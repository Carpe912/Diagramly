import { expect, test } from '@playwright/test';
test('本机活动和业务表单写入 IndexedDB，刷新恢复且不创建远程活动', async ({ page }) => {
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/rest/')) writes.push(request.url());
  });
  await page.goto('/');
  await expect(page.getByTestId('graph')).toBeVisible();
  await page.getByTestId('shape-activity').click();
  await page.getByRole('tab', { name: '业务详情', exact: true }).click();
  await page.getByLabel('活动名称', { exact: true }).fill('IndexedDB 草稿活动');
  await page.getByLabel('活动名称', { exact: true }).blur();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('diagramly', 1);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        return new Promise<boolean>((resolve) => {
          const request = db
            .transaction('drafts')
            .objectStore('drafts')
            .get('diagramly.document.v1');
          request.onsuccess = () => {
            resolve(JSON.stringify(request.result).includes('IndexedDB 草稿活动'));
            db.close();
          };
        });
      }),
    )
    .toBe(true);
  await page.reload();
  await page.getByRole('button', { name: /^图层/ }).click();
  await expect(page.getByRole('button', { name: 'IndexedDB 草稿活动', exact: true })).toBeVisible();
  expect(writes).toEqual([]);
});
