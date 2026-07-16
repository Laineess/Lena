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

// ── La regla de la merma ─────────────────────────────────────

/**
 * ¿Cancelar esta línea registra merma de producto?
 *
 * Toda la regla del negocio cabe en dos condiciones, y la segunda es la
 * interesante:
 *
 * **1. La frontera es el envío a cocina.** Una línea en `borrador` no existió
 *    para nadie. Una ya enviada se está haciendo — en una taquería el pastor
 *    se corta al momento, en segundos, así que "enviada" y "haciéndose" son
 *    lo mismo.
 *
 * **2. Quién cancela codifica lo que esa persona sabe** (RF-F-14):
 *
 *    | Quién                  | ¿Merma? | Qué sabe                          |
 *    |------------------------|---------|-----------------------------------|
 *    | Mesero / Administrador | **Sí**  | El cliente se fue. Se hizo y se tira |
 *    | **Cocinero**           | **No**  | *No pudo* prepararla. Nunca existió  |
 *
 *    Quien sabe si la comida se hizo es el cocinero. Por eso su cancelación es
 *    autoritativa: no hay que preguntarle nada al usuario ni añadir un campo a
 *    la interfaz. El actor ya aporta, con el solo hecho de cancelar, el dato
 *    que únicamente él tiene.
 *
 *    La alternativa —preguntar "¿ya se había preparado?"— pondría la decisión
 *    en quien no lo sabe y añadiría un toque en hora pico.
 *
 * Y tiene una consecuencia de SEGURIDAD que no es obvia: como solo el rol
 * `cocina` puede cancelar sin merma, y ese rol no puede cobrar, **el que cobra
 * no puede ocultar merma**. Separación de funciones aplicada al plato (`07` §4.1).
 */
export function generaMerma(estadoLinea: EstadoLinea, rolQuienCancela: Rol): boolean {
  if (estadoLinea === 'borrador' || estadoLinea === 'cancelada') return false;
  if (rolQuienCancela === 'cocina') return false;
  return true;
}

// ── Resolución de conflictos (05 §5) ─────────────────────────

export type Resolucion = 'gana_a' | 'gana_b' | 'ambos' | 'conflicto';

/**
 * Qué pasa cuando dos eventos concurrentes tocan la misma comanda.
 *
 * **Hay dos políticas distintas y la diferencia importa:**
 *
 * - **Cancelación → gana siempre** (menos contra `cobrada`). Es irreversible
 *   en el mundo físico: el cliente ya se fue, la comida ya no se vende.
 *   Bloquear la cancelación no cambia esa realidad — solo empuja al mesero a
 *   mentirle al sistema (cobrar y "regalar" el plato), y entonces la merma
 *   desaparece de los datos.
 *
 * - **Modificación → gana el más reciente.** Es un dato editable sin
 *   consecuencia económica.
 *
 * Aplicar last-write-wins a las cancelaciones sería un error grave: una
 * cancelación que llega tarde por sync se perdería, y la comida ya tirada
 * nunca aparecería en la merma.
 */
export function resolverConflicto(
  tipoA: TipoEvento,
  tipoB: TipoEvento,
): Resolucion {
  // Dos eventos del MISMO tipo no están en conflicto: el plegado es
  // idempotente y el HLC desempata. Sin esta guarda, resolverConflicto no
  // sería antisimétrico — lo destapó el property-based testing con el
  // contraejemplo ('comanda_cobrada', 'comanda_cobrada'), que devolvía
  // 'gana_a' en ambas direcciones.
  if (tipoA === tipoB) return 'ambos';

  const esCancelacion = (t: TipoEvento) =>
    t === 'comanda_cancelada' || t === 'linea_cancelada';

  // 'cobrada' es terminal y el dinero ya entró, posiblemente en un turno ya
  // cerrado. Revertirlo en automático descuadraría un corte firmado (CU-06 F4).
  if (tipoA === 'comanda_cobrada' && tipoB !== 'comanda_reabierta') return 'gana_a';
  if (tipoB === 'comanda_cobrada' && tipoA !== 'comanda_reabierta') return 'gana_b';

  if (esCancelacion(tipoA) && !esCancelacion(tipoB)) return 'gana_a';
  if (esCancelacion(tipoB) && !esCancelacion(tipoA)) return 'gana_b';

  return 'ambos';
}
