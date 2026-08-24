// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from './api.js';

describe('privacy-safe product event client', () => {
  afterEach(() => {
    document.cookie = 'goalpilot_csrf=; Max-Age=0; path=/';
    vi.unstubAllGlobals();
  });

  it('posts only the closed contract shape with CSRF and an idempotency key', async () => {
    document.cookie = 'goalpilot_csrf=csrf-token; path=/';
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      status: 202,
      headers: new Headers(),
      json: () => Promise.resolve({ accepted: true }),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);
    const event = {
      eventName: 'what_if_previewed',
      changedDimension: 'DEADLINE',
      demo: true,
      applicationVersion: 'product-experience-v1',
    } as const;

    await expect(api.productEvent(event, 'telemetry-test-key')).resolves.toEqual({
      accepted: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0] ?? [];
    expect(path).toBe('/api/v1/product-events');
    expect(init).toMatchObject({ method: 'POST', credentials: 'include' });
    const headers = new Headers(init?.headers);
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('idempotency-key')).toBe('telemetry-test-key');
    expect(headers.get('x-csrf-token')).toBe('csrf-token');
    if (typeof init?.body !== 'string') throw new Error('Expected a JSON request body.');
    const payload = JSON.parse(init.body) as Record<string, unknown>;
    expect(payload).toEqual(event);
    expect(Object.keys(payload).sort()).toEqual(
      ['applicationVersion', 'changedDimension', 'demo', 'eventName'].sort(),
    );
    expect(payload).not.toHaveProperty('amountCents');
    expect(payload).not.toHaveProperty('goalId');
    expect(payload).not.toHaveProperty('notes');
    expect(payload).not.toHaveProperty('url');
  });

  it('runs the fixture-only due-price routine with an empty body and idempotency key', async () => {
    const summary = {
      asOfDate: '2026-08-23',
      status: 'no_due_policies',
      duePolicyCount: 0,
      completedRunCount: 0,
      inProgressRunCount: 0,
      replayedRunCount: 0,
      failedRunCount: 0,
      observationsInserted: 0,
      assessmentsCreated: 0,
      errorCodes: [],
    } as const;
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: () => Promise.resolve(summary),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.runDuePriceChecks('price-check-test-key')).resolves.toEqual(summary);

    const [path, init] = fetchMock.mock.calls[0] ?? [];
    expect(path).toBe('/api/v1/timing-lab/run-due-price-checks');
    expect(init).toMatchObject({ method: 'POST', body: '{}' });
    expect(new Headers(init?.headers).get('idempotency-key')).toBe('price-check-test-key');
  });

  it('gives an idempotent demo advance enough time to finish', async () => {
    const summary = {
      fromDate: '2026-08-23',
      toDate: '2028-02-23',
      contributionsPosted: 18,
      interestPostings: 549,
      modeledInterestAddedCents: 4_217,
      maturityEvents: 0,
      health: 'ON_TRACK',
    } as const;
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: () => Promise.resolve(summary),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);
    const timeoutSignal = new AbortController().signal;
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutSignal);

    await expect(
      api.advanceDemo({ goalId: 'goal-id', milestone: 'TARGET_DATE' }, 'demo-advance-test-key'),
    ).resolves.toEqual(summary);

    expect(timeoutSpy).toHaveBeenCalledWith(30_000);
    const [path, init] = fetchMock.mock.calls[0] ?? [];
    expect(path).toBe('/api/v1/demo/advance');
    expect(init).toMatchObject({
      method: 'POST',
      body: '{"goalId":"goal-id","milestone":"TARGET_DATE"}',
      signal: timeoutSignal,
    });
    expect(new Headers(init?.headers).get('idempotency-key')).toBe('demo-advance-test-key');
  });

  it('forwards caller-owned keys through create, update, discard, and activation draft requests', async () => {
    const jsonResponse = {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: () => Promise.resolve({}),
    } as Response;
    const noContentResponse = {
      ok: true,
      status: 204,
      headers: new Headers(),
    } as Response;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse)
      .mockResolvedValueOnce(jsonResponse)
      .mockResolvedValueOnce(noContentResponse)
      .mockResolvedValueOnce(jsonResponse);
    vi.stubGlobal('fetch', fetchMock);
    const data = { name: 'Japan trip' } as const;

    await api.createDraft({ data, lastCompletedStep: null }, 'draft-create-key');
    await api.updateDraft(
      'draft-id',
      { expectedVersion: 1, data, lastCompletedStep: 'goal' },
      'draft-update-key',
    );
    await api.discardDraft('draft-id', 2, 'draft-discard-key');
    await api.activateDraft(
      'draft-id',
      { expectedDraftVersion: 2, vehicleCode: 'hysa' },
      'draft-activate-key',
    );

    expect(
      fetchMock.mock.calls.map(([path, init]) => ({
        path,
        method: init?.method,
        key: new Headers(init?.headers).get('idempotency-key'),
      })),
    ).toEqual([
      { path: '/api/v1/goal-drafts', method: 'POST', key: 'draft-create-key' },
      { path: '/api/v1/goal-drafts/draft-id', method: 'PATCH', key: 'draft-update-key' },
      { path: '/api/v1/goal-drafts/draft-id', method: 'DELETE', key: 'draft-discard-key' },
      {
        path: '/api/v1/goal-drafts/draft-id/activate',
        method: 'POST',
        key: 'draft-activate-key',
      },
    ]);
  });

  it('sends lifecycle concurrency and idempotency controls in the request', async () => {
    document.cookie = 'goalpilot_csrf=csrf-token; path=/';
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: () => Promise.resolve({ goal: { id: 'goal-id', version: 4 } }),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);

    await api.action('goal-id', 'complete', 3, 'lifecycle-test-key');

    const [path, init] = fetchMock.mock.calls[0] ?? [];
    expect(path).toBe('/api/v1/goals/goal-id/complete');
    expect(init).toMatchObject({ method: 'POST', body: '{"expectedGoalVersion":3}' });
    const headers = new Headers(init?.headers);
    expect(headers.get('idempotency-key')).toBe('lifecycle-test-key');
    expect(headers.get('x-csrf-token')).toBe('csrf-token');
  });

  it('uses the dedicated recovery endpoint so history records recovery provenance', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      status: 201,
      headers: new Headers(),
      json: () => Promise.resolve({ goalVersion: 3, planVersion: 3 }),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);
    const input = {
      expectedGoalVersion: 2,
      expectedPlanVersion: 2,
      change: { changedDimension: 'DEADLINE', targetDate: '2028-03-23' },
    } as const;

    await api.applyRecovery('goal-id', input, 'recovery-test-key');

    const [path, init] = fetchMock.mock.calls[0] ?? [];
    expect(path).toBe('/api/v1/goals/goal-id/recovery/apply');
    expect(init).toMatchObject({ method: 'POST', body: JSON.stringify(input) });
    expect(new Headers(init?.headers).get('idempotency-key')).toBe('recovery-test-key');
  });

  it('sends an empty idempotent export request', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      status: 201,
      headers: new Headers(),
      json: () => Promise.resolve({ status: 'completed', data: { goals: [] } }),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);

    await api.exportData('export-test-key');

    const [path, init] = fetchMock.mock.calls[0] ?? [];
    expect(path).toBe('/api/v1/data-exports');
    expect(init).toMatchObject({ method: 'POST', body: '{}' });
    expect(new Headers(init?.headers).get('idempotency-key')).toBe('export-test-key');
  });
});
