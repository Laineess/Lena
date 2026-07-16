/**
 * Proyector de estado (`05. Casos de uso` §4.3).
 *
 * FUNCIÓN PURA. Es la ÚNICA definición del estado de una comanda, y la
 * importan cliente y servidor tal cual, sin adaptadores (RNF-M-7).
 *
 * Si esta lógica se implementara dos veces, algún día divergirían — y el bug
 * aparecería en producción, en hora pico, sin forma de reproducirlo.
 *
 * EL LOG ES LA VERDAD (P1 / ADR-002). `comanda.estado` y `comanda.total` en la
 * base son proyecciones cacheadas: siempre recomputables plegando eventos.
 */
import { compararHlc } from './hlc';
import { generaMerma, transicionLineaValida } from './maquina-estados';
import type {
  Comanda,
  EstadoComanda,
  EstadoLinea,
  Evento,
  Linea,
  Pago,
  ResumenMerma,
} from './tipos';

/** Ordena por HLC. NO por `ts_cliente`: los relojes de tablet mienten. */
export function ordenarEventos(eventos: readonly Evento[]): Evento[] {
  return [...eventos].sort((a, b) => compararHlc(a.hlc, b.hlc));
}

interface Acumulador {
  creada: boolean;
  sucursalId: string;
  meseroId: string;
  tipoServicio: Comanda['tipoServicio'];
  mesaId?: string;
  lineas: Map<string, Linea>;
  pagos: Pago[];
  cancelada: { motivo: string } | null;
  cobrada: boolean;
  /** HLC del último `comanda_entregada`. Ver paso 6 de `estadoDerivado`. */
  entregadaHlc: string | null;
}

/**
 * Pliega el log y devuelve la comanda completa.
 *
 * Los eventos se ordenan por HLC antes de plegar: **el mismo conjunto de
 * eventos, en cualquier orden de llegada, produce el mismo resultado.** Esa es
 * la propiedad que sostiene RNF-I-6 y la que verifica el property-based
 * testing.
 */
export function plegarComanda(comandaId: string, eventos: readonly Evento[]): Comanda | null {
  const propios = ordenarEventos(eventos.filter((e) => e.comandaId === comandaId));
  if (propios.length === 0) return null;

  const acc: Acumulador = {
    creada: false,
    sucursalId: '',
    meseroId: '',
    tipoServicio: 'mesa',
    lineas: new Map(),
    pagos: [],
    cancelada: null,
    cobrada: false,
    entregadaHlc: null,
  };

  for (const e of propios) aplicar(acc, e);
  if (!acc.creada) return null;

  const lineas = [...acc.lineas.values()];
  const estado = estadoDerivado(acc, lineas);

  return {
    id: comandaId,
    sucursalId: acc.sucursalId,
    tipoServicio: acc.tipoServicio,
    ...(acc.mesaId !== undefined ? { mesaId: acc.mesaId } : {}),
    meseroId: acc.meseroId,
    estado,
    lineas,
    pagos: acc.pagos,
    total: calcularTotal(lineas),
    ...(acc.cancelada ? { motivoCancelacion: acc.cancelada.motivo } : {}),
  };
}

function aplicar(acc: Acumulador, e: Evento): void {
  const p = e.payload;

  switch (p.tipo) {
    case 'comanda_creada':
      acc.creada = true;
      acc.sucursalId = e.sucursalId;
      acc.meseroId = e.actorId;
      acc.tipoServicio = p.tipoServicio;
      if (p.mesaId !== undefined) acc.mesaId = p.mesaId;
      break;

    case 'linea_agregada': {
      if (!e.detalleId) break;
      acc.lineas.set(e.detalleId, {
        id: e.detalleId,
        productoId: p.productoId,
        // Snapshot: se copia el precio, no se referencia (ADR-006).
        nombreProducto: p.nombreProducto,
        precioUnitario: p.precioUnitario,
        cantidad: p.cantidad,
        ...(p.notas !== undefined ? { notas: p.notas } : {}),
        /**
         * Si la comanda ya está cerrada, la línea NACE CANCELADA (`05` §5).
         *
         * Pasa de verdad: el evento se generó offline antes de que llegara la
         * cancelación, y el sync lo entrega después. Nacer cancelada la deja
         * visible para auditoría sin que sume un peso al total.
         *
         * La capa de sync además lo marca como conflicto y lo notifica
         * (RF-J-7): un evento descartado en silencio es dinero que nadie ve.
         */
        estado: acc.cancelada || acc.cobrada ? 'cancelada' : 'borrador',
        enviadaHlc: null,
        listaHlc: null,
      });
      break;
    }

    case 'linea_modificada': {
      const l = e.detalleId ? acc.lineas.get(e.detalleId) : undefined;
      // Last-write-wins: es una cantidad o un texto, no dinero. Como los
      // eventos vienen ordenados por HLC, el último gana solo.
      if (l && l.estado !== 'cancelada') {
        acc.lineas.set(l.id, {
          ...l,
          ...(p.cantidad !== undefined ? { cantidad: p.cantidad } : {}),
          ...(p.notas !== undefined ? { notas: p.notas } : {}),
        });
      }
      break;
    }

    case 'linea_eliminada':
      // Solo en borrador. Una línea ya enviada se CANCELA (y puede mermar),
      // no se elimina — borrarla haría desaparecer la pérdida.
      if (e.detalleId) {
        const l = acc.lineas.get(e.detalleId);
        if (l?.estado === 'borrador') acc.lineas.delete(e.detalleId);
      }
      break;

    case 'comanda_enviada':
      // Solo las que están en borrador. Las ya enviadas conservan su estado:
      // eso es RF-E-7, "la mesa pidió más tacos" sin reiniciar lo anterior.
      for (const [id, l] of acc.lineas) {
        if (l.estado === 'borrador') {
          acc.lineas.set(id, { ...l, estado: 'pendiente', enviadaHlc: e.hlc });
        }
      }
      break;

    case 'preparacion_iniciada':
      for (const [id, l] of acc.lineas) {
        if (transicionLineaValida(l.estado, 'en_preparacion')) {
          acc.lineas.set(id, { ...l, estado: 'en_preparacion' });
        }
      }
      break;

    case 'linea_lista': {
      const l = e.detalleId ? acc.lineas.get(e.detalleId) : undefined;
      if (l && transicionLineaValida(l.estado, 'lista')) {
        acc.lineas.set(l.id, { ...l, estado: 'lista', listaHlc: e.hlc });
      }
      break;
    }

    case 'comanda_lista':
      for (const [id, l] of acc.lineas) {
        if (transicionLineaValida(l.estado, 'lista')) {
          acc.lineas.set(id, { ...l, estado: 'lista', listaHlc: e.hlc });
        }
      }
      break;

    case 'comanda_entregada':
      // NO es un interruptor permanente: solo vale si es posterior (por HLC)
      // al último envío de líneas. Ver estadoDerivado() paso 6.
      acc.entregadaHlc = e.hlc;
      break;

    case 'pago_registrado':
      acc.pagos.push({
        id: e.id,
        metodo: p.metodo,
        monto: p.monto,
        ...(p.recibido !== undefined ? { recibido: p.recibido } : {}),
      });
      break;

    case 'comanda_cobrada':
      // No se puede cobrar una comanda cancelada. `cancelada` y `cobrada` son
      // AMBOS terminales: gana el que ocurrió primero según el HLC, y el otro
      // queda como conflicto (RF-J-7).
      if (!acc.cancelada) acc.cobrada = true;
      break;

    case 'comanda_cancelada':
      // La cancelación GANA (RF-E-21) — menos contra 'cobrada', donde el
      // dinero ya entró y puede estar en un turno cerrado (CU-06 F4).
      if (!acc.cobrada) {
        acc.cancelada = { motivo: p.motivo };
        for (const [id, l] of acc.lineas) {
          if (l.estado !== 'cancelada') acc.lineas.set(id, { ...l, estado: 'cancelada' });
        }
      }
      break;

    case 'linea_cancelada': {
      const l = e.detalleId ? acc.lineas.get(e.detalleId) : undefined;
      if (l && !acc.cobrada && l.estado !== 'cancelada') {
        acc.lineas.set(l.id, { ...l, estado: 'cancelada' });
      }
      break;
    }

    case 'comanda_reabierta':
      // Solo el Administrador (RS-Y-1 lo valida en el push). Vuelve a
      // 'entregada' para que se pueda cobrar de nuevo.
      acc.cobrada = false;
      break;
  }
}

/**
 * Deriva el estado de la comanda a partir de sus líneas.
 *
 * **El estado de la comanda NO es un campo independiente.** Si lo fuera, una
 * comanda `lista` a la que le agregas un taco seguiría diciendo `lista` y
 * cocina nunca vería lo nuevo. Derivándolo, vuelve sola a `enviada` y el caso
 * "la mesa pidió más" —que en una taquería pasa todo el tiempo— funciona sin
 * código especial.
 */
function estadoDerivado(acc: Acumulador, lineas: readonly Linea[]): EstadoComanda {
  // 1. Los estados explícitos terminales mandan.
  if (acc.cancelada) return 'cancelada';
  if (acc.cobrada) return 'cobrada';

  const activas = lineas.filter((l) => l.estado !== 'cancelada');

  // 2. Sin líneas activas: sigue siendo capturable.
  if (activas.length === 0) return 'borrador';

  // 3. Nada se ha enviado todavía.
  if (activas.every((l) => l.estado === 'borrador')) return 'borrador';

  // 4. Estado derivado del MENOR avance entre las líneas ya enviadas.
  const enviadas = activas.filter((l) => l.estado !== 'borrador');
  if (enviadas.some((l) => l.estado === 'pendiente')) return 'enviada';
  if (enviadas.some((l) => l.estado === 'en_preparacion')) return 'en_preparacion';

  // 5. Quedan líneas en borrador sin enviar: la comanda no puede estar entregada.
  if (activas.some((l) => l.estado === 'borrador')) return 'enviada';

  // 6. EL PASO MÁS DELICADO DEL SISTEMA.
  //    'entregada' solo vale si el evento ocurrió DESPUÉS (por HLC) del último
  //    envío de líneas. Sin esta comparación, una comanda entregada a la que
  //    se le agregan tacos seguiría diciendo 'entregada' y se podría cobrar
  //    sin haber servido lo nuevo.
  //
  //    Se compara por HLC y no por timestamp (ADR-003): con relojes
  //    desfasados, un `ts_cliente` puede hacer parecer que la entrega ocurrió
  //    después de una adición que en realidad la siguió.
  if (acc.entregadaHlc !== null) {
    const ultimoEnvio = enviadas.reduce<string | null>(
      (max, l) => (l.enviadaHlc && (!max || compararHlc(l.enviadaHlc, max) > 0) ? l.enviadaHlc : max),
      null,
    );
    if (ultimoEnvio === null || compararHlc(acc.entregadaHlc, ultimoEnvio) > 0) {
      return 'entregada';
    }
  }

  return 'lista';
}

// ── Dinero (ADR-006) ─────────────────────────────────────────

/**
 * Total de la comanda.
 *
 * Se calcula con el `precioUnitario` **de cada línea** — el snapshot copiado
 * al momento de la venta. Jamás se consulta el catálogo vivo.
 *
 * Ese lookup al producto es tentador porque "normaliza", y es exactamente el
 * bug que ADR-006 previene: **el precio de una venta no es un atributo del
 * producto, es un hecho del pasado.** Si el admin sube el taco de $18 a $20,
 * el ticket de ayer sigue diciendo $18 (RNF-I-1).
 */
export function calcularTotal(lineas: readonly Linea[]): number {
  return lineas
    .filter((l) => l.estado !== 'cancelada')
    .reduce((suma, l) => suma + l.cantidad * l.precioUnitario, 0);
}

export function totalPagado(pagos: readonly Pago[]): number {
  return pagos.reduce((suma, p) => suma + p.monto, 0);
}

/** RF-G-6: los pagos deben igualar EXACTAMENTE el total. */
export function pagosCuadran(comanda: Comanda): boolean {
  return totalPagado(comanda.pagos) === comanda.total;
}

// ── Merma (RF-E-18) ──────────────────────────────────────────

/**
 * Qué se va a mermar si se cancela ahora. Se consulta ANTES de cancelar.
 *
 * Alimenta la advertencia de RF-E-18: *"2 tacos de pastor ya están en cocina.
 * Cancelar los registra como merma por $36. ¿Continuar?"*
 *
 * **Ese número no es cortesía.** Sin él, cancelar es psicológicamente gratis y
 * la merma se vuelve invisible — que es el problema de la Visión §1. Ponerle
 * precio en el momento convierte la merma en una decisión consciente en vez de
 * un accidente.
 */
export function calcularMermaSiSeCancela(
  comanda: Comanda,
  rolQuienCancela: Parameters<typeof generaMerma>[1],
): ResumenMerma {
  const lineas = comanda.lineas
    .filter((l) => generaMerma(l.estado, rolQuienCancela))
    .map((l) => ({
      detalleId: l.id,
      nombreProducto: l.nombreProducto,
      cantidad: l.cantidad,
      costo: l.cantidad * l.precioUnitario,
      estadoAlCancelar: l.estado,
    }));

  return { lineas, costoTotal: lineas.reduce((s, l) => s + l.costo, 0) };
}

/** Estado de una línea suelta. Útil para la UI de cocina. */
export function estadoLineaDe(comanda: Comanda, detalleId: string): EstadoLinea | null {
  return comanda.lineas.find((l) => l.id === detalleId)?.estado ?? null;
}
