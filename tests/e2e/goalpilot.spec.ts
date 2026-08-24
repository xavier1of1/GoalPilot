import AxeBuilder from '@axe-core/playwright';
import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type Request,
  type Response,
} from '@playwright/test';
import { randomUUID } from 'node:crypto';

const webOrigin = 'http://localhost:5273';
const demoEmail = 'demo.japan@example.test';
const demoPassword = 'GoalPilot-Demo-2026!';
const runId = `${Date.now().toString(36)}-${process.pid.toString(36)}`;
const responsiveWidths = [360, 768, 1024, 1440] as const;
const unexpectedServerErrors = new WeakMap<Page, string[]>();
const pendingApiRequests = new WeakMap<Page, Set<Request>>();

function attachUnexpectedServerErrorCollector(page: Page): string[] {
  const errors: string[] = [];
  const pending = new Set<Request>();
  unexpectedServerErrors.set(page, errors);
  pendingApiRequests.set(page, pending);
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/')) pending.add(request);
  });
  page.on('response', (response) => {
    pending.delete(response.request());
    if (response.url().includes('/api/v1/') && response.status() >= 500) {
      errors.push(`${String(response.status())} ${response.request().method()} ${response.url()}`);
    }
  });
  page.on('requestfailed', (request) => pending.delete(request));
  return errors;
}

async function drainTrackedApiRequests(page: Page): Promise<void> {
  await expect
    .poll(() => pendingApiRequests.get(page)?.size ?? 0, {
      message: 'The browser journey must settle every tracked API request before evaluation.',
      timeout: 5_000,
    })
    .toBe(0);
}

test.beforeEach(({ page }) => {
  attachUnexpectedServerErrorCollector(page);
});

test.afterEach(async ({ page }) => {
  await drainTrackedApiRequests(page);
  expect(
    unexpectedServerErrors.get(page) ?? [],
    'A release browser journey must not leave any unexpected API 5xx response in the background.',
  ).toEqual([]);
});

type ProductEventPayload = Readonly<Record<string, unknown>> & {
  readonly eventName: string;
  readonly demo: boolean;
};

async function expectSuccessful(response: Response): Promise<void> {
  const message = response.ok() ? `HTTP ${String(response.status())}` : await response.text();
  expect(response.ok(), message).toBe(true);
}

async function auditResponsiveState(page: Page): Promise<void> {
  for (const width of responsiveWidths) {
    await page.setViewportSize({ width, height: width <= 768 ? 900 : 960 });
    const overflow = await page.evaluate(() => {
      const viewportWidth = document.documentElement.clientWidth;
      const offenders = [...document.querySelectorAll<HTMLElement>('body *')]
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            selector: `${element.tagName.toLowerCase()}${
              element.id.length === 0 ? '' : `#${element.id}`
            }${
              typeof element.className !== 'string' || element.className.length === 0
                ? ''
                : `.${element.className.trim().replaceAll(/\s+/g, '.')}`
            }`,
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            width: Math.round(rect.width),
          };
        })
        .filter(
          ({ left, right, width: elementWidth }) =>
            elementWidth > 0 && (left < -1 || right > viewportWidth + 1),
        )
        .slice(0, 12);
      return {
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth,
        offenders,
      };
    });
    expect(
      overflow.documentWidth,
      `The page must not overflow horizontally at ${String(width)}px. Candidates: ${JSON.stringify(
        overflow.offenders,
      )}`,
    ).toBeLessThanOrEqual(overflow.viewportWidth + 1);
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(
      result.violations.map(({ id, impact, nodes }) => ({
        id,
        impact,
        targets: nodes.map((node) => node.target),
      })),
    ).toEqual([]);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

async function auditReducedMotion(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const durations = await page.locator('body').evaluate((element) => {
    const style = window.getComputedStyle(element);
    const milliseconds = (value: string) =>
      Number.parseFloat(value) * (value.endsWith('ms') ? 1 : 1_000);
    return {
      animationDurationMs: milliseconds(style.animationDuration),
      transitionDurationMs: milliseconds(style.transitionDuration),
    };
  });
  expect(durations.animationDurationMs).toBeCloseTo(0.01, 5);
  expect(durations.transitionDurationMs).toBeCloseTo(0.01, 5);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
}

async function registerThroughUi(page: Page, journey: string): Promise<void> {
  await page.goto('/signin');
  await auditResponsiveState(page);
  await page.getByRole('button', { name: 'Need a profile? Create one' }).click();
  await page.getByLabel('Name').fill(`Release journey ${journey}`);
  await page.getByLabel('Email').fill(`release-${journey.toLowerCase()}-${runId}@example.test`);
  await page.getByLabel('Password').fill(`GoalPilot-${journey}-${runId}!`);
  await page.getByRole('button', { name: 'Create local profile' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

async function signInToSeededDemo(page: Page): Promise<void> {
  await page.goto('/signin');
  await page.getByRole('button', { name: 'Use Japan Story Demo' }).click();
  await expect(page.getByLabel('Email')).toHaveValue(demoEmail);
  await expect(page.getByLabel('Password')).toHaveValue(demoPassword);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole('heading', { name: 'Japan trip' })).toBeVisible();
}

async function resetSeededDemo(page: Page): Promise<void> {
  const reset = page.getByRole('button', { name: 'Reset fixture' });
  await expect(reset).toBeVisible();
  await reset.click();
  const confirmation = page.getByRole('alertdialog', {
    name: 'Reset the seeded Story Demo?',
  });
  await expect(confirmation).toBeVisible();
  const confirm = confirmation.getByRole('button', { name: 'Reset seeded Story Demo' });
  const cancel = confirmation.getByRole('button', { name: 'Cancel' });
  await expect(confirm).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(confirm).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(confirmation).toBeHidden();
  await expect(reset).toBeFocused();
  await reset.click();
  await expect(confirmation).toBeVisible();
  await expect(confirm).toBeFocused();
  const resetResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/demo/reset') && response.request().method() === 'POST',
  );
  await confirm.click();
  const response = await resetResponse;
  await expectSuccessful(response);
  await expect(reset).toBeEnabled();
  await expect(page.locator('.autopilot').getByText('Application date:')).toContainText(
    'Aug 23, 2026',
  );
}

async function restoreSeededDemoForSetup(page: Page): Promise<void> {
  const goalsResponse = await page.request.get('/api/v1/goals');
  expect(goalsResponse.status(), await goalsResponse.text()).toBe(200);
  const goalsBody = (await goalsResponse.json()) as {
    readonly goals: readonly {
      readonly id: string;
      readonly name: string;
      readonly version: number;
    }[];
  };
  const fixtureGoal = goalsBody.goals.find((candidate) => candidate.name === 'Japan trip');
  expect(fixtureGoal, 'The signed-in Story Demo owner must retain the seeded goal.').toBeDefined();
  if (fixtureGoal === undefined) throw new Error('The seeded Story Demo goal is unavailable.');
  const resetResponse = await page.request.post('/api/v1/demo/reset', {
    headers: await mutationHeaders(page.context()),
    data: {
      goalId: fixtureGoal.id,
      expectedGoalVersion: fixtureGoal.version,
      confirmation: 'RESET_SEEDED_STORY_DEMO',
    },
  });
  expect(resetResponse.status(), await resetResponse.text()).toBe(200);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Japan trip' })).toBeVisible();
}

async function registerThroughApi(
  context: BrowserContext,
  email: string,
  displayName: string,
): Promise<void> {
  const response = await context.request.post('/auth/register', {
    headers: { origin: webOrigin },
    data: { email, password: `GoalPilot-E-${runId}!`, displayName },
  });
  expect(response.status(), await response.text()).toBe(201);
}

async function mutationHeaders(
  context: BrowserContext,
  idempotencyKey: string = randomUUID(),
): Promise<Record<string, string>> {
  const csrf = (await context.cookies(webOrigin)).find(
    (cookie) => cookie.name === 'goalpilot_csrf',
  );
  expect(csrf, 'An authenticated test context must receive a CSRF cookie.').toBeDefined();
  return {
    origin: webOrigin,
    'x-csrf-token': decodeURIComponent(csrf?.value ?? ''),
    'idempotency-key': idempotencyKey,
  };
}

test('Journey A: open sample, build progressively, compare four routes, and activate @release @a11y', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await registerThroughUi(page, 'A');

  await page.goto('/');
  await auditResponsiveState(page);
  await expect(page.getByLabel('Example goal progress')).toContainText('Japan trip');
  await page.locator('.hero-actions').getByRole('link', { name: 'Open sample plan' }).click();
  await expect(page).toHaveURL(/\/plan/);
  await expect(page.getByRole('navigation', { name: 'Goal builder progress' })).toContainText(
    'Goal',
  );

  await page.getByLabel('Goal name').fill(`Japan sample ${runId}`);
  await page.getByLabel('Target amount').fill('9000');
  await page.getByLabel('Purchase date').fill('2028-02-23');
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('group', { name: '2. Set the starting point' })).toBeVisible();
  await page.getByLabel('Already saved').fill('1500');
  await page.getByLabel('Contribution rhythm').selectOption('monthly');
  await page.getByRole('button', { name: 'Reveal my safe contribution' }).click();
  await expect(page.locator('.safe-reveal')).toContainText('$416.67 per monthly');
  await expect(page.getByLabel('Amount that fits your budget')).toHaveValue('416.67');
  await page.getByLabel('Amount that fits your budget').fill('400.50');

  await page.getByRole('button', { name: 'Continue to access' }).click();
  await page.getByLabel('Access need').selectOption('within_30_days');
  await page.getByLabel('Capital preservation').selectOption('required');
  await page.getByRole('button', { name: 'Review plan' }).click();
  await expect(page.getByRole('group', { name: '5. Review before preview' })).toContainText(
    'Safe amount',
  );
  await expect(page.getByRole('group', { name: '5. Review before preview' })).toContainText(
    '$416.67',
  );
  await expect(page.getByRole('group', { name: '5. Review before preview' })).toContainText(
    '$400.50',
  );
  await page.getByRole('button', { name: 'Preview my plan' }).click();

  const results = page.locator('.results-section');
  await expect(results).toBeVisible();
  await expect(results.locator('.vehicle-card')).toHaveCount(4);
  await expect(
    results
      .locator('.vehicle-card')
      .getByText('Illustrative rate, not a live offer.', { exact: true }),
  ).toHaveCount(4);
  const rejectedRoutes = results.locator('.vehicle-card:has(.rejection)');
  expect(await rejectedRoutes.count()).toBeGreaterThan(0);
  await expect(rejectedRoutes.first()).toContainText(/liquidity|horizon|minimum|access/i);

  const highYieldRoute = results
    .locator('.vehicle-card')
    .filter({ has: page.getByRole('heading', { name: 'High-yield savings model' }) });
  await highYieldRoute.getByText('Assumption and calculation detail').click();
  await expect(highYieldRoute.getByText('Assumption', { exact: true })).toBeVisible();
  await expect(highYieldRoute).toContainText('demo-2026-08-v1');
  await expect(highYieldRoute).toContainText('Lock');
  await auditReducedMotion(page);
  await auditResponsiveState(page);

  await highYieldRoute.getByRole('button', { name: 'Activate this Simulated Goal Plan' }).click();
  await expect(page).toHaveURL(/\/dashboard\?goal=/);
  await expect(page.getByRole('heading', { name: `Japan sample ${runId}` })).toBeVisible();
  await expect(page.locator('.dashboard-balance')).toHaveText('$1,500.00');
  await expect(
    page.getByRole('heading', { name: 'The commitment, cushion, and access reconcile.' }),
  ).toBeVisible();
  await expect(
    page
      .locator('.assumption-card')
      .getByText('Illustrative rate, not a live offer.', { exact: true }),
  ).toBeVisible();
  await auditResponsiveState(page);
});

test('Journey B: model a missed contribution, recover, and retain immutable history @release @a11y', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signInToSeededDemo(page);
  await resetSeededDemo(page);

  const firstAdvance = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/demo/advance') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Next contribution' }).click();
  const firstAdvanceResponse = await firstAdvance;
  await expectSuccessful(firstAdvanceResponse);
  await expect(page.locator('.autopilot-summary')).toContainText('1 contributions');

  await page.getByLabel('Change dimension').selectOption('MISSED_CONTRIBUTION');
  await expect(page.locator('.scenario-note')).toContainText(
    'Model one missed contribution on Oct 23, 2026',
  );
  await page.getByRole('button', { name: 'Preview one change' }).click();
  await expect(page.getByText('Proposed', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Apply as new version' }).click();
  await expect(
    page.getByText('Applied as a new immutable plan version.', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('.health-badge')).toHaveText('Needs attention');

  const recovery = page.locator('.recovery-list');
  await expect(recovery).toBeVisible();
  expect(await recovery.locator('li').count()).toBeLessThanOrEqual(3);
  await recovery.getByRole('button', { name: 'Apply' }).first().click();
  await expect(
    page.getByText('Recovery applied as a new immutable plan version.', { exact: true }),
  ).toBeVisible();

  const history = page.locator('.version-list');
  await expect(history.locator('li')).toHaveCount(3);
  await expect(history).toContainText('v1');
  await expect(history).toContainText('v2');
  await expect(history).toContainText('v3');
  await expect(history).toContainText('Initial activation');
  await expect(history).toContainText('What-If change applied');
  await expect(history).toContainText('Recovery option applied');
  await auditResponsiveState(page);

  await page.reload();
  await expect(page.locator('.version-list').locator('li')).toHaveCount(3);
});

test('Journey C: reset, advance the Japan story, complete, and navigate archived history @release @a11y', async ({
  page,
}) => {
  test.setTimeout(105_000);
  await signInToSeededDemo(page);
  await resetSeededDemo(page);

  const sixMonthResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/demo/advance') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Six months' }).click();
  const sixMonthRun = await sixMonthResponse;
  await expectSuccessful(sixMonthRun);
  expect(await sixMonthRun.json()).toMatchObject({
    milestone: 'SIX_MONTHS',
    fromDate: '2026-08-23',
    toDate: '2027-02-23',
    contributionsPosted: 6,
  });
  await expect(page.locator('.autopilot-summary')).toContainText('6 contributions');
  await expect(page.getByRole('table', { name: 'Simulated account activity' })).toContainText(
    'Scheduled simulated contribution posted',
  );

  const targetResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/demo/advance') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Target date' }).click();
  const targetRun = await targetResponse;
  await expectSuccessful(targetRun);
  expect(await targetRun.json()).toMatchObject({
    milestone: 'TARGET_DATE',
    toDate: '2028-02-23',
    health: 'PURCHASE_READY',
  });
  await expect(page.locator('.health-badge')).toHaveText('Purchase ready');
  await expect(page.locator('.status-pill.purchase_ready')).toHaveText('Purchase ready');
  const currentBalance = await page.locator('.dashboard-balance').textContent();
  const availableBalance = await page
    .locator('.assumption-list div')
    .filter({ hasText: 'Availability' })
    .locator('dd')
    .textContent();
  expect(availableBalance).toBe(currentBalance);
  await expect(page.getByText('FUNDED BUT LOCKED')).toHaveCount(0);
  await auditResponsiveState(page);

  const completeResponse = page.waitForResponse(
    (response) =>
      /\/api\/v1\/goals\/[^/]+\/complete$/.test(response.url()) &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Mark purchase complete' }).click();
  await expectSuccessful(await completeResponse);
  await expect(page.getByText('Goal completed and retained in your history.')).toBeVisible();
  await expect(page.locator('.status-pill.completed')).toHaveText('Completed');
  const archiveResponse = page.waitForResponse(
    (response) =>
      /\/api\/v1\/goals\/[^/]+\/archive$/.test(response.url()) &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Archive goal' }).click();
  await expectSuccessful(await archiveResponse);
  await expect(page.getByText('Goal archived in your local history.')).toBeVisible();
  await expect(page.getByLabel('View goal')).toContainText('Japan trip · Archived');

  await page.reload();
  await expect(page.getByLabel('View goal')).toHaveValue(/.+/);
  await expect(page.getByLabel('View goal')).toContainText('Japan trip · Archived');
  await expect(
    page.getByRole('heading', { name: 'Every applied plan remains readable.' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'This archived plan is history.' })).toBeVisible();
  await expect(page.getByText('Current savings', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Preview one change' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Next contribution' })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Run due price check (fixture only)' }),
  ).toHaveCount(0);
  await auditResponsiveState(page);
});

test('Journey D: run Timing Lab history, advance its clock, and prove exact replay @release @a11y', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signInToSeededDemo(page);
  await restoreSeededDemoForSetup(page);

  const runButton = page.getByRole('button', { name: 'Run due price check (fixture only)' });
  await expect(page.getByRole('heading', { name: 'Purchase Timing Lab' })).toBeVisible();
  await expect(page.getByText('Historical demo data, not a live retailer feed.')).toBeVisible();
  await expect(page.getByText(/Historical patterns do not predict future prices/)).toBeVisible();

  const initialResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/timing-lab/run-due-price-checks') &&
      response.request().method() === 'POST',
  );
  await runButton.click();
  const initialRunResponse = await initialResponse;
  await expectSuccessful(initialRunResponse);
  await expect(page.locator('.timing-state')).toBeVisible();
  await expect(page.locator('.timing-stats')).toContainText('Plan readiness');
  await expect(page.getByRole('heading', { name: 'Historical median by month' })).toBeVisible();
  await expect(page.locator('.seasonal-chart .seasonal-column')).toHaveCount(12);
  const seasonalTable = page.getByRole('table', { name: 'Monthly historical median price data' });
  await expect(seasonalTable).toBeVisible();
  await expect(seasonalTable.locator('tbody tr')).toHaveCount(12);
  await expect(seasonalTable.locator('tbody tr').first()).toContainText('January');
  await auditResponsiveState(page);

  const clockAdvance = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/demo/advance') && response.request().method() === 'POST',
  );
  const timingRefreshAfterClock = page.waitForResponse(
    (response) =>
      /\/api\/v1\/timing-lab\/purchase-items\/[^/]+\/latest$/.test(response.url()) &&
      response.request().method() === 'GET',
  );
  await page.getByRole('button', { name: 'One month' }).click();
  const clockAdvanceResponse = await clockAdvance;
  await expectSuccessful(clockAdvanceResponse);
  await expect(page.locator('.autopilot .autopilot-summary')).toContainText('Sep 23, 2026');
  await expectSuccessful(await timingRefreshAfterClock);

  const nextRunResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/timing-lab/run-due-price-checks') &&
      response.request().method() === 'POST',
  );
  const latestResponsePromise = page.waitForResponse(
    (response) =>
      /\/api\/v1\/timing-lab\/purchase-items\/[^/]+\/latest$/.test(response.url()) &&
      response.request().method() === 'GET',
  );
  await runButton.click();
  const nextRunResponse = await nextRunResponsePromise;
  await expectSuccessful(nextRunResponse);
  const nextRunBody = (await nextRunResponse.json()) as Readonly<Record<string, unknown>>;
  expect(nextRunBody).toMatchObject({ status: 'completed', asOfDate: '2026-09-23' });
  const latestResponse = await latestResponsePromise;
  await expectSuccessful(latestResponse);
  expect(await latestResponse.json()).toMatchObject({ assessment: { asOfDate: '2026-09-23' } });

  const replayKey = nextRunResponse.request().headers()['idempotency-key'];
  expect(replayKey).toBeTruthy();
  await page.route(
    '**/api/v1/timing-lab/run-due-price-checks',
    async (route) => {
      await route.continue({
        headers: { ...route.request().headers(), 'idempotency-key': replayKey ?? '' },
      });
    },
    { times: 1 },
  );
  const exactReplayPromise = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/timing-lab/run-due-price-checks') &&
      response.request().method() === 'POST',
  );
  await expect(runButton).toBeEnabled();
  await runButton.click();
  const exactReplay = await exactReplayPromise;
  await expectSuccessful(exactReplay);
  expect(exactReplay.headers()['idempotency-replayed']).toBe('true');
  expect(await exactReplay.json()).toEqual(nextRunBody);
});

test('Journey E: enforce ownership and keep browser telemetry content-free @release @security', async ({
  browser,
}) => {
  test.setTimeout(75_000);
  const ownerContext = await browser.newContext({ baseURL: webOrigin });
  const otherContext = await browser.newContext({ baseURL: webOrigin });
  try {
    const ownerEmail = `owner-e-${runId}@example.test`;
    const otherEmail = `other-e-${runId}@example.test`;
    await registerThroughApi(ownerContext, ownerEmail, 'Journey E owner');
    await registerThroughApi(otherContext, otherEmail, 'Journey E other user');

    const privateGoalName = `Private Japan ${runId}`;
    const privateDate = '2028-11-09';
    const ownerCreate = await ownerContext.request.post('/api/v1/goals', {
      headers: await mutationHeaders(ownerContext),
      data: {
        name: privateGoalName,
        category: 'private-release-fixture',
        targetAmountCents: 1_234_500,
        currentSavedCents: 234_500,
        targetDate: privateDate,
        recurringContributionCents: 40_050,
        contributionCadence: 'monthly',
        liquidityNeed: 'within_30_days',
        preservationPreference: 'required',
        confidence: 'expected',
        notes: 'never emit this private note',
      },
    });
    expect(ownerCreate.status(), await ownerCreate.text()).toBe(201);
    const ownerGoal = (await ownerCreate.json()) as {
      readonly id: string;
      readonly version: number;
    };

    const ownerItemCreate = await ownerContext.request.post('/api/v1/timing-lab/purchase-items', {
      headers: await mutationHeaders(ownerContext),
      data: {
        goalId: ownerGoal.id,
        fixtureCode: 'synthetic_oled_65_v1',
        currency: 'USD',
        targetPriceCents: 150_000,
      },
    });
    expect(ownerItemCreate.status(), await ownerItemCreate.text()).toBe(201);
    const ownerItem = (await ownerItemCreate.json()) as {
      readonly id: string;
      readonly version: number;
    };

    const ownerRead = await ownerContext.request.get(`/api/v1/goals/${ownerGoal.id}`);
    expect(ownerRead.status()).toBe(200);
    const ownerItemRead = await ownerContext.request.get(
      `/api/v1/timing-lab/purchase-items/${ownerItem.id}/latest`,
    );
    expect(ownerItemRead.status()).toBe(200);

    const deniedGoalRead = await otherContext.request.get(`/api/v1/goals/${ownerGoal.id}`);
    expect(deniedGoalRead.status()).toBe(404);
    const deniedGoalMutation = await otherContext.request.patch(`/api/v1/goals/${ownerGoal.id}`, {
      headers: await mutationHeaders(otherContext),
      data: { version: ownerGoal.version, name: 'Cross-owner mutation attempt' },
    });
    expect(deniedGoalMutation.status()).toBe(404);
    const deniedHistory = await otherContext.request.get(
      `/api/v1/goals/${ownerGoal.id}/plan/history`,
    );
    expect(deniedHistory.status()).toBe(404);
    const deniedReset = await otherContext.request.post('/api/v1/demo/reset', {
      headers: await mutationHeaders(otherContext),
      data: {
        goalId: ownerGoal.id,
        expectedGoalVersion: ownerGoal.version,
        confirmation: 'RESET_SEEDED_STORY_DEMO',
      },
    });
    expect(deniedReset.status()).toBe(404);
    const deniedAdvance = await otherContext.request.post('/api/v1/demo/advance', {
      headers: await mutationHeaders(otherContext),
      data: { goalId: ownerGoal.id, milestone: 'ONE_MONTH' },
    });
    expect(deniedAdvance.status()).toBe(403);
    const deniedItemRead = await otherContext.request.get(
      `/api/v1/timing-lab/purchase-items/${ownerItem.id}/latest`,
    );
    expect(deniedItemRead.status()).toBe(404);
    const deniedItemMutation = await otherContext.request.patch(
      `/api/v1/timing-lab/purchase-items/${ownerItem.id}`,
      {
        headers: await mutationHeaders(otherContext),
        data: { expectedVersion: ownerItem.version, targetPriceCents: 140_000 },
      },
    );
    expect(deniedItemMutation.status()).toBe(404);
    const isolatedItemList = await otherContext.request.get('/api/v1/timing-lab/purchase-items');
    expect(await isolatedItemList.json()).toEqual({ items: [] });

    const payloads: ProductEventPayload[] = [];
    const ownerPage = await ownerContext.newPage();
    const ownerPageServerErrors = attachUnexpectedServerErrorCollector(ownerPage);
    ownerPage.on('request', (request) => {
      if (!request.url().endsWith('/api/v1/product-events') || request.method() !== 'POST') return;
      const payload = request.postDataJSON() as ProductEventPayload;
      payloads.push(payload);
    });
    await ownerPage.goto('/plan');
    await ownerPage.getByLabel('Goal name').fill(privateGoalName);
    await ownerPage.getByLabel('Target amount').fill('12345');
    await ownerPage.getByLabel('Purchase date').fill(privateDate);
    await ownerPage.getByRole('button', { name: 'Continue' }).click();
    await ownerPage.getByLabel('Already saved').fill('2345');
    await ownerPage.getByRole('button', { name: 'Reveal my safe contribution' }).click();
    await expect.poll(() => payloads.length).toBeGreaterThanOrEqual(4);

    expect(payloads.filter((payload) => payload.eventName === 'builder_started')).toHaveLength(1);
    const allowedFields = new Set([
      'eventName',
      'demo',
      'applicationVersion',
      'builderStep',
      'vehicleCode',
      'rejectionCode',
      'changedDimension',
    ]);
    const prohibitedFields = new Set([
      'amount',
      'amountCents',
      'targetAmountCents',
      'currentSavedCents',
      'recurringContributionCents',
      'name',
      'notes',
      'date',
      'targetDate',
      'firstContributionDate',
      'email',
      'url',
      'goalId',
      'itemId',
      'accountId',
      'resourceId',
      'requestId',
      'sessionId',
      'metadata',
      'payload',
    ]);
    for (const payload of payloads) {
      expect(payload.demo).toBe(false);
      for (const field of Object.keys(payload)) {
        expect(allowedFields.has(field), `Unexpected telemetry field: ${field}`).toBe(true);
        expect(prohibitedFields.has(field), `Prohibited telemetry field: ${field}`).toBe(false);
      }
      const serialized = JSON.stringify(payload);
      expect(serialized).not.toContain(privateGoalName);
      expect(serialized).not.toContain(privateDate);
      expect(serialized).not.toContain('12345');
      expect(serialized).not.toContain('2345');
      expect(serialized).not.toContain(ownerEmail);
    }
    await drainTrackedApiRequests(ownerPage);
    expect(
      ownerPageServerErrors,
      'Journey E must not leave any unexpected API 5xx response in the background.',
    ).toEqual([]);
  } finally {
    await ownerContext.close();
    await otherContext.close();
  }
});
