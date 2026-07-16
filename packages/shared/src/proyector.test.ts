import { describe, expect, it } from 'vitest';
import { RelojHlc } from './hlc';
import { generaMerma } from './maquina-estados';
import { calcularMermaSiSeCancela, calcularMermas, estadoLineaDe, pagosCuadran, plegarComanda } from './proyector';
import type { Evento, PayloadEvento, Rol } from './tipos';
import { aCentavos, aPesos, formatearMoneda } from './tipos';

// ── Constructor de eventos para las pruebas ──────────────────

const COMANDA = 'c-1';
const SUCURSAL = 's-1';

function constructor(nodo = 'A') {
  const reloj = new RelojHlc(
    nodo,
    (() => {
      let t = 1_700_000_000_000;
      return () => (t += 1);
    })(),
  );
  let n = 0;

  // Genérico sobre el payload a propósito: así `tipo` se DERIVA de
  // `payload.tipo` y el helper no puede construir un evento desalineado.
  // Ojo: eso es justo lo que ocultó el hueco de seguridad —el helper hacía
  // imposible expresar el desajuste que el cable sí permitía. La correlación
  // real la impone el tipo `Evento`; esto solo evita repetirla a mano.
  return function ev<P extends PayloadEvento>(
    payload: P,
    opts: { detalleId?: string; actorId?: string; rolActor?: Rol } = {},
  ): Evento {
    n += 1;
    return {
      id: `${nodo}-e${n}`,
      comandaId: COMANDA,
      sucursalId: SUCURSAL,
      tipo: payload.tipo,
      actorId: opts.actorId ?? 'u-mesero',
      rolActor: opts.rolActor ?? 'mesero',
      dispositivoId: `disp-${nodo}`,
      hlc: reloj.ahora(),
      payload,
      ...(opts.detalleId !== undefined ? { detalleId: opts.detalleId } : {}),
    } as Evento;
  };
}

const PASTOR: PayloadEvento = {
  tipo: 'linea_agregada',
  productoId: 'p-pastor',
  nombreProducto: 'Pastor',
  precioUnitario: 1800,
  cantidad: 3,
};

// ── Merma registrada (RF-E-19) ───────────────────────────────

describe('calcularMermas', () => {
  it('el mesero cancela una línea YA enviada → merma con costo y estado', () => {
    const ev = constructor();
    const eventos = [
      ev({ tipo: 'comanda_creada', tipoServicio: 'para_llevar' }),
      ev(PASTOR, { detalleId: 'd-1' }),
      ev({ tipo: 'comanda_enviada' }),
      ev({ tipo: 'linea_cancelada', motivo: 'el cliente se fue' }, { detalleId: 'd-1' }),
    ];
    const mermas = calcularMermas(COMANDA, eventos);
    expect(mermas).toHaveLength(1);
    expect(mermas[0]).toMatchObject({
      cantidad: 3,
      costoEstimado: 5400,
      estadoAlCancelar: 'pendiente',
      motivo: 'el cliente se fue',
    });
  });

  it('la cocina cancela → NO hay merma (RF-F-14)', () => {
    const ev = constructor();
    const eventos = [
      ev({ tipo: 'comanda_creada', tipoServicio: 'para_llevar' }),
      ev(PASTOR, { detalleId: 'd-1' }),
      ev({ tipo: 'comanda_enviada' }),
      ev({ tipo: 'linea_cancelada', motivo: 'se acabó el pastor' }, { detalleId: 'd-1', rolActor: 'cocina' }),
    ];
    expect(calcularMermas(COMANDA, eventos)).toHaveLength(0);
  });

  it('cancelar en borrador (sin enviar) → NO hay merma', () => {
    const ev = constructor();
    const eventos = [
      ev({ tipo: 'comanda_creada', tipoServicio: 'para_llevar' }),
      ev(PASTOR, { detalleId: 'd-1' }),
      ev({ tipo: 'linea_cancelada', motivo: 'me equivoqué' }, { detalleId: 'd-1' }),
    ];
    expect(calcularMermas(COMANDA, eventos)).toHaveLength(0);
  });

  it('comanda_cancelada merma todas las líneas ya enviadas', () => {
    const ev = constructor();
    const eventos = [
      ev({ tipo: 'comanda_creada', tipoServicio: 'para_llevar' }),
      ev(PASTOR, { detalleId: 'd-1' }),
      ev({ ...PASTOR, cantidad: 1 }, { detalleId: 'd-2' }),
      ev({ tipo: 'comanda_enviada' }),
      ev({ tipo: 'comanda_cancelada', motivo: 'se fue la luz' }),
    ];
    const mermas = calcularMermas(COMANDA, eventos);
    expect(mermas).toHaveLength(2);
    expect(mermas.reduce((s, m) => s + m.costoEstimado, 0)).toBe(5400 + 1800);
  });

  it('el id de la merma es determinista: mismo log, mismo id', () => {
    const ev = constructor();
    const eventos = [
      ev({ tipo: 'comanda_creada', tipoServicio: 'para_llevar' }),
      ev(PASTOR, { detalleId: 'd-1' }),
      ev({ tipo: 'comanda_enviada' }),
      ev({ tipo: 'linea_cancelada', motivo: 'x' }, { detalleId: 'd-1' }),
    ];
    expect(calcularMermas(COMANDA, eventos)[0]!.id).toBe(calcularMermas(COMANDA, eventos)[0]!.id);
  });
});

// ── Ciclo básico ─────────────────────────────────────────────

describe('ciclo de vida', () => {
  it('comanda vacía queda en borrador', () => {
    const ev = constructor();
    const c = plegarComanda(COMANDA, [ev({ tipo: 'comanda_creada', tipoServicio: 'para_llevar' })]);
    expect(c?.estado).toBe('borrador');
    expect(c?.total).toBe(0);
  });

  it('domicilio: los datos del cliente viajan en comanda_creada (RF-E-17)', () => {
    const ev = constructor();
    const c = plegarComanda(COMANDA, [
      ev({
        tipo: 'comanda_creada',
        tipoServicio: 'domicilio',
        domicilio: { nombreCliente: 'María', telefono: '7711234567', direccion: 'Juárez 45' },
      }),
    ]);
    expect(c?.tipoServicio).toBe('domicilio');
    expect(c?.domicilio).toEqual({ nombreCliente: 'María', telefono: '7711234567', direccion: 'Juárez 45' });
  });

  it('RF-E-7: una adición NO reinicia el estado de las líneas anteriores', () => {
    const ev = constructor();
    const eventos = [
      ev({ tipo: 'comanda_creada', tipoServicio: 'para_llevar' }),
      ev(PASTOR, { detalleId: 'd-1' }),
      ev({ tipo: 'comanda_enviada' }),
      ev({ tipo: 'linea_lista' }, { rolActor: 'cocina', detalleId: 'd-1' }),
      // Adición: nueva línea + otro envío.
      ev({ ...PASTOR, cantidad: 1 }, { detalleId: 'd-2' }),
      ev({ tipo: 'comanda_enviada' }),
    ];
    const c = plegarComanda(COMANDA, eventos);
    const l1 = c?.lineas.find((l) => l.id === 'd-1');
    const l2 = c?.lineas.find((l) => l.id === 'd-2');
    // La primera línea sigue lista; el segundo envío no la retrocedió.
    expect(l1?.estado).toBe('lista');
    expect(l2?.estado).toBe('pendiente');
    // La comanda vuelve a 'enviada' porque hay algo nuevo en cocina.
    expect(c?.estado).toBe('enviada');
  });

  it('sin eventos no hay comanda', () => {
    expect(plegarComanda(COMANDA, [])).toBeNull();
  });

  it('recorrido completo: crear → enviar → lista → entregar → cobrar', () => {
    const ev = constructor();
    const eventos = [
      ev({ tipo: 'comanda_creada', tipoServicio: 'mesa', mesaId: 'm-4' }),
      ev(PASTOR, { detalleId: 'l-1' }),
      ev({ tipo: 'comanda_enviada' }),
      ev({ tipo: 'comanda_lista' }, { rolActor: 'cocina' }),
      ev({ tipo: 'comanda_entregada' }),
      ev({ tipo: 'pago_registrado', metodo: 'efectivo', monto: 5400, recibido: 10000 }),
      ev({ tipo: 'comanda_cobrada' }),
    ];
    const c = plegarComanda(COMANDA, eventos)!;
    expect(c.estado).toBe('cobrada');
    expect(c.total).toBe(5400);
    expect(pagosCuadran(c)).toBe(true);
  });
});

// ── RF-E-7: el caso que más pasa en una taquería ─────────────

describe('RF-E-7 — la mesa pidió más tacos', () => {
  it('agregar una línea a una comanda LISTA la regresa a enviada', () => {
    const ev = constructor();
    const eventos = [
      ev({ tipo: 'comanda_creada', tipoServicio: 'mesa', mesaId: 'm-4' }),
      ev(PASTOR, { detalleId: 'l-1' }),
      ev({ tipo: 'comanda_enviada' }),
      ev({ tipo: 'comanda_lista' }, { rolActor: 'cocina' }),
    ];
    expect(plegarComanda(COMANDA, eventos)!.estado).toBe('lista');

    // El cliente pide más
    eventos.push(ev({ ...PASTOR, nombreProducto: 'Árabe', cantidad: 2 }, { detalleId: 'l-2' }));
    eventos.push(ev({ tipo: 'comanda_enviada' }));

    const c = plegarComanda(COMANDA, eventos)!;
    // Sin la derivación del estado, esto seguiría diciendo 'lista' y cocina
    // nunca vería los tacos nuevos.
    expect(c.estado).toBe('enviada');
    // La línea vieja conserva su estado: no se reinicia.
    expect(c.lineas.find((l) => l.id === 'l-1')!.estado).toBe('lista');
    expect(c.lineas.find((l) => l.id === 'l-2')!.estado).toBe('pendiente');
  });

  it('agregar una línea después de ENTREGADA saca a la comanda de entregada', () => {
    // El paso 6 del proyector: 'entregada' no es un interruptor permanente.
    const ev = constructor();
    const eventos = [
      ev({ tipo: 'comanda_creada', tipoServicio: 'mesa', mesaId: 'm-4' }),
      ev(PASTOR, { detalleId: 'l-1' }),
      ev({ tipo: 'comanda_enviada' }),
      ev({ tipo: 'comanda_lista' }, { rolActor: 'cocina' }),
      ev({ tipo: 'comanda_entregada' }),
    ];
    expect(plegarComanda(COMANDA, eventos)!.estado).toBe('entregada');

    eventos.push(ev({ ...PASTOR, cantidad: 1 }, { detalleId: 'l-2' }));
    eventos.push(ev({ tipo: 'comanda_enviada' }));

    // Si siguiera 'entregada', se podría cobrar sin servir lo nuevo.
    expect(plegarComanda(COMANDA, eventos)!.estado).toBe('enviada');
  });
});

// ── ADR-006: el dinero histórico es inmutable ────────────────

describe('ADR-006 / RNF-I-1 — el precio es un hecho del pasado', () => {
  it('el total usa el snapshot de la línea, no el catálogo', () => {
    const ev = constructor();
    const c = plegarComanda(COMANDA, [
      ev({ tipo: 'comanda_creada', tipoServicio: 'para_llevar' }),
      // El taco costaba $18 al momento de la venta
      ev({ ...PASTOR, precioUnitario: 1800, cantidad: 3 }, { detalleId: 'l-1' }),
    ])!;
    expect(c.total).toBe(5400);

    // Aunque el catálogo cambie a $20 después, este total NO se mueve: el
    // precio vive copiado en el evento, no se consulta a nadie.
    expect(
      plegarComanda(COMANDA, [
        ev({ tipo: 'comanda_creada', tipoServicio: 'para_llevar' }),
        ev({ ...PASTOR, precioUnitario: 1800, cantidad: 3 }, { detalleId: 'l-1' }),
      ])!.total,
    ).toBe(5400);
  });

  it('las líneas canceladas no suman al total', () => {
    const ev = constructor();
    const c = plegarComanda(COMANDA, [
      ev({ tipo: 'comanda_creada', tipoServicio: 'para_llevar' }),
      ev(PASTOR, { detalleId: 'l-1' }),
      ev({ ...PASTOR, cantidad: 2 }, { detalleId: 'l-2' }),
      ev({ tipo: 'comanda_enviada' }),
      ev({ tipo: 'linea_cancelada', motivo: 'no lo quiso' }, { detalleId: 'l-2' }),
    ])!;
    expect(c.total).toBe(5400); // solo l-1
  });
});

// ── La regla de la merma ─────────────────────────────────────

describe('RF-E-19 / RF-F-14 — quién cancela codifica lo que sabe', () => {
  it('mesero cancela algo ya en cocina → SÍ hay merma', () => {
    const ev = constructor();
    const c = plegarComanda(COMANDA, [
      ev({ tipo: 'comanda_creada', tipoServicio: 'mesa', mesaId: 'm-4' }),
      ev(PASTOR, { detalleId: 'l-1' }),
      ev({ tipo: 'comanda_enviada' }),
    ])!;
    const merma = calcularMermaSiSeCancela(c, 'mesero');
    expect(merma.lineas).toHaveLength(1);
    expect(merma.costoTotal).toBe(5400);
  });

  it('COCINA cancela lo mismo → NO hay merma', () => {
    // Cocina cancela porque no PUDO prepararlo (se acabó el insumo).
    // Esa comida nunca existió: no hay nada que mermar.
    const ev = constructor();
    const c = plegarComanda(COMANDA, [
      ev({ tipo: 'comanda_creada', tipoServicio: 'mesa', mesaId: 'm-4' }),
      ev(PASTOR, { detalleId: 'l-1' }),
      ev({ tipo: 'comanda_enviada' }),
    ])!;
    const merma = calcularMermaSiSeCancela(c, 'cocina');
    expect(merma.lineas).toHaveLength(0);
    expect(merma.costoTotal).toBe(0);
  });

  it('cancelar algo en BORRADOR no genera merma para nadie', () => {
    const ev = constructor();
    const c = plegarComanda(COMANDA, [
      ev({ tipo: 'comanda_creada', tipoServicio: 'para_llevar' }),
      ev(PASTOR, { detalleId: 'l-1' }),
    ])!;
    expect(calcularMermaSiSeCancela(c, 'mesero').costoTotal).toBe(0);
    expect(calcularMermaSiSeCancela(c, 'administrador').costoTotal).toBe(0);
  });

  it('la tabla de verdad completa', () => {
    expect(generaMerma('borrador', 'mesero')).toBe(false);
    expect(generaMerma('borrador', 'cocina')).toBe(false);
    expect(generaMerma('pendiente', 'mesero')).toBe(true);
    expect(generaMerma('pendiente', 'administrador')).toBe(true);
    expect(generaMerma('pendiente', 'cocina')).toBe(false);
    expect(generaMerma('lista', 'mesero')).toBe(true);
    expect(generaMerma('lista', 'cocina')).toBe(false);
    expect(generaMerma('cancelada', 'mesero')).toBe(false);
  });
});

// ── RF-E-21 y CU-06 F4 ───────────────────────────────────────

describe('conflictos de negocio', () => {
  it('RF-E-21: la cancelación gana aunque cocina marque lista al mismo tiempo', () => {
    const ev = constructor();
    const c = plegarComanda(COMANDA, [
      ev({ tipo: 'comanda_creada', tipoServicio: 'mesa', mesaId: 'm-4' }),
      ev(PASTOR, { detalleId: 'l-1' }),
      ev({ tipo: 'comanda_enviada' }),
      ev({ tipo: 'comanda_lista' }, { rolActor: 'cocina' }),
      ev({ tipo: 'comanda_cancelada', motivo: 'el cliente se fue' }),
    ])!;
    expect(c.estado).toBe('cancelada');
    expect(c.motivoCancelacion).toBe('el cliente se fue');
  });

  it('CU-06 F4: contra COBRADA, la cancelación pierde', () => {
    // El dinero ya entró y puede estar en un turno cerrado. Revertirlo en
    // automático descuadraría un corte firmado.
    const ev = constructor();
    const c = plegarComanda(COMANDA, [
      ev({ tipo: 'comanda_creada', tipoServicio: 'para_llevar' }),
      ev(PASTOR, { detalleId: 'l-1' }),
      ev({ tipo: 'comanda_enviada' }),
      ev({ tipo: 'comanda_lista' }, { rolActor: 'cocina' }),
      ev({ tipo: 'comanda_entregada' }),
      ev({ tipo: 'pago_registrado', metodo: 'efectivo', monto: 5400, recibido: 5400 }),
      ev({ tipo: 'comanda_cobrada' }),
      ev({ tipo: 'comanda_cancelada', motivo: 'llegó tarde por sync' }),
    ])!;
    expect(c.estado).toBe('cobrada');
  });

  it('el administrador puede reabrir una comanda cobrada', () => {
    const ev = constructor();
    const c = plegarComanda(COMANDA, [
      ev({ tipo: 'comanda_creada', tipoServicio: 'para_llevar' }),
      ev(PASTOR, { detalleId: 'l-1' }),
      ev({ tipo: 'comanda_enviada' }),
      ev({ tipo: 'comanda_lista' }, { rolActor: 'cocina' }),
      ev({ tipo: 'comanda_entregada' }),
      ev({ tipo: 'comanda_cobrada' }),
      ev({ tipo: 'comanda_reabierta', motivo: 'se cobró de más' }, { rolActor: 'administrador' }),
    ])!;
    expect(c.estado).toBe('entregada');
  });
});

// ── Pago dividido ────────────────────────────────────────────

describe('RF-G-3 / RF-G-6 — pago dividido', () => {
  it('varios métodos suman al total', () => {
    const ev = constructor();
    const c = plegarComanda(COMANDA, [
      ev({ tipo: 'comanda_creada', tipoServicio: 'mesa', mesaId: 'm-4' }),
      ev({ ...PASTOR, cantidad: 5 }, { detalleId: 'l-1' }), // 5 × $18 = $90
      ev({ tipo: 'comanda_enviada' }),
      ev({ tipo: 'pago_registrado', metodo: 'efectivo', monto: 5000, recibido: 5000 }),
      ev({ tipo: 'pago_registrado', metodo: 'tarjeta', monto: 4000 }),
    ])!;
    expect(c.total).toBe(9000);
    expect(pagosCuadran(c)).toBe(true);
  });

  it('si los pagos no cuadran, no cuadran', () => {
    const ev = constructor();
    const c = plegarComanda(COMANDA, [
      ev({ tipo: 'comanda_creada', tipoServicio: 'mesa', mesaId: 'm-4' }),
      ev(PASTOR, { detalleId: 'l-1' }),
      ev({ tipo: 'comanda_enviada' }),
      ev({ tipo: 'pago_registrado', metodo: 'efectivo', monto: 5000, recibido: 5000 }),
    ])!;
    expect(pagosCuadran(c)).toBe(false);
  });
});

// ── Los caminos que la cobertura destapó como ciegos ─────────

describe('RF-E-4 — modificar una línea', () => {
  it('cambiar la cantidad recalcula el total', () => {
    const ev = constructor();
    const c = plegarComanda(COMANDA, [
      ev({ tipo: 'comanda_creada', tipoServicio: 'para_llevar' }),
      ev(PASTOR, { detalleId: 'l-1' }), // 3 × $18 = $54
      ev({ tipo: 'linea_modificada', cantidad: 5 }, { detalleId: 'l-1' }),
    ])!;
    expect(c.lineas[0]!.cantidad).toBe(5);
    expect(c.total).toBe(9000);
  });

  it('cambiar solo la nota conserva la cantidad', () => {
    const ev = constructor();
    const c = plegarComanda(COMANDA, [
      ev({ tipo: 'comanda_creada', tipoServicio: 'para_llevar' }),
      ev(PASTOR, { detalleId: 'l-1' }),
      ev({ tipo: 'linea_modificada', notas: 'sin cebolla' }, { detalleId: 'l-1' }),
    ])!;
    expect(c.lineas[0]!.notas).toBe('sin cebolla');
    expect(c.lineas[0]!.cantidad).toBe(3);
  });

  it('gana la modificación con HLC mayor (last-write-wins)', () => {
    // Es una cantidad, no dinero histórico: aquí LWW es correcto.
    const ev = constructor();
    const c = plegarComanda(COMANDA, [
      ev({ tipo: 'comanda_creada', tipoServicio: 'para_llevar' }),
      ev(PASTOR, { detalleId: 'l-1' }),
      ev({ tipo: 'linea_modificada', cantidad: 5 }, { detalleId: 'l-1' }),
      ev({ tipo: 'linea_modificada', cantidad: 2 }, { detalleId: 'l-1' }),
    ])!;
    expect(c.lineas[0]!.cantidad).toBe(2);
  });

  it('NO se modifica una línea ya cancelada', () => {
    const ev = constructor();
    const c = plegarComanda(COMANDA, [
      ev({ tipo: 'comanda_creada', tipoServicio: 'para_llevar' }),
      ev(PASTOR, { detalleId: 'l-1' }),
      ev({ tipo: 'comanda_enviada' }),
      ev({ tipo: 'linea_cancelada', motivo: 'x' }, { detalleId: 'l-1' }),
      ev({ tipo: 'linea_modificada', cantidad: 99 }, { detalleId: 'l-1' }),
    ])!;
    expect(c.lineas[0]!.cantidad).toBe(3);
    expect(c.total).toBe(0);
  });
});

describe('RF-E-5 — eliminar una línea', () => {
  it('se elimina en borrador', () => {
    const ev = constructor();
    const c = plegarComanda(COMANDA, [
      ev({ tipo: 'comanda_creada', tipoServicio: 'para_llevar' }),
      ev(PASTOR, { detalleId: 'l-1' }),
      ev({ tipo: 'linea_eliminada' }, { detalleId: 'l-1' }),
    ])!;
    expect(c.lineas).toHaveLength(0);
    expect(c.total).toBe(0);
  });

  it('NO se elimina una línea ya enviada a cocina', () => {
    // Una línea enviada se CANCELA (y puede mermar), no se borra. Borrarla
    // haría desaparecer la pérdida — que es el problema de la Visión §1.
    const ev = constructor();
    const c = plegarComanda(COMANDA, [
      ev({ tipo: 'comanda_creada', tipoServicio: 'para_llevar' }),
      ev(PASTOR, { detalleId: 'l-1' }),
      ev({ tipo: 'comanda_enviada' }),
      ev({ tipo: 'linea_eliminada' }, { detalleId: 'l-1' }),
    ])!;
    expect(c.lineas).toHaveLength(1);
    expect(c.total).toBe(5400);
  });
});

describe('RF-F-6 — cocina marca UNA línea lista', () => {
  it('solo esa línea cambia; la comanda sigue enviada', () => {
    const ev = constructor();
    const c = plegarComanda(COMANDA, [
      ev({ tipo: 'comanda_creada', tipoServicio: 'mesa', mesaId: 'm-4' }),
      ev(PASTOR, { detalleId: 'l-1' }),
      ev({ ...PASTOR, cantidad: 2 }, { detalleId: 'l-2' }),
      ev({ tipo: 'comanda_enviada' }),
      ev({ tipo: 'linea_lista' }, { detalleId: 'l-1', rolActor: 'cocina' }),
    ])!;
    expect(c.lineas.find((l) => l.id === 'l-1')!.estado).toBe('lista');
    expect(c.lineas.find((l) => l.id === 'l-2')!.estado).toBe('pendiente');
    // Basta una línea pendiente para que la comanda no esté lista.
    expect(c.estado).toBe('enviada');
  });

  it('cuando TODAS las líneas están listas, la comanda queda lista', () => {
    const ev = constructor();
    const c = plegarComanda(COMANDA, [
      ev({ tipo: 'comanda_creada', tipoServicio: 'mesa', mesaId: 'm-4' }),
      ev(PASTOR, { detalleId: 'l-1' }),
      ev({ ...PASTOR, cantidad: 2 }, { detalleId: 'l-2' }),
      ev({ tipo: 'comanda_enviada' }),
      ev({ tipo: 'linea_lista' }, { detalleId: 'l-1', rolActor: 'cocina' }),
      ev({ tipo: 'linea_lista' }, { detalleId: 'l-2', rolActor: 'cocina' }),
    ])!;
    expect(c.estado).toBe('lista');
  });

  it('no se marca lista una línea aún en borrador', () => {
    const ev = constructor();
    const c = plegarComanda(COMANDA, [
      ev({ tipo: 'comanda_creada', tipoServicio: 'para_llevar' }),
      ev(PASTOR, { detalleId: 'l-1' }),
      ev({ tipo: 'linea_lista' }, { detalleId: 'l-1', rolActor: 'cocina' }),
    ])!;
    expect(c.lineas[0]!.estado).toBe('borrador');
  });
});

describe('RF-F-3 — preparación iniciada (reservado, sin UI en el MVP)', () => {
  it('las líneas pendientes pasan a en_preparacion', () => {
    const ev = constructor();
    const c = plegarComanda(COMANDA, [
      ev({ tipo: 'comanda_creada', tipoServicio: 'para_llevar' }),
      ev(PASTOR, { detalleId: 'l-1' }),
      ev({ tipo: 'comanda_enviada' }),
      ev({ tipo: 'preparacion_iniciada' }, { rolActor: 'cocina' }),
    ])!;
    expect(c.lineas[0]!.estado).toBe('en_preparacion');
    expect(c.estado).toBe('en_preparacion');
  });

  it('y sí generan merma si se cancelan', () => {
    const ev = constructor();
    const c = plegarComanda(COMANDA, [
      ev({ tipo: 'comanda_creada', tipoServicio: 'para_llevar' }),
      ev(PASTOR, { detalleId: 'l-1' }),
      ev({ tipo: 'comanda_enviada' }),
      ev({ tipo: 'preparacion_iniciada' }, { rolActor: 'cocina' }),
    ])!;
    expect(calcularMermaSiSeCancela(c, 'mesero').costoTotal).toBe(5400);
  });
});

describe('estadoLineaDe', () => {
  it('devuelve el estado de una línea existente', () => {
    const ev = constructor();
    const c = plegarComanda(COMANDA, [
      ev({ tipo: 'comanda_creada', tipoServicio: 'para_llevar' }),
      ev(PASTOR, { detalleId: 'l-1' }),
      ev({ tipo: 'comanda_enviada' }),
    ])!;
    expect(estadoLineaDe(c, 'l-1')).toBe('pendiente');
  });

  it('devuelve null si la línea no existe', () => {
    const ev = constructor();
    const c = plegarComanda(COMANDA, [ev({ tipo: 'comanda_creada', tipoServicio: 'para_llevar' })])!;
    expect(estadoLineaDe(c, 'no-existe')).toBeNull();
  });
});

describe('eventos sin detalleId no rompen nada', () => {
  it('linea_agregada sin detalleId se ignora', () => {
    const ev = constructor();
    const c = plegarComanda(COMANDA, [
      ev({ tipo: 'comanda_creada', tipoServicio: 'para_llevar' }),
      ev(PASTOR), // sin detalleId
    ])!;
    expect(c.lineas).toHaveLength(0);
  });

  it('eventos de otra comanda se ignoran', () => {
    const ev = constructor();
    const ajeno: Evento = { ...ev(PASTOR, { detalleId: 'x' }), comandaId: 'otra' };
    const c = plegarComanda(COMANDA, [ev({ tipo: 'comanda_creada', tipoServicio: 'para_llevar' }), ajeno])!;
    expect(c.lineas).toHaveLength(0);
  });

  it('sin comanda_creada no hay comanda, aunque haya líneas', () => {
    const ev = constructor();
    expect(plegarComanda(COMANDA, [ev(PASTOR, { detalleId: 'l-1' })])).toBeNull();
  });
});

// ── Dinero: RNF-I-8 ──────────────────────────────────────────

describe('RNF-I-8 — nada de punto flotante', () => {
  it('el bug clásico del float NO ocurre con centavos enteros', () => {
    // 0.1 + 0.2 = 0.30000000000000004 en float.
    expect(aCentavos('0.10') + aCentavos('0.20')).toBe(30);
    expect(aPesos(aCentavos('0.10') + aCentavos('0.20'))).toBe('0.30');
  });

  it('ida y vuelta pesos ↔ centavos', () => {
    for (const p of ['0.00', '0.01', '18.00', '18.55', '999.99', '12345.67']) {
      expect(aPesos(aCentavos(p))).toBe(p);
    }
  });

  it('18.55 no se trunca a 18.54', () => {
    // 18.55 * 100 da 1854.9999... en binario. Sin Math.round, perderíamos
    // un centavo por línea y el corte fallaría sin explicación.
    expect(aCentavos('18.55')).toBe(1855);
  });

  it('aPesos rechaza centavos no enteros', () => {
    expect(() => aPesos(18.5)).toThrow();
  });

  it('aCentavos rechaza basura', () => {
    expect(() => aCentavos('no es un número')).toThrow();
    expect(() => aCentavos(Number.NaN)).toThrow();
    expect(() => aCentavos(Number.POSITIVE_INFINITY)).toThrow();
  });

  it('los montos negativos se formatean bien', () => {
    // No hay totales negativos hoy, pero un ajuste de corte sí puede serlo.
    expect(aPesos(-1850)).toBe('-18.50');
    expect(aPesos(-5)).toBe('-0.05');
    expect(formatearMoneda(-1850)).toBe('$-18.50');
  });

  it('acepta número además de string', () => {
    expect(aCentavos(18.5)).toBe(1850);
    expect(aCentavos(0)).toBe(0);
  });

  it('un total grande no pierde precisión', () => {
    const ev = constructor();
    const c = plegarComanda(COMANDA, [
      ev({ tipo: 'comanda_creada', tipoServicio: 'para_llevar' }),
      ev({ ...PASTOR, precioUnitario: aCentavos('18.55'), cantidad: 100 }, { detalleId: 'l-1' }),
    ])!;
    expect(c.total).toBe(185500);
    expect(aPesos(c.total)).toBe('1855.00');
  });
});
