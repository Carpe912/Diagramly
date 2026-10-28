import { expect, test, type Page } from '@playwright/test';
async function readDocument(page: Page) {
  await page.getByRole('button', { name: '文档数据', exact: true }).click();
  const doc = JSON.parse(await page.getByTestId('document-json').innerText());
  await page.getByRole('button', { name: '关闭文档数据' }).click();
  return doc;
}
async function bounds(page: Page, id: string) {
  const b = await page.locator(`[data-element-id="${id}"]`).first().boundingBox();
  if (!b) throw Error('缺少图形');
  return b;
}
async function drag(
  page: Page,
  x: number,
  y: number,
  dx: number,
  dy: number,
  button: 'left' | 'middle' = 'left',
) {
  await page.mouse.move(x, y);
  await page.mouse.down({ button });
  await page.mouse.move(x + dx, y + dy, { steps: 12 });
  await page.mouse.up({ button });
}
test('滚轮围绕鼠标位置缩放，缩放往返不漂移且不修改文档', async ({ page }) => {
  await page.goto('/');
  const doc = await readDocument(page),
    before = await bounds(page, 'receive');
  const x = before.x + before.width / 2,
    y = before.y + before.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, -180);
  await expect
    .poll(async () => (await bounds(page, 'receive')).width)
    .toBeGreaterThan(before.width);
  const after = await bounds(page, 'receive');
  // 引擎将描边对齐到像素，DOM 边界允许少量取整误差。
  expect(Math.abs(after.x + after.width / 2 - x)).toBeLessThan(2);
  expect(Math.abs(after.y + after.height / 2 - y)).toBeLessThan(2);
  await page.mouse.wheel(0, 180);
  await expect
    .poll(async () => Math.abs((await bounds(page, 'receive')).width - before.width))
    .toBeLessThan(1);
  expect(await readDocument(page)).toEqual(doc);
});
test('放大后可连续向左平移，找回视口外右侧图形，纯水平拖拽不回弹', async ({ page }) => {
  await page.goto('/');
  const doc = await readDocument(page),
    graph = await page.getByTestId('graph').boundingBox();
  if (!graph) throw Error('缺少画布');
  const end = await bounds(page, 'end');
  await page.mouse.move(graph.x + graph.width / 2, end.y + end.height / 2);
  await page.mouse.wheel(0, -3000);
  await expect(page.locator('.zoom-control>span')).toHaveText('400%');
  const before = await bounds(page, 'end');
  expect(before.x).toBeGreaterThan(graph.x + graph.width);
  await page.getByRole('button', { name: '平移工具', exact: true }).click();
  for (let i = 0; i < 3; i++) await drag(page, graph.x + graph.width - 80, graph.y + 100, -550, 0);
  const after = await bounds(page, 'end');
  expect(after.x).toBeCloseTo(before.x - 1650, 0);
  expect(after.y).toBeCloseTo(before.y, 0);
  expect(after.x).toBeGreaterThan(graph.x);
  expect(after.x + after.width).toBeLessThan(graph.x + graph.width);
  expect(await readDocument(page)).toEqual(doc);
});
test('默认空白拖拽、中键和空格拖拽均可平移，纯垂直移动保留结果', async ({ page }) => {
  await page.goto('/');
  const doc = await readDocument(page),
    graph = await page.getByTestId('graph').boundingBox();
  if (!graph) throw Error('缺少画布');
  let before = await bounds(page, 'receive');
  await drag(page, graph.x + 100, graph.y + 20, 140, 0);
  let after = await bounds(page, 'receive');
  expect(after.x).toBeCloseTo(before.x + 140, 0);
  before = after;
  const x = after.x + after.width / 2,
    y = after.y + after.height / 2;
  await drag(page, x, y, 0, 120, 'middle');
  after = await bounds(page, 'receive');
  expect(after.y).toBeCloseTo(before.y + 120, 0);
  expect(after.x).toBeCloseTo(before.x, 0);
  before = after;
  await page.mouse.move(after.x + after.width / 2, after.y + after.height / 2);
  await page.keyboard.down('Space');
  await drag(page, after.x + after.width / 2, after.y + after.height / 2, -120, -100);
  await page.keyboard.up('Space');
  after = await bounds(page, 'receive');
  expect(after.x).toBeCloseTo(before.x - 120, 0);
  expect(after.y).toBeCloseTo(before.y - 100, 0);
  await expect(page.getByTestId('graph')).not.toHaveClass(/space-panning|is-panning/);
  expect(await readDocument(page)).toEqual(doc);
});
test('Shift 加滚轮及触控板水平滚动可左右移动，侧栏和按钮滚动不缩放', async ({ page }) => {
  await page.goto('/');
  const graph = await page.getByTestId('graph').boundingBox();
  if (!graph) throw Error('缺少画布');
  const before = await bounds(page, 'receive');
  await page.mouse.move(graph.x + graph.width / 2, graph.y + 20);
  await page.keyboard.down('Shift');
  await page.mouse.wheel(0, 120);
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await bounds(page, 'receive')).x).toBeCloseTo(before.x - 120, 0);
  await page.mouse.wheel(-100, 0);
  await expect.poll(async () => (await bounds(page, 'receive')).x).toBeCloseTo(before.x - 20, 0);
  const zoom = await page.locator('.zoom-control>span').innerText();
  await page.getByRole('button', { name: '放大', exact: true }).hover();
  await page.mouse.wheel(0, -200);
  await expect(page.locator('.zoom-control>span')).toHaveText(zoom);
  await page.getByRole('complementary', { name: '属性侧栏', exact: true }).hover();
  await page.mouse.wheel(0, -200);
  await expect(page.locator('.zoom-control>span')).toHaveText(zoom);
});
test('滚轮缩放限制在 10% 到 400%，适应画布可以找回全部图形', async ({ page }) => {
  await page.goto('/');
  const graph = await page.getByTestId('graph').boundingBox();
  if (!graph) throw Error('缺少画布');
  await page.mouse.move(graph.x + graph.width / 2, graph.y + 100);
  await page.mouse.wheel(0, 10000);
  await expect(page.locator('.zoom-control>span')).toHaveText('10%');
  await page.mouse.wheel(0, -10000);
  await expect(page.locator('.zoom-control>span')).toHaveText('400%');
  await page.getByRole('button', { name: '适应画布', exact: true }).click();
  const pool = await bounds(page, 'pool_order');
  expect(pool.x).toBeGreaterThanOrEqual(graph.x);
  expect(pool.x + pool.width).toBeLessThanOrEqual(graph.x + graph.width);
});
