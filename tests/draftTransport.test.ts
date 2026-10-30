import { expect, it, vi } from 'vitest';
import { DraftTransport } from '../src/application/draftTransport';
import { demoDocument } from '../src/application/demo';
it('草稿编辑不请求后端，保存时合并提交最终状态', async () => {
  const before = demoDocument(),
    after = structuredClone(before);
  after.title = '草稿标题';
  after.revision++;
  const remote = { commit: vi.fn(async (request) => request.document) };
  const draft = new DraftTransport(before, remote);
  await draft.commit({
    kind: 'command',
    before,
    document: after,
    command: {
      commandId: 'draft',
      expectedRevision: before.revision,
      origin: 'user',
      label: '编辑',
      operations: [],
    },
  });
  expect(remote.commit).not.toHaveBeenCalled();
  expect(draft.dirty).toBe(true);
  await draft.save();
  expect(remote.commit).toHaveBeenCalledTimes(1);
  expect(draft.dirty).toBe(false);
  await draft.save();
  expect(remote.commit).toHaveBeenCalledTimes(1);
});
it('失败后保留同一保存事务，避免重试产生新建活动副本', async () => {
  const before = demoDocument(),
    after = structuredClone(before);
  after.title = '待保存';
  const remote = {
    commit: vi
      .fn()
      .mockRejectedValueOnce(new Error('中断'))
      .mockImplementation(async (request) => request.document),
  };
  const draft = new DraftTransport(before, remote);
  await draft.commit({
    kind: 'command',
    before,
    document: after,
    command: {
      commandId: 'draft',
      expectedRevision: before.revision,
      origin: 'user',
      label: '编辑',
      operations: [],
    },
  });
  await expect(draft.save()).rejects.toThrow('中断');
  await draft.save();
  expect(remote.commit.mock.calls[0][0]).toEqual(remote.commit.mock.calls[1][0]);
});
