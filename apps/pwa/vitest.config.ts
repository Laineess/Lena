// Config de pruebas aparte de vite.config.ts: vitest 2 trae tipos de vite 5 y
// el proyecto usa vite 8, así que mezclarlos en un solo archivo choca. Las
// pruebas son de lógica (Dexie, dominio) y no necesitan los plugins de build.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // JSX con el runtime automático de React 19 (sin importar React). Evita meter
  // el plugin de vite, que choca por los tipos de vite 5 vs 8.
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
});
