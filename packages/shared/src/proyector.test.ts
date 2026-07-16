import { describe, expect, it } from 'vitest';
import { RelojHlc } from './hlc';
import { generaMerma } from './maquina-estados';
import {
  calcularMermaSiSeCancela,
  pagosCuadran,
  plegarComanda,
} from './proyector';
import type { Evento, PayloadEvento, Rol } from './tipos';
import { aCentavos, aPesos } from './tipos';

// ── Constructor de eventos para las pruebas ──────────────────

const COMANDA = 'c-1';
const SUCURSAL = 's-1';

function constructor(nodo = 'A') {
  const reloj = new RelojHlc(nodo, (() => {
    let t = 1_700_000_000_000;
    return () => (t += 1);
  })());
  let n = 0;

  return function ev(
    payload: PayloadEvento,
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
    };
  };
}

const PASTOR: PayloadEvento = {
  tipo: 'linea_agregada',
  productoId: 'p-pastor',
  nombreProducto: 'Pastor',
  precioUnitario: 1800,
  cantidad: 3,
};

// ── Ciclo básico ─────────────────────────────────────────────

describe('ciclo de vida', () => {
  it('comanda vacía queda en borrador', () => {
    const ev = constructor();
    const c = plegarComanda(COMANDA, [ev({ tipo: 'comanda_creada', tipoServicio: 'para_llevar' })]);
    expect(c?.estado).toBe('borrador');
    expect(c?.total).toBe(0);
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
    expect(plegarComanda(COMANDA, [
      ev({ tipo: 'comanda_creada', tipoServicio: 'para_llevar' }),
      ev({ ...PASTOR, precioUnitario: 1800, cantidad: 3 }, { detalleId: 'l-1' }),
    ])!.total).toBe(5400);
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
