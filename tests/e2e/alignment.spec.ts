import { expect, test, type Page } from '@playwright/test';
import { absoluteBounds } from '../../src/domain/pools';
import type { DiagramDocument } from '../../src/domain/model';
async function readDocument(page: Page): Promise<DiagramDocument> {
  await page.getByRole('button', { name: '文档数据', exact: true }).click();
  const doc = JSON.parse(await page.getByTestId('document-json').innerText());
  await page.getByRole('button', { name: '关闭文档数据' }).click();
  return doc;
}
test('多选节点对齐，单选支持吸附网格，连接关系和业务身份不变', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /^图层/ }).click();
  await page.getByRole('button', { name: '接收客户订单', exact: true }).click();
  await page
    .getByRole('button', { name: '确认订单信息', exact: true })
    .click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: '左对齐', exact: true }).click();
  let doc = await readDocument(page);
  expect(doc.nodes.receive.bounds.x).toBe(doc.nodes.confirm.bounds.x);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect((await readDocument(page)).nodes.confirm.bounds.x).toBe(705);
  await page.getByRole('button', { name: '安排订单交付', exact: true }).click();
  await page.getByRole('button', { name: '对齐到网格', exact: true }).click();
  doc = await readDocument(page);
  const bounds = absoluteBounds(doc, doc.nodes.deliver);
  expect(bounds.x % 20).toBe(0);
  expect(bounds.y % 20).toBe(0);
  expect(doc.edges.edge_deliver.target.nodeId).toBe('deliver');
  expect(doc.nodes.deliver.entityId).toBe('entity_deliver');
  await page.getByRole('button', { name: '销售团队', exact: true }).click();
  await expect(page.getByRole('button', { name: '对齐到网格', exact: true })).toBeDisabled();
});
