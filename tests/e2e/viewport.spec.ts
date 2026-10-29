import { expect, test, type Page } from '@playwright/test';
import { demoDocument } from '../../src/application/demo';
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
test('内容未溢出时与可见区域同大，放大后通过横纵滚动条找回视野外图形', async ({ page }) => {
  await page.goto('/');
  const doc = await readDocument(page),
    graph = await page.getByTestId('graph').boundingBox();
  if (!graph) throw Error('缺少画布');
  const area = (await page.getByTestId('canvas-area').boundingBox())!,
    topbar = (await page.locator('.canvas-topbar').boundingBox())!;
  expect(graph.x - area.x).toBe(12);
  expect(area.x + area.width - graph.x - graph.width).toBe(12);
  expect(graph.y - topbar.y - topbar.height).toBe(12);
  expect(area.y + area.height - graph.y - graph.height).toBe(12);
  const heading = (await page.locator('.canvas-heading').boundingBox())!,
    tools = (await page.getByRole('toolbar', { name: '画布工具' }).boundingBox())!;
  expect(heading.y).toBeGreaterThan(graph.y);
  expect(tools.y + tools.height).toBeLessThan(graph.y + graph.height);
  await expect(page.locator('.scroll-shadow')).toHaveCount(0);
  const sizes = () =>
    page.getByTestId('graph').evaluate((el) => ({
      width: el.clientWidth,
      height: el.clientHeight,
      scrollWidth: el.scrollWidth,
      scrollHeight: el.scrollHeight,
      left: el.scrollLeft,
      top: el.scrollTop,
    }));
  const initial = await sizes();
  expect(initial.scrollWidth).toBe(initial.width);
  expect(initial.scrollHeight).toBe(initial.height);
  const end = await bounds(page, 'end');
  await page.mouse.move(graph.x + graph.width / 2, end.y + end.height / 2);
  await page.mouse.wheel(0, -3000);
  await expect(page.locator('.zoom-control>span')).toHaveText('400%');
  const before = await bounds(page, 'end');
  expect(before.x).toBeGreaterThan(graph.x + graph.width);
  const expanded = await sizes();
  expect(expanded.scrollWidth).toBeGreaterThan(expanded.width);
  expect(expanded.scrollHeight).toBeGreaterThan(expanded.height);
  await page.getByTestId('graph').evaluate((el) => {
    el.scrollLeft = 0;
    el.scrollTop = 0;
  });
  await expect(page.locator('.scroll-shadow.right')).toHaveCount(1);
  await expect(page.locator('.scroll-shadow.bottom')).toHaveCount(1);
  await expect(page.locator('.scroll-shadow.left, .scroll-shadow.top')).toHaveCount(0);
  await page.getByTestId('graph').evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
    el.scrollTop = el.scrollHeight;
  });
  await expect(page.locator('.scroll-shadow.left')).toHaveCount(1);
  await expect(page.locator('.scroll-shadow.top')).toHaveCount(1);
  await expect(page.locator('.scroll-shadow.right, .scroll-shadow.bottom')).toHaveCount(0);
  const after = await bounds(page, 'end');
  expect(after.x).toBeGreaterThan(graph.x);
  expect(after.x + after.width).toBeLessThan(graph.x + graph.width);
  expect(after.y).toBeGreaterThan(graph.y);
  expect(after.y + after.height).toBeLessThan(graph.y + graph.height);
  await page.getByRole('button', { name: '适应画布', exact: true }).click();
  const fitted = await sizes();
  expect(fitted.scrollWidth).toBe(fitted.width);
  expect(fitted.scrollHeight).toBe(fitted.height);
  await expect(page.locator('.scroll-shadow')).toHaveCount(0);
  expect(await readDocument(page)).toEqual(doc);
});
test('鼠标可拖动横纵滚动条并使用键盘定位，画布工具栏不随内容滚动', async ({ page }) => {
  await page.goto('/');
  const graph = (await page.getByTestId('graph').boundingBox())!,
    tools = await page.getByRole('toolbar', { name: '画布工具' }).boundingBox();
  await page.mouse.move(graph.x + graph.width / 2, graph.y + graph.height / 2);
  await page.mouse.wheel(0, -3000);
  await expect(page.getByRole('scrollbar')).toHaveCount(2);
  await page.getByTestId('graph').evaluate((el) => {
    el.scrollLeft = 0;
    el.scrollTop = 0;
  });
  const horizontal = page.getByRole('scrollbar', { name: '水平滚动条' }),
    vertical = page.getByRole('scrollbar', { name: '垂直滚动条' });
  await expect(horizontal).toHaveAttribute('aria-valuenow', '0');
  let thumb = (await horizontal.locator('.scrollbar-thumb').boundingBox())!;
  await drag(page, thumb.x + thumb.width / 2, thumb.y + thumb.height / 2, 500, 0);
  await expect
    .poll(() => page.getByTestId('graph').evaluate((el) => el.scrollLeft))
    .toBeGreaterThan(500);
  thumb = (await vertical.locator('.scrollbar-thumb').boundingBox())!;
  await drag(page, thumb.x + thumb.width / 2, thumb.y + thumb.height / 2, 0, 300);
  await expect
    .poll(() => page.getByTestId('graph').evaluate((el) => el.scrollTop))
    .toBeGreaterThan(300);
  expect(await page.getByRole('toolbar', { name: '画布工具' }).boundingBox()).toEqual(tools);
  await horizontal.press('Home');
  await expect(horizontal).toHaveAttribute('aria-valuenow', '0');
  await horizontal.press('End');
  await expect
    .poll(() => page.getByTestId('graph').evaluate((el) => el.scrollLeft))
    .toBeGreaterThan(1000);
  await page.getByRole('button', { name: '适应画布', exact: true }).click();
  await expect(page.getByRole('scrollbar')).toHaveCount(0);
});
test('普通拖拽恢复框选，组合图形只选择业务节点，框选不移动画布', async ({ page }) => {
  await page.goto('/');
  const fixture = demoDocument();
  fixture.edges = {};
  const ids = ['receive', 'confirm', 'deliver'];
  fixture.nodes = Object.fromEntries(
    ids.map((id, index) => {
      const node = fixture.nodes[id];
      delete node.parentId;
      node.bounds = { x: 100 + index * 280, y: index === 2 ? 340 : 100, width: 200, height: 120 };
      return [id, node];
    }),
  );
  fixture.entities = Object.fromEntries(
    ids.map((id) => [`entity_${id}`, fixture.entities[`entity_${id}`]]),
  );
  fixture.canvas = { grid: true, gridSize: 20, background: null };
  await page.getByLabel('导入文档', { exact: true }).setInputFiles({
    name: '框选.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(fixture)),
  });
  const doc = await readDocument(page),
    graph = await page.getByTestId('graph').boundingBox();
  if (!graph) throw Error('缺少画布');
  const before = await bounds(page, 'receive'),
    second = await bounds(page, 'confirm');
  await drag(
    page,
    before.x - 15,
    before.y - 15,
    second.x + second.width - before.x + 30,
    before.height + 30,
  );
  await expect(page.getByText('已选择 2 个元素', { exact: true })).toBeVisible();
  expect(await bounds(page, 'receive')).toEqual(before);
  await expect(page.locator('.mxRubberband')).toHaveCount(0);
  await page.mouse.move(graph.x + graph.width / 2, graph.y + graph.height / 2);
  await page.mouse.wheel(0, -100);
  const gridBefore = await page
    .getByTestId('canvas-area')
    .evaluate((el) => getComputedStyle(el).backgroundPosition);
  const scroll = await page.getByTestId('graph').evaluate((el) => {
    const before = { left: el.scrollLeft, top: el.scrollTop };
    el.scrollLeft += 80;
    el.scrollTop += 20;
    return { x: el.scrollLeft - before.left, y: el.scrollTop - before.top };
  });
  expect(scroll.x).toBeGreaterThan(0);
  const position = (text: string) => text.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  await expect
    .poll(
      async () =>
        position(
          await page
            .getByTestId('canvas-area')
            .evaluate((el) => getComputedStyle(el).backgroundPosition),
        )[0],
    )
    .toBeCloseTo(position(gridBefore)[0] - scroll.x, 0);
  const scrolled = await bounds(page, 'receive'),
    scrolledSecond = await bounds(page, 'confirm');
  await drag(
    page,
    scrolled.x - 15,
    scrolled.y - 15,
    scrolledSecond.x + scrolledSecond.width - scrolled.x + 30,
    scrolled.height + 30,
  );
  await expect(page.getByText('已选择 2 个元素', { exact: true })).toBeVisible();
  expect(await readDocument(page)).toEqual(doc);
});
test('泳道内容区也可直接框选，标题仍可单独选择泳道', async ({ page }) => {
  await page.goto('/');
  const doc = await readDocument(page),
    a = await bounds(page, 'receive'),
    b = await bounds(page, 'confirm');
  await drag(page, a.x - 12, a.y - 12, b.x + b.width - a.x + 24, a.height + 24);
  await expect(page.getByText(/已选择 \d+ 个元素/)).toBeVisible();
  await page.getByRole('button', { name: /^图层/ }).click();
  for (const name of ['接收客户订单', '信息完整？', '确认订单信息'])
    await expect(page.getByRole('button', { name, exact: true })).toHaveClass(/selected/);
  await expect(page.getByRole('button', { name: '销售团队', exact: true })).not.toHaveClass(
    /selected/,
  );
  const lane = await bounds(page, 'lane_sales');
  await page.mouse.click(lane.x + 20, lane.y + lane.height / 2);
  await expect(page.getByRole('toolbar', { name: '泳道工具栏', exact: true })).toBeVisible();
  expect(await readDocument(page)).toEqual(doc);
});
test('平移工具、中键与空格只滚动视口，切回选择工具后仍可框选', async ({ page }) => {
  await page.goto('/');
  const doc = await readDocument(page),
    graph = (await page.getByTestId('graph').boundingBox())!;
  await page.mouse.move(graph.x + graph.width / 2, graph.y + graph.height / 2);
  await page.mouse.wheel(0, -500);
  await page.getByTestId('graph').evaluate((el) => {
    el.scrollLeft = 200;
    // 扩大的视口中预留连续两次纵向平移的空间，避免提前到达滚动尽头。
    el.scrollTop = 100;
  });
  let before = await bounds(page, 'receive');
  await page.getByRole('button', { name: '平移工具', exact: true }).click();
  await drag(page, graph.x + graph.width / 2, graph.y + 40, -100, 0);
  let after = await bounds(page, 'receive');
  expect(after.x).toBeCloseTo(before.x - 100, 0);
  await page.getByRole('button', { name: '选择工具', exact: true }).click();
  before = after;
  const x = after.x + after.width / 2,
    y = after.y + after.height / 2;
  await drag(page, x, y, 0, -80, 'middle');
  after = await bounds(page, 'receive');
  expect(after.y).toBeCloseTo(before.y - 80, 0);
  expect(after.x).toBeCloseTo(before.x, 0);
  before = after;
  await page.mouse.move(after.x + after.width / 2, after.y + after.height / 2);
  await page.keyboard.down('Space');
  await drag(page, after.x + after.width / 2, after.y + after.height / 2, -80, -60);
  await page.keyboard.up('Space');
  after = await bounds(page, 'receive');
  // 浏览器将滚动位置与鼠标坐标取整，允许一个像素的边界差异。
  expect(Math.abs(after.x - (before.x - 80))).toBeLessThan(2);
  expect(Math.abs(after.y - (before.y - 60))).toBeLessThan(2);
  await expect(page.getByTestId('graph')).not.toHaveClass(/space-panning|is-panning/);
  expect(await readDocument(page)).toEqual(doc);
});
test('移动图形到可见范围外自动扩展，删除内容后滚动范围回收为空画布', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /^图层/ }).click();
  await page.getByRole('button', { name: '订单履约泳池', exact: true }).click();
  await page.getByLabel('图形 x', { exact: true }).fill('2000');
  await page.getByLabel('图形 x', { exact: true }).press('Tab');
  await expect
    .poll(() => page.getByTestId('graph').evaluate((el) => el.scrollWidth > el.clientWidth))
    .toBe(true);
  await page.getByTestId('graph').evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  await page.getByRole('button', { name: '删除所选', exact: true }).click();
  await expect
    .poll(() =>
      page.getByTestId('graph').evaluate((el) => ({
        x: el.scrollWidth - el.clientWidth,
        y: el.scrollHeight - el.clientHeight,
        left: el.scrollLeft,
        top: el.scrollTop,
      })),
    )
    .toEqual({ x: 0, y: 0, left: 0, top: 0 });
  expect(Object.keys((await readDocument(page)).nodes)).toHaveLength(0);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect((await readDocument(page)).nodes.pool_order.bounds.x).toBe(2000);
  await expect
    .poll(() => page.getByTestId('graph').evaluate((el) => el.scrollWidth > el.clientWidth))
    .toBe(true);
});
test('负坐标图形也纳入滚动范围，不修改文档即可滚动到达', async ({ page }) => {
  await page.goto('/');
  const fixture = demoDocument();
  fixture.nodes.pool_order.bounds.x = -240;
  fixture.nodes.pool_order.bounds.y = -180;
  await page.getByLabel('导入文档', { exact: true }).setInputFiles({
    name: '负坐标.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(fixture)),
  });
  const doc = await readDocument(page),
    graph = (await page.getByTestId('graph').boundingBox())!;
  await page.mouse.move(graph.x + graph.width / 2, graph.y + graph.height / 2);
  await page.mouse.wheel(0, -3000);
  await page.getByTestId('graph').evaluate((el) => {
    el.scrollLeft = 0;
    el.scrollTop = 0;
  });
  const first = await bounds(page, 'start');
  expect(first.x).toBeGreaterThan(graph.x);
  expect(first.y).toBeGreaterThan(graph.y);
  expect(first.x + first.width).toBeLessThan(graph.x + graph.width);
  expect(first.y + first.height).toBeLessThan(graph.y + graph.height);
  await page.getByTestId('graph').evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  const last = await bounds(page, 'end');
  expect(last.x).toBeGreaterThan(graph.x);
  expect(last.x + last.width).toBeLessThan(graph.x + graph.width);
  expect(await readDocument(page)).toEqual(doc);
});
test('Shift 加滚轮及触控板水平滚动可左右移动，侧栏和按钮滚动不缩放', async ({ page }) => {
  await page.goto('/');
  const graph = await page.getByTestId('graph').boundingBox();
  if (!graph) throw Error('缺少画布');
  await page.mouse.move(graph.x + graph.width / 2, graph.y + graph.height / 2);
  await page.mouse.wheel(0, -500);
  await page.getByTestId('graph').evaluate((el) => {
    el.scrollLeft = 200;
  });
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
