import { expect, test, type Page } from '@playwright/test';
import { FakeCoopwire, testConfig } from '../support/coopwire';
async function connect(page: Page, backend: FakeCoopwire) {
  // 所有 /rest 请求均由进程内的测试后端响应，不会访问真实服务。
  await page.route('**/rest/**', async (route) => {
    const source = route.request(),
      method = source.method(),
      postData = source.postDataBuffer();
    const response = await backend.fetch(
      new Request(source.url(), {
        method,
        headers: source.headers(),
        body: method === 'GET' || !postData ? undefined : new Uint8Array(postData).buffer,
      }),
    );
    await route.fulfill({
      status: response.status,
      contentType: 'application/json',
      body: await response.text(),
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '连接 Coopwire', exact: true }).click();
  await page.getByRole('textbox', { name: '远程接口地址', exact: true }).fill('');
  await page.getByRole('textbox', { name: '远程项目 ID', exact: true }).fill(testConfig.projectId);
  await page
    .getByRole('textbox', { name: '远程流程 ID', exact: true })
    .fill(testConfig.flowchartId);
  await page.getByRole('button', { name: '连接并读取流程' }).click();
  await expect(page.getByRole('button', { name: 'Coopwire 已连接', exact: true })).toBeVisible();
}
async function receive(page: Page) {
  await page.getByRole('button', { name: /^图层/ }).click();
  await page.getByRole('button', { name: '接收客户订单', exact: true }).click();
}
test('remote UI writes business edits, actual XML/PNG multipart and compensates undo', async ({
  page,
}) => {
  const backend = new FakeCoopwire(),
    failures: string[] = [];
  page.on('pageerror', (e) => failures.push(e.message));
  await connect(page, backend);
  expect(backend.writeCount).toBe(0);
  await receive(page);
  await page.getByRole('textbox', { name: '节点名称', exact: true }).fill('浏览器远程更新');
  await page.getByRole('textbox', { name: '节点名称', exact: true }).press('Tab');
  await expect.poll(() => backend.flow.version).toBe(9);
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeEnabled();
  expect(backend.activities.get('remote_receive')?.activity.actName).toBe('浏览器远程更新');
  expect(backend.flow.drawioXml).toContain('diagramlyDocument=');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect.poll(() => backend.flow.version).toBe(10);
  expect(backend.activities.get('remote_receive')?.activity.actName).toBe('接收客户订单');
  expect(failures).toEqual([]);
});
test('remote copy, remove relation and redo preserve business IDs', async ({ page }) => {
  const backend = new FakeCoopwire();
  await connect(page, backend);
  await receive(page);
  await page.getByRole('button', { name: '复制所选', exact: true }).click();
  await expect.poll(() => backend.flow.version).toBe(9);
  await expect(page.getByRole('textbox', { name: '节点名称', exact: true })).toHaveValue(
    '接收客户订单 副本',
  );
  await page.getByRole('button', { name: '删除所选', exact: true }).click();
  await expect.poll(() => backend.flow.version).toBe(10);
  expect(backend.activities.has('remote_copy_1')).toBe(true);
  expect(backend.flow.flowObj?.acts?.some((a) => a.actId === 'remote_copy_1')).toBe(false);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect.poll(() => backend.flow.version).toBe(11);
  expect(backend.flow.flowObj?.acts?.some((a) => a.actId === 'remote_copy_1')).toBe(true);
  expect(backend.calls.filter((c) => c.action === 'copyAct')).toHaveLength(1);
});
test('shows a failed-save recovery action and resumes without copying twice', async ({ page }) => {
  const backend = new FakeCoopwire();
  await connect(page, backend);
  await receive(page);
  backend.fail = { action: 'saveFlowDiagramRelation', kind: 'rejected' };
  await page.getByRole('button', { name: '复制所选', exact: true }).click();
  await expect(page.getByRole('button', { name: '重试上次操作' })).toBeVisible();
  await page.getByRole('button', { name: '重试上次操作' }).click();
  await expect.poll(() => backend.flow.version).toBe(9);
  expect(backend.calls.filter((c) => c.action === 'copyAct')).toHaveLength(1);
});
test('remote reload reads persisted content and disconnect restores the separate local workspace', async ({
  page,
}) => {
  const backend = new FakeCoopwire();
  await connect(page, backend);
  await receive(page);
  await page.getByRole('textbox', { name: '节点名称', exact: true }).fill('远程已保存');
  await page.getByRole('textbox', { name: '节点名称', exact: true }).press('Tab');
  await expect.poll(() => backend.flow.version).toBe(9);
  await page.reload();
  await connect(page, backend);
  await page.getByRole('button', { name: /^图层/ }).click();
  await expect(page.getByRole('button', { name: '远程已保存', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Coopwire 已连接', exact: true }).click();
  await page.getByRole('button', { name: '断开并返回本机' }).click();
  await expect(page.getByRole('button', { name: '连接 Coopwire', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '接收客户订单', exact: true })).toBeVisible();
});
test('pool changes round-trip through remote XML and PNG without updating business activities', async ({
  page,
}) => {
  const backend = new FakeCoopwire();
  await connect(page, backend);
  await page.getByRole('button', { name: /^图层/ }).click();
  await page.getByRole('button', { name: '订单履约泳池', exact: true }).click();
  await page.getByRole('button', { name: '垂直布局', exact: true }).click();
  await expect.poll(() => backend.flow.version).toBe(9);
  await expect(page.getByRole('button', { name: '垂直布局', exact: true })).toBeEnabled();
  await page.getByLabel('泳池背景色', { exact: true }).evaluate((input) => {
    (input as HTMLInputElement).value = '#eaf4ee';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect.poll(() => backend.flow.version).toBe(10);
  expect(backend.calls.filter((call) => call.method === 'POST').map((call) => call.action)).toEqual(
    ['saveFlowDiagramRelation', 'saveFlowDiagramRelation'],
  );
  expect(backend.flow.drawioXml).toContain('verticalSwimlane');
  await page.reload();
  await connect(page, backend);
  await page.getByRole('button', { name: /^图层/ }).click();
  await page.getByRole('button', { name: '订单履约泳池', exact: true }).click();
  await expect(page.getByRole('button', { name: '垂直布局', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByLabel('泳池背景色', { exact: true })).toHaveValue('#eaf4ee');
});
test('活动详情加载业务选项并通过专用接口保存说明和时间', async ({ page }) => {
  const backend = new FakeCoopwire();
  await connect(page, backend);
  await receive(page);
  await page.getByRole('button', { name: '查看业务详情', exact: true }).click();
  await page.getByRole('button', { name: '加载业务选项', exact: true }).click();
  await expect(
    page
      .getByLabel('活动使用的应用', { exact: true })
      .getByRole('option', { name: '订单应用', exact: true }),
  ).toHaveCount(1);
  await page.getByLabel('活动使用的应用', { exact: true }).selectOption('app_erp');
  await expect.poll(() => backend.flow.version).toBe(9);
  await page.getByLabel('补充说明', { exact: true }).fill('远程核对库存');
  await page.getByLabel('补充说明', { exact: true }).press('Tab');
  await expect.poll(() => backend.flow.version).toBe(10);
  expect(backend.activities.get('remote_receive')?.activity).toMatchObject({
    actSystemUsed: 'app_erp',
    keyStep: '远程核对库存',
  });
  expect(backend.calls.filter((call) => call.action === 'updateActDetailDesc')).toHaveLength(1);
  await page.getByText('显示设置', { exact: true }).click();
  await page.getByLabel('显示活动时间要求', { exact: true }).check();
  await expect.poll(() => backend.flow.version).toBe(11);
  await page.getByText('显示设置', { exact: true }).click();
  await page.getByLabel('活动开始小时', { exact: true }).fill('8');
  await page.getByLabel('活动开始小时', { exact: true }).press('Tab');
  await expect.poll(() => backend.flow.version).toBe(12);
  expect(backend.calls.filter((call) => call.action === 'addTimeRange')).toHaveLength(1);
  expect(backend.activities.get('remote_receive')?.activity.timeRanges).toMatchObject({
    actTimeStart: 8,
    actTimeEnd: 18,
  });
});
test('泳道角色工具栏更新对应活动的角色，泳池工具栏保持关闭', async ({ page }) => {
  const backend = new FakeCoopwire();
  await connect(page, backend);
  await page.getByRole('button', { name: /^图层/ }).click();
  await page.getByRole('button', { name: '销售团队', exact: true }).click();
  await page
    .getByRole('toolbar', { name: '泳道工具栏' })
    .getByLabel('角色泳道', { exact: true })
    .click();
  await page.getByLabel('泳道工具栏组织角色').selectOption(['role_sales', 'role_ops']);
  await expect.poll(() => backend.flow.version).toBe(9);
  expect(backend.activities.get('remote_receive')?.activity.orgId).toEqual([
    'role_sales',
    'role_ops',
  ]);
  expect(
    await page
      .getByLabel('泳道工具栏组织角色')
      .evaluate((el) =>
        Array.from((el as HTMLSelectElement).selectedOptions, (option) => option.value),
      ),
  ).toEqual(['role_sales', 'role_ops']);
  await expect(page.getByRole('toolbar', { name: '泳池工具栏' })).toHaveCount(0);
  await expect(page.getByLabel('节点名称', { exact: true })).toHaveValue('销售角色、交付角色');
  await expect(page.locator('[data-part-id="lane_sales::lane-title"]').last()).toContainText(
    '销售角色、交付角色',
  );
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect.poll(() => backend.flow.version).toBe(10);
  await expect(page.getByLabel('节点名称', { exact: true })).toHaveValue('销售团队');
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect.poll(() => backend.flow.version).toBe(11);
  await expect(page.getByLabel('节点名称', { exact: true })).toHaveValue('销售角色、交付角色');
});

test('属性面板选择角色也同步生成泳道名称', async ({ page }) => {
  const backend = new FakeCoopwire();
  await connect(page, backend);
  await page.getByRole('button', { name: /^图层/ }).click();
  await page.getByRole('button', { name: '销售团队', exact: true }).click();
  await page.getByLabel('组织角色', { exact: true }).selectOption(['role_ops']);
  await expect.poll(() => backend.flow.version).toBe(9);
  await expect(page.getByLabel('节点名称', { exact: true })).toHaveValue('交付角色');
  expect(backend.flow.flowObj?.swimlanes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ xmlId: 'lane_sales', name: '交付角色', orgId: ['role_ops'] }),
    ]),
  );
});
