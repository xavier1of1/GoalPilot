import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ignoredDirectories = new Set([
  '.git',
  '.next',
  '.pnpm-store',
  '.turbo',
  'artifacts',
  'coverage',
  'dist',
  'node_modules',
  'playwright-report',
  'test-results',
]);

const scannedExtensions = new Set([
  '.conf',
  '.ini',
  '.js',
  '.json',
  '.key',
  '.md',
  '.pem',
  '.properties',
  '.sh',
  '.sql',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
]);

const scannedDotfiles = new Set(['.netrc', '.npmrc', '.pypirc']);

interface DetectorRule {
  readonly id: string;
  readonly pattern: RegExp;
}

const tokenRules: readonly DetectorRule[] = [
  { id: 'aws-access-key-id', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  {
    id: 'private-key-block',
    pattern: /-----BEGIN (?:DSA |EC |OPENSSH |PGP |RSA )?PRIVATE KEY-----/g,
  },
  { id: 'github-token', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,255}\b/g },
  { id: 'github-fine-grained-token', pattern: /\bgithub_pat_[A-Za-z0-9_]{20,255}\b/g },
  { id: 'google-api-key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { id: 'npm-token', pattern: /\bnpm_[A-Za-z0-9]{30,255}\b/g },
  { id: 'pypi-token', pattern: /\bpypi-[A-Za-z0-9_-]{40,255}\b/g },
  { id: 'slack-token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,255}\b/g },
  { id: 'stripe-live-key', pattern: /\b(?:rk|sk)_live_[A-Za-z0-9]{16,255}\b/g },
  {
    id: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  },
];

const credentialAssignmentPattern =
  /(?:^|[\s,{])['"]?([A-Za-z][A-Za-z0-9_.-]*)['"]?\s*[:=]\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|`([^`\r\n]*)`|([^\s,;#}]+))/gm;
const credentialUrlPattern =
  /\b(?:mongodb(?:\+srv)?|mysql|postgres(?:ql)?|redis):\/\/[^\s:/@]+:([^\s/@]+)@/gi;

const exactCredentialNames = new Set([
  'api_key',
  'apikey',
  'auth_token',
  'authorization_token',
  'aws_access_key_id',
  'aws_secret_access_key',
  'bearer_token',
  'client_secret',
  'connection_string',
  'database_url',
  'db_password',
  'db_url',
  'encryption_key',
  'github_token',
  'jwt_secret',
  'password',
  'passwd',
  'private_key',
  'refresh_token',
  'secret_key',
  'session_secret',
  'signing_key',
  'signing_secret',
  'slack_token',
  'stripe_secret_key',
]);

const exactSafePlaceholders = new Set([
  'change-me',
  'change_me',
  'changeme',
  'current-password',
  'development',
  'dummy',
  'example',
  'fake',
  'goalpilot',
  'local',
  'new-password',
  'password',
  'placeholder',
  'postgres',
  'redacted',
  'replace-me',
  'replace_me',
  'secret',
  'test',
]);

// These are committed, local-only fixture literals. Keep approvals exact: adding a
// new fixture credential requires a deliberate entry instead of inheriting a broad
// filename or `test-*`/`goalpilot-*` exemption.
const approvedFixturePlaceholders = new Set([
  'a-test-secret-that-is-at-least-32-characters',
  '01arz3ndektsv4rrffq69g5fax',
  '01arz3ndektsv4rrffq69g5fay',
  '01arz3ndektsv4rrffq69g5fb4',
  '01arz3ndektsv4rrffq69g5fb5',
  'ci-only-secret-with-at-least-32-characters',
  'do-not-log',
  'goalpilot-${journey}-${runid}!',
  'goalpilot-alex-2026!',
  'goalpilot-clock-2026!',
  'goalpilot-demo-2026!',
  'goalpilot-e-${runid}!',
  'goalpilot-privacy-2026!',
  'goalpilot-product-2026!',
  'goalpilot-sam-2026!',
  'goalpilot-singlepool-2026!',
  'goalpilot-strong-test-password!',
  'goalpilot_local_only',
  'incorrect-password-2026!',
  'local-demo-secret-change-before-sharing-32-chars',
  'local-test-secret-at-least-thirty-two-characters',
  'not-used',
  'not-a-fixture-password-hash',
  'private-audit-metadata-${runkey}',
  'private-idempotency-response-${runkey}',
  'private-password-hash-${runkey}',
  'prohibited-password-value',
  'prohibited-token-value',
]);

export interface SecretFinding {
  readonly filename: string;
  readonly rules: readonly string[];
}

function normalizedCredentialName(identifier: string): string {
  return identifier
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[.-]+/g, '_')
    .toLowerCase();
}

function isCredentialName(identifier: string): boolean {
  const normalized = normalizedCredentialName(identifier);
  if (exactCredentialNames.has(normalized)) return true;
  return /(?:^|_)(?:access_token|api_key|auth_token|client_secret|password|passwd|private_key|refresh_token|secret|token)$/.test(
    normalized,
  );
}

export function isSafePlaceholder(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) return true;
  if (/^(?:false|null|true|undefined)$/.test(normalized)) return true;
  if (exactSafePlaceholders.has(normalized) || approvedFixturePlaceholders.has(normalized))
    return true;
  if (/^(?:<[^>]+>|\$\{[^}]+\}|\{\{[^}]+\}\}|%[^%]+%)$/.test(normalized)) return true;
  if (/^(?:x+|0+|\*+)$/i.test(normalized)) return true;
  if (/^(?:process\.|import\.meta|env\[|env\.)/.test(normalized)) return true;
  return /^(?:your|insert|set)[-_ ](?:api[-_ ]?key|credential|password|secret|token|value)(?:[-_ ]here)?$/.test(
    normalized,
  );
}

function isSafeCredentialValue(value: string): boolean {
  if (isSafePlaceholder(value)) return true;
  const urlMatch =
    /^(?:mongodb(?:\+srv)?|mysql|postgres(?:ql)?|redis):\/\/[^\s:/@]+:([^\s/@]+)@/i.exec(
      value.trim(),
    );
  return urlMatch?.[1] !== undefined && isSafePlaceholder(urlMatch[1]);
}

function acceptsUnquotedAssignments(filename: string): boolean {
  const basename = path.basename(filename).toLowerCase();
  return (
    basename === '.env' ||
    basename.startsWith('.env.') ||
    scannedDotfiles.has(basename) ||
    ['.conf', '.ini', '.properties', '.toml', '.yaml', '.yml'].includes(path.extname(basename))
  );
}

export function detectPotentialSecrets(source: string, filename = ''): readonly string[] {
  const detected = new Set<string>();
  for (const rule of tokenRules) {
    rule.pattern.lastIndex = 0;
    if (rule.pattern.test(source)) detected.add(rule.id);
  }

  credentialAssignmentPattern.lastIndex = 0;
  for (const match of source.matchAll(credentialAssignmentPattern)) {
    const identifier = match[1];
    const value = match[2] ?? match[3] ?? match[4] ?? match[5];
    const isUnquoted = match[5] !== undefined;
    if (
      identifier !== undefined &&
      value !== undefined &&
      (!isUnquoted || acceptsUnquotedAssignments(filename)) &&
      isCredentialName(identifier) &&
      value.trim().length >= 8 &&
      !/\s/.test(value.trim()) &&
      !isSafeCredentialValue(value)
    ) {
      detected.add('credential-assignment');
    }
  }

  credentialUrlPattern.lastIndex = 0;
  for (const match of source.matchAll(credentialUrlPattern)) {
    const password = match[1];
    if (password !== undefined && password.length >= 8 && !isSafePlaceholder(password)) {
      detected.add('credential-url');
    }
  }

  return [...detected].sort();
}

export function shouldScanFile(filename: string): boolean {
  const basename = path.basename(filename).toLowerCase();
  if (basename === '.env' || basename.startsWith('.env.')) return true;
  if (scannedDotfiles.has(basename)) return true;
  return scannedExtensions.has(path.extname(basename));
}

async function workspaceFiles(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries
      .filter((entry) => !ignoredDirectories.has(entry.name))
      .map(async (entry) => {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) return workspaceFiles(fullPath);
        return shouldScanFile(fullPath) ? [fullPath] : [];
      }),
  );
  return nested.flat();
}

export async function scanWorkspace(directory = '.'): Promise<readonly SecretFinding[]> {
  const findings: SecretFinding[] = [];
  for (const filename of await workspaceFiles(directory)) {
    const rules = detectPotentialSecrets(await readFile(filename, 'utf8'), filename);
    if (rules.length > 0) findings.push({ filename, rules });
  }
  return findings.sort((left, right) => left.filename.localeCompare(right.filename));
}

export async function main(directory = '.'): Promise<void> {
  const findings = await scanWorkspace(directory);
  if (findings.length > 0) {
    const summary = findings.map(
      (finding) => `${path.relative(directory, finding.filename)} [${finding.rules.join(', ')}]`,
    );
    process.stderr.write(
      `Potential secret patterns found in workspace files:\n${summary.join('\n')}\n`,
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write('No potential secret patterns detected in scanned workspace files.\n');
}

function isEntrypoint(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && pathToFileURL(path.resolve(entry)).href === import.meta.url;
}

if (isEntrypoint()) await main();
