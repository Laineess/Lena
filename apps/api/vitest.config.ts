import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Las pruebas tocan una base compartida: un solo proceso, en serie.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
