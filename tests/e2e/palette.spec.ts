import { expect, test, type Page } from '@playwright/test';
async function readDocument(page: Page) {
  await page.getByRole('button', { name: '文档数据', exact: true }).click();
  const document = JSON.parse(await page.getByTestId('document-json').innerText());
  await page.getByRole('button', { name: '关闭文档数据' }).click();
  return document;
}

test('图形库可切换为浮动工具栏，点击、拖放和键盘菜单均可用', async ({ page }) => {
  await page.goto('/');
  const before = await readDocument(page);
  const initialWidth = (await page.getByTestId('graph').boundingBox())!.width;
  await page.getByRole('button', { name: '切换到图形库工具栏模式' }).click();
  const toolbar = page.getByRole('toolbar', { name: '图形库工具栏', exact: true });
  await expect(toolbar).toBeVisible();
  await expect(page.locator('.library-panel')).toBeHidden();
  await expect
    .poll(async () => (await page.getByTestId('graph').boundingBox())!.width)
    .toBeGreaterThan(initialWidth);
  await toolbar.getByRole('button', { name: '打开业务图形', exact: true }).click();
  await page.getByRole('menuitem', { name: '人工线下', exact: true }).click();
  let document = await readDocument(page);
  const activity = Object.values(document.nodes).find((node: any) => !before.nodes[node.id]) as any;
  expect(document.entities[activity.entityId].activityType).toBe('offline');
  await toolbar.getByRole('button', { name: '打开基础图形', exact: true }).click();
  await page
    .getByRole('menuitem', { name: '矩形', exact: true })
    .dragTo(page.getByTestId('graph'), { targetPosition: { x: 50, y: 60 } });
  await expect(page.getByRole('menu', { name: '选择图形' })).toHaveCount(0);
  document = await readDocument(page);
  expect(Object.keys(document.nodes)).toHaveLength(Object.keys(before.nodes).length + 2);
  expect(Object.values(document.nodes).some((node: any) => node.type === 'rectangle')).toBe(true);
  const pools = toolbar.getByRole('button', { name: '打开泳池', exact: true });
  await pools.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: '水平泳池', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(pools).toBeFocused();
  await page.reload();
  await expect(toolbar).toBeVisible();
  await toolbar.getByRole('button', { name: '切换到图形库侧栏模式' }).click();
  await expect(page.locator('.library-panel')).toBeVisible();
  await expect(toolbar).toHaveCount(0);
});

test('窄画布自动合并图形分类，顶部文件操作收进更多菜单', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '切换到图形库工具栏模式' }).click();
  await page.setViewportSize({ width: 1100, height: 760 });
  await page.getByRole('separator', { name: '属性侧栏宽度', exact: true }).press('End');
  const toolbar = page.getByRole('toolbar', { name: '图形库工具栏', exact: true });
  await expect(toolbar.getByRole('button', { name: '打开全部图形' })).toBeVisible();
  await toolbar.getByRole('button', { name: '打开全部图形' }).click();
  await expect(page.getByRole('menuitem', { name: '水平泳池', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '人工线上', exact: true })).toBeVisible();
  const graph = (await page.getByTestId('graph').boundingBox())!;
  const box = (await toolbar.boundingBox())!;
  expect(box.x).toBeGreaterThan(graph.x);
  expect(box.x + box.width).toBeLessThan(graph.x + graph.width);
  await page.getByRole('button', { name: '更多画布操作', exact: true }).click();
  await expect(page.getByRole('menu', { name: '选择图形' })).toHaveCount(0);
  await page.getByLabel('画布设置', { exact: true }).click();
  await expect(page.getByLabel('显示网格', { exact: true })).toBeVisible();
});
