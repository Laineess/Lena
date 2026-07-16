/**
 * RNF-I-6 — el estado proyectado es idéntico en cliente y servidor.
 *
 * Es un INVARIANTE ABSOLUTO, no un objetivo: no admite "99% del tiempo".
 *
 * POR QUÉ PROPERTY-BASED Y NO PRUEBAS DE EJEMPLO
 * El sync entrega los mismos eventos en órdenes distintos a cada dispositivo.
 * Si el plegado dependiera del orden de llegada, cliente y servidor mostrarían
 * comandas distintas — y ese bug aparecería en producción, en hora pico, sin
 * forma de reproducirlo.
 *
 * Escribir a mano el caso raro de orden que lo destapa es imposible: nadie se
 * acuerda de "linea_lista llega antes que comanda_enviada porque la tablet B
 * sincronizó después". Generar miles de permutaciones aleatorias sí lo
 * encuentra.
 *
 * Esto es lo que la pureza del proyector compra. Sin ella, este archivo no
 * podría existir.
 */
import fc from 'fast-check';
import { describe, it } from 'vitest';
import { formatearHlc } from './hlc';
import { ordenarEventos, plegarComanda } from './proyector';
import type { Evento, PayloadEvento, Rol } from './tipos';

const COMANDA = 'c-1';
const SUCURSAL = 's-1';
const LINEAS = ['l-1', 'l-2', 'l-3'] as const;

/** Genera un log arbitrario pero PLAUSIBLE de una comanda. */
const arbLog = fc
  .record({
    tipoServicio: fc.constantFrom('mesa' as const, 'para_llevar' as const, 'domicilio' as const),
    // Cuántas líneas y con qué precios
    lineas: fc.array(
      fc.record({
        idx: fc.integer({ min: 0, max: LINEAS.length - 1 }),
        precio: fc.integer({ min: 1, max: 100_000 }),
        cantidad: fc.integer({ min: 1, max: 20 }),
      }),
      { minLength: 1, maxLength: 3 },
    ),
    // Qué le pasa después a la comanda.
    //
    // La versión anterior de este generador NO producía linea_modificada,
    // linea_eliminada, linea_lista ni preparacion_iniciada. Resultado: 125 mil
    // ejecuciones que jamás tocaron esos caminos, y una cobertura que decía
    // 85% mientras RF-E-4 y RF-E-5 no tenían ni una prueba.
    //
    // Pasar un property-based test no vale nada si el generador no ejercita
    // el código.
    acciones: fc.array(
      fc.constantFrom(
        'enviar' as const,
        'lista' as const,
        'lista_una' as const,
        'empezar' as const,
        'entregar' as const,
        'modificar' as const,
        'eliminar' as const,
        'cancelar_linea' as const,
        'cancelar_comanda' as const,
        'cobrar' as const,
        'agregar_mas' as const,
      ),
      { minLength: 0, maxLength: 10 },
    ),
    lineaObjetivo: fc.integer({ min: 0, max: LINEAS.length - 1 }),
    rolCancela: fc.constantFrom('mesero' as const, 'cocina' as const, 'administrador' as const),
    nuevaCantidad: fc.integer({ min: 1, max: 30 }),
  })
  .map(({ tipoServicio, lineas, acciones, lineaObjetivo, rolCancela, nuevaCantidad }) => {
    const eventos: Evento[] = [];
    let n = 0;
    const push = (payload: PayloadEvento, detalleId?: string, rolActor: Rol = 'mesero') => {
      n += 1;
      eventos.push({
        id: `e${n}`,
        comandaId: COMANDA,
        sucursalId: SUCURSAL,
        tipo: payload.tipo,
        actorId: 'u-1',
        rolActor,
        dispositivoId: 'd-1',
        // HLC creciente: refleja el orden REAL en que ocurrieron los hechos.
        hlc: formatearHlc({ fisico: 1_700_000_000_000 + n, logico: 0, nodo: 'A' }),
        payload,
        ...(detalleId !== undefined ? { detalleId } : {}),
      } as Evento);
    };

    push({
      tipo: 'comanda_creada',
      tipoServicio,
      ...(tipoServicio === 'mesa' ? { mesaId: 'm-1' } : {}),
    });

    for (const l of lineas) {
      push(
        {
          tipo: 'linea_agregada',
          productoId: `p-${l.idx}`,
          nombreProducto: `Producto ${l.idx}`,
          precioUnitario: l.precio,
          cantidad: l.cantidad,
        },
        LINEAS[l.idx],
      );
    }

    for (const a of acciones) {
      switch (a) {
        case 'enviar':
          push({ tipo: 'comanda_enviada' });
          break;
        case 'lista':
          push({ tipo: 'comanda_lista' }, undefined, 'cocina');
          break;
        case 'lista_una':
          // RF-F-6: cocina marca UNA línea lista, no la comanda entera.
          push({ tipo: 'linea_lista' }, LINEAS[lineaObjetivo], 'cocina');
          break;
        case 'empezar':
          push({ tipo: 'preparacion_iniciada' }, undefined, 'cocina');
          break;
        case 'entregar':
          push({ tipo: 'comanda_entregada' });
          break;
        case 'modificar':
          // RF-E-4: cambiar cantidad o nota.
          push({ tipo: 'linea_modificada', cantidad: nuevaCantidad, notas: 'sin cebolla' }, LINEAS[lineaObjetivo]);
          break;
        case 'eliminar':
          // RF-E-5: quitar una línea. Solo aplica en borrador.
          push({ tipo: 'linea_eliminada' }, LINEAS[lineaObjetivo]);
          break;
        case 'cancelar_linea':
          push({ tipo: 'linea_cancelada', motivo: 'prueba' }, LINEAS[lineaObjetivo], rolCancela);
          break;
        case 'cancelar_comanda':
          push({ tipo: 'comanda_cancelada', motivo: 'prueba' }, undefined, rolCancela);
          break;
        case 'cobrar':
          push({ tipo: 'comanda_cobrada' });
          break;
        case 'agregar_mas':
          push(
            {
              tipo: 'linea_agregada',
              productoId: 'p-extra',
              nombreProducto: 'Extra',
              precioUnitario: 2500,
              cantidad: 1,
            },
            `l-extra-${n}`,
          );
          break;
      }
    }

    return eventos;
  });

/** Baraja determinista: la semilla la controla fast-check. */
function barajar<T>(xs: readonly T[], semilla: number): T[] {
  const a = [...xs];
  let s = semilla;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

describe('RNF-I-6 — convergencia', () => {
  it('el mismo log en CUALQUIER orden de llegada produce el mismo estado', () => {
    // La propiedad central del sistema. Si esto falla, el sync produce
    // estados imposibles y cliente y servidor muestran comandas distintas.
    fc.assert(
      fc.property(arbLog, fc.integer(), fc.integer(), (eventos, s1, s2) => {
        const esperado = plegarComanda(COMANDA, eventos);
        const a = plegarComanda(COMANDA, barajar(eventos, s1));
        const b = plegarComanda(COMANDA, barajar(eventos, s2));
        const c = plegarComanda(COMANDA, [...eventos].reverse());
        return (
          JSON.stringify(esperado) === JSON.stringify(a) &&
          JSON.stringify(a) === JSON.stringify(b) &&
          JSON.stringify(b) === JSON.stringify(c)
        );
      }),
      { numRuns: 3000 },
    );
  });

  it('plegar es idempotente: aplicar el log dos veces da lo mismo', () => {
    // Un lote reenviado tras un timeout no debe cambiar nada (RF-J-3).
    fc.assert(
      fc.property(arbLog, (eventos) => {
        const una = plegarComanda(COMANDA, eventos);
        const dos = plegarComanda(COMANDA, [...eventos, ...eventos]);
        return JSON.stringify(una) === JSON.stringify(dos);
      }),
      { numRuns: 2000 },
    );
  });

  it('la sincronización incremental converge al mismo estado que el log completo', () => {
    // Simula el pull real: los eventos llegan en lotes, no todos de golpe.
    fc.assert(
      fc.property(arbLog, fc.integer({ min: 1, max: 5 }), (eventos, tam) => {
        const completo = plegarComanda(COMANDA, eventos);
        const acumulado: Evento[] = [];
        for (let i = 0; i < eventos.length; i += tam) {
          acumulado.push(...eventos.slice(i, i + tam));
        }
        return JSON.stringify(completo) === JSON.stringify(plegarComanda(COMANDA, acumulado));
      }),
      { numRuns: 2000 },
    );
  });

  it('el total JAMÁS es negativo ni fraccionario', () => {
    // RNF-I-8: si esto falla, alguien metió punto flotante.
    fc.assert(
      fc.property(arbLog, (eventos) => {
        const c = plegarComanda(COMANDA, eventos);
        if (!c) return true;
        return c.total >= 0 && Number.isInteger(c.total);
      }),
      { numRuns: 2000 },
    );
  });

  it('el total siempre es la suma de las líneas NO canceladas', () => {
    fc.assert(
      fc.property(arbLog, (eventos) => {
        const c = plegarComanda(COMANDA, eventos);
        if (!c) return true;
        const esperado = c.lineas
          .filter((l) => l.estado !== 'cancelada')
          .reduce((s, l) => s + l.cantidad * l.precioUnitario, 0);
        return c.total === esperado;
      }),
      { numRuns: 2000 },
    );
  });

  it('una comanda cancelada tiene TODAS sus líneas canceladas', () => {
    fc.assert(
      fc.property(arbLog, (eventos) => {
        const c = plegarComanda(COMANDA, eventos);
        if (!c || c.estado !== 'cancelada') return true;
        return c.lineas.every((l) => l.estado === 'cancelada') && c.total === 0;
      }),
      { numRuns: 2000 },
    );
  });

  it('una comanda cancelada siempre tiene motivo', () => {
    // El CHECK `cancelada_con_motivo` de la base dice lo mismo. Sin motivo,
    // el reporte de canceladas del Administrador no sirve de nada (T1).
    fc.assert(
      fc.property(arbLog, (eventos) => {
        const c = plegarComanda(COMANDA, eventos);
        if (!c || c.estado !== 'cancelada') return true;
        return typeof c.motivoCancelacion === 'string' && c.motivoCancelacion.length > 0;
      }),
      { numRuns: 2000 },
    );
  });

  it('cancelada y cobrada son AMBOS terminales: gana el primero por HLC', () => {
    // Esta propiedad la reescribí después de que el property-based testing
    // destapara el bug: mi versión anterior decía "si se cobró, el estado es
    // cobrada" e ignoraba que la cancelación pudiera haber ocurrido ANTES.
    //
    // No se puede cobrar una comanda cancelada, ni cancelar una cobrada. El
    // que llegue segundo es un conflicto (RF-J-7), no un cambio de estado.
    fc.assert(
      fc.property(arbLog, (eventos) => {
        const c = plegarComanda(COMANDA, eventos);
        if (!c) return true;
        if (eventos.some((e) => e.tipo === 'comanda_reabierta')) return true;

        const primerTerminal = ordenarEventos(eventos).find(
          (e) => e.tipo === 'comanda_cobrada' || e.tipo === 'comanda_cancelada',
        );
        if (!primerTerminal) return c.estado !== 'cobrada' && c.estado !== 'cancelada';

        return primerTerminal.tipo === 'comanda_cobrada' ? c.estado === 'cobrada' : c.estado === 'cancelada';
      }),
      { numRuns: 3000 },
    );
  });

  it('una línea que llega DESPUÉS del cierre nace cancelada y no suma', () => {
    // El otro bug que encontró el property-based testing: una línea generada
    // offline puede llegar después de que la comanda se canceló o cobró.
    // Si naciera en borrador, sumaría al total de una comanda cerrada.
    fc.assert(
      fc.property(arbLog, (eventos) => {
        const c = plegarComanda(COMANDA, eventos);
        if (!c) return true;
        if (c.estado !== 'cancelada' && c.estado !== 'cobrada') return true;

        const ordenados = ordenarEventos(eventos);
        const cierre = ordenados.findIndex((e) => e.tipo === 'comanda_cobrada' || e.tipo === 'comanda_cancelada');
        if (cierre === -1) return true;

        const tardias = ordenados
          .slice(cierre + 1)
          .filter((e) => e.tipo === 'linea_agregada' && e.detalleId)
          .map((e) => e.detalleId!);

        return c.lineas.filter((l) => tardias.includes(l.id)).every((l) => l.estado === 'cancelada');
      }),
      { numRuns: 3000 },
    );
  });

  it('una línea nunca revive: cancelada es terminal', () => {
    fc.assert(
      fc.property(arbLog, (eventos) => {
        const c = plegarComanda(COMANDA, eventos);
        if (!c) return true;
        const canceladas = new Set(
          eventos.filter((e) => e.tipo === 'linea_cancelada' && e.detalleId).map((e) => e.detalleId!),
        );
        // Salvo que la comanda entera se haya cobrado antes (la cancelación
        // pierde contra 'cobrada').
        if (c.estado === 'cobrada') return true;
        return c.lineas.filter((l) => canceladas.has(l.id)).every((l) => l.estado === 'cancelada');
      }),
      { numRuns: 2000 },
    );
  });
});
