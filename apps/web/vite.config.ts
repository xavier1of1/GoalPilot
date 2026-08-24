import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env['GOALPILOT_WEB_PORT'] ?? 5173),
    strictPort: true,
    proxy: {
      '/api': process.env['GOALPILOT_API_PROXY_ORIGIN'] ?? 'http://localhost:3000',
      '/auth': process.env['GOALPILOT_API_PROXY_ORIGIN'] ?? 'http://localhost:3000',
      '/health': process.env['GOALPILOT_API_PROXY_ORIGIN'] ?? 'http://localhost:3000',
      '/docs': process.env['GOALPILOT_API_PROXY_ORIGIN'] ?? 'http://localhost:3000',
    },
  },
  build: {
    sourcemap: true,
  },
});
