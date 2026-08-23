import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

import { checkDatabase, createDatabaseClient } from '@goalpilot/data-access';

import { getDatabaseUrl, loadLocalEnvironment } from './runtime-config.js';

loadLocalEnvironment();
const checks: { readonly name: string; readonly result: string; readonly ok: boolean }[] = [];
checks.push({ name: 'Node', result: process.version, ok: process.version === 'v24.19.0' });
try {
  const pnpmVersion = (
    process.platform === 'win32'
      ? execFileSync(
          process.env['ComSpec'] ?? 'cmd.exe',
          ['/d', '/s', '/c', 'corepack pnpm --version'],
          { encoding: 'utf8' },
        )
      : execFileSync('corepack', ['pnpm', '--version'], { encoding: 'utf8' })
  ).trim();
  checks.push({ name: 'pnpm', result: pnpmVersion, ok: pnpmVersion === '11.22.0' });
} catch {
  checks.push({ name: 'pnpm', result: 'Corepack pnpm unavailable', ok: false });
}
try {
  execFileSync('docker', ['info'], { stdio: 'ignore' });
  checks.push({ name: 'Docker', result: 'engine available', ok: true });
} catch {
  checks.push({ name: 'Docker', result: 'engine unavailable', ok: false });
}
checks.push({
  name: 'Environment',
  result: existsSync('.env.local') ? '.env.local loaded' : '.env.local missing',
  ok: existsSync('.env.local'),
});
try {
  const database = createDatabaseClient(getDatabaseUrl(), 1);
  await checkDatabase(database);
  await database.end();
  checks.push({ name: 'Database', result: 'ready', ok: true });
} catch {
  checks.push({ name: 'Database', result: 'unreachable', ok: false });
}
for (const check of checks) {
  process.stdout.write(`${check.ok ? 'PASS' : 'FAIL'}  ${check.name}: ${check.result}\n`);
}
process.stdout.write('Authentication provider: LocalAuthProvider (local/test only)\n');
process.stdout.write('Financial provider mode: simulated, illustrative, not live\n');
process.stdout.write('AWS status: disabled and not required\n');
if (checks.some((check) => !check.ok)) process.exitCode = 1;
