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
  await page.getByLabel('网格线颜色', { exact: true }).evaluate((el) => {
    (el as HTMLInputElement).value = '#112233';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.getByLabel('网格线透明度', { exact: true }).fill('50');
  await expect(page.getByTestId('canvas-area')).toHaveCSS(
    'background-image',
    /rgba\(17, 34, 51, 0.5\)/,
  );
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.getByLabel('网格线透明度', { exact: true })).toHaveValue('0');
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(page.getByLabel('网格线透明度', { exact: true })).toHaveValue('50');
  await page.getByLabel('透明背景', { exact: true }).uncheck();
  await page.getByLabel('画布背景颜色').evaluate((el) => {
    (el as HTMLInputElement).value = '#eaf4ee';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect((await readDocument(page)).canvas).toEqual({
    grid: true,
    gridSize: 25,
    background: '#eaf4ee',
    gridColor: '#112233',
    gridOpacity: 0.5,
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
  expect((await readDocument(page)).canvas).toMatchObject({
    background: '#eaf4ee',
    gridColor: '#112233',
    gridOpacity: 0.5,
  });
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
  const empty = {
    ...doc,
    nodes: {},
    entities: {},
    edges: {},
    canvas: { grid: true, gridSize: 20, background: null, gridColor: '#112233', gridOpacity: 1 },
  };
  const opaque = await pngPixel(page, empty, 16, 26);
  const translucent = await pngPixel(
    page,
    { ...empty, canvas: { ...empty.canvas, gridOpacity: 0.5 } },
    16,
    26,
  );
  expect(opaque[3]).toBeGreaterThan(0);
  expect(translucent[3]).toBeGreaterThan(0);
  expect(translucent[3]).toBeLessThan(opaque[3]);
  for (const [index, value] of [17, 34, 51].entries())
    expect(Math.abs(opaque[index] - value)).toBeLessThanOrEqual(2);
  expect(
    (await pngPixel(page, { ...empty, canvas: { ...empty.canvas, gridOpacity: 0 } }, 16, 26))[3],
  ).toBe(0);
});
