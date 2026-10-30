import Fastify from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { createShapeRegistry } from '../src/shapes/registry';
import { validateDocument } from '../src/domain/validation';
import { documentSchema, idSchema } from '../src/domain/model';
declare module 'fastify' {
  interface FastifyRequest {
    identity: { id: string; username: string; role: string } | null;
  }
}
export interface DocumentStore {
  authenticate?(header: string): Promise<{ id: string; username: string; role: string } | null>;
  list(trash?: boolean): Promise<unknown>;
  nameVersion?(id: string, revision: number, label: string): Promise<boolean>;
  versions?(id: string): Promise<unknown>;
  version?(id: string, revision: number): Promise<{ document: unknown } | null>;
  setDeleted?(id: string, expected: number, restore: boolean): Promise<number | null>;
  get(id: string): Promise<{ revision: number; document: unknown } | null>;
  save(id: string, document: unknown, expected: number): Promise<number | null>;
}
export function createServer(store: DocumentStore, credentials: string) {
  if (!credentials) throw new Error('必须设置 DIAGRAMLY_CREDENTIALS（用户名:密码）');
  const app = Fastify({ bodyLimit: 10 * 1024 * 1024, logger: false });
  const failedLogins = new Map<string, { count: number; until: number }>();
  app.decorateRequest('identity', null);
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (request.url === '/api/health') return;
    const key = String(request.headers['x-real-ip'] ?? request.ip),
      now = Date.now(),
      attempts = failedLogins.get(key);
    if (attempts && attempts.until > now && attempts.count >= 10)
      return reply.code(429).send({ message: '登录尝试过多，请稍后重试' });
    const expected = Buffer.from(`Basic ${Buffer.from(credentials).toString('base64')}`);
    const actual = Buffer.from(request.headers.authorization ?? '');
    const identity = store.authenticate
      ? await store.authenticate(actual.toString())
      : actual.length === expected.length && timingSafeEqual(actual, expected)
        ? { id: 'bootstrap', username: credentials.split(':')[0], role: 'admin' }
        : null;
    if (!identity) {
      for (const [ip, value] of failedLogins) if (value.until <= now) failedLogins.delete(ip);
      if (failedLogins.size > 10000) failedLogins.delete(failedLogins.keys().next().value!);
      failedLogins.set(key, {
        count: attempts && attempts.until > now ? attempts.count + 1 : 1,
        until: now + 600000,
      });
      return reply
        .header('WWW-Authenticate', 'Basic realm="Diagramly", charset="UTF-8"')
        .code(401)
        .send({ message: '请登录 Diagramly' });
    }
    failedLogins.delete(key);
    request.identity = identity;
    if (request.url.startsWith('/api/users') && identity.role !== 'admin')
      return reply.code(403).send({ message: '需要管理员权限' });
    if (
      identity.role === 'viewer' &&
      !['GET', 'HEAD'].includes(request.method) &&
      request.url !== '/api/password'
    )
      return reply.code(403).send({ message: '当前账号仅可查看' });
  });
  app.setErrorHandler((error, _, reply) => {
    if (error instanceof z.ZodError)
      return reply.code(400).send({ message: '文档校验失败', issues: error.issues });
    if ((error as { code?: string }).code === '23505')
      return reply.code(409).send({ message: '名称或记录已存在' });
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode && statusCode >= 400 && statusCode < 500)
      return reply.code(statusCode).send({ message: '请求格式错误或内容过大' });
    app.log.error(error);
    return reply.code(500).send({ message: '服务暂时不可用' });
  });
  app.get('/api/health', async () => ({ status: 'ok' }));
  app.get('/api/documents', (request) =>
    store.list((request.query as { trash?: string }).trash === 'true'),
  );
  app.post('/api/documents/:id/lifecycle', async (request, reply) => {
    const id = idSchema.parse((request.params as { id: string }).id);
    const body = z
      .object({ expectedRevision: z.number().int().positive(), restore: z.boolean() })
      .strict()
      .parse(request.body);
    if (!store.setDeleted) return reply.code(503).send({ message: '当前存储不支持回收站' });
    const revision = await store.setDeleted(id, body.expectedRevision, body.restore);
    return revision === null
      ? reply.code(409).send({ message: '文档状态已变化，请刷新列表' })
      : { revision };
  });
  app.get('/api/documents/:id', async (request, reply) => {
    const id = idSchema.parse((request.params as { id: string }).id);
    const result = await store.get(id);
    return result ?? reply.code(404).send({ message: '文档不存在' });
  });
  app.post('/api/documents/:id/versions/:revision/name', async (request, reply) => {
    const params = z
      .object({ id: idSchema, revision: z.coerce.number().int().positive() })
      .parse(request.params);
    const body = z
      .object({ label: z.string().trim().min(1).max(160) })
      .strict()
      .parse(request.body);
    if (
      !(await store.get(params.id)) ||
      !(await store.nameVersion?.(params.id, params.revision, body.label))
    )
      return reply.code(404).send({ message: '版本不存在' });
    return { ok: true };
  });
  app.get('/api/documents/:id/versions', async (request, reply) => {
    const id = idSchema.parse((request.params as { id: string }).id);
    if (!(await store.get(id))) return reply.code(404).send({ message: '文档不存在' });
    return store.versions ? store.versions(id) : [];
  });
  app.get('/api/documents/:id/versions/:revision', async (request, reply) => {
    const params = z
      .object({ id: idSchema, revision: z.coerce.number().int().positive() })
      .parse(request.params);
    if (!(await store.get(params.id))) return reply.code(404).send({ message: '文档不存在' });
    return (
      (await store.version?.(params.id, params.revision)) ??
      reply.code(404).send({ message: '版本不存在' })
    );
  });
  app.post('/api/documents/:id/restore', async (request, reply) => {
    const id = idSchema.parse((request.params as { id: string }).id);
    const body = z
      .object({
        revision: z.number().int().positive(),
        expectedRevision: z.number().int().positive(),
      })
      .strict()
      .parse(request.body);
    const current = await store.get(id),
      previous = await store.version?.(id, body.revision);
    if (!current || !previous) return reply.code(404).send({ message: '文档或版本不存在' });
    const document = documentSchema.parse(previous.document);
    document.revision = documentSchema.parse(current.document).revision + 1;
    const revision = await store.save(id, document, body.expectedRevision);
    return revision === null
      ? reply.code(409).send({ message: '文档版本已变化，请重新读取' })
      : { revision, document };
  });
  app.put('/api/documents/:id', async (request, reply) => {
    const id = idSchema.parse((request.params as { id: string }).id);
    const body = z
      .object({ document: documentSchema, expectedRevision: z.number().int().min(0) })
      .strict()
      .parse(request.body);
    if (body.document.id !== id) return reply.code(400).send({ message: '文档 ID 不匹配' });
    let validated;
    try {
      validated = validateDocument(body.document, createShapeRegistry());
    } catch {
      return reply.code(400).send({ message: '图形引用或布局不合法' });
    }
    const revision = await store.save(id, validated, body.expectedRevision);
    if (revision === null)
      return reply.code(409).send({ message: '文档已在其他窗口修改，请先重新读取' });
    return { revision };
  });
  return app;
}
