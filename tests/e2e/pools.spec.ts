import { expect, test, type Page } from '@playwright/test';
import type { DiagramDocument } from '../../src/domain/model';
async function readDocument(page: Page): Promise<DiagramDocument> {
  await page.getByRole('button', { name: '文档数据', exact: true }).click();
  const data = JSON.parse(await page.getByTestId('document-json').innerText());
  await page.getByRole('button', { name: '关闭文档数据' }).click();
  return data;
}
async function poolSelection(page: Page) {
  await page.getByRole('button', { name: /^图层/ }).click();
  await page.getByRole('button', { name: '订单履约泳池', exact: true }).click();
  await expect(page.getByRole('toolbar', { name: '泳池工具栏' })).toBeVisible();
}
async function setColor(page: Page, label: string, value: string) {
  await page.getByLabel(label, { exact: true }).evaluate((input, color) => {
    (input as HTMLInputElement).value = color;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}
test.beforeEach(async ({ page }) => {
  await page.goto('/');
});
test('selecting a pool on the actual canvas reveals the pool toolbar', async ({ page }) => {
  const root = page.locator('[data-element-id="pool_order"]').first();
  const bounds = await root.boundingBox();
  if (!bounds) throw Error('Missing pool bounds');
  await page.mouse.click(bounds.x + 18, bounds.y + bounds.height / 2);
  await expect(page.getByRole('toolbar', { name: '泳池工具栏' })).toBeVisible();
  await expect(page.getByRole('button', { name: '水平布局', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: '添加泳道', exact: true }).first()).toBeEnabled();
});
test('creates horizontal and vertical pools from the palette, each owning its own lanes', async ({
  page,
}) => {
  await page.getByRole('button', { name: '新建画布', exact: true }).click();
  await page.getByRole('button', { name: '新建画布', exact: true }).last().click();
  await page.getByTestId('shape-pool-horizontal').click();
  await expect(page.getByRole('toolbar', { name: '泳池工具栏' })).toBeVisible();
  await page.getByTestId('shape-pool-vertical').click();
  await expect(page.getByRole('button', { name: '垂直布局', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const doc = await readDocument(page),
    pools = Object.values(doc.nodes).filter((n) => n.type.startsWith('pool-'));
  expect(pools).toHaveLength(2);
  expect(Object.keys(doc.nodes)).toHaveLength(6);
  for (const pool of pools) {
    const lanes = Object.values(doc.nodes)
      .filter((n) => n.parentId === pool.id)
      .sort((a, b) => a.laneOrder! - b.laneOrder!);
    expect(lanes).toHaveLength(2);
    if (pool.type === 'pool-horizontal') {
      expect(lanes[0].bounds.x).toBe(36);
      expect(lanes[1].bounds.y).toBe(lanes[0].bounds.height);
    } else {
      expect(lanes[0].bounds.y).toBe(36);
      expect(lanes[1].bounds.x).toBe(lanes[0].bounds.width);
    }
  }
});
test('adds and deletes lanes through the toolbar and restores them with undo', async ({ page }) => {
  await poolSelection(page);
  await page
    .getByRole('toolbar', { name: '泳池工具栏' })
    .getByRole('button', { name: '添加泳道', exact: true })
    .click();
  let doc = await readDocument(page);
  const added = Object.values(doc.nodes).find(
    (n) => n.parentId === 'pool_order' && doc.entities[n.entityId].name === '泳道 3',
  )!;
  expect(added).toBeDefined();
  expect(added.laneOrder).toBe(2);
  await page.getByLabel('操作泳道', { exact: true }).selectOption(added.id);
  await page.getByRole('button', { name: '删除泳道', exact: true }).click();
  doc = await readDocument(page);
  expect(doc.nodes[added.id]).toBeUndefined();
  expect(doc.nodes.receive).toBeDefined();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  doc = await readDocument(page);
  expect(doc.nodes[added.id]).toBeDefined();
});
test('confirms deletion of a populated lane and guards the last remaining lane', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await poolSelection(page);
  await page.getByLabel('操作泳道', { exact: true }).selectOption('lane_sales');
  await page.getByRole('button', { name: '删除泳道', exact: true }).click();
  await expect(page.getByRole('button', { name: '确认删除泳道' })).toBeVisible();
  await page.getByRole('button', { name: '确认删除泳道' }).click();
  await expect(page.getByRole('button', { name: '删除泳道', exact: true })).toBeDisabled();
  const doc = await readDocument(page);
  expect(doc.nodes.receive).toBeUndefined();
  expect(doc.nodes.deliver).toBeDefined();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect((await readDocument(page)).nodes.receive).toBeDefined();
  expect(errors).toEqual([]);
});
test('switches direction, changes rendered themes and persists both across reload', async ({
  page,
}) => {
  await poolSelection(page);
  await page.getByRole('button', { name: '垂直布局', exact: true }).click();
  await expect(page.getByRole('button', { name: '垂直布局', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await setColor(page, '泳池背景色', '#eaf4ee');
  await setColor(page, '泳池标题背景色', '#bddac8');
  await setColor(page, '泳池文字颜色', '#315342');
  await expect(
    page.locator('[data-element-id="lane_sales"]').first().locator('rect').first(),
  ).toHaveAttribute('fill', '#eaf4ee');
  const doc = await readDocument(page);
  expect(doc.nodes.pool_order.type).toBe('pool-vertical');
  expect(doc.nodes.pool_order.appearance).toMatchObject({
    fill: '#eaf4ee',
    headerFill: '#bddac8',
    fontColor: '#315342',
  });
  expect(Object.keys(doc.edges)).toHaveLength(6);
  expect(doc.nodes.receive.parentId).toBe('lane_sales');
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('diagramly.document.v1')!).nodes.pool_order.type,
      ),
    )
    .toBe('pool-vertical');
  await page.reload();
  await poolSelection(page);
  await expect(page.getByLabel('泳池背景色', { exact: true })).toHaveValue('#eaf4ee');
  await expect(page.getByRole('button', { name: '垂直布局', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});
test('moves an existing lane to another pool and displays its title at the top', async ({
  page,
}) => {
  await page.getByTestId('shape-pool-vertical').click();
  const created = Object.values((await readDocument(page)).nodes).find(
    (n) => n.type === 'pool-vertical',
  )!;
  await page.getByRole('button', { name: /^图层/ }).click();
  await page.getByRole('button', { name: '销售团队', exact: true }).click();
  await page.getByLabel('所属泳池', { exact: true }).selectOption(created.id);
  const doc = await readDocument(page);
  expect(doc.nodes.lane_sales.parentId).toBe(created.id);
  expect(doc.nodes.receive.parentId).toBe('lane_sales');
  const title = await page.locator('[data-part-id="lane_sales::lane-title"]').first().boundingBox();
  if (!title) throw Error('Missing lane title');
  expect(title.width / title.height).toBeGreaterThan(3);
});
test('drops a business activity into the content area of a nested vertical lane', async ({
  page,
}) => {
  await page.getByRole('button', { name: '新建画布', exact: true }).click();
  await page.getByRole('button', { name: '新建画布', exact: true }).last().click();
  await page.getByTestId('shape-pool-vertical').click();
  const before = await readDocument(page),
    lane = Object.values(before.nodes).find((n) => n.type === 'swimlane' && n.laneOrder === 0)!;
  const bounds = await page.locator(`[data-element-id="${lane.id}"]`).first().boundingBox();
  if (!bounds) throw Error('Missing vertical lane bounds');
  const scale = bounds.width / lane.bounds.width;
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await page.getByTestId('shape-activity').dispatchEvent('dragstart', { dataTransfer: transfer });
  await page
    .getByTestId('graph')
    .dispatchEvent('drop', {
      dataTransfer: transfer,
      clientX: bounds.x + 24 * scale,
      clientY: bounds.y + 90 * scale,
    });
  const doc = await readDocument(page),
    activity = Object.values(doc.nodes).find((n) => n.type === 'activity')!;
  expect(activity).toBeDefined();
  expect(activity.parentId).toBe(lane.id);
  expect(activity.bounds.x).toBeGreaterThanOrEqual(12);
  expect(activity.bounds.y).toBeGreaterThanOrEqual(52);
  await expect(page.getByRole('textbox', { name: '节点名称', exact: true })).toHaveValue(
    '业务活动',
  );
});
test('lane selection has its own toolbar, appearance and role controls', async ({ page }) => {
  await poolSelection(page);
  await page.getByRole('button', { name: '销售团队', exact: true }).click();
  await expect(page.getByRole('toolbar', { name: '泳池工具栏' })).toHaveCount(0);
  await expect(page.getByRole('toolbar', { name: '泳道工具栏' })).toBeVisible();
  await setColor(page, '泳道背景色', '#ffeedd');
  await setColor(page, '泳道文字颜色', '#993300');
  await page
    .getByRole('toolbar', { name: '泳道工具栏' })
    .getByText('角色泳道', { exact: true })
    .click();
  await page.getByLabel('泳道工具栏角色说明').fill('销售负责人');
  await page.getByLabel('泳道工具栏角色说明').press('Tab');
  const doc = await readDocument(page);
  expect(doc.nodes.lane_sales.appearance).toMatchObject({ fill: '#ffeedd', fontColor: '#993300' });
  expect(doc.nodes.lane_ops.appearance.fill).toBeUndefined();
  expect(doc.nodes.pool_order.appearance.fill).toBeUndefined();
  expect(doc.entities.entity_lane_sales.role).toBe('销售负责人');
});
for (const orientation of ['horizontal', 'vertical'] as const)
  test(`drags a real ${orientation} lane corner and adapts the entire pool`, async ({ page }) => {
    await poolSelection(page);
    if (orientation === 'vertical')
      await page.getByRole('button', { name: '垂直布局', exact: true }).click();
    await page.getByRole('button', { name: '销售团队', exact: true }).click();
    const before = await readDocument(page),
      lane = before.nodes.lane_sales,
      handle = page.locator('[data-lane-resize="lane_sales:7"]');
    const bounds = await handle.boundingBox();
    if (!bounds) throw Error('Missing lane resize handle');
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 48, bounds.y + 38, { steps: 12 });
    await page.mouse.up();
    await expect
      .poll(async () => (await readDocument(page)).nodes.lane_sales.bounds.width)
      .toBeGreaterThan(lane.bounds.width);
    const doc = await readDocument(page);
    expect(doc.nodes.lane_sales.bounds.height).toBeGreaterThan(lane.bounds.height);
    expect(doc.nodes.pool_order.bounds.width).toBeGreaterThan(before.nodes.pool_order.bounds.width);
    expect(doc.nodes.pool_order.bounds.height).toBeGreaterThan(
      before.nodes.pool_order.bounds.height,
    );
    expect(doc.nodes.receive.bounds).toEqual(before.nodes.receive.bounds);
    expect(doc.edges).toEqual(before.edges);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    expect((await readDocument(page)).nodes).toEqual(before.nodes);
  });
test('lane title has only a divider, and deselection clears every selection outline', async ({
  page,
}) => {
  await poolSelection(page);
  for (const name of ['销售团队', '接收客户订单', '交付团队', '订单履约泳池'])
    await page.getByRole('button', { name, exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('toolbar', { name: '泳池工具栏' })).toHaveCount(0);
  const title = page
    .locator('[data-part-id="lane_sales::lane-title"]')
    .first()
    .locator('rect')
    .first();
  await expect(title).not.toHaveAttribute('stroke', /#[a-f0-9]{6}/i);
  await expect(page.locator('[data-part-id="lane_sales::lane-divider"]').first()).toBeVisible();
  expect(await page.getByTestId('graph').locator('rect[stroke="#7d91b7"]').count()).toBe(0);
});
