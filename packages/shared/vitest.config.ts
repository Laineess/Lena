import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      // RNF-M-1: >=85% en la logica de negocio. Aqui vive TODA.
      thresholds: { lines: 85, functions: 85, branches: 85, statements: 85 },
    },
  },
});
