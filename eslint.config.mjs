// ESLint plano (flat config). Ligero a propósito: TypeScript estricto ya hace
// casi todo el trabajo (noUnusedLocals, exactOptionalPropertyTypes, etc.); aquí
// solo se agregan reglas que el compilador no cubre. Prettier maneja el formato.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/migrations/**', '**/coverage/**', '**/*.config.{js,ts,mjs}'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // El código usa `void promesa` y prefijos `_` para lo intencional.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Los casts a `as` en las fronteras (cable↔dominio) son deliberados.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  // Reglas de hooks solo para la PWA.
  {
    files: ['apps/pwa/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  prettier,
);
