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
it('回收站操作校验版本，列表区分已删除文档', async () => {
  const document = demoDocument();
  const store = {
    list: vi.fn(async () => []),
    get: vi.fn(async () => null),
    save: vi.fn(async () => null),
    setDeleted: vi.fn(async (): Promise<number | null> => 2),
  };
  const app = createServer(store, 'test:password');
  const headers = { authorization: `Basic ${Buffer.from('test:password').toString('base64')}` };
  try {
    await app.inject({ url: '/api/documents?trash=true', headers });
    expect(store.list).toHaveBeenCalledWith(true);
    const url = `/api/documents/${document.id}/lifecycle`;
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          headers,
          payload: { expectedRevision: 1, restore: false },
        })
      ).json(),
    ).toEqual({ revision: 2 });
    expect(store.setDeleted).toHaveBeenCalledWith(document.id, 1, false);
    store.setDeleted.mockResolvedValueOnce(null);
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          headers,
          payload: { expectedRevision: 1, restore: true },
        })
      ).statusCode,
    ).toBe(409);
  } finally {
    await app.close();
  }
});
it('恢复历史内容创建新版本，不修改旧快照并拒绝并发冲突', async () => {
  const previous = demoDocument(),
    current = structuredClone(previous);
  current.title = '新版';
  current.revision = 8;
  const store = {
    list: async () => [],
    get: async () => ({ revision: 7, document: current }),
    save: vi.fn(async (): Promise<number | null> => 8),
    version: async () => ({ document: previous }),
    versions: async () => [],
  };
  const app = createServer(store, 'test:password');
  const headers = { authorization: `Basic ${Buffer.from('test:password').toString('base64')}` };
  try {
    const options = {
      method: 'POST' as const,
      url: `/api/documents/${current.id}/restore`,
      headers,
      payload: { revision: 1, expectedRevision: 7 },
    };
    const response = await app.inject(options);
    expect(response.statusCode).toBe(200);
    expect(response.json().document.title).toBe(previous.title);
    expect(response.json().document.revision).toBe(9);
    expect(previous.revision).not.toBe(9);
    store.save.mockResolvedValueOnce(null);
    expect((await app.inject(options)).statusCode).toBe(409);
  } finally {
    await app.close();
  }
});
it('服务端强制只读权限并限制账号管理，不依赖前端隐藏按钮', async () => {
  const store = {
    list: async () => [],
    get: async () => null,
    save: vi.fn(async () => 1),
    authenticate: async () => ({ id: 'viewer', username: 'viewer', role: 'viewer' }),
  };
  const app = createServer(store, 'bootstrap:password');
  try {
    expect((await app.inject('/api/documents')).statusCode).toBe(200);
    expect(
      (await app.inject({ method: 'PUT', url: '/api/documents/test', payload: {} })).statusCode,
    ).toBe(403);
    expect((await app.inject('/api/users')).statusCode).toBe(403);
    expect(store.save).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});
