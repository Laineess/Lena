import type { EstadoLinea, Rol, TipoEvento } from './tipos';

// ── Autorización de eventos (RS-Y-1) ─────────────────────────

/**
 * Qué eventos puede emitir cada rol.
 *
 * El log es la fuente de verdad, así que **un evento falsificado ES un hecho
 * falso**. Sin esta validación en el push, un cocinero con acceso a la API
 * podría cobrar comandas. Cada evento se autoriza como si fuera una petición
 * REST, porque eso es exactamente lo que es.
 */
const EVENTOS_POR_ROL: Readonly<Record<Rol, readonly TipoEvento[]>> = {
  mesero: [
    'comanda_creada',
    'linea_agregada',
    'linea_modificada',
    'linea_eliminada',
    'comanda_enviada',
    'comanda_entregada',
    'pago_registrado',
    'comanda_cobrada',
    'comanda_cancelada',
    'linea_cancelada',
  ],
  cocina: [
    'preparacion_iniciada',
    'linea_lista',
    'comanda_lista',
    // Cocina SÍ puede cancelar: es quien descubre que se acabó el insumo
    // (RF-F-13). Su cancelación no genera merma (RF-F-14) — ver generaMerma().
    'linea_cancelada',
  ],
  // El Administrador puede todo lo de los otros dos, más reabrir (RF-G-8).
  administrador: [
    'comanda_creada',
    'linea_agregada',
    'linea_modificada',
    'linea_eliminada',
    'comanda_enviada',
    'preparacion_iniciada',
    'linea_lista',
    'comanda_lista',
    'comanda_entregada',
    'pago_registrado',
    'comanda_cobrada',
    'comanda_cancelada',
    'linea_cancelada',
    'comanda_reabierta',
  ],
};

export function eventoPermitido(tipo: TipoEvento, rol: Rol): boolean {
  return EVENTOS_POR_ROL[rol].includes(tipo);
}

export function eventosPermitidosPara(rol: Rol): readonly TipoEvento[] {
  return EVENTOS_POR_ROL[rol];
}

// ── Transiciones de línea (05 §4.1) ──────────────────────────

const TRANSICIONES_LINEA: Readonly<Record<EstadoLinea, readonly EstadoLinea[]>> = {
  borrador: ['pendiente', 'cancelada'],
  // 'en_preparacion' se contempla aunque el MVP no lo produzca: la vista de
  // cocina tiene un solo botón. Habilitarlo después será cambio de UI.
  pendiente: ['en_preparacion', 'lista', 'cancelada'],
  en_preparacion: ['lista', 'cancelada'],
  lista: ['cancelada'],
  cancelada: [],
};

export function transicionLineaValida(desde: EstadoLinea, hasta: EstadoLinea): boolean {
  return TRANSICIONES_LINEA[desde].includes(hasta);
}

export function esEstadoLineaTerminal(estado: EstadoLinea): boolean {
  return TRANSICIONES_LINEA[estado].length === 0;
}

export function generaMerma(estadoLinea: EstadoLinea, rolQuienCancela: Rol): boolean {
  if (estadoLinea === 'borrador' || estadoLinea === 'cancelada') return false;
  if (rolQuienCancela === 'cocina') return false;
  return true;
}

// ── Resolución de conflictos (05 §5) ─────────────────────────

export type Resolucion = 'gana_a' | 'gana_b' | 'ambos' | 'conflicto';

export function resolverConflicto(
  tipoA: TipoEvento,
  tipoB: TipoEvento,
): Resolucion {
  if (tipoA === tipoB) return 'ambos';

  const esCancelacion = (t: TipoEvento) =>
    t === 'comanda_cancelada' || t === 'linea_cancelada';
  if (tipoA === 'comanda_cobrada' && tipoB !== 'comanda_reabierta') return 'gana_a';
  if (tipoB === 'comanda_cobrada' && tipoA !== 'comanda_reabierta') return 'gana_b';

  if (esCancelacion(tipoA) && !esCancelacion(tipoB)) return 'gana_a';
  if (esCancelacion(tipoB) && !esCancelacion(tipoA)) return 'gana_b';

  return 'ambos';
}
