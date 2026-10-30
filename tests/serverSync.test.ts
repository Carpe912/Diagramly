import { afterEach, expect, it, vi } from 'vitest';
import { DocumentSync } from '../src/adapters/server/client';
import { demoDocument } from '../src/application/demo';
afterEach(() => vi.unstubAllGlobals());
it('串行保存使用服务端版本，冲突后保留草稿并禁止后续覆盖', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ revision: 8 }))
    .mockResolvedValueOnce(Response.json({ message: '版本冲突' }, { status: 409 }));
  vi.stubGlobal('fetch', fetcher);
  const document = demoDocument(),
    sync = new DocumentSync(7, document);
  const first = structuredClone(document);
  first.title = '第一次';
  const second = structuredClone(document);
  second.title = '第二次';
  await sync.save(first);
  await expect(sync.save(second)).rejects.toThrow('版本冲突');
  await expect(sync.save(document)).rejects.toThrow('版本冲突');
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(JSON.parse(fetcher.mock.calls[0][1].body).expectedRevision).toBe(7);
  expect(JSON.parse(fetcher.mock.calls[1][1].body).expectedRevision).toBe(8);
});
