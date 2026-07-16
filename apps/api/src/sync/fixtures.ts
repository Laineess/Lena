// Utilidades para las pruebas de integración contra Postgres real.
import { fileURLToPath } from 'node:url';
import { config as cargarEnv } from 'dotenv';
import { sql } from 'drizzle-orm';
import { EsquemaEvento, RelojHlc, formatearHlc } from '@lena/shared';
import type { EventoCable, PayloadEvento, Rol } from '@lena/shared';
import { crearDb } from '../db';

cargarEnv({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)) });

// IDs del seed (packages/db/src/seed.ts).
export const ID = {
  sucursal: '01930000-0000-7000-8000-000000000001',
  mesero1: '01930000-0000-7000-8000-000000000011',
  mesero2: '01930000-0000-7000-8000-000000000012',
  cocinero: '01930000-0000-7000-8000-000000000013',
  tabletA: '01930000-0000-7000-8000-000000000020',
  tabletB: '01930000-0000-7000-8000-000000000021',
  pastor: '01930000-0000-7000-8000-000000000200',
  arabe: '01930000-0000-7000-8000-000000000201',
  mesa1: '01930000-0000-7000-8000-000000000100',
  corte: '01930000-0000-7000-8000-0000000c0f01',
} as const;

// El dueño (lena) limpia y siembra el turno; el log es append-only para
// lena_app, así que el borrado de pruebas NO puede correr como la app.
export const owner = crearDb(process.env.DATABASE_URL);
// La app (lena_app) es la que corre push/pull, con sus permisos reales.
export const app = crearDb(process.env.DATABASE_URL_APP);

export async function limpiar(): Promise<void> {
  // corte_caja incluido: si un test deja un turno abierto, el índice único
  // parcial (un solo turno abierto por sucursal) rompería el abrirTurno de otro.
  await owner.db.execute(sql`
    TRUNCATE comanda_evento, comanda_detalle, merma_producto, pago, comanda, corte_caja
    RESTART IDENTITY CASCADE
  `);
}

export async function abrirTurno(): Promise<void> {
  await owner.db.execute(sql`
    INSERT INTO corte_caja (id, sucursal_id, fondo_inicial, abierto_por, estado)
    VALUES (${ID.corte}, ${ID.sucursal}, '1000', ${ID.mesero1}, 'abierto')
    ON CONFLICT (id) DO UPDATE SET estado = 'abierto', cerrado_at = NULL, cerrado_por = NULL
  `);
}

export async function cerrarTurno(): Promise<void> {
  await owner.db.execute(sql`UPDATE corte_caja SET estado = 'cerrado' WHERE id = ${ID.corte}`);
}

export async function cerrarConexiones(): Promise<void> {
  await owner.sql.end();
  await app.sql.end();
}

// Genera eventos válidos con un reloj HLC por dispositivo, como el cliente real.
export function dispositivo(nodo: string, opts: { actorId?: string; rolActor?: Rol; dispositivoId?: string } = {}) {
  const reloj = new RelojHlc(nodo);
  const actorId = opts.actorId ?? ID.mesero1;
  const rolActor = opts.rolActor ?? 'mesero';
  const dispositivoId = opts.dispositivoId ?? ID.tabletA;

  function ev(
    comandaId: string,
    payload: PayloadEvento,
    extra: { id: string; detalleId?: string; hlc?: string } & Partial<{ actorId: string; rolActor: Rol }>,
  ): EventoCable {
    return EsquemaEvento.parse({
      id: extra.id,
      comandaId,
      ...(extra.detalleId ? { detalleId: extra.detalleId } : {}),
      sucursalId: ID.sucursal,
      tipo: payload.tipo,
      payload,
      actorId: extra.actorId ?? actorId,
      rolActor: extra.rolActor ?? rolActor,
      dispositivoId,
      hlc: extra.hlc ?? reloj.ahora(),
      tsCliente: new Date().toISOString(),
    });
  }

  return { ev, reloj, recibir: (hlc: string) => reloj.recibir(hlc) };
}

export { formatearHlc };
