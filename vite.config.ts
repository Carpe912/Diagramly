import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import vue from '@vitejs/plugin-vue';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // 仅供服务端读取，不得通过 VITE_* 或客户端代码暴露会话凭证。
  const sessionFile = process.env.COOPWIRE_SESSION_FILE || env.COOPWIRE_SESSION_FILE;
  const readCookie = () => {
    if (!sessionFile) return '';
    try {
      return String(JSON.parse(readFileSync(sessionFile, 'utf8')).cookie || '');
    } catch (error) {
      // 临时会话文件可能在重启后消失，允许编辑器和本机功能继续启动。
      // 不注入 Cookie 时，代理沿用浏览器请求携带的登录态。
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
      throw new Error('无法读取 Coopwire 本机鉴权文件');
    }
  };
  const storeRefreshedCookies = (setCookies: string[]) => {
    if (!sessionFile || !setCookies.length) return;
    const values = new Map(
      readCookie()
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
          const index = part.indexOf('=');
          return [part.slice(0, index), part.slice(index + 1)] as const;
        }),
    );
    for (const header of setCookies) {
      const pair = header.split(';', 1)[0],
        index = pair.indexOf('=');
      if (index <= 0) continue;
      values.set(pair.slice(0, index), pair.slice(index + 1));
    }
    const temporary = `${sessionFile}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(
      temporary,
      JSON.stringify({ cookie: [...values].map(([key, value]) => `${key}=${value}`).join('; ') }),
      { mode: 0o600, flag: 'wx' },
    );
    renameSync(temporary, sessionFile);
  };
  readCookie();
  const target = process.env.COOPWIRE_TARGET || env.COOPWIRE_TARGET;
  return {
    plugins: [
      vue(),
      {
        name: 'diagramly-local-session',
        configureServer(server) {
          // 只返回登录态是否存在，不向前端暴露 HttpOnly 凭证。
          server.middlewares.use('/__diagramly/session', (request, response) => {
            response.setHeader('Content-Type', 'application/json');
            response.setHeader('Cache-Control', 'no-store');
            response.end(
              JSON.stringify({
                authenticated: /(?:^|;)\s*access_token=[^;]+/.test(request.headers.cookie ?? ''),
              }),
            );
          });
        },
      },
    ],
    test: { include: ['tests/**/*.test.ts'] },
    server: {
      proxy: {
        '/api': {
          target: process.env.DIAGRAMLY_API_TARGET || 'http://127.0.0.1:3000',
          changeOrigin: true,
        },
        ...(target
          ? {
              '/rest': {
                target,
                changeOrigin: true,
                configure(proxy) {
                  proxy.on('proxyReq', (request, incoming) => {
                    // 浏览器手动配置的登录态优先，本机会话文件仅作为后备。
                    const browserCookie = incoming.headers.cookie ?? '';
                    const hasAccessToken = /(?:^|;)\s*access_token=[^;]+/.test(browserCookie);
                    const cookie = hasAccessToken ? browserCookie : readCookie();
                    if (cookie) request.setHeader('cookie', cookie);
                  });
                  proxy.on('proxyRes', (response, request) => {
                    if (
                      request.url?.startsWith('/rest/platform/refreshToken') &&
                      response.statusCode === 200
                    ) {
                      const setCookies = response.headers['set-cookie'];
                      if (setCookies) storeRefreshedCookies(setCookies);
                    }
                    delete response.headers['set-cookie'];
                  });
                },
              },
            }
          : {}),
      },
    },
  };
});
