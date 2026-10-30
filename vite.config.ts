import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
export default defineConfig({
  base: process.env.DIAGRAMLY_BASE || '/',
  plugins: [vue()],
  test: { include: ['tests/**/*.test.ts'] },
  server: {
    proxy: {
      '/api': {
        target: process.env.DIAGRAMLY_API_TARGET || 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
});
