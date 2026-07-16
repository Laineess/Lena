// GET /sync/pull — entrega incremental por cursor de seq (ADR-005).
import { and, asc, eq, gt } from 'drizzle-orm';
import type { PeticionPull, RespuestaPull } from '@lena/shared';
import { comandaEvento } from '@lena/db';
import type { Db } from '../db';
import { aCable } from './eventos';

export async function procesarPull(db: Db, peticion: PeticionPull): Promise<RespuestaPull> {
  // Se pide un evento de más para saber si hay más sin un COUNT aparte.
  const filas = await db
    .select()
    .from(comandaEvento)
    .where(and(eq(comandaEvento.sucursalId, peticion.sucursalId), gt(comandaEvento.seq, peticion.desde)))
    .orderBy(asc(comandaEvento.seq))
    .limit(peticion.limite + 1);

  const hayMas = filas.length > peticion.limite;
  const pagina = hayMas ? filas.slice(0, peticion.limite) : filas;
  const eventos = pagina.map(aCable);
  const ultimo = eventos[eventos.length - 1];

  return {
    eventos,
    seq: ultimo ? ultimo.seq : peticion.desde,
    hayMas,
  };
}
