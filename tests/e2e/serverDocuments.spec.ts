import { expect, test } from '@playwright/test';
test('独立文档库登录新建后自动保存JSON，不调用Coopwire', async ({ page }) => {
  let saved: any,
    revision = 0;
  const writes: string[] = [];
  await page.route('**/rest/**', (route) => {
    writes.push(route.request().url());
    return route.abort();
  });
  await page.route('**/api/documents**', async (route) => {
    const request = route.request();
    if (!request.headers().authorization?.startsWith('Basic '))
      return route.fulfill({ status: 401, json: { message: '未登录' } });
    if (request.method() === 'PUT') {
      const body = request.postDataJSON();
      expect(body.expectedRevision).toBe(revision);
      saved = body.document;
      revision++;
      return route.fulfill({ json: { revision } });
    }
    return route.fulfill({ json: [] });
  });
  await page.route('**/api/session', (route) =>
    route.fulfill({ json: { username: 'demo', role: 'editor' } }),
  );
  await page.goto('/');
  await expect(page.getByTestId('graph')).toBeVisible();
  await page.getByRole('button', { name: '新建文档', exact: true }).click();
  await page.getByRole('button', { name: '云端文档', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '文档库' });
  await dialog.getByLabel('用户名').fill('demo');
  await dialog.getByLabel('密码').fill('password');
  await dialog.getByRole('button', { name: '登录', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('textbox', { name: '画布名称' }).fill('独立服务文档');
  await page.getByRole('textbox', { name: '画布名称' }).blur();
  await expect.poll(() => saved?.title).toBe('独立服务文档');
  expect(writes).toEqual([]);
});
test('文档历史可比较并显式恢复为新版本', async ({ page }) => {
  const { demoDocument } = await import('../../src/application/demo');
  const document = demoDocument();
  document.title = '历史内容';
  let restored = false;
  await page.route('**/api/documents**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/restore')) {
      expect(route.request().postDataJSON()).toEqual({ revision: 1, expectedRevision: 2 });
      restored = true;
      return route.fulfill({ json: { document, revision: 3 } });
    }
    if (url.pathname.endsWith('/versions/1')) return route.fulfill({ json: { document } });
    if (url.pathname.endsWith('/versions'))
      return route.fulfill({
        json: [{ revision: 1, title: '历史内容', created_at: '2026-10-30T00:00:00Z' }],
      });
    if (url.pathname.endsWith(`/documents/${document.id}`))
      return route.fulfill({ json: { document: { ...document, title: '新版内容' }, revision: 2 } });
    return route.fulfill({ json: [{ id: document.id, title: '新版内容', revision: 2 }] });
  });
  await page.route('**/api/session', (route) =>
    route.fulfill({ json: { username: 'demo', role: 'editor' } }),
  );
  await page.goto('/');
  await expect(page.getByTestId('graph')).toBeVisible();
  await page.getByRole('button', { name: '文档库', exact: true }).click();
  await page.getByLabel('用户名').fill('demo');
  await page.getByLabel('密码').fill('password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('button', { name: '版本', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '版本历史' });
  await dialog.getByRole('button', { name: /v1 · 历史内容/ }).click();
  await expect(dialog.getByRole('button', { name: '恢复为新版本' })).toBeDisabled();
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: '恢复为新版本' }).click();
  await expect(page.getByRole('textbox', { name: '画布名称' })).toHaveValue('历史内容');
  expect(restored).toBe(true);
});
