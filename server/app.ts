import Fastify from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { createShapeRegistry } from '../src/shapes/registry';
import { validateDocument } from '../src/domain/validation';
import { documentSchema, idSchema } from '../src/domain/model';
export interface DocumentStore {
  list(trash?: boolean): Promise<unknown>;
  setDeleted?(id: string, expected: number, restore: boolean): Promise<number | null>;
  get(id: string): Promise<{ revision: number; document: unknown } | null>;
  save(id: string, document: unknown, expected: number): Promise<number | null>;
}
export function createServer(store: DocumentStore, credentials: string) {
  if (!credentials) throw new Error('必须设置 DIAGRAMLY_CREDENTIALS（用户名:密码）');
  const app = Fastify({ bodyLimit: 10 * 1024 * 1024, logger: false });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (request.url === '/api/health') return;
    const expected = Buffer.from(`Basic ${Buffer.from(credentials).toString('base64')}`);
    const actual = Buffer.from(request.headers.authorization ?? '');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      return reply
        .header('WWW-Authenticate', 'Basic realm="Diagramly", charset="UTF-8"')
        .code(401)
        .send({ message: '请登录 Diagramly' });
  });
  app.setErrorHandler((error, _, reply) => {
    if (error instanceof z.ZodError)
      return reply.code(400).send({ message: '文档校验失败', issues: error.issues });
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
