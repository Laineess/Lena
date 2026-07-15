import { fileURLToPath } from 'node:url';
import { config as cargarEnv } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// El .env vive en la raíz del monorepo, no en este paquete.
cargarEnv({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('Falta DATABASE_URL. Copia .env.example a .env en la raíz del repo.');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: { url },
  casing: 'snake_case',
  verbose: true,
  strict: true,
});
