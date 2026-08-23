import { describe, expect, it } from 'vitest';

import { createLogger } from '@goalpilot/observability';

describe('security regressions', () => {
  it('redacts prohibited fields from structured logs', () => {
    const output: string[] = [];
    const destination = { write: (message: string) => output.push(message) };
    const logger = createLogger('info', destination);
    logger.info(
      {
        password: 'prohibited-password-value',
        token: 'prohibited-token-value',
        email: 'private@example.test',
        amountCents: 123_456,
      },
      'synthetic redaction check',
    );
    expect(output.join('')).toContain('[REDACTED]');
    expect(output.join('')).not.toContain('prohibited-password-value');
    expect(output.join('')).not.toContain('prohibited-token-value');
    expect(output.join('')).not.toContain('private@example.test');
    expect(output.join('')).not.toContain('123456');
  });

  it('contains no real-money route language in the API surface', async () => {
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile('apps/api/src/app.ts', 'utf8'),
    );
    expect(source).not.toMatch(/\/ach|\/transfers|routingNumber|accountNumber/);
  });
});
