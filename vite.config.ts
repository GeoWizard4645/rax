import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// In dev, Vite serves the SPA and forwards /api/* to `wrangler pages dev`
// (npm run pages:dev) so the Pages Functions run exactly as they do on Cloudflare.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8788' },
  },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
