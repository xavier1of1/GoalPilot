import { spawn, type ChildProcess } from 'node:child_process';
import { connect } from 'node:net';
import { resolve } from 'node:path';

const API_PORT = 3100;
const WEB_PORT = 5273;
const STARTUP_TIMEOUT_MS = 60_000;
const SHUTDOWN_TIMEOUT_MS = 10_000;

function childExit(
  child: ChildProcess,
): Promise<{ readonly code: number | null; readonly signal: string | null }> {
  return new Promise((resolvePromise) => {
    child.once('exit', (code, signal) => resolvePromise({ code, signal }));
  });
}

function startNode(
  arguments_: readonly string[],
  environment: Readonly<Record<string, string>>,
): ChildProcess {
  return spawn(process.execPath, arguments_, {
    cwd: process.cwd(),
    env: { ...process.env, ...environment },
    stdio: 'inherit',
    windowsHide: true,
  });
}

async function waitForHttp(url: string, label: string, children: readonly ChildProcess[]) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  let lastFailure = 'not attempted';
  while (Date.now() < deadline) {
    const stopped = children.find((child) => child.exitCode !== null || child.signalCode !== null);
    if (stopped !== undefined)
      throw new Error(`${label} could not start because a managed E2E service exited.`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
      lastFailure = `HTTP ${String(response.status)}`;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`${label} did not become ready (${lastFailure}).`);
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return Promise.race([
    childExit(child).then(() => true),
    new Promise<boolean>((resolvePromise) => setTimeout(() => resolvePromise(false), timeoutMs)),
  ]);
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  if (await waitForExit(child, SHUTDOWN_TIMEOUT_MS)) return;
  child.kill('SIGKILL');
  if (!(await waitForExit(child, SHUTDOWN_TIMEOUT_MS)))
    throw new Error(`Managed E2E process ${String(child.pid)} did not stop.`);
}

async function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.setTimeout(500);
    socket.once('connect', () => {
      socket.destroy();
      resolvePromise(true);
    });
    const close = (): void => {
      socket.destroy();
      resolvePromise(false);
    };
    socket.once('error', close);
    socket.once('timeout', close);
  });
}

async function assertPortClosed(port: number): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (!(await isPortOpen(port))) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
  }
  throw new Error(`E2E port ${String(port)} remained open after shutdown.`);
}

export async function runE2e(arguments_: readonly string[]): Promise<void> {
  const api = startNode(['--conditions=development', '--import', 'tsx', 'apps/api/src/server.ts'], {
    ENVIRONMENT: 'test',
    NODE_ENV: 'test',
    TEST_RATE_LIMIT_MAX: '2000',
    DEMO_STORY_ENABLED: 'true',
    PURCHASE_TIMING_LAB_ENABLED: 'true',
    API_PORT: String(API_PORT),
    API_ORIGIN: `http://localhost:${String(API_PORT)}`,
    WEB_ORIGIN: `http://localhost:${String(WEB_PORT)}`,
  });
  const web = startNode(
    [
      'apps/web/node_modules/vite/bin/vite.js',
      'apps/web',
      '--host',
      '127.0.0.1',
      '--port',
      String(WEB_PORT),
    ],
    {
      GOALPILOT_WEB_PORT: String(WEB_PORT),
      GOALPILOT_API_PROXY_ORIGIN: `http://localhost:${String(API_PORT)}`,
    },
  );
  const services = [api, web] as const;
  let failure: unknown = null;
  try {
    await Promise.all([
      waitForHttp(`http://127.0.0.1:${String(API_PORT)}/health/ready`, 'E2E API', services),
      waitForHttp(`http://127.0.0.1:${String(WEB_PORT)}`, 'E2E web', services),
    ]);
    const playwright = startNode(
      [resolve('node_modules/@playwright/test/cli.js'), 'test', ...arguments_],
      {
        GOALPILOT_E2E_EXTERNAL_SERVERS: 'true',
      },
    );
    const result = await childExit(playwright);
    if (result.code !== 0)
      throw new Error(
        `Playwright failed with ${result.code === null ? `signal ${result.signal ?? 'unknown'}` : `exit code ${String(result.code)}`}.`,
      );
  } catch (error) {
    failure = error;
  }

  const shutdownErrors: unknown[] = [];
  for (const child of services) {
    try {
      await stopChild(child);
    } catch (error) {
      shutdownErrors.push(error);
    }
  }
  for (const port of [API_PORT, WEB_PORT]) {
    try {
      await assertPortClosed(port);
    } catch (error) {
      shutdownErrors.push(error);
    }
  }
  if (failure !== null || shutdownErrors.length > 0)
    throw new AggregateError(
      failure === null ? shutdownErrors : [failure, ...shutdownErrors],
      'GoalPilot E2E execution failed.',
    );
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve('scripts/run-e2e.ts')) {
  runE2e(process.argv.slice(2)).catch((error: unknown) => {
    const message =
      error instanceof AggregateError
        ? error.errors
            .map((item) => (item instanceof Error ? item.message : String(item)))
            .join(' | ')
        : error instanceof Error
          ? error.message
          : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
