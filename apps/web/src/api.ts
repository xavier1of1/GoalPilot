import type {
  AccountSummaryDto,
  ActivityDto,
  GoalDto,
  GoalInput,
  PreviewOutput,
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
  preview: (goal: GoalInput) =>
    request<PreviewOutput>('/api/v1/previews', { method: 'POST', body: JSON.stringify(goal) }),
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
  activate: (goalId: string, vehicleCode: VehicleCode) =>
    request<{ readonly account: AccountSummaryDto }>(`/api/v1/goals/${goalId}/activate`, {
      method: 'POST',
      body: JSON.stringify({ vehicleCode }),
    }),
  action: (goalId: string, action: 'pause' | 'resume' | 'complete' | 'archive') =>
    request<{ readonly goal: GoalDto }>(`/api/v1/goals/${goalId}/${action}`, { method: 'POST' }),
  contribute: (
    goalId: string,
    amountCents: number,
    effectiveDate: string,
    idempotencyKey: string = crypto.randomUUID(),
  ) =>
    request(`/api/v1/goals/${goalId}/contributions`, {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
      body: JSON.stringify({ amountCents, effectiveDate }),
    }),
  activity: (goalId: string) =>
    request<{ readonly activity: readonly ActivityDto[] }>(`/api/v1/goals/${goalId}/ledger`),
  exportData: async () => {
    const result = await request<{
      readonly requestId: string;
      readonly status: 'completed';
      readonly data: Readonly<Record<string, unknown>>;
    }>('/api/v1/data-exports', { method: 'POST' });
    return result.data;
  },
  deleteAccount: () =>
    request<{ readonly status: string }>('/api/v1/account-deletion', { method: 'POST' }),
};
