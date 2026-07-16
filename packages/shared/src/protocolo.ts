// Contrato de sync. Todo lo que cruza la red se valida aquí antes de tocar el
// dominio. Cliente y servidor importan los mismos esquemas (RNF-M-7).
// Un evento inválido es un hecho falso en un log sin UPDATE (ADR-002, RS-U-1).
import { z } from 'zod';
import { DERIVA_MAXIMA_MS, HLC_RE } from './hlc';
import type { Evento } from './tipos';

const uuid = z.string().uuid();

// El regex se importa de hlc.ts, no se reescribe: duplicarlo ya falló una vez
// (esperaba 13 decimales; formatearHlc emite 16 hex).
const esquemaHlc = z.string().regex(HLC_RE, 'HLC mal formado');

// Entero no negativo → rechaza 18.5, NaN, Infinity antes del numeric (RNF-I-8).
const centavos = z.number().int().nonnegative();

const rol = z.enum(['administrador', 'cocina', 'mesero']);
const metodoPago = z.enum(['efectivo', 'tarjeta', 'transferencia']);
const tipoServicio = z.enum(['mesa', 'para_llevar', 'domicilio']);
const motivo = z.string().trim().min(1).max(500); // se audita: vacío no sirve (RS-U-3)

const payloads = {
  comanda_creada: z.object({
    tipo: z.literal('comanda_creada'),
    tipoServicio,
    mesaId: uuid.optional(),
  }),
  linea_agregada: z.object({
    tipo: z.literal('linea_agregada'),
    productoId: uuid,
    nombreProducto: z.string().trim().min(1).max(120), // snapshot (ADR-006)
    precioUnitario: centavos,
    cantidad: z.number().int().positive(),
    notas: z.string().trim().max(280).optional(),
  }),
  linea_modificada: z.object({
    tipo: z.literal('linea_modificada'),
    cantidad: z.number().int().positive().optional(),
    notas: z.string().trim().max(280).optional(),
  }),
  linea_eliminada: z.object({ tipo: z.literal('linea_eliminada') }),
  comanda_enviada: z.object({ tipo: z.literal('comanda_enviada') }),
  preparacion_iniciada: z.object({ tipo: z.literal('preparacion_iniciada') }),
  linea_lista: z.object({ tipo: z.literal('linea_lista') }),
  comanda_lista: z.object({ tipo: z.literal('comanda_lista') }),
  comanda_entregada: z.object({ tipo: z.literal('comanda_entregada') }),
  pago_registrado: z.object({
    tipo: z.literal('pago_registrado'),
    metodo: metodoPago,
    monto: centavos.positive(),
    recibido: centavos.optional(),
  }),
  comanda_cobrada: z.object({ tipo: z.literal('comanda_cobrada') }),
  comanda_cancelada: z.object({ tipo: z.literal('comanda_cancelada'), motivo }),
  linea_cancelada: z.object({ tipo: z.literal('linea_cancelada'), motivo }),
  comanda_reabierta: z.object({ tipo: z.literal('comanda_reabierta'), motivo }),
} as const;

const camposBase = {
  id: uuid,
  comandaId: uuid,
  detalleId: uuid.optional(),
  sucursalId: uuid,
  actorId: uuid,
  rolActor: rol,
  dispositivoId: uuid,
  hlc: esquemaHlc,
  tsCliente: z.string().datetime(), // no confiable (RS-Y-4); solo diagnóstico
} as const;

function variante<T extends keyof typeof payloads>(tipo: T) {
  return z.object({ ...camposBase, tipo: z.literal(tipo), payload: payloads[tipo] });
}

// Unión discriminada: `tipo` y `payload.tipo` amarrados. Control antifraude, no
// formato — sin él, cocina manda tipo:'linea_lista' (autorizado) con
// payload:'comanda_cobrada' y cobra la comanda (T1, 07 §1). Se listan a mano:
// el `as` de Object.entries().map() borraría la inferencia de EventoCable.
export const EsquemaEvento = z.discriminatedUnion('tipo', [
  variante('comanda_creada'),
  variante('linea_agregada'),
  variante('linea_modificada'),
  variante('linea_eliminada'),
  variante('comanda_enviada'),
  variante('preparacion_iniciada'),
  variante('linea_lista'),
  variante('comanda_lista'),
  variante('comanda_entregada'),
  variante('pago_registrado'),
  variante('comanda_cobrada'),
  variante('comanda_cancelada'),
  variante('linea_cancelada'),
  variante('comanda_reabierta'),
]);

export type EventoCable = z.infer<typeof EsquemaEvento>;

// Tope de lote: defensa de memoria, no de rendimiento (RS-T-8). VPS 1 vCPU/2 GB.
export const LOTE_MAXIMO = 200;

export const EsquemaPush = z.object({
  dispositivoId: uuid,
  eventos: z.array(EsquemaEvento).min(1).max(LOTE_MAXIMO),
});
export type PeticionPush = z.infer<typeof EsquemaPush>;

export type RazonRechazo =
  | 'rol_no_autorizado'
  | 'comanda_desconocida'
  | 'deriva_de_reloj'
  | 'sucursal_ajena'
  | 'sin_turno_abierto'
  | 'evento_malformado'
  | 'duplicado_con_otro_contenido';

export interface EventoRechazado {
  readonly id: string;
  readonly razon: RazonRechazo;
  readonly detalle: string;
}

// `aceptados` incluye duplicados: reenviar un evento ya guardado es éxito, no
// error (RF-J-3), o el cliente reintentaría para siempre. `folios` viaja aquí
// porque lo asigna el servidor (RF-E-13).
export interface RespuestaPush {
  readonly aceptados: readonly string[];
  readonly rechazados: readonly EventoRechazado[];
  readonly folios: readonly { readonly comandaId: string; readonly folio: number }[];
  readonly seq: number;
}

export const PAGINA_MAXIMA = 500;

// Cursor por `seq`, no por HLC: seq es denso y monótono en el servidor. Paginar
// por HLC perdería eventos (otro nodo genera un HLC menor al último entregado).
export const EsquemaPull = z.object({
  sucursalId: uuid,
  desde: z.coerce.number().int().nonnegative().default(0),
  limite: z.coerce.number().int().positive().max(PAGINA_MAXIMA).default(PAGINA_MAXIMA),
});
export type PeticionPull = z.infer<typeof EsquemaPull>;

export interface RespuestaPull {
  readonly eventos: readonly (EventoCable & { readonly seq: number })[];
  readonly seq: number;
  readonly hayMas: boolean;
}

// El servidor avisa, el cliente jala (ADR-005). Empujar el evento por el socket
// abriría un segundo camino de entrega sin cursor: un mensaje perdido en una
// reconexión sería un evento perdido.
export type MensajeServidor =
  | { readonly tipo: 'hay_novedades'; readonly sucursalId: string; readonly seq: number }
  | { readonly tipo: 'pong' };

export type MensajeCliente =
  | { readonly tipo: 'suscribir'; readonly sucursalId: string }
  | { readonly tipo: 'ping' };

// Cable → dominio. Descarta tsCliente: el dominio no debe poder ordenar por él.
export function aEventoDominio(cable: EventoCable): Evento {
  const { tsCliente: _tsCliente, ...resto } = cable;
  return resto as unknown as Evento;
}

export { DERIVA_MAXIMA_MS };
