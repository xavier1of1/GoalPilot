import { spawn, type ChildProcess } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { connect } from 'node:net';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { DEFAULT_RELEASE_API_PORT, DEFAULT_RELEASE_WEB_PORT } from './local-release.js';

interface SmokeOptions {
  readonly apiPort: number;
  readonly webPort: number;
}

interface JsonResponse {
  readonly response: Response;
  readonly body: unknown;
}

const LOOPBACK_HOST = '127.0.0.1';
const STARTUP_TIMEOUT_MS = 120_000;
const SHUTDOWN_TIMEOUT_MS = 15_000;
const JAPAN_GOAL_NAME = 'Japan trip';
const DEMO_EMAIL = 'demo.japan@example.test';
const DEMO_PASSWORD = 'GoalPilot-Demo-2026!';
const TIMING_ITEMS_PATH = '/api/v1/timing-lab/purchase-items';
const TIMING_LATEST_TEMPLATE = '/api/v1/timing-lab/purchase-items/{itemId}/latest';
const TIMING_RUN_PATH = '/api/v1/timing-lab/run-due-price-checks';

function parsePort(value: string | undefined, flag: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1_024 || port > 65_535) {
    throw new Error(`${flag} must be an integer from 1024 through 65535.`);
  }
  return port;
}

export function parseSmokeArguments(arguments_: readonly string[]): SmokeOptions {
  let apiPort = DEFAULT_RELEASE_API_PORT;
  let webPort = DEFAULT_RELEASE_WEB_PORT;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--api-port') {
      apiPort = parsePort(arguments_[index + 1], '--api-port');
      index += 1;
    } else if (argument === '--web-port') {
      webPort = parsePort(arguments_[index + 1], '--web-port');
      index += 1;
    } else {
      throw new Error(`Unknown local smoke argument: ${String(argument)}`);
    }
  }
  if (apiPort === webPort) throw new Error('Smoke API and web ports must be different.');
  if ([3_000, 5_173].includes(apiPort) || [3_000, 5_173].includes(webPort)) {
    throw new Error(
      'Smoke ports must be dedicated and cannot reuse development ports 3000 or 5173.',
    );
  }
  return { apiPort, webPort };
}

function record(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function stringField(
  value: Readonly<Record<string, unknown>>,
  field: string,
  label: string,
): string {
  const selected = value[field];
  if (typeof selected !== 'string') throw new Error(`${label}.${field} must be a string.`);
  return selected;
}

function numberField(
  value: Readonly<Record<string, unknown>>,
  field: string,
  label: string,
): number {
  const selected = value[field];
  if (typeof selected !== 'number' || !Number.isFinite(selected)) {
    throw new Error(`${label}.${field} must be a finite number.`);
  }
  return selected;
}

function arrayField(
  value: Readonly<Record<string, unknown>>,
  field: string,
  label: string,
): readonly unknown[] {
  const selected = value[field];
  if (!Array.isArray(selected)) throw new Error(`${label}.${field} must be an array.`);
  return selected;
}

function requireEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(
      `${label} expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`,
    );
  }
}

async function jsonResponse(
  url: string,
  label: string,
  init: RequestInit = {},
  expectedStatus = 200,
): Promise<JsonResponse> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'request failed';
    throw new Error(`${label} request failed at ${url}: ${message}`, { cause: error });
  }
  const text = await response.text();
  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text) as unknown;
    } catch (error) {
      throw new Error(
        `${label} returned non-JSON HTTP ${String(response.status)}: ${text.slice(0, 300)}`,
        { cause: error },
      );
    }
  }
  if (response.status !== expectedStatus) {
    throw new Error(
      `${label} expected HTTP ${String(expectedStatus)}, received ${String(response.status)}: ${JSON.stringify(body).slice(0, 500)}`,
    );
  }
  return { response, body };
}

export function cookiePairs(setCookieHeaders: readonly string[]): readonly string[] {
  return setCookieHeaders.map((header) => {
    const pair = header.split(';', 1)[0]?.trim();
    if (!pair?.includes('=')) {
      throw new Error(`Invalid Set-Cookie header: ${header}`);
    }
    return pair;
  });
}

class SmokeSession {
  readonly #cookies = new Map<string, string>();
  #csrfToken: string | null = null;

  public constructor(
    private readonly baseUrl: string,
    private readonly webOrigin: string,
  ) {}

  public async request(
    path: string,
    label: string,
    options: {
      readonly method?: 'GET' | 'POST';
      readonly body?: unknown;
      readonly expectedStatus?: number;
      readonly idempotencyKey?: string;
    } = {},
  ): Promise<unknown> {
    const method = options.method ?? 'GET';
    const headers = new Headers();
    if (this.#cookies.size > 0) {
      headers.set(
        'cookie',
        [...this.#cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; '),
      );
    }
    if (method !== 'GET') {
      headers.set('origin', this.webOrigin);
      headers.set('content-type', 'application/json');
      if (this.#csrfToken !== null) headers.set('x-csrf-token', this.#csrfToken);
      if (options.idempotencyKey !== undefined) {
        headers.set('idempotency-key', options.idempotencyKey);
      }
    }
    const init: RequestInit = { method, headers };
    if (options.body !== undefined) init.body = JSON.stringify(options.body);
    const result = await jsonResponse(
      `${this.baseUrl}${path}`,
      label,
      init,
      options.expectedStatus ?? 200,
    );
    const setCookies = result.response.headers.getSetCookie();
    for (const pair of cookiePairs(setCookies)) {
      const separator = pair.indexOf('=');
      this.#cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    return result.body;
  }

  public setCsrfToken(value: string): void {
    this.#csrfToken = value;
  }
}

export function assertNoAwsDependencyNames(names: readonly string[]): void {
  const forbidden = names.filter((name) => /(^|[/@_-])aws([/._-]|$)|amazon/i.test(name));
  if (forbidden.length > 0) {
    throw new Error(`AWS runtime dependencies are forbidden: ${forbidden.sort().join(', ')}`);
  }
}

async function assertNoAwsRuntimeDependencies(): Promise<void> {
  const manifests = ['apps/api/package.json'];
  const packageDirectories = await readdir('packages', { withFileTypes: true });
  manifests.push(
    ...packageDirectories
      .filter((entry) => entry.isDirectory())
      .map((entry) => `packages/${entry.name}/package.json`),
  );
  const names: string[] = [];
  for (const manifestPath of manifests) {
    const manifest = record(
      JSON.parse(await readFile(manifestPath, 'utf8')) as unknown,
      manifestPath,
    );
    for (const field of ['dependencies', 'optionalDependencies'] as const) {
      const dependencies = manifest[field];
      if (dependencies !== undefined)
        names.push(...Object.keys(record(dependencies, `${manifestPath}.${field}`)));
    }
  }
  assertNoAwsDependencyNames(names);
}

function spawnDemoRelease(options: SmokeOptions): ChildProcess {
  const tsxEntry = resolve('node_modules/tsx/dist/cli.mjs');
  const releaseEntry = resolve('scripts/local-release.ts');
  return spawn(
    process.execPath,
    [
      tsxEntry,
      releaseEntry,
      '--mode',
      'demo',
      '--api-port',
      String(options.apiPort),
      '--web-port',
      String(options.webPort),
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
      shell: false,
      windowsHide: true,
    },
  );
}

async function waitForService(url: string, label: string, release: ChildProcess): Promise<void> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  let lastFailure = 'no response';
  while (Date.now() < deadline) {
    if (release.exitCode !== null || release.signalCode !== null) {
      throw new Error(
        `${label} did not start because demo release exited (${release.signalCode ?? String(release.exitCode)}).`,
      );
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
      lastFailure = `HTTP ${String(response.status)}`;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : 'request failed';
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`${label} did not become available at ${url} (${lastFailure}).`);
}

function isPortOpen(port: number): Promise<boolean> {
  return new Promise<boolean>((resolvePromise) => {
    const socket = connect({ host: LOOPBACK_HOST, port });
    socket.setTimeout(500);
    socket.once('connect', () => {
      socket.destroy();
      resolvePromise(true);
    });
    const closed = (): void => {
      socket.destroy();
      resolvePromise(false);
    };
    socket.once('error', closed);
    socket.once('timeout', closed);
  });
}

async function assertPortClosed(port: number, label: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (!(await isPortOpen(port))) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
  }
  throw new Error(`${label} port ${String(port)} remained open after smoke shutdown.`);
}

async function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise<boolean>((resolvePromise) => {
    const timeout = setTimeout(() => resolvePromise(false), timeoutMs);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolvePromise(true);
    });
  });
}

function childExitState(child: ChildProcess): {
  readonly exitCode: number | null;
  readonly signalCode: NodeJS.Signals | null;
} {
  return { exitCode: child.exitCode, signalCode: child.signalCode };
}

async function stopRelease(release: ChildProcess): Promise<void> {
  const alreadyStopped = release.exitCode !== null || release.signalCode !== null;
  if (!alreadyStopped) release.kill('SIGTERM');
  if (!(await waitForChildExit(release, SHUTDOWN_TIMEOUT_MS))) {
    release.kill('SIGKILL');
    await waitForChildExit(release, 5_000);
    throw new Error('Demo release ignored SIGTERM and required forced termination.');
  }
  const finalState = childExitState(release);
  if (
    !alreadyStopped &&
    finalState.exitCode !== null &&
    finalState.exitCode !== 0 &&
    finalState.signalCode === null
  ) {
    throw new Error(
      `Demo release exited with code ${String(finalState.exitCode)} during smoke shutdown.`,
    );
  }
}

function openApiPaths(value: unknown): Readonly<Record<string, unknown>> {
  const document = record(value, 'OpenAPI document');
  return record(document['paths'], 'OpenAPI document.paths');
}

function requireOpenApiOperation(
  paths: Readonly<Record<string, unknown>>,
  path: string,
  method: 'get' | 'post',
): void {
  const pathDefinition = paths[path];
  if (pathDefinition === undefined) {
    throw new Error(`Demo smoke requires OpenAPI path ${path}.`);
  }
  const methods = record(pathDefinition, `OpenAPI path ${path}`);
  if (methods[method] === undefined) {
    throw new Error(`Demo smoke requires ${method.toUpperCase()} ${path}.`);
  }
  record(methods[method], `OpenAPI operation ${method.toUpperCase()} ${path}`);
}

export function assertTimingLabOpenApiPaths(paths: Readonly<Record<string, unknown>>): void {
  requireOpenApiOperation(paths, TIMING_ITEMS_PATH, 'get');
  requireOpenApiOperation(paths, TIMING_RUN_PATH, 'post');
  requireOpenApiOperation(paths, TIMING_LATEST_TEMPLATE, 'get');
}

export function assertTimingLabRunCreatedAssessment(value: unknown): void {
  const run = record(value, 'Due Timing Lab price-check run');
  requireEqual(run['status'], 'completed', 'Due Timing Lab price-check run status');
  const duePolicyCount = numberField(run, 'duePolicyCount', 'Due Timing Lab price-check run');
  const completedRunCount = numberField(run, 'completedRunCount', 'Due Timing Lab price-check run');
  const failedRunCount = numberField(run, 'failedRunCount', 'Due Timing Lab price-check run');
  const assessmentsCreated = numberField(
    run,
    'assessmentsCreated',
    'Due Timing Lab price-check run',
  );
  if (duePolicyCount < 1 || completedRunCount < 1 || assessmentsCreated < 1) {
    throw new Error(
      'Timing Lab smoke requires a due policy, a completed check, and a newly created assessment.',
    );
  }
  requireEqual(failedRunCount, 0, 'Due Timing Lab failed run count');
}

export function timingLabFixtureItemId(value: unknown, goalId: string): string {
  const response = record(value, 'Timing Lab fixture items');
  const items = arrayField(response, 'items', 'Timing Lab fixture items').map((item, index) =>
    record(item, `Timing items[${String(index)}]`),
  );
  const item = items.find(
    (candidate) =>
      candidate['goalId'] === goalId && candidate['fixtureCode'] === 'synthetic_oled_65_v1',
  );
  if (item === undefined) throw new Error('Timing Lab is missing the seeded synthetic OLED item.');
  return stringField(item, 'id', 'Timing Lab fixture item');
}

export function assertLatestTimingLabAssessment(value: unknown, itemId: string): void {
  const latest = record(value, 'Latest Timing Lab assessment');
  const latestItem = record(latest['item'], 'Latest Timing Lab assessment.item');
  requireEqual(latestItem['id'], itemId, 'Latest Timing Lab item');
  const assessment = latest['assessment'];
  if (assessment === null || assessment === undefined) {
    throw new Error('Timing Lab run route completed without producing a latest assessment.');
  }
  record(assessment, 'Latest Timing Lab assessment.assessment');
}

async function exerciseProductFlow(apiOrigin: string, webOrigin: string): Promise<void> {
  const root = await fetch(webOrigin, { signal: AbortSignal.timeout(10_000) });
  const html = await root.text();
  if (!root.ok || !html.includes('id="root"')) {
    throw new Error(`Built web preview is invalid at ${webOrigin} (HTTP ${String(root.status)}).`);
  }

  const live = record(
    (await jsonResponse(`${apiOrigin}/health/live`, 'API live')).body,
    'API live',
  );
  requireEqual(live['status'], 'live', 'API live status');
  const ready = record(
    (await jsonResponse(`${apiOrigin}/health/ready`, 'API readiness')).body,
    'API readiness',
  );
  requireEqual(ready['status'], 'ready', 'API readiness status');
  requireEqual(ready['database'], 'ready', 'API database readiness');
  const proxyLive = record(
    (await jsonResponse(`${webOrigin}/health/live`, 'Web health proxy')).body,
    'Web health proxy',
  );
  requireEqual(proxyLive['status'], 'live', 'Web health proxy status');

  const session = new SmokeSession(webOrigin, webOrigin);
  const rejection = record(
    await session.request('/api/v1/goals', 'Anonymous auth rejection', {
      expectedStatus: 401,
    }),
    'Anonymous auth rejection',
  );
  const rejectionError = record(rejection['error'], 'Anonymous auth rejection.error');
  requireEqual(rejectionError['code'], 'AUTHENTICATION_REQUIRED', 'Anonymous rejection code');

  const login = record(
    await session.request('/auth/login', 'Dedicated demo login', {
      method: 'POST',
      body: { email: DEMO_EMAIL, password: DEMO_PASSWORD },
    }),
    'Dedicated demo login',
  );
  const user = record(login['user'], 'Dedicated demo login.user');
  requireEqual(user['email'], DEMO_EMAIL, 'Dedicated demo identity');
  session.setCsrfToken(stringField(login, 'csrfToken', 'Dedicated demo login'));

  const capabilities = record(
    await session.request('/api/v1/capabilities', 'Demo capabilities'),
    'Demo capabilities',
  );
  requireEqual(capabilities['demoStory'], true, 'Demo Story capability');
  requireEqual(capabilities['purchaseTimingLab'], true, 'Timing Lab capability');

  const goalsResponse = record(
    await session.request('/api/v1/goals', 'Japan goal list'),
    'Goal list',
  );
  const goals = arrayField(goalsResponse, 'goals', 'Goal list').map((goal, index) =>
    record(goal, `Goal list.goals[${String(index)}]`),
  );
  const goal = goals.find((candidate) => candidate['name'] === JAPAN_GOAL_NAME);
  if (goal === undefined) {
    throw new Error(`Dedicated demo identity is missing the seeded "${JAPAN_GOAL_NAME}" goal.`);
  }
  const goalId = stringField(goal, 'id', 'Japan goal');
  requireEqual(goal['targetDate'], '2028-02-23', 'Japan target date');
  requireEqual(goal['recurringContributionCents'], 40_050, 'Japan affordable contribution');

  const previewInput = {
    name: stringField(goal, 'name', 'Japan goal'),
    category: goal['category'],
    targetAmountCents: numberField(goal, 'targetAmountCents', 'Japan goal'),
    currentSavedCents: numberField(goal, 'currentSavedCents', 'Japan goal'),
    targetDate: stringField(goal, 'targetDate', 'Japan goal'),
    recurringContributionCents: numberField(goal, 'recurringContributionCents', 'Japan goal'),
    contributionCadence: stringField(goal, 'contributionCadence', 'Japan goal'),
    liquidityNeed: stringField(goal, 'liquidityNeed', 'Japan goal'),
    preservationPreference: stringField(goal, 'preservationPreference', 'Japan goal'),
    confidence: stringField(goal, 'confidence', 'Japan goal'),
    notes: goal['notes'],
  };
  const preview = record(
    await session.request('/api/v1/previews', 'Japan plan preview', {
      method: 'POST',
      body: previewInput,
    }),
    'Japan plan preview',
  );
  requireEqual(arrayField(preview, 'vehicles', 'Japan plan preview').length, 4, 'Vehicle count');
  requireEqual(preview['recommendedVehicleCode'], 'hysa', 'Japan recommended vehicle');
  const baseline = record(
    preview['zeroInterestBaseline'],
    'Japan plan preview.zeroInterestBaseline',
  );
  requireEqual(baseline['requiredContributionCents'], 41_667, 'Japan safe contribution');

  const plan = record(
    await session.request(`/api/v1/goals/${goalId}/plan/summary`, 'Current Japan plan'),
    'Current Japan plan',
  );
  const goalVersion = numberField(plan, 'goalVersion', 'Current Japan plan');
  const planVersion = numberField(plan, 'planVersion', 'Current Japan plan');
  const summary = record(plan['summary'], 'Current Japan plan.summary');
  requireEqual(summary['safeContributionCents'], 41_667, 'Current Japan safe contribution');
  requireEqual(summary['chosenContributionCents'], 40_050, 'Current Japan chosen contribution');

  const whatIf = record(
    await session.request(`/api/v1/goals/${goalId}/what-if/preview`, 'What-If preview', {
      method: 'POST',
      body: {
        expectedGoalVersion: goalVersion,
        expectedPlanVersion: planVersion,
        change: { changedDimension: 'CONTRIBUTION', recurringContributionCents: 41_667 },
      },
    }),
    'What-If preview',
  );
  const comparison = record(whatIf['comparison'], 'What-If preview.comparison');
  requireEqual(comparison['changedDimension'], 'CONTRIBUTION', 'What-If changed dimension');
  record(comparison['current'], 'What-If current plan');
  const proposed = record(comparison['proposed'], 'What-If proposed plan');
  requireEqual(proposed['chosenContributionCents'], 41_667, 'What-If proposed contribution');

  const openApi = openApiPaths(
    (await jsonResponse(`${apiOrigin}/docs/json`, 'OpenAPI route discovery')).body,
  );
  assertTimingLabOpenApiPaths(openApi);
  const itemsResponse = await session.request(TIMING_ITEMS_PATH, 'Timing Lab fixture items');
  const itemId = timingLabFixtureItemId(itemsResponse, goalId);
  const run = await session.request(TIMING_RUN_PATH, 'Due Timing Lab price-check run', {
    method: 'POST',
    body: {},
    idempotencyKey: `smoke-timing-${crypto.randomUUID()}`,
  });
  assertTimingLabRunCreatedAssessment(run);
  const latestPath = TIMING_LATEST_TEMPLATE.replace('{itemId}', itemId);
  const latest = await session.request(latestPath, 'Latest Timing Lab assessment');
  assertLatestTimingLabAssessment(latest, itemId);
}

export async function runLocalSmoke(options: SmokeOptions): Promise<void> {
  await assertNoAwsRuntimeDependencies();
  const apiOrigin = `http://${LOOPBACK_HOST}:${String(options.apiPort)}`;
  const webOrigin = `http://${LOOPBACK_HOST}:${String(options.webPort)}`;
  const release = spawnDemoRelease(options);
  let primaryError: unknown = null;
  try {
    await Promise.all([
      waitForService(`${apiOrigin}/health/live`, 'Built API', release),
      waitForService(webOrigin, 'Built web preview', release),
    ]);
    await exerciseProductFlow(apiOrigin, webOrigin);
  } catch (error) {
    primaryError = error;
  }

  const shutdownErrors: unknown[] = [];
  try {
    await stopRelease(release);
  } catch (error) {
    shutdownErrors.push(error);
  }
  for (const [port, label] of [
    [options.apiPort, 'API'],
    [options.webPort, 'Web preview'],
  ] as const) {
    try {
      await assertPortClosed(port, label);
    } catch (error) {
      shutdownErrors.push(error);
    }
  }
  if (primaryError !== null || shutdownErrors.length > 0) {
    const errors = primaryError === null ? shutdownErrors : [primaryError, ...shutdownErrors];
    throw new AggregateError(errors, 'GoalPilot local smoke failed.');
  }
  process.stdout.write(
    `GOALPILOT_SMOKE_PASSED ${JSON.stringify({
      mode: 'demo',
      webOrigin,
      apiOrigin,
      japanGoal: true,
      planPreview: true,
      scenarioPreview: true,
      priceAssessment: true,
      aws: 'disabled',
      portsClosed: true,
    })}\n`,
  );
}

function isEntrypoint(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && pathToFileURL(resolve(entry)).href === import.meta.url;
}

if (isEntrypoint()) {
  runLocalSmoke(parseSmokeArguments(process.argv.slice(2))).catch((error: unknown) => {
    const message =
      error instanceof AggregateError
        ? error.errors
            .map((item) => (item instanceof Error ? item.message : String(item)))
            .join(' | ')
        : error instanceof Error
          ? error.message
          : 'Unknown smoke failure';
    process.stderr.write(`Local smoke failed: ${message}\n`);
    process.exitCode = 1;
  });
}
