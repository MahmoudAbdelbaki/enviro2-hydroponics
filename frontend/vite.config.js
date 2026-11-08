import { defineConfig } from 'vite';

// The Go backend (./bin/hydro) listens on :8080 by default.
// In dev we proxy the API so the browser talks to a single origin.
const target = process.env.HYDRO_API_URL || 'http://localhost:8080';

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': { target, changeOrigin: true },
      '/healthz': { target, changeOrigin: true },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      '/api': { target, changeOrigin: true },
      '/healthz': { target, changeOrigin: true },
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
});
