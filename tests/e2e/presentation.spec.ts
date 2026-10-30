import { expect, test } from '@playwright/test';
test('演示模式只保留画布和右侧面板，可退出且缩放不变', async ({ page }) => {
  await page.goto('/');
  const zoom = await page.locator('.zoom-control > span').innerText();
  await page.getByRole('button', { name: '演示模式', exact: true }).click();
  await expect(page.locator('.app-header')).toBeHidden();
  await expect(page.locator('.library-panel')).toBeHidden();
  await expect(page.locator('.canvas-topbar')).toBeHidden();
  await expect(page.locator('.status-bar')).toBeHidden();
  await expect(page.getByTestId('graph')).toBeVisible();
  await expect(page.getByRole('tab', { name: '属性', exact: true })).toBeVisible();
  await expect(page.locator('.zoom-control > span')).toHaveText(zoom);
  await page.getByRole('button', { name: '退出演示模式' }).click();
  await expect(page.locator('.app-header')).toBeVisible();
  await expect(page.locator('.canvas-topbar')).toBeVisible();
});
