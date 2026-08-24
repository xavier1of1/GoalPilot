import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  detectPotentialSecrets,
  isSafePlaceholder,
  shouldScanFile,
} from '../scripts/security-scan.js';

describe('workspace secret detection', () => {
  it('detects common provider tokens without returning their values', () => {
    const providerToken = ['ghp_', 'A'.repeat(36)].join('');
    const cloudKey = ['AKIA', 'B'.repeat(16)].join('');
    const paymentKey = ['sk_', 'live_', 'C'.repeat(24)].join('');
    const source = [providerToken, cloudKey, paymentKey].join('\n');

    const rules = detectPotentialSecrets(source);

    expect(rules).toEqual(['aws-access-key-id', 'github-token', 'stripe-live-key']);
    expect(JSON.stringify(rules)).not.toContain(providerToken);
    expect(JSON.stringify(rules)).not.toContain(cloudKey);
    expect(JSON.stringify(rules)).not.toContain(paymentKey);
  });

  it('detects credential assignments, authenticated URLs, and private-key blocks', () => {
    const assignment = ['SESSION_SECRET=', 's'.repeat(32)].join('');
    const authenticatedUrl = [
      'DATABASE_URL=postgres://goalpilot:',
      'r'.repeat(24),
      '@localhost:5432/goalpilot_local',
    ].join('');
    const keyBlock = ['-----BEGIN ', 'PRIVATE KEY-----'].join('');

    expect(
      detectPotentialSecrets([assignment, authenticatedUrl, keyBlock].join('\n'), '.env.local'),
    ).toEqual(['credential-assignment', 'credential-url', 'private-key-block']);
  });

  it('scans example environment files while accepting explicit local placeholders', async () => {
    const exampleEnvironment = await readFile('.env.example', 'utf8');

    expect(shouldScanFile('.env.example')).toBe(true);
    expect(detectPotentialSecrets(exampleEnvironment, '.env.example')).toEqual([]);
    expect(isSafePlaceholder('local-demo-secret-change-before-sharing-32-chars')).toBe(true);
    expect(isSafePlaceholder('GoalPilot-Demo-2026!')).toBe(true);
    expect(isSafePlaceholder('${SESSION_SECRET}')).toBe(true);
  });

  it('does not treat ordinary source identifiers as credential assignments', () => {
    const source = [
      'const secretDetectorRules = [];',
      'const tokenCount = 3;',
      'const passwordLength = 32;',
    ].join('\n');

    expect(detectPotentialSecrets(source)).toEqual([]);
  });

  it('does not exempt realistic credential assignments or database URLs in test files', () => {
    const realisticPassword = ['Saffron-Cedar-82!', 'Vault'].join('');
    const credentialedUrl = [
      'postgresql://goalpilot:',
      'CorrectHorseBatteryStaple!',
      '@localhost:5432/goalpilot_test',
    ].join('');
    const source = [
      ["const account = { password: '", realisticPassword, "' };"].join(''),
      ["const environment = { DATABASE_URL: '", credentialedUrl, "' };"].join(''),
    ].join('\n');

    expect(detectPotentialSecrets(source, 'example.integration.test.ts')).toEqual([
      'credential-assignment',
      'credential-url',
    ]);
    expect(isSafePlaceholder('test-production-password-2026!')).toBe(false);
    expect(isSafePlaceholder('goalpilot-customer-credential-2026!')).toBe(false);
  });

  it('still applies token and assignment rules inside test fixtures', () => {
    const providerToken = ['ghp_', 'Z'.repeat(36)].join('');

    expect(detectPotentialSecrets(providerToken, 'example.test.ts')).toEqual(['github-token']);
    expect(
      detectPotentialSecrets(["password='", 'fixture-value-123', "'"].join(''), 'example.test.ts'),
    ).toEqual(['credential-assignment']);
  });

  it('allows only the exact committed local fixture literals', () => {
    const approvedFixture = [
      "const config = { DATABASE_URL: 'postgres://goalpilot:goalpilot@127.0.0.1:1/goalpilot_test' };",
      "const secrets = { SESSION_SECRET: 'a-test-secret-that-is-at-least-32-characters' };",
      "const user = { password: 'GoalPilot-Demo-2026!' };",
      "const worker = { claimToken: '01ARZ3NDEKTSV4RRFFQ69G5FAX' };",
    ].join('\n');

    expect(detectPotentialSecrets(approvedFixture, 'known-fixture.test.ts')).toEqual([]);
    const unapprovedFixture = ['GoalPilot-Demo-2026!', '-unexpected'].join('');
    expect(
      detectPotentialSecrets(
        ["const user = { password: '", unapprovedFixture, "' };"].join(''),
        'known-fixture.test.ts',
      ),
    ).toEqual(['credential-assignment']);
    const unapprovedClaimToken = ['01ARZ3NDEKTSV4RRFFQ69G5FA', 'Z'].join('');
    expect(
      detectPotentialSecrets(
        ["const worker = { claimToken: '", unapprovedClaimToken, "' };"].join(''),
        'known-fixture.test.ts',
      ),
    ).toEqual(['credential-assignment']);
  });
});
