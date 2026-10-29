import { expect, test } from '@playwright/test';

test('本机示例没有远程业务 ID 时隐藏详情，图形库明确列出四类活动', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /^图层/ }).click();
  await page.getByRole('button', { name: '接收客户订单', exact: true }).click();
  await expect(page.getByRole('tab', { name: '业务详情', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '图形库', exact: true }).click();
  for (const id of [
    'shape-activity',
    'shape-activity-offline',
    'shape-activity-system',
    'shape-activity-interface',
    'shape-activity-linked',
    'shape-parallel',
    'shape-stage-horizontal',
    'shape-stage-vertical',
    'shape-connector',
  ]) {
    await expect(page.getByTestId(id)).toBeVisible();
  }
});

test('四类活动共用业务节点结构并保留独立类型，阶段分别为一个节点', async ({ page }) => {
  await page.goto('/');
  for (const id of ['shape-stage-horizontal', 'shape-stage-vertical']) {
    await page.getByTestId(id).click();
  }
  await page.getByRole('button', { name: /^图层/ }).click();
  await page.getByRole('button', { name: '销售团队', exact: true }).click();
  await page.getByRole('button', { name: '图形库', exact: true }).click();
  for (const id of [
    'shape-activity',
    'shape-activity-offline',
    'shape-activity-system',
    'shape-activity-interface',
  ]) {
    await page.getByTestId(id).click();
  }
  await page.getByRole('button', { name: '文档数据', exact: true }).click();
  const doc = JSON.parse(await page.getByTestId('document-json').innerText());
  const types = Object.values(doc.nodes)
    .filter((node: any) => node.type === 'activity')
    .map((node: any) => doc.entities[node.entityId].activityType);
  expect(types).toEqual(expect.arrayContaining(['manual', 'offline', 'system', 'interface']));
  expect(
    Object.values(doc.nodes).filter((node: any) => node.type.startsWith('stage-')),
  ).toHaveLength(2);
});
