import { expect, it } from 'vitest';
import { inspectDocument } from '../src/domain/inspection';
import { demoDocument } from '../src/application/demo';
it('体检定位未连接活动，允许正常回退环路', () => {
  const doc = demoDocument();
  expect(inspectDocument(doc).some((issue) => issue.message.includes('环'))).toBe(false);
  doc.edges = {};
  expect(
    inspectDocument(doc).some(
      (issue) => issue.id === 'receive' && issue.message.includes('尚未连接'),
    ),
  ).toBe(true);
});
