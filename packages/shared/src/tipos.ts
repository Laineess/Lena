import type { Hlc } from './hlc';

// ── Roles y actores ──────────────────────────────────────────

export type Rol = 'administrador' | 'cocina' | 'mesero';

// ── Estados ──────────────────────────────────────────────────

/**
 * El estado fundamental del sistema. El de la comanda se DERIVA de este
 * (`05. Casos de uso` §4.3).
 *
 * 'en_preparacion' está reservado y no se produce en el MVP: la vista de
 * cocina tiene un solo botón (✓ lista). Se contempla en la lógica para que
 * habilitarlo después sea un cambio de UI, no de dominio.
 */
export type EstadoLinea = 'borrador' | 'pendiente' | 'en_preparacion' | 'lista' | 'cancelada';

export type EstadoComanda = 'borrador' | 'enviada' | 'en_preparacion' | 'lista' | 'entregada' | 'cobrada' | 'cancelada';

export type TipoServicio = 'mesa' | 'para_llevar' | 'domicilio';

export type MetodoPago = 'efectivo' | 'tarjeta' | 'transferencia';

// ── Dinero ───────────────────────────────────────────────────

/**
 * Dinero en CENTAVOS, como entero.
 *
 * RNF-I-8: los montos jamás se calculan en punto flotante. Un `float` da
 * `0.1 + 0.2 = 0.30000000000000004`, y el corte de caja falla por un centavo
 * que nadie puede explicar.
 *
 * En la base es `numeric(10,2)`; la conversión ocurre en la frontera
 * (ver `aCentavos` / `aPesos`). Aquí adentro todo es entero.
 */
export type Centavos = number;

// ── Eventos ──────────────────────────────────────────────────

export type TipoEvento =
  | 'comanda_creada'
  | 'linea_agregada'
  | 'linea_modificada'
  | 'linea_eliminada'
  | 'comanda_enviada'
  | 'preparacion_iniciada'
  | 'linea_lista'
  | 'comanda_lista'
  | 'comanda_entregada'
  | 'pago_registrado'
  | 'comanda_cobrada'
  | 'comanda_cancelada'
  | 'linea_cancelada'
  | 'comanda_reabierta';

// rolActor va DENTRO del evento (no se busca en `usuario` al proyectar):
// corrección histórica —el rol de entonces, no el de hoy (ADR-006)— y pureza
// del proyector (RNF-I-6).
export interface EventoBase {
  readonly id: string;
  readonly comandaId: string;
  readonly detalleId?: string;
  readonly sucursalId: string;
  readonly actorId: string;
  readonly rolActor: Rol;
  readonly dispositivoId: string;
  readonly hlc: Hlc;
}

// `tipo` y `payload.tipo` amarrados por el tipo. Control de seguridad: la
// autorización mira `tipo`, aplicar() mira `payload.tipo`. Sin amarre, cocina
// manda tipo:'linea_lista' con payload:'comanda_cobrada' y cobra (T1). El
// `tipo` aparte existe solo porque la base lo indexa. En el cable lo valida
// EsquemaEvento (protocolo.ts).
type EventoDe<P> = P extends PayloadEvento ? EventoBase & { readonly tipo: P['tipo']; readonly payload: P } : never;

export type Evento = EventoDe<PayloadEvento>;

/** Datos del cliente a domicilio (RF-E-17). LFPDPPP: el mínimo para entregar. */
export interface Domicilio {
  readonly nombreCliente: string;
  readonly telefono: string;
  readonly direccion: string;
  readonly referencias?: string;
}

export type PayloadEvento =
  | {
      readonly tipo: 'comanda_creada';
      readonly tipoServicio: TipoServicio;
      readonly mesaId?: string;
      readonly domicilio?: Domicilio;
    }
  | {
      readonly tipo: 'linea_agregada';
      readonly productoId: string;
      /** Snapshot: copia, no referencia (ADR-006). */
      readonly nombreProducto: string;
      readonly precioUnitario: Centavos;
      readonly cantidad: number;
      readonly notas?: string;
    }
  | { readonly tipo: 'linea_modificada'; readonly cantidad?: number; readonly notas?: string }
  | { readonly tipo: 'linea_eliminada' }
  | { readonly tipo: 'comanda_enviada' }
  | { readonly tipo: 'preparacion_iniciada' }
  | { readonly tipo: 'linea_lista' }
  | { readonly tipo: 'comanda_lista' }
  | { readonly tipo: 'comanda_entregada' }
  | {
      readonly tipo: 'pago_registrado';
      readonly metodo: MetodoPago;
      readonly monto: Centavos;
      readonly recibido?: Centavos;
    }
  | { readonly tipo: 'comanda_cobrada' }
  | { readonly tipo: 'comanda_cancelada'; readonly motivo: string }
  | { readonly tipo: 'linea_cancelada'; readonly motivo: string }
  | { readonly tipo: 'comanda_reabierta'; readonly motivo: string };

// ── Proyecciones ─────────────────────────────────────────────

export interface Linea {
  readonly id: string;
  readonly productoId: string;
  readonly nombreProducto: string;
  readonly precioUnitario: Centavos;
  readonly cantidad: number;
  readonly notas?: string;
  readonly estado: EstadoLinea;
  /** HLC del evento que la envió a cocina. `null` mientras sea borrador. */
  readonly enviadaHlc: Hlc | null;
  readonly listaHlc: Hlc | null;
}

export interface Pago {
  readonly id: string;
  readonly metodo: MetodoPago;
  readonly monto: Centavos;
  readonly recibido?: Centavos;
}

export interface Comanda {
  readonly id: string;
  readonly sucursalId: string;
  readonly tipoServicio: TipoServicio;
  readonly mesaId?: string;
  readonly domicilio?: Domicilio;
  readonly meseroId: string;
  readonly estado: EstadoComanda;
  readonly lineas: readonly Linea[];
  readonly pagos: readonly Pago[];
  readonly total: Centavos;
  readonly motivoCancelacion?: string;
}

/** Lo que se va a mermar si se cancela. Alimenta la advertencia de RF-E-18. */
export interface ResumenMerma {
  readonly lineas: readonly {
    readonly detalleId: string;
    readonly nombreProducto: string;
    readonly cantidad: number;
    readonly costo: Centavos;
    readonly estadoAlCancelar: EstadoLinea;
  }[];
  readonly costoTotal: Centavos;
}

// ── Conversión en la frontera ────────────────────────────────

/** `"18.50"` (numeric de Postgres) → `1850` centavos. */
export function aCentavos(pesos: string | number): Centavos {
  const n = typeof pesos === 'string' ? Number.parseFloat(pesos) : pesos;
  if (!Number.isFinite(n)) throw new Error(`Monto inválido: ${pesos}`);
  // Math.round y no truncar: 18.55 * 100 da 1854.9999… en binario.
  return Math.round(n * 100);
}

/** `1850` centavos → `"18.50"` para guardar en `numeric(10,2)`. */
export function aPesos(centavos: Centavos): string {
  if (!Number.isInteger(centavos)) {
    throw new Error(`Los centavos deben ser enteros, llegó: ${centavos}`);
  }
  const signo = centavos < 0 ? '-' : '';
  const abs = Math.abs(centavos);
  return `${signo}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** `1850` → `"$18.50"`. Para la interfaz. */
export function formatearMoneda(centavos: Centavos): string {
  return `$${aPesos(centavos)}`;
}
