import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8080' },
  },
  // The unminified Bryntum trial bundle crashes the dev dependency optimizer on Windows; it is
  // already a single ESM module, so it is served as-is instead of being pre-bundled.
  optimizeDeps: { exclude: ['@bryntum/scheduler', '@bryntum/scheduler-react'] },
  build: {
    outDir: fileURLToPath(new URL('../dist/web', import.meta.url)),
    emptyOutDir: true,
    sourcemap: true,
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('ag-studio') || id.includes('ag-grid') || id.includes('ag-charts'))
            return 'ag';
          if (id.includes('@bryntum')) return 'bryntum';
          if (id.includes('node_modules')) return 'vendor';
          return undefined;
        },
      },
    },
  },
});
