import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

function invocation(
  command: string,
  arguments_: readonly string[],
): { readonly executable: string; readonly arguments: readonly string[] } {
  if (process.platform !== 'win32') return { executable: command, arguments: arguments_ };
  if (command === 'node') return { executable: process.execPath, arguments: arguments_ };
  if (command === 'docker') return { executable: 'docker.exe', arguments: arguments_ };
  if (command === 'corepack') {
    const corepackModule = join(
      dirname(process.execPath),
      'node_modules',
      'corepack',
      'dist',
      'corepack.js',
    );
    return { executable: process.execPath, arguments: [corepackModule, ...arguments_] };
  }
  return { executable: command, arguments: arguments_ };
}

function run(
  command: string,
  arguments_: readonly string[],
  options: { readonly quiet?: boolean; readonly allowFailure?: boolean } = {},
): boolean {
  const resolved = invocation(command, arguments_);
  const result = spawnSync(resolved.executable, resolved.arguments, {
    cwd: process.cwd(),
    env: process.env,
    stdio: options.quiet === true ? 'ignore' : 'inherit',
    shell: false,
  });
  const succeeded = result.status === 0;
  if (!succeeded && options.allowFailure !== true) {
    const detail = result.error?.message ?? `exit code ${String(result.status)}`;
    throw new Error(`Command failed: ${command} ${arguments_.join(' ')} (${detail})`);
  }
  return succeeded;
}

function requireTool(command: string, versionArguments: readonly string[]): void {
  if (!run(command, versionArguments, { quiet: true, allowFailure: true }))
    throw new Error(`Missing required tool: ${command}`);
}

requireTool('node', ['--version']);
requireTool('corepack', ['--version']);
requireTool('docker', ['--version']);
run('docker', ['info'], { quiet: true });
run('corepack', ['enable']);
run('corepack', ['pnpm', 'install', '--frozen-lockfile']);

if (!existsSync('.env.local')) {
  copyFileSync('.env.example', '.env.local');
  process.stdout.write('Created .env.local from development-only template.\n');
}
process.loadEnvFile('.env.local');

run('docker', ['compose', '-f', 'docker-compose.local.yml', 'up', '-d', 'postgres']);
let ready = false;
for (let attempt = 1; attempt <= 30; attempt += 1) {
  ready = run(
    'docker',
    [
      'compose',
      '-f',
      'docker-compose.local.yml',
      'exec',
      '-T',
      'postgres',
      'pg_isready',
      '-U',
      'goalpilot_local',
      '-d',
      'goalpilot_local',
    ],
    { quiet: true, allowFailure: true },
  );
  if (ready) break;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_000);
}
if (!ready) throw new Error('PostgreSQL did not become ready within 30 seconds.');

run('corepack', ['pnpm', 'db:migrate']);
run('corepack', ['pnpm', 'db:seed']);
run('corepack', ['pnpm', 'run', 'doctor']);

const databaseUrl = new URL(
  process.env['DATABASE_URL'] ??
    'postgres://goalpilot_local:goalpilot_local_only@localhost:5432/goalpilot_local',
);
process.stdout.write(`
GoalPilot local environment is ready.
Web:               ${process.env['WEB_ORIGIN'] ?? 'http://localhost:5173'}
API:               ${process.env['API_ORIGIN'] ?? 'http://localhost:3000'}
API documentation: ${process.env['API_ORIGIN'] ?? 'http://localhost:3000'}/docs
Database:          ${databaseUrl.hostname}:${databaseUrl.port || '5432'}/${databaseUrl.pathname.slice(1)}
Environment:       ${process.env['ENVIRONMENT'] ?? 'local'}
Authentication:    LocalAuthProvider
Financial mode:    simulated illustrative assumptions
AWS:               disabled

Next command: pnpm dev
`);
