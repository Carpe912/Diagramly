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
  await page.goto('/');
  await page.getByRole('button', { name: '文档库', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '文档库' });
  await dialog.getByLabel('用户名').fill('demo');
  await dialog.getByLabel('密码').fill('password');
  await dialog.getByRole('button', { name: '登录独立服务' }).click();
  await dialog.getByRole('button', { name: '新建服务端文档' }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('textbox', { name: '画布名称' }).fill('独立服务文档');
  await page.getByRole('textbox', { name: '画布名称' }).blur();
  await expect.poll(() => saved?.title).toBe('独立服务文档');
  expect(writes).toEqual([]);
});
