import { expect, test, type Page } from '@playwright/test';
async function readDocument(page: Page) {
  await page.getByRole('button', { name: '文档数据', exact: true }).click();
  const doc = JSON.parse(await page.getByTestId('document-json').innerText());
  await page.getByRole('button', { name: '关闭文档数据' }).click();
  return doc;
}
async function pngPixel(page: Page, doc: unknown, x = 0, y = 0) {
  return page.evaluate(
    async ({ doc, x, y }) => {
      const { exportDiagramPng } = await import(String('/src/adapters/maxgraph/export.ts'));
      const { createShapeRegistry } = await import(String('/src/shapes/registry.ts'));
      const blob = await exportDiagramPng(doc, createShapeRegistry()),
        image = await createImageBitmap(blob);
      const output = document.createElement('canvas');
      output.width = image.width;
      output.height = image.height;
      const ctx = output.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      const pixel = [...ctx.getImageData(x, y, 1, 1).data];
      image.close();
      return pixel;
    },
    { doc, x, y },
  );
}
test('画布网格和背景可设置、持久化并撤销', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('画布设置', { exact: true }).click();
  await expect(page.getByLabel('透明背景', { exact: true })).toBeChecked();
  await page.getByLabel('显示网格', { exact: true }).check();
  await page.getByLabel('网格间距', { exact: true }).fill('25');
  await page.getByLabel('网格间距', { exact: true }).press('Tab');
  await page.getByLabel('透明背景', { exact: true }).uncheck();
  await page.getByLabel('画布背景颜色').evaluate((el) => {
    (el as HTMLInputElement).value = '#eaf4ee';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect((await readDocument(page)).canvas).toEqual({
    grid: true,
    gridSize: 25,
    background: '#eaf4ee',
  });
  await expect(page.getByTestId('canvas-area')).toHaveCSS('background-color', 'rgb(234, 244, 238)');
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('diagramly.document.v1')!).canvas?.background,
      ),
    )
    .toBe('#eaf4ee');
  await page.reload();
  expect((await readDocument(page)).canvas.background).toBe('#eaf4ee');
});
test('PNG 默认透明，设置背景和网格后真实像素随之变化', async ({ page }) => {
  await page.goto('/');
  const doc = await readDocument(page);
  expect((await pngPixel(page, doc))[3]).toBe(0);
  expect(
    await pngPixel(page, { ...doc, canvas: { grid: false, gridSize: 20, background: '#123456' } }),
  ).toEqual([18, 52, 86, 255]);
  expect(
    (
      await pngPixel(
        page,
        {
          ...doc,
          nodes: {},
          entities: {},
          edges: {},
          canvas: { grid: true, gridSize: 20, background: null },
        },
        16,
        16,
      )
    )[3],
  ).toBeGreaterThan(0);
});
