import { expect, test, type Page } from '@playwright/test';
async function dragCorner(page: Page, label: string, dx: number, dy: number) {
  const bounds = await page
    .getByRole('button', { name: `${label}宽高`, exact: true })
    .boundingBox();
  if (!bounds) throw Error('找不到侧栏拖拽手柄');
  const x = bounds.x + bounds.width / 2,
    y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 10 });
  await page.mouse.up();
}
for (const side of [
  { id: 'left', label: '图形库侧栏', min: 180, max: 420, shrink: -150, grow: 800 },
  { id: 'right', label: '属性侧栏', min: 260, max: 600, shrink: 180, grow: -800 },
]) {
  test(`${side.label} 折叠后让出画布空间，刷新后可恢复原尺寸`, async ({ page }) => {
    await page.goto('/');
    const panel = page.locator(`[data-resizable-sidebar="${side.id}"]`);
    const before = await panel.boundingBox();
    const graph = (await page.getByTestId('graph').boundingBox())!;
    await page.getByRole('button', { name: `折叠${side.label}`, exact: true }).click();
    await expect(panel).toHaveCSS('width', '36px');
    await expect
      .poll(async () => (await page.getByTestId('graph').boundingBox())!.width)
      .toBeGreaterThan(graph.width);
    await page.reload();
    await expect(
      page.getByRole('button', { name: `展开${side.label}`, exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: `展开${side.label}`, exact: true }).click();
    await expect(panel).toHaveCSS('width', `${before!.width}px`);
    await expect(panel).toHaveCSS('height', `${before!.height}px`);
    expect(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem('diagramly.document.v1')!).revision,
      ),
    ).toBe(0);
  });
  test(`${side.label} 可拖动宽高，限制范围并记住尺寸`, async ({ page }) => {
    const failures: string[] = [];
    page.on('pageerror', (e) => failures.push(e.message));
    await page.goto('/');
    await dragCorner(page, side.label, side.shrink, -700);
    const panel = page.locator(`[data-resizable-sidebar="${side.id}"]`);
    await expect(panel).toHaveCSS('width', `${side.min}px`);
    await expect(panel).toHaveCSS('height', '280px');
    await page.reload();
    await expect(panel).toHaveCSS('width', `${side.min}px`);
    await expect(panel).toHaveCSS('height', '280px');
    await dragCorner(page, side.label, side.grow, 100);
    await expect(panel).toHaveCSS('width', `${side.max}px`);
    await expect(panel).toHaveCSS('height', '380px');
    const vertical = page.getByRole('separator', { name: `${side.label}高度`, exact: true });
    await vertical.press('End');
    await expect(panel).toHaveCSS('height', `${await vertical.getAttribute('aria-valuemax')}px`);
    await vertical.press('Home');
    await expect(panel).toHaveCSS('height', '280px');
    expect(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem('diagramly.document.v1')!).revision,
      ),
    ).toBe(0);
    expect(failures).toEqual([]);
  });
}
test('窗口缩小时重新约束侧栏上限，为画布保留空间', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('separator', { name: '图形库侧栏宽度', exact: true }).press('End');
  await page.getByRole('separator', { name: '属性侧栏宽度', exact: true }).press('End');
  await page.setViewportSize({ width: 1100, height: 760 });
  await expect(page.locator('[data-resizable-sidebar="left"]')).toHaveCSS('width', '308px');
  await expect(page.locator('[data-resizable-sidebar="right"]')).toHaveCSS('width', '440px');
  const canvas = await page.getByTestId('canvas-area').boundingBox();
  expect(canvas!.width).toBeGreaterThan(300);
});
