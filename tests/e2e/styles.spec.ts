import { expect, test, type Page } from '@playwright/test';
import { Editor } from '../../src/application/editor';
import { emptyDocument, type DiagramDocument } from '../../src/domain/model';
import { createShapeRegistry } from '../../src/shapes/registry';
function fixture() {
  const editor = new Editor(emptyDocument(), createShapeRegistry());
  const ops = [
    ['a', 100, 220],
    ['b', 650, 220],
    ['c', 350, 70],
    ['d', 350, 430],
  ].map(([id, x, y]) => {
    const op = editor.createNode('rectangle', Number(x), Number(y));
    if (op.type !== 'node.create') throw Error();
    op.node.id = String(id);
    op.node.entityId = `entity_${id}`;
    op.entity.id = op.node.entityId;
    op.entity.name = String(id);
    op.node.bounds.width = 100;
    op.node.bounds.height = 60;
    return op;
  });
  editor.dispatch('创建测试图', [
    ...ops,
    {
      type: 'edge.create',
      edge: {
        id: 'horizontal',
        label: '横线',
        source: { nodeId: 'a', portId: 'right' },
        target: { nodeId: 'b', portId: 'left' },
        appearance: { routing: 'straight', corner: 'sharp', endArrow: 'none' },
      },
    },
    {
      type: 'edge.create',
      edge: {
        id: 'vertical',
        label: '竖线',
        source: { nodeId: 'c', portId: 'bottom' },
        target: { nodeId: 'd', portId: 'top' },
        appearance: { routing: 'straight', corner: 'sharp', endArrow: 'none' },
      },
    },
  ]);
  return editor.snapshot;
}
async function readDocument(page: Page): Promise<DiagramDocument> {
  await page.getByRole('button', { name: '文档数据', exact: true }).click();
  const doc = JSON.parse(await page.getByTestId('document-json').innerText());
  await page.getByRole('button', { name: '关闭文档数据' }).click();
  return doc;
}
async function select(page: Page, name: string, shift = false) {
  await page
    .getByRole('button', { name, exact: true })
    .click({ modifiers: shift ? ['Shift'] : [] });
}
async function number(page: Page, name: string, value: number) {
  await page.getByLabel(name, { exact: true }).fill(String(value));
  await page.getByLabel(name, { exact: true }).press('Tab');
}
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('导入文档', { exact: true }).setInputFiles({
    name: '样式.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(fixture())),
  });
  await page.getByRole('button', { name: /^图层/ }).click();
});
test('节点边框、配色与不透明度应用到实际 SVG，支持批量设置及撤销', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await select(page, 'a');
  await select(page, 'b', true);
  await page.getByRole('button', { name: '应用绿色样式' }).click();
  await number(page, '线条宽度', 4);
  await page.getByLabel('线条样式', { exact: true }).selectOption('dotted-spaced');
  await page.getByLabel('转角样式', { exact: true }).selectOption('sharp');
  await number(page, '图形不透明度', 50);
  let doc = await readDocument(page);
  for (const id of ['a', 'b']) {
    expect(doc.nodes[id].appearance).toMatchObject({
      accent: '#82b366',
      fill: '#d5e8d4',
      strokeWidth: 4,
      pattern: 'dotted-spaced',
      corner: 'sharp',
      opacity: 50,
    });
    const shape = page.locator(`[data-element-id="${id}"]`).first();
    const outline = shape.locator('[stroke="#82b366"]').first();
    const dash = (await outline.getAttribute('stroke-dasharray'))!.split(' ').map(Number);
    const scale = Number(await outline.getAttribute('width')) / doc.nodes[id].bounds.width;
    expect(dash[0]).toBeCloseTo(4 * scale, 2);
    expect(dash[1]).toBeCloseTo(8 * scale, 2);
    await expect(shape.locator('[fill="#d5e8d4"]').first()).toHaveAttribute('fill-opacity', '0.5');
  }
  await page.getByLabel('显示线条', { exact: true }).uncheck();
  await expect(page.getByLabel('线条宽度', { exact: true })).toBeDisabled();
  await expect(
    page.locator('[data-element-id="a"]').first().locator('[stroke="#82b366"]'),
  ).toHaveCount(0);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect((await readDocument(page)).nodes.a.appearance.strokeEnabled).toBe(true);
  expect(errors).toEqual([]);
});
test('连线路径、箭头大小填充与间距改变 SVG，形态切换不丢失属性', async ({ page }) => {
  await select(page, '横线');
  const line = page.locator('[data-element-id="horizontal"]').first().locator('path').last();
  const beforeSpacing = await line.getAttribute('d');
  await number(page, '线始端间距', 12);
  await number(page, '线末端间距', 10);
  const spaced = await line.getAttribute('d');
  expect(spaced).not.toBe(beforeSpacing);
  const beforeNumbers = beforeSpacing!.match(/-?\d+(?:\.\d+)?/g)!.map(Number),
    afterNumbers = spaced!.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  expect(afterNumbers[0]).toBeGreaterThan(beforeNumbers[0]);
  expect(afterNumbers[2]).toBeLessThan(beforeNumbers[2]);
  await select(page, 'b');
  await number(page, '图形 y', 350);
  await select(page, '横线');
  await page.getByLabel('线始端形状', { exact: true }).selectOption('diamond');
  await page.getByLabel('填充线始端', { exact: true }).uncheck();
  await number(page, '线始端大小', 14);
  await number(page, '线始端间距', 12);
  await page.getByLabel('线末端形状', { exact: true }).selectOption('classicThin');
  await number(page, '线末端大小', 18);
  await number(page, '线末端间距', 10);
  await page.getByLabel('连接路径', { exact: true }).selectOption('elbow-vertical');
  await page.getByLabel('转角样式', { exact: true }).selectOption('curved');
  const edge = page.locator('[data-element-id="horizontal"]').first();
  await expect(edge.locator('path[fill="none"]').last()).toHaveAttribute('d', /.+/);
  await expect(edge.locator('path').nth(1)).toHaveAttribute('d', /Q/i);
  await expect(page.getByLabel('跨线样式', { exact: true })).toBeDisabled();
  for (const shape of ['block-arrow', 'link', 'simple-arrow', 'line']) {
    await page.getByLabel('线段形态', { exact: true }).selectOption(shape);
    await expect(edge.locator('path').first()).toHaveAttribute('d', /.+/);
  }
  expect((await readDocument(page)).edges.horizontal.appearance).toMatchObject({
    startArrow: 'diamond',
    startFill: false,
    startSize: 14,
    startSpacing: 12,
    endArrow: 'classicThin',
    endSize: 18,
    endSpacing: 10,
    routing: 'elbow-vertical',
    corner: 'curved',
    shape: 'line',
  });
});
test('真实交点绘制圆弧、间断和尖角，PNG 导出使用同一效果', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await select(page, '竖线');
  await page.getByLabel('跨线样式', { exact: true }).selectOption('arc');
  await number(page, '跨线大小', 24);
  const edge = page.locator('[data-element-id="vertical"]').first();
  await expect(edge).toHaveAttribute('data-line-jumps', '1');
  const path = edge.locator('path').last();
  await expect(path).toHaveAttribute('d', /C/i);
  const arc = await path.getAttribute('d');
  await page.getByLabel('跨线样式', { exact: true }).selectOption('gap');
  expect((await path.getAttribute('d'))!.match(/M/gi)?.length).toBeGreaterThan(1);
  await page.getByLabel('跨线样式', { exact: true }).selectOption('sharp');
  expect(await path.getAttribute('d')).not.toBe(arc);
  const doc = await readDocument(page);
  const png = await page.evaluate(async (doc) => {
    const { exportDiagramPng } = await import(String('/src/adapters/maxgraph/export.ts'));
    const { createShapeRegistry } = await import(String('/src/shapes/registry.ts'));
    const images = [];
    for (const jumpStyle of ['none', 'arc', 'gap', 'sharp'] as const) {
      doc.edges.vertical.appearance = { ...doc.edges.vertical.appearance, jumpStyle };
      const blob = await exportDiagramPng(doc, createShapeRegistry());
      const img = await createImageBitmap(blob),
        canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      images.push(canvas.toDataURL());
      img.close();
    }
    return images;
  }, doc);
  expect(new Set(png).size).toBe(4);
  expect(errors).toEqual([]);
});
