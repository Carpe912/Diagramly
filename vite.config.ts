import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import { readFileSync } from 'node:fs';
import vue from '@vitejs/plugin-vue';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // 仅供服务端读取，不得通过 VITE_* 或客户端代码暴露会话凭证。
  const sessionFile = process.env.COOPWIRE_SESSION_FILE || env.COOPWIRE_SESSION_FILE;
  const readCookie = () => {
    if (!sessionFile) return '';
    try {
      return String(JSON.parse(readFileSync(sessionFile, 'utf8')).cookie || '');
    } catch {
      throw new Error('无法读取 Coopwire 本机鉴权文件');
    }
  };
  readCookie();
  const target = process.env.COOPWIRE_TARGET || env.COOPWIRE_TARGET;
  return {
    plugins: [vue()],
    test: { include: ['tests/**/*.test.ts'] },
    server: {
      proxy: target
        ? {
            '/rest': {
              target,
              changeOrigin: true,
              configure(proxy) {
                proxy.on('proxyReq', (request) => {
                  const cookie = readCookie();
                  if (cookie) request.setHeader('cookie', cookie);
                });
                proxy.on('proxyRes', (response) => {
                  delete response.headers['set-cookie'];
                });
              },
            },
          }
        : undefined,
    },
  };
});
