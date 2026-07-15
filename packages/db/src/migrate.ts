/**
 * Aplica las migraciones pendientes.
 *
 *   pnpm db:migrate
 *
 * Se conecta como DUEÑO (DATABASE_URL), no como lena_app: el rol de la
 * aplicación no puede crear tablas ni otorgarse permisos — ese es justo el
 * punto de RS-U-1.
 */
import { fileURLToPath } from 'node:url';
import { config as cargarEnv } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

cargarEnv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('Falta DATABASE_URL. Copia .env.example a .env en la raíz del repo.');
}

const cliente = postgres(url, { max: 1 });

try {
  await migrate(drizzle(cliente), {
    migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)),
  });
  console.log('✓ Migraciones aplicadas');
} finally {
  await cliente.end();
}
