import { createHash, randomBytes } from 'node:crypto';

import type { FastifyReply, FastifyRequest } from 'fastify';

import type { UserDto } from '@goalpilot/contracts';
import type { GoalPilotRepository } from '@goalpilot/data-access';

import type { AppConfiguration } from './config.js';
import { AuthenticationRequiredError, ForbiddenOperationError } from './errors.js';

export const sessionCookieName = 'goalpilot_session';
export const csrfCookieName = 'goalpilot_csrf';

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalJsonValue(nested)]),
    );
  }
  return value;
}

export function canonicalRequestHash(value: unknown): string {
  if (value === undefined) throw new TypeError('The request must be JSON serializable.');
  return sha256(JSON.stringify(canonicalJsonValue(value)));
}

export async function issueSession(
  repository: GoalPilotRepository,
  configuration: AppConfiguration,
  userId: string,
  reply: FastifyReply,
): Promise<string> {
  const sessionToken = randomBytes(32).toString('base64url');
  const csrfToken = randomBytes(32).toString('base64url');
  const now = Date.now();
  await repository.createSession({
    idHash: sha256(sessionToken),
    userId,
    csrfHash: sha256(csrfToken),
    expiresAt: new Date(now + 8 * 60 * 60 * 1000),
    absoluteExpiresAt: new Date(now + 7 * 24 * 60 * 60 * 1000),
  });
  const secure = configuration.ENVIRONMENT !== 'local' && configuration.ENVIRONMENT !== 'test';
  reply.setCookie(sessionCookieName, sessionToken, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: 7 * 24 * 60 * 60,
  });
  reply.setCookie(csrfCookieName, csrfToken, {
    path: '/',
    httpOnly: false,
    sameSite: 'lax',
    secure,
    maxAge: 7 * 24 * 60 * 60,
  });
  return csrfToken;
}

export async function currentUser(
  request: FastifyRequest,
  repository: GoalPilotRepository,
): Promise<UserDto | null> {
  const token = request.cookies[sessionCookieName];
  if (token === undefined) return null;
  const session = await repository.getSession(sha256(token), new Date());
  return session?.user ?? null;
}

export async function requireUser(
  request: FastifyRequest,
  repository: GoalPilotRepository,
): Promise<UserDto> {
  const user = await currentUser(request, repository);
  if (user === null) throw new AuthenticationRequiredError();
  return user;
}

export async function verifyCsrf(
  request: FastifyRequest,
  repository: GoalPilotRepository,
): Promise<void> {
  const sessionToken = request.cookies[sessionCookieName];
  const csrfHeader = request.headers['x-csrf-token'];
  if (sessionToken === undefined || typeof csrfHeader !== 'string')
    throw new ForbiddenOperationError();
  const session = await repository.getSession(sha256(sessionToken), new Date());
  if (session?.csrfHash !== sha256(csrfHeader)) throw new ForbiddenOperationError();
}

export function clearSessionCookies(reply: FastifyReply): void {
  reply.clearCookie(sessionCookieName, { path: '/' });
  reply.clearCookie(csrfCookieName, { path: '/' });
}
