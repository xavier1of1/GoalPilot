import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function expectNoSeriousAccessibilityViolations(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(result.violations).toEqual([]);
}

async function expectNoHorizontalOverflowAtWidths(page: Page, widths: readonly number[]) {
  for (const width of widths) {
    await page.setViewportSize({ width, height: width <= 768 ? 900 : 960 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

test('landing and mobile navigation are accessible at 360px @a11y', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('savings route');
  await expect(
    page.getByText('Illustrative rate, not a live offer.', { exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);

  const menu = page.getByRole('button', { name: 'Toggle navigation' });
  await menu.click();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expectNoSeriousAccessibilityViolations(page);

  await expectNoHorizontalOverflowAtWidths(page, [768, 1024, 1440]);
});

test('authenticated goal journey persists, completes, exports, and deletes @a11y', async ({
  page,
}) => {
  await page.goto('/signin');
  await expectNoSeriousAccessibilityViolations(page);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole('heading', { name: 'Ready when you are.' })).toBeVisible();

  await page.goto('/plan');
  const targetAmount = page.getByLabel('Target amount');
  await targetAmount.fill('1');
  await page.getByRole('button', { name: 'Compare my routes' }).click();
  await expect(page.getByText('The minimum goal is $500.')).toBeVisible();
  await expect(targetAmount).toBeFocused();
  await expect(page.locator('.results-section')).toHaveCount(0);
  await targetAmount.fill('6000');
  await page.getByRole('button', { name: 'Compare my routes' }).click();
  await expect(page.getByText('Your contribution-only baseline')).toBeVisible();
  await expect(page.locator('.vehicle-card')).toHaveCount(4);
  await expect(
    page
      .locator('.vehicle-card')
      .getByText('Illustrative rate, not a live offer.', { exact: true }),
  ).toHaveCount(4);
  await expectNoSeriousAccessibilityViolations(page);
  await expectNoHorizontalOverflowAtWidths(page, [360, 768, 1024, 1440]);

  await page.getByLabel('Goal name').fill('Japan trip updated after preview');
  await expect(page.locator('.results-section')).toHaveCount(0);
  await page.getByRole('button', { name: 'Compare my routes' }).click();
  const recommended = page.locator('.vehicle-card.recommended');
  await expect(recommended).toHaveCount(1);
  const liquidRoute = page
    .locator('.vehicle-card')
    .filter({ has: page.getByRole('heading', { name: 'High-yield savings model' }) });
  await liquidRoute.getByRole('button', { name: 'Activate this simulated route' }).click();

  await expect(page).toHaveURL(/\/dashboard\?goal=/);
  await expect(page.getByText('$1,000.00').first()).toBeVisible();
  await page.reload();
  await expect(page.getByText('$1,000.00').first()).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);
  await expectNoHorizontalOverflowAtWidths(page, [360, 768, 1024, 1440]);

  await page.getByRole('button', { name: 'Add simulated contribution' }).click();
  await expectNoSeriousAccessibilityViolations(page);
  await page.getByLabel('Amount').fill('0');
  await page.getByRole('button', { name: 'Post simulated contribution' }).click();
  await expect(page.getByRole('alert')).toContainText('between $0.01 and $1,000,000');
  await expect(page.getByLabel('Amount')).toBeFocused();
  await page.getByLabel('Amount').fill('100');
  await page.getByRole('button', { name: 'Post simulated contribution' }).click();
  await expect(page.getByRole('status')).toContainText('posted successfully');
  await expect(page.getByText('$1,100.00').first()).toBeVisible();

  await page.getByRole('button', { name: 'Pause simulation' }).click();
  await expect(page.getByRole('status')).toContainText('paused');
  await page.getByRole('button', { name: 'Resume simulation' }).click();
  await expect(page.getByRole('status')).toContainText('resumed');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('goalpilot-export.json');

  await page.getByRole('button', { name: 'Add simulated contribution' }).click();
  await page.getByLabel('Amount').fill('4900');
  await page.getByRole('button', { name: 'Post simulated contribution' }).click();
  await expect(page.getByText('purchase ready', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mark purchase complete' }).click();
  await expect(page.getByText('completed', { exact: true })).toBeVisible();
  await expect(page.getByText('Lifetime funding composition', { exact: true })).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);
  await page.getByRole('button', { name: 'Archive goal' }).click();
  await expect(
    page.getByText('Goal archived in your local history.', { exact: true }),
  ).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete profile' }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
});
