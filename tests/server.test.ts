import { expect, it, vi } from 'vitest';
import { createServer } from '../server/app';
import { demoDocument } from '../src/application/demo';
it('独立文档接口校验身份、JSON和并发版本', async () => {
  const document = demoDocument();
  const store = {
    list: vi.fn(async () => []),
    get: vi.fn(async () => ({ revision: 1, document })),
    save: vi.fn(async (): Promise<number | null> => 1),
  };
  const app = createServer(store, 'test:password');
  const headers = { authorization: `Basic ${Buffer.from('test:password').toString('base64')}` };
  try {
    expect((await app.inject('/api/documents')).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/documents', headers })).statusCode).toBe(200);
    const url = `/api/documents/${document.id}`;
    expect(
      (
        await app.inject({
          method: 'PUT',
          url,
          headers,
          payload: { document, expectedRevision: 0 },
        })
      ).json(),
    ).toEqual({ revision: 1 });
    store.save.mockResolvedValueOnce(null);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url,
          headers,
          payload: { document, expectedRevision: 0 },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url,
          headers,
          payload: { document: {}, expectedRevision: 0 },
        })
      ).statusCode,
    ).toBe(400);
  } finally {
    await app.close();
  }
});
