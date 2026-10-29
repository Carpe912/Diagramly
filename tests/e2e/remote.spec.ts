import { expect, test, type Page } from '@playwright/test';
import { FakeCoopwire, testConfig, embed } from '../support/coopwire';
async function connect(page: Page, backend: FakeCoopwire, zoomBeforeConnect = false) {
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
  await page.getByRole('textbox', { name: '远程接口地址', exact: true }).fill('');
  await page.getByRole('textbox', { name: '远程项目 ID', exact: true }).fill(testConfig.projectId);
  await page
    .getByRole('textbox', { name: '远程流程 ID', exact: true })
    .fill(testConfig.flowchartId);
  await page.getByRole('button', { name: '连接并读取流程' }).click();
  await expect(page.getByRole('button', { name: 'Coopwire 已连接', exact: true })).toBeVisible();
}
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
  expect(backend.calls.filter((c) => c.method === 'POST').map((c) => c.action)).toEqual([
    'saveFlowDiagramRelation',
  ]);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect.poll(() => backend.flow.version).toBe(10);
  expect(backend.flow.drawioXml).not.toContain('strokeWidth=4;');
  await page.getByRole('button', { name: '是', exact: true }).click();
  await page.getByLabel('线末端形状', { exact: true }).selectOption('diamond');
  await expect.poll(() => backend.flow.version).toBe(11);
  expect(backend.flow.drawioXml).toContain('endArrow=diamond;');
  expect(backend.calls.filter((c) => c.method === 'POST').map((c) => c.action)).toEqual([
    'saveFlowDiagramRelation',
    'saveFlowDiagramRelation',
    'saveFlowDiagramRelation',
  ]);
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
test('原业务面板嵌入后按活动 ID 同步外部修改，不重复写业务接口', async ({ page }) => {
  const backend = new FakeCoopwire();
  await page.route('**/enterprise/diagramly/portrait/**', async (route) => {
    await route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><button id="save">模拟原面板保存</button><script>
        const query = new URLSearchParams(location.search);
        const parentOrigin = query.get('parentOrigin');
        const sessionId = query.get('sessionId');
        let requestId = 0, actId = '';
        const send = (type, data = {}) => parent.postMessage({channel:'diagramly.portrait',version:1,sessionId,type,...data},parentOrigin);
        addEventListener('message', event => {
          if(event.source !== parent || event.origin !== parentOrigin || event.data.sessionId !== sessionId) return;
          const data = event.data;
          if(data.type === 'select') { requestId = data.requestId; actId = data.selection.actId; send('loaded',{requestId,actId}); }
          if(data.type === 'refresh') send('loaded',{requestId,actId});
        });
        document.getElementById('save').onclick = () => send('changed',{requestId,actId});
        send('ready');
      </script>`,
    });
  });
  await connect(page, backend);
  await receive(page);
  await page.getByRole('tab', { name: '业务详情', exact: true }).click();
  await expect(page.getByTitle('Coopwire 业务详情')).toBeVisible();
  const activity = backend.activities.get('remote_receive')!;
  activity.activity.actName = '原面板已保存';
  activity.activity.version++;
  await page
    .frameLocator('iframe[title="Coopwire 业务详情"]')
    .getByRole('button', { name: '模拟原面板保存' })
    .click();
  await expect.poll(() => backend.flow.version).toBe(9);
  await expect(page.getByRole('button', { name: '原面板已保存', exact: true })).toBeVisible();
  expect(backend.calls.filter((call) => call.method === 'POST').map((call) => call.action)).toEqual(
    ['saveFlowDiagramRelation'],
  );
});
test('引用活动先通过原选择器返回目标，再创建带关联信息的业务节点', async ({ page }) => {
  const backend = new FakeCoopwire();
  await page.route('**/enterprise/diagramly/portrait/**', async (route) => {
    await route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><script>
        const query = new URLSearchParams(location.search);
        const parentOrigin = query.get('parentOrigin');
        const sessionId = query.get('sessionId');
        const send = (type, data = {}) => parent.postMessage({channel:'diagramly.portrait',version:1,sessionId,type,...data},parentOrigin);
        addEventListener('message', event => {
          if(event.source !== parent || event.origin !== parentOrigin || event.data.sessionId !== sessionId) return;
          if(event.data.type === 'chooseLinked') send('linkedChosen',{
            requestId:event.data.requestId,
            form:{linkFlow:'flow_other',linkAct:'activity_other',showOrgName:true}
          });
        });
        send('ready');
      </script>`,
    });
  });
  await connect(page, backend);
  await page.getByRole('button', { name: /^图层/ }).click();
  await page.getByRole('button', { name: '销售团队', exact: true }).click();
  await page.getByRole('button', { name: '图形库', exact: true }).click();
  await page.getByTestId('shape-activity-linked').click();
  await expect.poll(() => backend.flow.version).toBe(9);
  expect(backend.calls.find((call) => call.action === 'addActs')?.body).toMatchObject([
    {
      actType: 'linkAct',
      linkFlow: 'flow_other',
      linkAct: 'activity_other',
      showOrgName: true,
    },
  ]);
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
