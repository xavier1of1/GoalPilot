import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: process.env['GOALPILOT_DEVCONTAINER'] === 'true' ? '0.0.0.0' : '127.0.0.1',
    port: Number(process.env['GOALPILOT_WEB_PORT'] ?? 5173),
    strictPort: true,
    proxy: {
      '/api': process.env['GOALPILOT_API_PROXY_ORIGIN'] ?? 'http://localhost:3000',
      '/auth': process.env['GOALPILOT_API_PROXY_ORIGIN'] ?? 'http://localhost:3000',
      '/health': process.env['GOALPILOT_API_PROXY_ORIGIN'] ?? 'http://localhost:3000',
      '/docs': process.env['GOALPILOT_API_PROXY_ORIGIN'] ?? 'http://localhost:3000',
    },
  },
  preview: {
    host: process.env['GOALPILOT_DEVCONTAINER'] === 'true' ? '0.0.0.0' : '127.0.0.1',
    port: Number(process.env['GOALPILOT_WEB_PORT'] ?? 5373),
    strictPort: true,
    proxy: {
      '/api': process.env['GOALPILOT_API_PROXY_ORIGIN'] ?? 'http://localhost:3200',
      '/auth': process.env['GOALPILOT_API_PROXY_ORIGIN'] ?? 'http://localhost:3200',
      '/health': process.env['GOALPILOT_API_PROXY_ORIGIN'] ?? 'http://localhost:3200',
      '/docs': process.env['GOALPILOT_API_PROXY_ORIGIN'] ?? 'http://localhost:3200',
    },
  },
  build: {
    sourcemap: true,
  },
});
