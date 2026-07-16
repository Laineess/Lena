// El API usa lena_app, nunca el dueño: sin UPDATE/DELETE en el log (RS-U-1).
import { fileURLToPath } from 'node:url';
import { config as cargarEnv } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { schema } from '@lena/db';

cargarEnv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

export function crearDb(url = process.env.DATABASE_URL_APP) {
  if (!url) throw new Error('Falta DATABASE_URL_APP en .env');
  const sql = postgres(url, {
    max: 10,
    connection: { timezone: 'America/Mexico_City' },
    onnotice: () => {}, // los NOTICE de Postgres no son errores; no ensucian el log
  });
  const db = drizzle(sql, { schema, casing: 'snake_case' });
  return { db, sql };
}

export type Db = ReturnType<typeof crearDb>['db'];
