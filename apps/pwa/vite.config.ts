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
        name: 'Leña — Mesero',
        short_name: 'Leña',
        description: 'Comandas para taquería',
        theme_color: '#C2410C',
        background_color: '#FAFAF9',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
      },
    }),
  ],
  server: {
    port: 5173,
    host: '127.0.0.1',
    // El API corre en :3000. En producción Caddy sirve ambos en el mismo
    // dominio, así que no hace falta CORS (RS-T-4).
    proxy: {
      '/auth': 'http://127.0.0.1:3000',
      '/sync': 'http://127.0.0.1:3000',
      '/catalogo': 'http://127.0.0.1:3000',
    },
  },
});
