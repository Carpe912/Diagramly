import { expect, test, type Page } from '@playwright/test';
import { FakeCoopwire, testConfig, embed } from '../support/coopwire';
async function connect(page: Page, backend: FakeCoopwire, zoomBeforeConnect = false, baseUrl = '') {
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
  if (zoomBeforeConnect) {
    const graph = (await page.getByTestId('graph').boundingBox())!;
    await page.mouse.move(graph.x + graph.width / 2, graph.y + graph.height / 2);
    await page.mouse.wheel(0, -3000);
    await expect(page.locator('.zoom-control > span')).toHaveText('400%');
  }
  await page.getByRole('button', { name: '连接 Coopwire', exact: true }).click();
  await page.getByRole('textbox', { name: '远程接口地址', exact: true }).fill(baseUrl);
  await page.getByRole('textbox', { name: '远程项目 ID', exact: true }).fill(testConfig.projectId);
  await page
    .getByRole('textbox', { name: '远程流程 ID', exact: true })
    .fill(testConfig.flowchartId);
  await page.getByRole('button', { name: '连接并读取流程' }).click();
  await expect(page.getByRole('button', { name: 'Coopwire 已连接', exact: true })).toBeVisible();
}
test('远程连接时可以新建空白本机画布，不写入远程流程', async ({ page }) => {
  const backend = new FakeCoopwire();
  await connect(page, backend);
  const writes = backend.writeCount;
  await page.getByRole('button', { name: '新建画布', exact: true }).click();
  await expect(page.locator('.confirm-modal')).toContainText('远程流程保持不变');
  await page.getByRole('button', { name: '新建画布', exact: true }).last().click();
  await expect(page.getByRole('button', { name: '连接 Coopwire', exact: true })).toBeVisible();
  await expect(page.getByTestId('graph')).not.toContainText('接收客户订单');
  await page.getByTestId('shape-activity').click();
  await expect(page.getByRole('textbox', { name: '节点名称', exact: true })).toHaveValue(
    '人工线上',
  );
  expect(backend.writeCount).toBe(writes);
});
test('连接面板支持填写 /rest，发出的路径没有重复前缀', async ({ page }) => {
  const paths: string[] = [];
  page.on('request', (request) => paths.push(new URL(request.url()).pathname));
  await connect(page, new FakeCoopwire(), false, '/rest');
  expect(paths.some((path) => path.startsWith('/rest/quality/'))).toBe(true);
  expect(paths.some((path) => path.startsWith('/rest/rest/'))).toBe(false);
  await expect(page.getByRole('alert')).toHaveCount(0);
});
test('地址格式不正确时显示明确文字而非校验 JSON', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '连接 Coopwire', exact: true }).click();
  await page.getByRole('textbox', { name: '远程接口地址', exact: true }).fill('notaurl');
  await page.getByRole('textbox', { name: '远程项目 ID', exact: true }).fill(testConfig.projectId);
  await page
    .getByRole('textbox', { name: '远程流程 ID', exact: true })
    .fill(testConfig.flowchartId);
  await page.getByRole('button', { name: '连接并读取流程', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(
    '接口地址请填写 HTTP(S) 后端地址、/rest 或留空',
  );
  await expect(page.getByRole('alert')).not.toContainText('"code"');
  await expect(page.getByRole('alert')).not.toContainText('"path"');
});
test('手动连接重读与断开远程流程保留比例，仅首次进入远程页面适应画布', async ({ page }) => {
  const backend = new FakeCoopwire();
  await connect(page, backend, true);
  const zoom = page.locator('.zoom-control > span');
  await expect(zoom).toHaveText('400%');
  await page.getByRole('button', { name: 'Coopwire 已连接', exact: true }).click();
  await page.getByRole('button', { name: '重新读取远端', exact: true }).click();
  await page.getByRole('button', { name: '重新读取远端', exact: true }).last().click();
  await expect(page.getByRole('heading', { name: '读取远端并核对' })).toHaveCount(0);
  await expect(zoom).toHaveText('400%');
  await page.getByRole('button', { name: '断开并返回本机', exact: true }).click();
  await expect(zoom).toHaveText('400%');
  await page.goto('/?flowchart=1&projectId=project_test&flowchartId=flow_test&flowchartType=tobe');
  await expect(page.getByRole('button', { name: 'Coopwire 已连接', exact: true })).toBeVisible();
  await expect(zoom).not.toHaveText('400%');
});
async function receive(page: Page) {
  await page.getByRole('button', { name: /^图层/ }).click();
  await page.getByRole('button', { name: '接收客户订单', exact: true }).click();
  await page.getByRole('tab', { name: '属性', exact: true }).click();
}
test('跨泳道拖动同步目标组织角色，远程撤销恢复原归属和业务 ID', async ({ page }) => {
  const backend = new FakeCoopwire();
  await connect(page, backend);
  await receive(page);
  const source = (await page.locator('[data-element-id="receive"]').first().boundingBox())!;
  const lane = (await page.locator('[data-element-id="lane_ops"]').first().boundingBox())!;
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(source.x + source.width / 2, lane.y + lane.height / 2, { steps: 16 });
  await page.mouse.up();
  await expect.poll(() => backend.flow.version).toBe(9);
  expect(backend.activities.get('remote_receive')?.activity.orgId).toEqual(['role_ops']);
  await page.getByRole('button', { name: '文档数据', exact: true }).click();
  const moved = JSON.parse(await page.getByTestId('document-json').innerText());
  expect(moved.nodes.receive.parentId).toBe('lane_ops');
  expect(moved.entities.entity_receive.externalRef.id).toBe('remote_receive');
  await page.getByRole('button', { name: '关闭文档数据' }).click();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect.poll(() => backend.flow.version).toBe(10);
  expect(backend.activities.get('remote_receive')?.activity.orgId).toEqual(['role_sales']);
  expect(
    backend.calls.filter((call) => call.action === 'addActs' || call.action === 'copyAct'),
  ).toHaveLength(0);
});
test('已有远程活动可拖出泳池并撤销，保持业务 ID 和流程关系', async ({ page }) => {
  const backend = new FakeCoopwire();
  await connect(page, backend);
  await receive(page);
  const source = (await page.locator('[data-element-id="receive"]').first().boundingBox())!;
  const graph = (await page.getByTestId('graph').boundingBox())!;
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(graph.x + graph.width / 2, graph.y + 80, { steps: 16 });
  await page.mouse.up();
  await expect.poll(() => backend.flow.version).toBe(9);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(backend.activities.get('remote_receive')?.activity.orgId).toEqual([]);
  await page.getByRole('button', { name: '文档数据', exact: true }).click();
  const outside = JSON.parse(await page.getByTestId('document-json').innerText());
  expect(outside.nodes.receive.parentId).toBeUndefined();
  expect(outside.entities.entity_receive.externalRef.id).toBe('remote_receive');
  await page.getByRole('button', { name: '关闭文档数据' }).click();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect.poll(() => backend.flow.version).toBe(10);
  expect(backend.activities.get('remote_receive')?.activity.orgId).toEqual(['role_sales']);
  expect(
    backend.calls.filter((call) => call.action === 'addActs' || call.action === 'copyAct'),
  ).toHaveLength(0);
});
test('远程样式编辑保存真实 XML 和 PNG，撤销还原且不调用活动修改接口', async ({ page }) => {
  const backend = new FakeCoopwire();
  await connect(page, backend);
  await receive(page);
  await page.getByLabel('线条宽度', { exact: true }).fill('4');
  await page.getByLabel('线条宽度', { exact: true }).press('Tab');
  await expect.poll(() => backend.flow.version).toBe(9);
  expect(backend.flow.drawioXml).toContain('strokeWidth=4;');
  expect(
    backend.calls
      .filter(
        (c) =>
          c.method === 'POST' &&
          !['selectApp', 'queryDevice', 'qryFlowDiagram', 'qryOperateTypeEnums'].includes(c.action),
      )
      .map((c) => c.action),
  ).toEqual(['saveFlowDiagramRelation']);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect.poll(() => backend.flow.version).toBe(10);
  expect(backend.flow.drawioXml).not.toContain('strokeWidth=4;');
  await page.getByRole('button', { name: '是', exact: true }).click();
  await page.getByLabel('线末端形状', { exact: true }).selectOption('diamond');
  await expect.poll(() => backend.flow.version).toBe(11);
  expect(backend.flow.drawioXml).toContain('endArrow=diamond;');
  expect(
    backend.calls
      .filter(
        (c) =>
          c.method === 'POST' &&
          !['selectApp', 'queryDevice', 'qryFlowDiagram', 'qryOperateTypeEnums'].includes(c.action),
      )
      .map((c) => c.action),
  ).toEqual(['saveFlowDiagramRelation', 'saveFlowDiagramRelation', 'saveFlowDiagramRelation']);
});
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
  await page.getByRole('tab', { name: '属性', exact: true }).click();
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
test('自有业务面板按分组保存活动信息，不依赖宿主页面', async ({ page }) => {
  const backend = new FakeCoopwire();
  await connect(page, backend);
  await receive(page);
  await page.getByRole('tab', { name: '业务详情', exact: true }).click();
  await expect(page.locator('iframe')).toHaveCount(0);
  const details = page.getByTestId('activity-details');
  await details.getByRole('textbox', { name: '活动名称', exact: true }).fill('自有表单已保存');
  await details.getByRole('textbox', { name: '活动名称', exact: true }).blur();
  await expect
    .poll(() => backend.activities.get('remote_receive')!.activity.actName)
    .toBe('自有表单已保存');
  await expect(page.getByRole('button', { name: '自有表单已保存', exact: true })).toBeVisible();
  await details.getByRole('button', { name: '应用设备', exact: true }).click();
  await details.getByLabel('活动使用的应用', { exact: true }).selectOption('app_erp');
  await expect
    .poll(() => backend.activities.get('remote_receive')!.activity.actSystemUsed)
    .toBe('app_erp');
  await details.getByRole('button', { name: '时间周期', exact: true }).click();
  await details.getByLabel('单次活动用时', { exact: true }).fill('2.5');
  await details.getByLabel('单次活动用时', { exact: true }).blur();
  await expect
    .poll(() => backend.activities.get('remote_receive')!.activity.hoursOnceAct)
    .toBe('2.5');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await details.getByRole('button', { name: '基本信息', exact: true }).click();
});
test('接口类型展示专属字段并保存接口设计关联', async ({ page }) => {
  const backend = new FakeCoopwire();
  backend.activities.get('remote_receive')!.activity.actType = 'interfaceDocking';
  await connect(page, backend);
  await receive(page);
  await page.getByRole('tab', { name: '业务详情', exact: true }).click();
  const details = page.getByTestId('activity-details');
  await details.getByRole('button', { name: '应用设备', exact: true }).click();
  await details.getByLabel('提供数据的应用', { exact: true }).selectOption('app_erp');
  await expect
    .poll(() => backend.activities.get('remote_receive')!.activity.inputSystemOrDeviceId)
    .toBe('app_erp');
  await details.getByLabel('接口设计', { exact: true }).selectOption('interface_order');
  await expect
    .poll(() => backend.activities.get('remote_receive')!.activity.interfaceDesigns)
    .toEqual(['interface_order']);
  await details.getByLabel('提供数据的应用', { exact: true }).selectOption('');
  await expect
    .poll(() =>
      backend.calls.some((call) => call.query.get('clearInputSystemOrDeviceId') === 'true'),
    )
    .toBe(true);
});
test('自有输入输出弹窗保留附件信息，保存和删除后同步画布', async ({ page }) => {
  const backend = new FakeCoopwire();
  await connect(page, backend);
  await receive(page);
  await page.getByRole('tab', { name: '业务详情', exact: true }).click();
  const details = page.getByTestId('activity-details');
  await details.getByRole('button', { name: '输入输出', exact: true }).click();
  await details
    .getByRole('button', { name: /^编辑输入：/ })
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: '编辑输入', exact: true });
  await dialog.getByLabel('输入输出名称', { exact: true }).fill('客户订单');
  await dialog.getByLabel('输入输出描述', { exact: true }).fill('完整客户订单数据');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const saved = backend.activities
    .get('remote_receive')!
    .activity.ioputs!.find((item) => item.name === '客户订单')!;
  expect(saved.attachments).toEqual(['preserved_attachment']);
  expect(saved.id).toBeTruthy();
  await expect(details).toContainText('完整客户订单数据');
  await details.getByRole('button', { name: '删除输入：客户订单', exact: true }).click();
  await page
    .getByRole('dialog', { name: '删除业务记录' })
    .getByRole('button', { name: '确认删除' })
    .click();
  await expect
    .poll(() =>
      backend.activities
        .get('remote_receive')!
        .activity.ioputs!.some((item) => item.id === saved.id),
    )
    .toBe(false);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('输入输出可选择对象表字段、单证和附件并保留原关联', async ({ page }) => {
  const backend = new FakeCoopwire();
  await connect(page, backend);
  await receive(page);
  await page.getByRole('tab', { name: '业务详情', exact: true }).click();
  const details = page.getByTestId('activity-details');
  await details.getByRole('button', { name: '输入输出', exact: true }).click();
  await details.getByRole('button', { name: '添加输出', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '添加输出', exact: true });
  await dialog.getByLabel('输入输出名称', { exact: true }).fill('结构化订单');
  await dialog.getByLabel('输入输出描述', { exact: true }).fill('订单号及单证');
  await dialog.locator('.io-data-fields > summary').click();
  await dialog.getByLabel('数据对象', { exact: true }).selectOption('object_order');
  await dialog.getByLabel('选择数据表：订单表', { exact: true }).check();
  await dialog
    .getByLabel('订单表字段（不选表示整张表）', { exact: true })
    .selectOption('field_order_no');
  await dialog.getByLabel('使用表单 / 单证', { exact: true }).selectOption('statement_order');
  await dialog.getByLabel('关联附件文档', { exact: true }).selectOption('document_order');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(backend.activities.get('remote_receive')!.activity.ioputs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: '结构化订单',
        dataObjectId: 'object_order',
        dataObjectType: 'table',
        dataTablesWithChoosedFields: [{ tableId: 'table_order', fieldIds: ['field_order_no'] }],
        statements: ['statement_order'],
        attachmentIds: ['document_order'],
      }),
    ]),
  );
});
test('痛点弹窗可独立新增编辑删除并遵循原接口契约', async ({ page }) => {
  const backend = new FakeCoopwire();
  await connect(page, backend);
  await receive(page);
  await page.getByRole('tab', { name: '业务详情', exact: true }).click();
  const details = page.getByTestId('activity-details');
  await details.getByRole('button', { name: '关联业务', exact: true }).click();
  await details.getByRole('button', { name: '添加痛点', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '添加痛点', exact: true });
  await dialog.getByLabel('痛点概述', { exact: true }).fill('重复登记');
  await dialog.getByLabel('痛点详细描述', { exact: true }).fill('客户信息在不同应用重复录入');
  await dialog.getByLabel('痛点预期目标', { exact: true }).fill('一次录入');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await details
    .locator('.related-records')
    .filter({ has: page.locator('summary', { hasText: /^痛点/ }) })
    .locator('summary')
    .click();
  await details.getByRole('button', { name: '编辑痛点', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '编辑痛点', exact: true });
  await dialog.getByLabel('痛点解决方法', { exact: true }).fill('使用接口同步');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect((backend.activities.get('remote_receive')!.difficulties as any[])[0]).toMatchObject({
    solveMethod: '使用接口同步',
    version: 2,
  });
  await details.getByRole('button', { name: '删除痛点', exact: true }).click();
  await page
    .getByRole('dialog', { name: '删除业务记录' })
    .getByRole('button', { name: '确认删除' })
    .click();
  await expect.poll(() => backend.activities.get('remote_receive')!.difficulties).toEqual([]);
});
test('自有异常弹窗支持新增编辑和删除，使用独立记录版本', async ({ page }) => {
  const backend = new FakeCoopwire();
  await connect(page, backend);
  await receive(page);
  await page.getByRole('tab', { name: '业务详情', exact: true }).click();
  const details = page.getByTestId('activity-details');
  await details.getByRole('button', { name: '关联业务', exact: true }).click();
  await details.getByRole('button', { name: '添加异常', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '添加异常', exact: true });
  await dialog.getByLabel('异常描述', { exact: true }).fill('订单信息不完整');
  await dialog.getByLabel('异常解决方法', { exact: true }).fill('联系客户补齐');
  await dialog.getByLabel('异常概率', { exact: true }).fill('15');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await details.locator('.related-records').filter({ hasText: '异常' }).locator('summary').click();
  await details.getByRole('button', { name: '编辑异常', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '编辑异常', exact: true });
  await dialog.getByLabel('异常解决方法', { exact: true }).fill('人工复核并补齐');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect((backend.activities.get('remote_receive')!.exceptions as any[])[0]).toMatchObject({
    version: 2,
    resolveMethod: '人工复核并补齐',
  });
  await details.getByRole('button', { name: '删除异常', exact: true }).click();
  await page
    .getByRole('dialog', { name: '删除业务记录' })
    .getByRole('button', { name: '确认删除' })
    .click();
  await expect.poll(() => backend.activities.get('remote_receive')!.exceptions).toEqual([]);
});
test('自有引用选择器先选流程和活动，再创建带关联信息的业务节点', async ({ page }) => {
  const backend = new FakeCoopwire();
  await connect(page, backend);
  await page.getByRole('button', { name: /^图层/ }).click();
  await page.getByRole('button', { name: '销售团队', exact: true }).click();
  await page.getByRole('button', { name: '图形库', exact: true }).click();
  await page.getByTestId('shape-activity-linked').click();
  const chooser = page.getByRole('dialog', { name: '选择引用活动', exact: true });
  await chooser.getByLabel('关联流程', { exact: true }).selectOption('flow_delivery');
  await chooser.getByLabel('引用活动', { exact: true }).selectOption('activity_other');
  await chooser.getByLabel('在图上显示关联角色').check();
  await chooser.getByRole('button', { name: '添加引用活动', exact: true }).click();
  await expect.poll(() => backend.flow.version).toBe(9);
  expect(backend.calls.find((call) => call.action === 'addActs')?.body).toMatchObject([
    { actType: 'linkAct', linkFlow: 'flow_delivery', linkAct: 'activity_other', showOrgName: true },
  ]);
  await expect(page.locator('iframe')).toHaveCount(0);
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
test('远程活动没有可用业务详情时隐藏详情标签', async ({ page }) => {
  const backend = new FakeCoopwire();
  delete backend.document.entities.entity_check.externalRef;
  backend.flow.drawioXml = embed(backend.document);
  await connect(page, backend);
  await page.getByRole('button', { name: /^图层/ }).click();
  await page.getByRole('button', { name: '信息完整？', exact: true }).click();
  await expect(page.getByRole('tab', { name: '业务详情', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '接收客户订单', exact: true }).click();
  await expect(page.getByRole('tab', { name: '业务详情', exact: true })).toBeVisible();
});
