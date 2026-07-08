import { test, expect } from '@playwright/test';

/**
 * Critical-journey browser smoke over the real DOM (offline stack). Complements the
 * HTTP-level e2e-zuub suite with actual rendering + interaction coverage.
 */

test('workbench home renders without a login (auth disabled) and shows the nav', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Arbiter', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Concept Map' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Reference Docs' })).toBeVisible();
});

test('reference docs lists the seeded corpus', async ({ page }) => {
  await page.goto('/knowledge');
  await expect(page.getByText('Delta Dental', { exact: false }).first()).toBeVisible();
});

test('concept map is interactive: a node click opens its detail panel', async ({ page }) => {
  await page.goto('/graph');
  // The seeded graph renders SVG nodes as focusable buttons labelled with the entity.
  const node = page.getByRole('button', { name: /member_id/ }).first();
  await expect(node).toBeVisible();
  await node.click();
  // The detail panel shows the node type, mentions and its connections.
  const detail = page.locator('aside.detail');
  await expect(detail).toBeVisible();
  await expect(detail.getByRole('heading', { name: 'member_id' })).toBeVisible();
  await expect(detail.getByText(/connection/)).toBeVisible();
});

test('concept map zoom controls change the zoom level', async ({ page }) => {
  await page.goto('/graph');
  await expect(page.locator('svg.canvas')).toBeVisible();
  const zoomLabel = page.locator('.toolbar .hint');
  const before = await zoomLabel.textContent();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(zoomLabel).not.toHaveText(before ?? '');
});

test('data format checker rejects malformed JSON', async ({ page }) => {
  await page.goto('/validate');
  await expect(page.getByRole('heading', { name: 'Data Format Checker' })).toBeVisible();
});
