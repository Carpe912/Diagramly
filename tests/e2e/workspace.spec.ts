import { expect, test } from '@playwright/test';
import { demoDocument } from '../../src/application/demo';
async function setup(page: any) {
  const document = demoDocument(),
    records: Record<string, any[]> = {},
    comments: any[] = [];
  let revision = 1;
  await page.route('**/api/**', async (route: any) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname,
      method = req.method();
    if (path === '/api/session')
      return route.fulfill({ json: { username: 'admin', role: 'admin' } });
    if (path.startsWith('/api/business/')) {
      const parts = path.split('/'),
        kind = parts[3],
        rows = (records[kind] ??= []);
      if (method === 'PUT') {
        const body = req.postDataJSON();
        rows.push({ ...body, id: parts[4], revision: 1 });
        return route.fulfill({ json: { revision: 1 } });
      }
      return route.fulfill({ json: rows });
    }
    if (path.endsWith('/discussions')) {
      if (method === 'POST') {
        comments.push({
          ...req.postDataJSON(),
          id: 'comment-1',
          replies: [],
          status: 'open',
          revision: 1,
          author: 'admin',
        });
        return route.fulfill({ json: { id: 'comment-1' } });
      }
      return route.fulfill({ json: comments });
    }
    if (path === '/api/discussions/comment-1') {
      const body = req.postDataJSON();
      expect(body.expectedRevision).toBe(comments[0].revision);
      if (body.reply) comments[0].replies.push({ body: body.reply, author: 'admin' });
      if (body.status) comments[0].status = body.status;
      comments[0].revision++;
      return route.fulfill({ json: { revision: comments[0].revision } });
    }
    if (path === '/api/documents')
      return route.fulfill({ json: [{ id: document.id, title: document.title, revision }] });
    if (path === `/api/documents/${document.id}`) {
      if (method === 'PUT') {
        Object.assign(document, req.postDataJSON().document);
        revision++;
        return route.fulfill({ json: { revision } });
      }
      return route.fulfill({ json: { document, revision } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto('/');
  await expect(page.getByTestId('graph')).toBeVisible();
  await page.getByRole('button', { name: '文档库', exact: true }).click();
  await page.getByLabel('用户名').fill('admin');
  await page.getByLabel('密码').fill('test-password-123');
  await page.getByRole('button', { name: '登录独立服务' }).click();
  return { document, records, comments };
}
test('独立管理可以维护数据表字段，并在对象中选择关联表', async ({ page }) => {
  const state = await setup(page);
  await page.getByRole('button', { name: state.document.title + ' · v1', exact: true }).click();
  await page.getByRole('button', { name: '工作空间管理' }).click();
  const dialog = page.getByRole('dialog', { name: '工作空间管理' });
  await dialog.getByLabel('数据类型').selectOption('tables');
  await dialog.getByLabel('名称', { exact: true }).fill('订单表');
  await dialog.getByRole('button', { name: '添加字段', exact: true }).click();
  await dialog.getByLabel('字段名称').fill('订单号');
  await dialog.getByRole('button', { name: '新增记录', exact: true }).click();
  await expect.poll(() => state.records.tables?.length).toBe(1);
  expect(state.records.tables[0].data.fields[0].name).toBe('订单号');
  await dialog.getByLabel('数据类型').selectOption('objects');
  await dialog.getByLabel('名称', { exact: true }).fill('订单对象');
  await dialog.getByLabel('关联数据表').selectOption(state.records.tables[0].id);
  await dialog.getByRole('button', { name: '新增记录', exact: true }).click();
  await expect.poll(() => state.records.objects?.length).toBe(1);
  expect(state.records.objects[0].data.tableIds).toEqual([state.records.tables[0].id]);
});
test('讨论可关联活动、回复、解决和重新打开', async ({ page }) => {
  const state = await setup(page);
  await page.getByRole('button', { name: state.document.title + ' · v1', exact: true }).click();
  await page.getByRole('button', { name: /^图层/ }).click();
  await page.getByRole('button', { name: '接收客户订单', exact: true }).click();
  await page.getByRole('tab', { name: '讨论', exact: true }).click();
  const panel = page.getByRole('tabpanel', { name: '讨论' });
  await panel.getByLabel('对选中图形提问').fill('确认订单信息来源');
  await panel.getByRole('button', { name: '提交讨论' }).click();
  await expect.poll(() => state.comments.length).toBe(1);
  expect(state.comments[0].anchor).toBe('receive');
  await panel.getByLabel('回复', { exact: true }).fill('来源于订单系统');
  await panel.getByRole('button', { name: '回复', exact: true }).click();
  await expect(panel).toContainText('来源于订单系统');
  await panel.getByRole('button', { name: '标记解决' }).click();
  await expect(panel.getByRole('button', { name: '重新打开' })).toBeVisible();
  await panel.getByRole('button', { name: '重新打开' }).click();
  await expect(panel.getByRole('button', { name: '标记解决' })).toBeVisible();
});
