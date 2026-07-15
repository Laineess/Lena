import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index';

export * from './schema/index';
export { schema };

export type Db = ReturnType<typeof crearDb>;

export function crearDb(url: string) {
  const cliente = postgres(url, {
    max: 10,
    // RES-4: el corte del día es a medianoche local, no UTC.
    connection: { timezone: 'America/Mexico_City' },
  });
  return drizzle(cliente, { schema, casing: 'snake_case' });
}
