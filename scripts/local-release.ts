import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { checkDatabase, createDatabaseClient } from '@goalpilot/data-access';

import { loadLocalEnvironment } from './runtime-config.js';

export type ReleaseMode = 'local' | 'demo';

export interface ReleaseOptions {
  readonly mode: ReleaseMode;
  readonly apiPort: number;
  readonly webPort: number;
}

export const DEFAULT_RELEASE_API_PORT = 3200;
export const DEFAULT_RELEASE_WEB_PORT = 5373;
const LOOPBACK_HOST = '127.0.0.1';
const STARTUP_TIMEOUT_MS = 90_000;
const CHILD_SHUTDOWN_TIMEOUT_MS = 5_000;

function parsePort(value: string | undefined, flag: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1_024 || port > 65_535) {
    throw new Error(`${flag} must be an integer from 1024 through 65535.`);
  }
  return port;
}

export function parseReleaseArguments(arguments_: readonly string[]): ReleaseOptions {
  let mode: ReleaseMode | null = null;
  let apiPort = DEFAULT_RELEASE_API_PORT;
  let webPort = DEFAULT_RELEASE_WEB_PORT;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    switch (argument) {
      case '--mode': {
        const value = arguments_[index + 1];
        if (value !== 'local' && value !== 'demo') {
          throw new Error('--mode must be exactly "local" or "demo".');
        }
        mode = value;
        index += 1;
        break;
      }
      case '--api-port':
        apiPort = parsePort(arguments_[index + 1], '--api-port');
        index += 1;
        break;
      case '--web-port':
        webPort = parsePort(arguments_[index + 1], '--web-port');
        index += 1;
        break;
      default:
        throw new Error(`Unknown local release argument: ${argument ?? '<missing>'}`);
    }
  }
  if (mode === null)
    throw new Error('Local release mode is required: use --mode local or --mode demo.');
  if (apiPort === webPort) throw new Error('The API and web preview require different ports.');
  if ([3_000, 5_173].includes(apiPort) || [3_000, 5_173].includes(webPort)) {
    throw new Error(
      'Release ports must be dedicated and cannot reuse development ports 3000 or 5173.',
    );
  }
  return { mode, apiPort, webPort };
}

export function assertReleaseDatabaseUrl(
  databaseUrl: string,
  allowDevContainerHostBridge = false,
): URL {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL must be a valid local PostgreSQL URL.');
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const allowedHosts = ['127.0.0.1', 'localhost', '::1'];
  if (allowDevContainerHostBridge) allowedHosts.push('host.docker.internal');
  if (!allowedHosts.includes(hostname)) {
    throw new Error(
      `Local release requires PostgreSQL on loopback${
        allowDevContainerHostBridge ? ' or the Dev Container host bridge' : ''
      }; DATABASE_URL uses "${parsed.hostname}".`,
    );
  }
  const database = decodeURIComponent(parsed.pathname.slice(1));
  if (database !== 'goalpilot_local') {
    throw new Error(
      `Local release requires the non-test "goalpilot_local" database; received "${database}".`,
    );
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('DATABASE_URL must use the postgres or postgresql protocol.');
  }
  return parsed;
}

export function resolveReleaseDatabaseUrl(databaseUrl: string, inDevContainer: boolean): string {
  const parsed = assertReleaseDatabaseUrl(databaseUrl, inDevContainer);
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (inDevContainer && ['127.0.0.1', 'localhost', '::1'].includes(hostname)) {
    parsed.hostname = 'host.docker.internal';
  }
  return parsed.toString();
}

export function createReleaseEnvironment(
  options: ReleaseOptions,
  databaseUrl: string,
  baseEnvironment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const environment = Object.fromEntries(
    Object.entries(baseEnvironment).filter(([name]) => !name.toUpperCase().startsWith('AWS_')),
  ) as NodeJS.ProcessEnv;
  delete environment['GOALPILOT_DEVCONTAINER'];
  const apiOrigin = `http://${LOOPBACK_HOST}:${String(options.apiPort)}`;
  const webOrigin = `http://${LOOPBACK_HOST}:${String(options.webPort)}`;
  Object.assign(environment, {
    ENVIRONMENT: 'local',
    NODE_ENV: 'production',
    API_BIND_HOST: LOOPBACK_HOST,
    API_PORT: String(options.apiPort),
    API_ORIGIN: apiOrigin,
    WEB_ORIGIN: webOrigin,
    DATABASE_URL: databaseUrl,
    AUTH_MODE: 'local',
    FINANCIAL_PROVIDER_MODE: 'simulated',
    DEMO_STORY_ENABLED: options.mode === 'demo' ? 'true' : 'false',
    PURCHASE_TIMING_LAB_ENABLED: options.mode === 'demo' ? 'true' : 'false',
    GOALPILOT_WEB_PORT: String(options.webPort),
    GOALPILOT_API_PROXY_ORIGIN: apiOrigin,
  });
  return environment;
}

function childDetail(child: ChildProcess, label: string): string {
  if (child.exitCode !== null) return `${label} exited with code ${String(child.exitCode)}`;
  if (child.signalCode !== null) return `${label} exited from signal ${child.signalCode}`;
  return `${label} is running`;
}

async function assertPortAvailable(port: number, label: string): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const server = createServer();
    server.once('error', (error) => {
      reject(new Error(`${label} port ${String(port)} is unavailable: ${error.message}`));
    });
    server.listen({ host: LOOPBACK_HOST, port, exclusive: true }, () => {
      server.close((error) => {
        if (error !== undefined) reject(error);
        else resolvePromise();
      });
    });
  });
}

function pnpmInvocation(arguments_: readonly string[]): {
  readonly executable: string;
  readonly arguments: readonly string[];
} {
  const npmExecutable = process.env['npm_execpath'];
  if (npmExecutable !== undefined && existsSync(npmExecutable)) {
    return { executable: process.execPath, arguments: [npmExecutable, ...arguments_] };
  }
  if (process.platform === 'win32') {
    const corepackModule = resolve(
      dirname(process.execPath),
      'node_modules/corepack/dist/corepack.js',
    );
    if (!existsSync(corepackModule)) {
      throw new Error(`Corepack entry point is missing beside Node at ${corepackModule}.`);
    }
    return {
      executable: process.execPath,
      arguments: [corepackModule, 'pnpm', ...arguments_],
    };
  }
  return {
    executable: 'corepack',
    arguments: ['pnpm', ...arguments_],
  };
}

async function runPnpm(
  arguments_: readonly string[],
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  const invocation = pnpmInvocation(arguments_);
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(invocation.executable, invocation.arguments, {
      cwd: process.cwd(),
      env: environment,
      stdio: 'inherit',
      shell: false,
      windowsHide: true,
    });
    child.once('error', (error) => reject(new Error(`Could not start pnpm: ${error.message}`)));
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise();
      else {
        reject(
          new Error(
            `pnpm ${arguments_.join(' ')} failed (${signal === null ? `exit ${String(code)}` : `signal ${signal}`}).`,
          ),
        );
      }
    });
  });
}

async function verifyLocalDatabase(databaseUrl: string): Promise<void> {
  const database = createDatabaseClient(databaseUrl, 1);
  try {
    await checkDatabase(database);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown database error';
    throw new Error(`Local PostgreSQL is unavailable: ${message}`, { cause: error });
  } finally {
    await database.end();
  }
}

function requireBuildArtifact(path: string, label: string): string {
  const absolutePath = resolve(path);
  if (!existsSync(absolutePath)) {
    throw new Error(`${label} build artifact is missing at ${absolutePath}.`);
  }
  return absolutePath;
}

function spawnService(
  label: string,
  arguments_: readonly string[],
  environment: NodeJS.ProcessEnv,
  workingDirectory = process.cwd(),
): ChildProcess {
  const child = spawn(process.execPath, arguments_, {
    cwd: workingDirectory,
    env: environment,
    stdio: 'inherit',
    shell: false,
    windowsHide: true,
  });
  child.once('error', (error) => {
    process.stderr.write(`[${label}] failed to start: ${error.message}\n`);
  });
  return child;
}

async function createPreviewConfig(apiOrigin: string): Promise<{
  readonly directory: string;
  readonly configPath: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'goalpilot-release-'));
  const configPath = join(directory, 'vite-preview.config.mjs');
  const proxy = Object.fromEntries(
    ['/api', '/auth', '/health', '/docs'].map((path) => [path, apiOrigin]),
  );
  await writeFile(
    configPath,
    `export default ${JSON.stringify({ preview: { proxy } })};\n`,
    'utf8',
  );
  return { directory, configPath };
}

async function waitForHttp(
  url: string,
  label: string,
  children: readonly { readonly label: string; readonly child: ChildProcess }[],
): Promise<void> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  let lastFailure = 'no response';
  while (Date.now() < deadline) {
    const exited = children.find(
      ({ child }) => child.exitCode !== null || child.signalCode !== null,
    );
    if (exited !== undefined) {
      throw new Error(
        `${exited.label} stopped during startup: ${childDetail(exited.child, exited.label)}.`,
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
  throw new Error(`${label} did not become ready at ${url} within 90 seconds (${lastFailure}).`);
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise<boolean>((resolvePromise) => {
    const timeout = setTimeout(() => resolvePromise(false), timeoutMs);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolvePromise(true);
    });
  });
}

async function terminateChild(child: ChildProcess, label: string): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  if (await waitForExit(child, CHILD_SHUTDOWN_TIMEOUT_MS)) return;
  child.kill('SIGKILL');
  if (!(await waitForExit(child, CHILD_SHUTDOWN_TIMEOUT_MS))) {
    throw new Error(`${label} did not stop after SIGTERM and SIGKILL.`);
  }
}

export async function runLocalRelease(options: ReleaseOptions): Promise<void> {
  loadLocalEnvironment();
  const configuredDatabaseUrl = process.env['DATABASE_URL'];
  if (configuredDatabaseUrl === undefined) {
    throw new Error(
      'DATABASE_URL is required. Configure a loopback goalpilot_local PostgreSQL database.',
    );
  }
  const databaseUrl = resolveReleaseDatabaseUrl(
    configuredDatabaseUrl,
    process.env['GOALPILOT_DEVCONTAINER'] === 'true',
  );
  const environment = createReleaseEnvironment(options, databaseUrl);

  await Promise.all([
    assertPortAvailable(options.apiPort, 'API release'),
    assertPortAvailable(options.webPort, 'Web release'),
  ]);
  await verifyLocalDatabase(databaseUrl);
  process.stdout.write('Building GoalPilot production artifacts...\n');
  await runPnpm(['run', 'build'], environment);
  process.stdout.write('Applying repeatable local migrations...\n');
  await runPnpm(['run', 'db:migrate'], environment);
  if (options.mode === 'demo') {
    process.stdout.write('Restoring the deterministic scoped demo fixture...\n');
    await runPnpm(['run', 'db:seed'], environment);
  }

  const apiEntry = requireBuildArtifact('apps/api/dist/server.js', 'API');
  requireBuildArtifact('apps/web/dist/index.html', 'Web');
  const viteEntry = requireBuildArtifact('apps/web/node_modules/vite/bin/vite.js', 'Vite preview');
  const apiOrigin = `http://${LOOPBACK_HOST}:${String(options.apiPort)}`;
  const webOrigin = `http://${LOOPBACK_HOST}:${String(options.webPort)}`;
  const previewConfig = await createPreviewConfig(apiOrigin);
  const api = spawnService('api', [apiEntry], environment);
  const web = spawnService(
    'web',
    [
      viteEntry,
      'preview',
      '--config',
      previewConfig.configPath,
      '--host',
      LOOPBACK_HOST,
      '--port',
      String(options.webPort),
      '--strictPort',
    ],
    environment,
    resolve('apps/web'),
  );
  const children = [
    { label: 'API', child: api },
    { label: 'Web preview', child: web },
  ] as const;
  const unexpectedExit = Promise.race(
    children.map(
      ({ child, label }) =>
        new Promise<{ readonly kind: 'exit'; readonly message: string }>((resolvePromise) => {
          child.once('exit', () =>
            resolvePromise({ kind: 'exit', message: childDetail(child, label) }),
          );
        }),
    ),
  );
  let resolveSignal:
    | ((event: { readonly kind: 'signal'; readonly signal: string }) => void)
    | null = null;
  const signalReceived = new Promise<{ readonly kind: 'signal'; readonly signal: string }>(
    (resolvePromise) => {
      resolveSignal = resolvePromise;
    },
  );
  const onSigint = (): void => resolveSignal?.({ kind: 'signal', signal: 'SIGINT' });
  const onSigterm = (): void => resolveSignal?.({ kind: 'signal', signal: 'SIGTERM' });
  process.once('SIGINT', onSigint);
  process.once('SIGTERM', onSigterm);

  try {
    const startup = Promise.all([
      waitForHttp(`${apiOrigin}/health/ready`, 'API readiness', children),
      waitForHttp(webOrigin, 'Web preview', children),
    ]).then(() => ({ kind: 'ready' }) as const);
    const startupEvent = await Promise.race([startup, signalReceived, unexpectedExit]);
    if (startupEvent.kind === 'signal') {
      process.stdout.write(
        `Received ${startupEvent.signal} during startup; stopping local release services...\n`,
      );
      return;
    }
    if (startupEvent.kind === 'exit') {
      throw new Error(`Local release service stopped during startup: ${startupEvent.message}.`);
    }
    process.stdout.write(
      `GOALPILOT_RELEASE_READY ${JSON.stringify({
        mode: options.mode,
        webOrigin,
        apiOrigin,
        database: 'loopback/goalpilot_local',
        demoStory: options.mode === 'demo',
        purchaseTimingLab: options.mode === 'demo',
        aws: 'disabled',
      })}\n`,
    );
    const event = await Promise.race([signalReceived, unexpectedExit]);
    if (event.kind === 'exit')
      throw new Error(`Local release service stopped unexpectedly: ${event.message}.`);
    process.stdout.write(`Received ${event.signal}; stopping local release services...\n`);
  } finally {
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);
    try {
      await Promise.all(children.map(({ child, label }) => terminateChild(child, label)));
    } finally {
      await rm(previewConfig.directory, { recursive: true, force: true });
    }
  }
}

function isEntrypoint(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && pathToFileURL(resolve(entry)).href === import.meta.url;
}

if (isEntrypoint()) {
  runLocalRelease(parseReleaseArguments(process.argv.slice(2))).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown local release failure';
    process.stderr.write(`Local release failed: ${message}\n`);
    process.exitCode = 1;
  });
}
