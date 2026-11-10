import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'packages/app',
  publicDir: 'public',
  plugins: [react()],
  build: {
    outDir: '../relay/public',
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 3000,
    sourcemap: false,
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    proxy: {
      '/v1': { target: 'http://127.0.0.1:8787', ws: true, changeOrigin: true },
    },
  },
});
