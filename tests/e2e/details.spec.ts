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

test('选中阶段可调整文字颜色、大小、粗细和排版方向', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('shape-stage-horizontal').click();
  const toolbar = page.getByRole('toolbar', { name: '阶段工具栏' });
  await expect(toolbar).toBeVisible();
  await toolbar.getByRole('spinbutton', { name: '阶段文字大小' }).fill('18');
  await toolbar.getByRole('spinbutton', { name: '阶段文字大小' }).blur();
  await toolbar.getByRole('button', { name: '阶段文字加粗' }).click();
  await toolbar.getByRole('button', { name: '阶段文字竖排' }).click();
  await toolbar.getByLabel('阶段文字颜色').evaluate((element: HTMLInputElement) => {
    element.value = '#aabbcc';
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.getByRole('button', { name: '文档数据', exact: true }).click();
  const doc = JSON.parse(await page.getByTestId('document-json').innerText());
  const stage = Object.values(doc.nodes).find(
    (node: any) => node.type === 'stage-horizontal',
  ) as any;
  expect(stage.appearance).toMatchObject({
    fontColor: '#aabbcc',
    fontSize: 18,
    fontBold: false,
    textDirection: 'vertical',
  });
});
