import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Leña — Comandas',
        short_name: 'Leña',
        description: 'Comandas para taquería',
        theme_color: '#C2410C',
        background_color: '#FAFAF9',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: '/icon.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any' },
          { src: '/icon.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        // La app es una SPA: cualquier navegación offline cae en index.html
        // (RF-J-8). Las llamadas al API NO se sirven desde caché.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/(auth|sync|catalogo|comandas|productos|turno|admin)/],
      },
    }),
  ],
  server: {
    port: 5173,
    host: '127.0.0.1',
    // El API corre en :3000. En producción Caddy sirve ambos en el mismo
    // dominio, así que no hace falta CORS (RS-T-4). Debe cubrir TODAS las rutas
    // del servidor, o la PWA en dev no las alcanza.
    proxy: Object.fromEntries(
      ['/auth', '/sync', '/catalogo', '/comandas', '/productos', '/turno', '/admin'].map((r) => [
        r,
        'http://127.0.0.1:3000',
      ]),
    ),
  },
});
