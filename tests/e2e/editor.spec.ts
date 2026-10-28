import { expect, test, type Page } from '@playwright/test';
import type { DiagramDocument } from '../../src/domain/model';
async function readDocument(page: Page): Promise<DiagramDocument> {
  await page.getByRole('button', { name: '文档数据', exact: true }).click();
  const data = JSON.parse(await page.getByTestId('document-json').innerText());
  await page.getByRole('button', { name: '关闭文档数据' }).click();
  return data;
}
async function selectLayer(page: Page, name: string) {
  await page.getByRole('button', { name: /^图层/ }).click();
  await page.getByRole('button', { name, exact: true }).click();
}
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-element-id="receive"]').first()).toBeVisible();
});
test('renders the real graph and treats a composite as one selectable business node', async ({ page }) => {
  const failures: string[] = []; page.on('pageerror', (error) => failures.push(error.message));
  await page.locator('[data-element-id="receive"]').first().click();
  await expect(page.getByRole('textbox', { name: '节点名称', exact: true })).toHaveValue('接收客户订单');
  await page.getByRole('textbox', { name: '节点名称', exact: true }).fill('核对客户订单');
  await page.getByRole('textbox', { name: '节点名称', exact: true }).press('Tab');
  await expect(page.getByTestId('graph')).toContainText('核对客户订单');
  const doc = await readDocument(page);
  expect(doc.entities.entity_receive.name).toBe('核对客户订单'); expect(Object.keys(doc.nodes)).toHaveLength(9);
  expect(JSON.stringify(doc)).not.toContain('::title'); expect(failures).toEqual([]);
});
test('duplicates with a fresh entity, deletes the whole composite and undoes atomically', async ({ page }) => {
  await selectLayer(page, '接收客户订单');
  await page.getByRole('button', { name: '复制所选', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '节点名称', exact: true })).toHaveValue('接收客户订单 副本');
  let doc = await readDocument(page);
  expect(Object.keys(doc.nodes)).toHaveLength(10); expect(Object.keys(doc.entities)).toHaveLength(10);
  await page.getByRole('button', { name: '删除所选', exact: true }).click();
  doc = await readDocument(page); expect(Object.keys(doc.nodes)).toHaveLength(9);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  doc = await readDocument(page); expect(Object.keys(doc.nodes)).toHaveLength(10);
});
test('persists edits through reload and safely imports an exported document', async ({ page }) => {
  await selectLayer(page, '接收客户订单');
  const field = page.getByRole('textbox', { name: '节点名称', exact: true });
  await field.fill('持久化活动'); await field.press('Tab');
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('diagramly.document.v1')!).entities.entity_receive.name)).toBe('持久化活动');
  await page.reload(); await selectLayer(page, '持久化活动');
  await expect(field).toHaveValue('持久化活动');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /导出 JSON/ }).first().click();
  const download = await downloadPromise, path = await download.path();
  expect(download.suggestedFilename()).toContain('.diagramly.json');
  await page.getByRole('button', { name: '删除所选', exact: true }).click();
  await page.getByLabel('导入 JSON 文件').setInputFiles(path!);
  await selectLayer(page, '持久化活动'); await expect(field).toHaveValue('持久化活动');
});
test('rejects malformed import without replacing the current graph', async ({ page }) => {
  await page.getByLabel('导入 JSON 文件').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"schemaVersion":999}') });
  await expect(page.getByRole('alert')).toBeVisible();
  const doc = await readDocument(page); expect(doc.nodes.receive).toBeDefined(); expect(doc.revision).toBe(0);
});
test('previews an agent command before applying it through the same undo history', async ({ page }) => {
  await page.getByRole('button', { name: /Agent LAB/ }).click();
  await page.getByRole('button', { name: '生成命令示例' }).click();
  await page.getByRole('button', { name: '校验并预览' }).click();
  await expect(page.getByText('校验通过')).toBeVisible();
  expect((await readDocument(page)).revision).toBe(0);
  await page.getByRole('button', { name: '应用到画布' }).click();
  await expect(page.getByText('已应用 · revision 1 · 可以撤销')).toBeVisible();
  expect((await readDocument(page)).entities.entity_receive.name).toBe('Agent 更新的活动');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect((await readDocument(page)).entities.entity_receive.name).toBe('接收客户订单');
});
test('drags a composite node and records coordinates in the application model', async ({ page }) => {
  await selectLayer(page, '接收客户订单');
  const box = await page.locator('[data-element-id="receive"]').first().boundingBox();
  if (!box) throw Error('No node bounds');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 22, box.y + box.height / 2 + 7, { steps: 12 }); await page.mouse.up();
  const doc = await readDocument(page); expect(doc.nodes.receive.bounds.x).not.toBe(215); expect(doc.revision).toBe(1);
  expect(doc.nodes.receive.parentId).toBe('lane_sales');
});
test('connects nodes with a valid fixed-port edge', async ({ page }) => {
  await page.getByRole('button', { name: '连接工具', exact: true }).click();
  await page.locator('[data-element-id="receive"]').first().click();
  await expect(page.getByText('选择终点节点')).toBeVisible();
  await page.locator('[data-element-id="confirm"]').first().click();
  const doc = await readDocument(page);
  expect(Object.keys(doc.edges)).toHaveLength(7);
  const edge = Object.values(doc.edges).find((e) => e.source.nodeId === 'receive' && e.target.nodeId === 'confirm');
  expect(edge?.source.portId).toBe('right'); expect(edge?.target.portId).toBe('left');
});
test('adds a shape from the palette and renders it', async ({ page }) => {
  await page.getByTestId('shape-rectangle').click();
  await expect(page.getByRole('textbox', { name: '节点名称', exact: true })).toHaveValue('矩形');
  const doc = await readDocument(page); expect(Object.keys(doc.nodes)).toHaveLength(10);
});
test('draws a connection by dragging actual graph ports', async ({ page }) => {
  const a = await page.locator('[data-element-id="receive"]').first().boundingBox();
  const b = await page.locator('[data-element-id="confirm"]').first().boundingBox();
  if (!a || !b) throw Error('Missing connection bounds');
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  const sourcePorts = await page.locator('[data-testid="graph"] svg image').evaluateAll((icons) => icons.map((icon) => { const r = icon.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
  const sourcePort = sourcePorts.sort((u, v) => v.y - u.y)[0];
  expect(sourcePort).toBeDefined();
  await page.mouse.move(sourcePort.x, sourcePort.y);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 20 });
  const targetPorts = await page.locator('[data-testid="graph"] svg image').evaluateAll((icons) => icons.map((icon) => { const r = icon.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
  const targetPort = targetPorts.sort((u, v) => u.y - v.y)[0];
  expect(targetPort).toBeDefined();
  await page.mouse.move(targetPort.x, targetPort.y, { steps: 4 });
  await page.mouse.up();
  const doc = await readDocument(page);
  expect(Object.keys(doc.edges)).toHaveLength(7);
  expect(Object.values(doc.edges).some((e) => e.source.nodeId === 'receive' && e.target.nodeId === 'confirm')).toBe(true);
});
test('double-click edits a composite title through its owner entity', async ({ page }) => {
  await page.locator('[data-element-id="receive"]').first().dblclick();
  const inline = page.locator('.mxCellEditor');
  await expect(inline).toBeVisible();
  await inline.fill('双击更新活动'); await inline.press('F2');
  await expect(page.getByTestId('graph')).toContainText('双击更新活动');
  const doc = await readDocument(page); expect(doc.entities.entity_receive.name).toBe('双击更新活动');
  expect(Object.keys(doc.nodes)).toHaveLength(9);
});
test('creates a blank document and adds a complete composite from the palette', async ({ page }) => {
  await page.getByRole('button', { name: '新建画布', exact: true }).click();
  await page.getByRole('button', { name: '新建画布', exact: true }).last().click();
  await page.getByTestId('shape-activity').click();
  await expect(page.getByRole('textbox', { name: '节点名称', exact: true })).toHaveValue('业务活动');
  const doc = await readDocument(page); expect(Object.keys(doc.nodes)).toHaveLength(1); expect(Object.keys(doc.entities)).toHaveLength(1);
  expect(doc.title).toBe('未命名画布');
});
