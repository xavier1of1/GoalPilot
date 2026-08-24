import type {
  AccountSummaryDto,
  ActivityDto,
  DemoAdvanceInput,
  DemoResetInput,
  DemoRunSummary,
  GoalArchiveInput,
  GoalDraft,
  GoalDraftActivateInput,
  GoalDraftCreateInput,
  GoalDraftUpdateInput,
  GoalDto,
  GoalInput,
  InitialPlanActivationOutput,
  PlanDecisionSummary,
  PlanHealthOutput,
  PlanHistoryOutput,
  PriceCheckRunSummary,
  PreviewOutput,
  ProductEventAcceptedOutput,
  ProductEventInput,
  PurchaseItem,
  PurchaseTimingLatestOutput,
  RecoveryOptionsOutput,
  SafeBaselineInput,
  SafeBaselineResponse,
  ScenarioApplyInput,
  ScenarioApplyOutput,
  ScenarioPreviewInput,
  ScenarioPreviewOutput,
  UserDto,
  VehicleCode,
} from '@goalpilot/contracts';

export class ApiClientError extends Error {
  public constructor(
    message: string,
    public readonly code: string,
    public readonly requestId: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

function csrfToken(): string | null {
  const cookie = document.cookie.split('; ').find((value) => value.startsWith('goalpilot_csrf='));
  return cookie === undefined ? null : decodeURIComponent(cookie.split('=').slice(1).join('='));
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  const csrf = csrfToken();
  if (csrf !== null && !['GET', 'HEAD'].includes(init.method ?? 'GET'))
    headers.set('x-csrf-token', csrf);
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers,
      credentials: 'include',
      signal: init.signal ?? AbortSignal.timeout(10_000),
    });
  } catch {
    throw new ApiClientError(
      'GoalPilot could not reach the local API. Check that pnpm dev is running.',
      'NETWORK_ERROR',
      'unavailable',
      0,
    );
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      readonly error?: {
        readonly code?: string;
        readonly message?: string;
        readonly requestId?: string;
      };
    } | null;
    throw new ApiClientError(
      body?.error?.message ?? 'The request could not be completed.',
      body?.error?.code ?? 'REQUEST_FAILED',
      body?.error?.requestId ?? response.headers.get('x-request-id') ?? 'unavailable',
      response.status,
    );
  }
  if (response.status === 204) return undefined as T; // A 204 response intentionally has no JSON body.
  return (await response.json()) as T; // The API validates response contracts at the service boundary.
}

export const api = {
  capabilities: () =>
    request<{
      readonly demoStory: boolean;
      readonly purchaseTimingLab: boolean;
      readonly applicationDate: string;
    }>('/api/v1/capabilities'),
  me: () => request<{ readonly user: UserDto }>('/api/v1/me'),
  login: (input: { readonly email: string; readonly password: string }) =>
    request<{ readonly user: UserDto }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  register: (input: {
    readonly email: string;
    readonly password: string;
    readonly displayName: string;
  }) =>
    request<{ readonly user: UserDto }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  logout: () => request<undefined>('/auth/logout', { method: 'POST' }),
  productEvent: (input: ProductEventInput, idempotencyKey: string = crypto.randomUUID()) =>
    request<ProductEventAcceptedOutput>('/api/v1/product-events', {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
      body: JSON.stringify(input),
    }),
  preview: (goal: GoalInput) =>
    request<PreviewOutput>('/api/v1/previews', { method: 'POST', body: JSON.stringify(goal) }),
  safeBaseline: (input: SafeBaselineInput) =>
    request<SafeBaselineResponse>('/api/v1/baselines', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  drafts: () => request<{ readonly drafts: readonly GoalDraft[] }>('/api/v1/goal-drafts'),
  draft: (draftId: string) => request<GoalDraft>(`/api/v1/goal-drafts/${draftId}`),
  createDraft: (input: GoalDraftCreateInput, idempotencyKey: string) =>
    request<GoalDraft>('/api/v1/goal-drafts', {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
      body: JSON.stringify(input),
    }),
  updateDraft: (draftId: string, input: GoalDraftUpdateInput, idempotencyKey: string) =>
    request<GoalDraft>(`/api/v1/goal-drafts/${draftId}`, {
      method: 'PATCH',
      headers: { 'idempotency-key': idempotencyKey },
      body: JSON.stringify(input),
    }),
  discardDraft: (draftId: string, expectedVersion: number, idempotencyKey: string) =>
    request<undefined>(`/api/v1/goal-drafts/${draftId}`, {
      method: 'DELETE',
      headers: { 'idempotency-key': idempotencyKey },
      body: JSON.stringify({ expectedVersion }),
    }),
  activateDraft: (draftId: string, input: GoalDraftActivateInput, idempotencyKey: string) =>
    request<InitialPlanActivationOutput>(`/api/v1/goal-drafts/${draftId}/activate`, {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
      body: JSON.stringify(input),
    }),
  goals: () => request<{ readonly goals: readonly GoalDto[] }>('/api/v1/goals'),
  goal: (goalId: string) =>
    request<{
      readonly goal: GoalDto;
      readonly account: AccountSummaryDto | null;
      readonly applicationDate: string;
    }>(`/api/v1/goals/${goalId}`),
  createGoal: (goal: GoalInput, idempotencyKey: string = crypto.randomUUID()) =>
    request<GoalDto>('/api/v1/goals', {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
      body: JSON.stringify(goal),
    }),
  activate: (
    goalId: string,
    vehicleCode: VehicleCode,
    expectedGoalVersion: number,
    idempotencyKey: string,
  ) =>
    request<{ readonly account: AccountSummaryDto }>(`/api/v1/goals/${goalId}/activate`, {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
      body: JSON.stringify({ vehicleCode, expectedGoalVersion }),
    }),
  action: (
    goalId: string,
    action: 'pause' | 'resume' | 'complete',
    expectedGoalVersion: number,
    idempotencyKey: string,
  ) =>
    request<{ readonly goal: GoalDto }>(`/api/v1/goals/${goalId}/${action}`, {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
      body: JSON.stringify({ expectedGoalVersion }),
    }),
  contribute: (
    goalId: string,
    amountCents: number,
    effectiveDate: string,
    idempotencyKey: string,
  ) =>
    request(`/api/v1/goals/${goalId}/contributions`, {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
      body: JSON.stringify({ amountCents, effectiveDate }),
    }),
  activity: (goalId: string) =>
    request<{ readonly activity: readonly ActivityDto[] }>(`/api/v1/goals/${goalId}/ledger`),
  planSummary: async (goalId: string) => {
    const result = await request<{
      readonly goalVersion: number;
      readonly planVersion: number;
      readonly summary: PlanDecisionSummary;
    }>(`/api/v1/goals/${goalId}/plan/summary`);
    return result.summary;
  },
  planHealth: (goalId: string) => request<PlanHealthOutput>(`/api/v1/goals/${goalId}/plan/health`),
  previewScenario: (goalId: string, input: ScenarioPreviewInput) =>
    request<ScenarioPreviewOutput>(`/api/v1/goals/${goalId}/what-if/preview`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  applyScenario: (goalId: string, input: ScenarioApplyInput, idempotencyKey: string) =>
    request<ScenarioApplyOutput>(`/api/v1/goals/${goalId}/what-if/apply`, {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
      body: JSON.stringify(input),
    }),
  recoveryOptions: (goalId: string) =>
    request<RecoveryOptionsOutput>(`/api/v1/goals/${goalId}/recovery`),
  applyRecovery: (goalId: string, input: ScenarioApplyInput, idempotencyKey: string) =>
    request<ScenarioApplyOutput>(`/api/v1/goals/${goalId}/recovery/apply`, {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
      body: JSON.stringify(input),
    }),
  planHistory: (goalId: string) =>
    request<PlanHistoryOutput>(`/api/v1/goals/${goalId}/plan/history`),
  archiveGoal: (goalId: string, input: GoalArchiveInput, idempotencyKey: string) =>
    request<{ readonly goal: GoalDto }>(`/api/v1/goals/${goalId}/archive`, {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
      body: JSON.stringify(input),
    }),
  advanceDemo: (input: DemoAdvanceInput, idempotencyKey: string = crypto.randomUUID()) =>
    request<DemoRunSummary>('/api/v1/demo/advance', {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(30_000),
    }),
  resetDemo: (input: DemoResetInput, idempotencyKey: string = crypto.randomUUID()) =>
    request<{ readonly reset: true }>('/api/v1/demo/reset', {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
      body: JSON.stringify(input),
    }),
  timingLabLatest: async (goalId: string) => {
    const { items } = await request<{ readonly items: readonly PurchaseItem[] }>(
      '/api/v1/timing-lab/purchase-items',
    );
    const item = items.find((candidate) => candidate.goalId === goalId);
    if (item === undefined) {
      throw new ApiClientError(
        'No Purchase Timing Lab item is attached to this goal.',
        'PURCHASE_ITEM_NOT_FOUND',
        'unavailable',
        404,
      );
    }
    return request<PurchaseTimingLatestOutput>(
      `/api/v1/timing-lab/purchase-items/${item.id}/latest`,
    );
  },
  runDuePriceChecks: (idempotencyKey: string) =>
    request<PriceCheckRunSummary>('/api/v1/timing-lab/run-due-price-checks', {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
      body: JSON.stringify({}),
    }),
  exportData: async (idempotencyKey: string = crypto.randomUUID()) => {
    const result = await request<{
      readonly requestId: string;
      readonly status: 'completed';
      readonly data: Readonly<Record<string, unknown>>;
    }>('/api/v1/data-exports', {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
      body: JSON.stringify({}),
    });
    return result.data;
  },
  deleteAccount: () =>
    request<{ readonly status: string }>('/api/v1/account-deletion', { method: 'POST' }),
};

/** Product telemetry is best-effort and must never interrupt the user workflow it describes. */
export function trackProductEvent(input: ProductEventInput): void {
  void Promise.resolve()
    .then(() => api.productEvent(input))
    .catch(() => undefined);
}
