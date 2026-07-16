// Puente entre la fila de Postgres y el Evento del dominio (@lena/shared).
import type { Evento, EventoCable } from '@lena/shared';
import { comandaEvento } from '@lena/db';

type FilaEvento = typeof comandaEvento.$inferSelect;

// Fila → Evento del dominio. El proyector no ve seq, tsCliente ni tsServidor.
export function aDominio(fila: FilaEvento): Evento {
  return {
    id: fila.id,
    comandaId: fila.comandaId,
    ...(fila.detalleId ? { detalleId: fila.detalleId } : {}),
    sucursalId: fila.sucursalId,
    tipo: fila.tipo,
    actorId: fila.actorId,
    rolActor: fila.rolActor,
    dispositivoId: fila.dispositivoId,
    hlc: fila.hlc,
    payload: fila.payload,
  } as Evento;
}

// Fila → evento del cable (con seq) para la respuesta del pull.
export function aCable(fila: FilaEvento): EventoCable & { seq: number } {
  return {
    id: fila.id,
    comandaId: fila.comandaId,
    ...(fila.detalleId ? { detalleId: fila.detalleId } : {}),
    sucursalId: fila.sucursalId,
    tipo: fila.tipo,
    payload: fila.payload,
    actorId: fila.actorId,
    rolActor: fila.rolActor,
    dispositivoId: fila.dispositivoId,
    hlc: fila.hlc,
    tsCliente: fila.tsCliente.toISOString(),
    seq: Number(fila.seq),
  } as EventoCable & { seq: number };
}

// Evento del cable → fila para INSERT. tsServidor lo pone la base (defaultNow).
export function aFila(e: EventoCable): typeof comandaEvento.$inferInsert {
  return {
    id: e.id,
    comandaId: e.comandaId,
    detalleId: e.detalleId ?? null,
    sucursalId: e.sucursalId,
    tipo: e.tipo,
    payload: e.payload,
    actorId: e.actorId,
    rolActor: e.rolActor,
    dispositivoId: e.dispositivoId,
    hlc: e.hlc,
    tsCliente: new Date(e.tsCliente),
  };
}

// JSON con llaves ordenadas. Postgres jsonb NO conserva el orden de inserción,
// así que un JSON.stringify directo del payload releído difiere del original y
// haría fallar la comparación de idempotencia en CADA reenvío de outbox.
function canonico(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonico).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonico(o[k])}`)
    .join(',')}}`;
}

// Dos eventos con el mismo id deben tener el mismo contenido: un id reusado con
// otro payload es un intento de reescribir el log (RF-J-3).
export function mismoContenido(a: Evento, b: EventoCable): boolean {
  return (
    a.tipo === b.tipo &&
    a.comandaId === b.comandaId &&
    a.hlc === b.hlc &&
    (a.detalleId ?? null) === (b.detalleId ?? null) &&
    canonico(a.payload) === canonico(b.payload)
  );
}
