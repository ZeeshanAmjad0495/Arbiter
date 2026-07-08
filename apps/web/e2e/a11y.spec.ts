import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Automated accessibility gate: run axe-core (WCAG 2.1 A + AA) on every page a user
 * can reach and fail on any violation. This enforces the Lighthouse-100-a11y goal on
 * every CI run instead of by hand.
 */
const ROUTES = [
  ['/', 'Workbench home'],
  ['/knowledge', 'Reference Docs'],
  ['/graph', 'Concept Map'],
  ['/validate', 'Data Format Checker'],
  ['/writeback', 'Write-back'],
  ['/runner', 'Test Runner'],
  ['/review', 'Review Queue'],
  ['/insights', 'Insights'],
  ['/prompts', 'Template Library'],
  ['/admin', 'Users & Access'],
  ['/demask', 'Unmask Data'],
] as const;

for (const [route, name] of ROUTES) {
  test(`a11y: ${name} (${route})`, async ({ page }) => {
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    const summary = violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }));
    expect(violations, JSON.stringify(summary, null, 2)).toEqual([]);
  });
}
