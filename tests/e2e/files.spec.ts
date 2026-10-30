import { expect, test, type Page } from '@playwright/test';
async function dialog(page: Page) {
  await page.getByRole('button', { name: '文档数据', exact: true }).click();
}
async function readDocument(page: Page) {
  await dialog(page);
  const doc = JSON.parse(await page.getByTestId('document-json').innerText());
  await page.getByRole('button', { name: '关闭文档数据' }).click();
  return doc;
}
test('头部只保留文档数据入口，弹窗支持 JSON、XML 和 PNG 导出', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('graph')).toBeVisible();
  await expect(page.locator('.app-header').getByRole('button', { name: /导入|导出/ })).toHaveCount(
    0,
  );
  await dialog(page);
  await expect(page.getByRole('button', { name: '导入', exact: true })).toBeVisible();
  for (const format of ['json', 'xml', 'png']) {
    await page.getByLabel('导出格式').selectOption(format);
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: `导出 ${format.toUpperCase()}`, exact: true }).click();
    const download = await pending;
    expect(download.suggestedFilename()).toMatch(new RegExp(`\\.diagramly\\.${format}$`));
    expect(await download.failure()).toBeNull();
  }
});
test('XML 从文档数据导入后保留泳池与业务身份，错误 XML 不覆盖画布', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('graph')).toBeVisible();
  const before = await readDocument(page);
  await dialog(page);
  await page.getByLabel('导出格式').selectOption('xml');
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 XML', exact: true }).click();
  const download = await pending,
    file = await download.path();
  await page.getByLabel('导入文档', { exact: true }).setInputFiles(file!);
  expect(await readDocument(page)).toEqual(before);
  await dialog(page);
  await page.getByLabel('导入文档', { exact: true }).setInputFiles({
    name: 'bad.xml',
    mimeType: 'application/xml',
    buffer: Buffer.from('<mxGraphModel><root>'),
  });
  await expect(page.getByRole('alert')).toBeVisible();
  expect(JSON.parse(await page.getByTestId('document-json').innerText())).toEqual(before);
});
