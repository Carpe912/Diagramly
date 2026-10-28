import { expect, test, type Page } from '@playwright/test';
async function openDetails(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /^图层/ }).click();
  await page.getByRole('button', { name: '接收客户订单', exact: true }).click();
  await page.getByRole('button', { name: '查看业务详情', exact: true }).click();
}
test('活动画像的说明、差异与图上描述可以保存并撤销', async ({ page }) => {
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  await openDetails(page);
  await page.getByLabel('补充说明', { exact: true }).fill('核对库存后提交订单');
  await page.getByLabel('补充说明', { exact: true }).press('Tab');
  await page.getByLabel('差异新增', { exact: true }).check();
  await page.getByLabel('在图上显示描述', { exact: true }).check();
  await expect(page.locator('[data-part-id="receive::title"]').last()).toContainText(
    '接收并核对客户订单的基础信息',
  );
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.getByLabel('在图上显示描述', { exact: true })).not.toBeChecked();
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('diagramly.document.v1')!).entities.entity_receive.details
            ?.showInFlow,
      ),
    )
    .toBe(true);
  await page.reload();
  await page.getByRole('button', { name: /^图层/ }).click();
  await page.getByRole('button', { name: '接收客户订单', exact: true }).click();
  await page.getByRole('button', { name: '查看业务详情', exact: true }).click();
  await expect(page.getByLabel('补充说明', { exact: true })).toHaveValue('核对库存后提交订单');
  await expect(page.getByLabel('差异新增', { exact: true })).toBeChecked();
  expect(failures).toEqual([]);
});
test('显示设置展开时间和周期，切换节点时保持各自详情', async ({ page }) => {
  await openDetails(page);
  await page.getByText('显示设置', { exact: true }).click();
  await page.getByLabel('显示活动时间要求', { exact: true }).check();
  await page.getByLabel('显示活动周期要求', { exact: true }).check();
  await page.getByText('显示设置', { exact: true }).click();
  await page.getByLabel('单次活动用时', { exact: true }).fill('2.5');
  await page.getByLabel('单次活动用时', { exact: true }).press('Tab');
  await page.getByLabel('执行周期', { exact: true }).selectOption('week');
  await page.getByLabel('执行星期', { exact: true }).fill('1,3,5');
  await page.getByLabel('执行星期', { exact: true }).press('Tab');
  await page.getByRole('button', { name: '确认订单信息', exact: true }).click();
  await expect(page.getByLabel('单次活动用时', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '接收客户订单', exact: true }).click();
  await expect(page.getByLabel('单次活动用时', { exact: true })).toHaveValue('2.5');
  await expect(page.getByLabel('执行星期', { exact: true })).toHaveValue('1,3,5');
});
