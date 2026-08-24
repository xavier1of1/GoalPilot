import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createLogger, safeErrorContext } from './index.js';

describe('safe logging', () => {
  it('does not serialize unexpected error messages or stacks', () => {
    let output = '';
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        output += String(chunk);
        callback();
      },
    });
    const logger = createLogger('error', destination);
    const secret = 'postgres://user:do-not-log@localhost/private';
    logger.error({ err: new Error(`DATABASE_URL=${secret}`) }, 'Unexpected failure');

    expect(output).not.toContain(secret);
    expect(output).not.toContain('do-not-log');
    expect(output).toContain('[REDACTED]');
  });

  it('classifies failures without copying their message', () => {
    const context = safeErrorContext(new TypeError('SESSION_SECRET=do-not-log'));
    expect(context).toEqual({ errorType: 'TypeError' });
    expect(JSON.stringify(context)).not.toContain('do-not-log');
  });

  it('does not trust a mutable error name', () => {
    const error = new Error('safe message');
    error.name = 'postgres://user:do-not-log@localhost/private';
    expect(safeErrorContext(error)).toEqual({ errorType: 'Error' });
  });
});
