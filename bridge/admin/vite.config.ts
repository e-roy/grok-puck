import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const here = (file: string) => fileURLToPath(new URL(file, import.meta.url));

// Two pages: the admin page (index.html) and the Listen page (listen.html, which the bridge serves at
// /listen), sharing the components and the theme. `pnpm dev` (in admin/) serves both with hot reload
// (the Listen page at /listen.html) and forwards /api and the Listen page's WebSocket to a bridge
// running locally.
export default defineConfig({
  root: here('.'),
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': here('./src') } },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rolldownOptions: { input: { admin: here('index.html'), listen: here('listen.html') } },
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8788', '/listen/ws': { target: 'ws://127.0.0.1:8788', ws: true } },
  },
});
