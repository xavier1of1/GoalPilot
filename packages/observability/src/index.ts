import pino, { type DestinationStream, type Logger, type LoggerOptions } from 'pino';

export function createLogger(level: string, destination?: DestinationStream): Logger {
  const options: LoggerOptions = {
    level,
    base: { service: 'goalpilot-api' },
    redact: {
      paths: [
        'err',
        'req.headers.authorization',
        'req.headers.cookie',
        'headers.authorization',
        'headers.cookie',
        '*.password',
        '*.token',
        '*.session',
        '*.csrf',
        '*.email',
        '*.amountCents',
        '*.targetAmountCents',
        'password',
        'token',
        'email',
        'amountCents',
        'targetAmountCents',
      ],
      censor: '[REDACTED]',
    },
  };
  return destination === undefined ? pino(options) : pino(options, destination);
}

export function safeErrorContext(error: unknown): Readonly<{ errorType: string }> {
  return {
    errorType: error instanceof Error ? error.name : typeof error,
  };
}
