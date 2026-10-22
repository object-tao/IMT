import { test, expect } from '@playwright/test';
import { createApp } from '../../server/app';
import { Database } from '../../server/database';
import type { Catalog, SavedPlan } from '../../shared/model';
import { roadConnectionFixture } from '../road-connection-fixture';

test('成都经布拉格转运巴黎：保留待落实公路段并支持校验、保存和重开', async ({ page }) => {
  // Every API request uses this isolated database; the shared E2E server only serves the UI.
  const { app } = await createApp({ database: new Database({ file: ':memory:' }), password: '' });
  const { catalog, roadSelection } = roadConnectionFixture();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    const seeded = await app.inject({ method: 'POST', url: '/api/catalog/import', payload: catalog });
    expect(seeded.statusCode).toBe(200);
    await page.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url());
      const response = await app.inject({
        method: request.method() as 'GET' | 'POST', url: `${url.pathname}${url.search}`,
        ...(request.postData() ? { payload: request.postData()!, headers: { 'content-type': 'application/json' } } : {}),
      });
      await route.fulfill({ status: response.statusCode, contentType: String(response.headers['content-type'] ?? 'application/json'), body: response.rawPayload });
    });
    await page.goto('/');
    await page.getByRole('combobox', { name: '起运城市', exact: true }).fill('成都');
    await page.getByRole('listbox', { name: '起运城市候选城市' }).getByRole('option').first().click();
    await page.getByRole('combobox', { name: '目的国家', exact: true }).selectOption('FR');
    await page.getByRole('combobox', { name: '目的城市', exact: true }).fill('Paris');
    await page.getByRole('listbox', { name: '目的城市候选城市' }).getByRole('option').first().click();
    await page.getByLabel('最早可提货时间', { exact: true }).fill('2026-10-22T08:00');
    await page.getByLabel('货物名称 1', { exact: true }).fill('虚构空卡联运验收货物');
    await page.getByRole('button', { name: '生成运输方案' }).click();
    const card = page.locator('.candidate-card').filter({ hasText: '公路转运待落实' }).first();
    await expect(card).toBeVisible();
    await expect(card).toContainText('Paris');
    await expect(card).toContainText('Prague');
    await expect(card).toContainText('送达时间待确认');
    await card.getByRole('button', { name: '查看与调整' }).click();
    const roadOption = page.locator('.leg-selector option:checked').filter({ hasText: '公路转运' });
    await expect(roadOption).toHaveAttribute('value', roadSelection);
    await expect(roadOption).toContainText('待匹配供应商');
    await page.getByRole('button', { name: '重新校验' }).click();
    await expect(roadOption).toHaveAttribute('value', roadSelection);
    const [savedResponse] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/api/plans') && response.request().method() === 'POST'),
      page.getByRole('button', { name: '保存方案', exact: true }).click(),
    ]);
    expect(savedResponse.ok()).toBe(true);
    const saved: SavedPlan = await savedResponse.json();
    expect(saved.candidate.legs.at(-1)).toMatchObject({ laneId: roadSelection, mode: 'road', missing: true, timingUnknown: true });
    await expect(page.getByText(/已保存版本 V1/)).toBeVisible();
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await page.reload();
    await page.getByRole('button', { name: /方案档案/ }).click();
    await page.getByRole('button', { name: '查看 / 导出', exact: true }).first().click();
    await expect(page.getByRole('dialog')).toContainText('公路转运待落实');
    await expect(roadOption).toHaveAttribute('value', roadSelection);
    await expect(page.getByRole('dialog')).toContainText('送达待确认');
    await page.getByRole('button', { name: '重新校验' }).click();
    await expect(roadOption).toHaveAttribute('value', roadSelection);
    const current = (await app.inject('/api/catalog')).json<Catalog>();
    expect(current.nodes).toHaveLength(2);
    expect(current.lanes).toHaveLength(1);
    expect(current.nodes.some(node => node.cityId === '2988507')).toBe(false);
    expect(errors).toEqual([]);
  } finally {
    await page.unrouteAll({ behavior: 'wait' });
    await app.close();
  }
});
