import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, {
  type FastifyInstance,
  LogController,
  type RawReplyDefaultExpression,
  type RawRequestDefaultExpression,
  type RawServerDefault,
} from 'fastify';
import type { Logger } from 'pino';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { ulid } from 'ulid';
import { z } from 'zod';

import { LocalAuthProvider } from '@goalpilot/auth';
import {
  activationInputSchema,
  contributionInputSchema,
  goalInputSchema,
  goalUpdateSchema,
  loginInputSchema,
  previewInputSchema,
  registerInputSchema,
} from '@goalpilot/contracts';
import {
  checkDatabase,
  type DatabaseClient,
  GoalPilotRepository,
  IdempotencyConflictError,
  StateConflictError,
} from '@goalpilot/data-access';
import { compareVehicles, generateContributionDates } from '@goalpilot/domain';
import { createLogger, safeErrorContext } from '@goalpilot/observability';
import type { Clock, RateProvider } from '@goalpilot/provider-ports';
import {
  PersistedApplicationClock,
  SimulatedContributionProvider,
  SimulatedGoalAccountProvider,
  StaticRateProvider,
} from '@goalpilot/provider-simulators';

import type { AppConfiguration } from './config.js';
import {
  AppError,
  AuthenticationRequiredError,
  ConflictAppError,
  ForbiddenOperationError,
  ResourceNotFoundError,
  ValidationAppError,
} from './errors.js';
import {
  clearSessionCookies,
  currentUser,
  csrfCookieName,
  issueSession,
  requireUser,
  sessionCookieName,
  sha256,
  verifyCsrf,
} from './session.js';

interface AppDependencies {
  readonly configuration: AppConfiguration;
  readonly database: DatabaseClient;
  readonly clock?: Clock;
  readonly rateProvider?: RateProvider;
}

const goalIdParameters = z.object({ goalId: z.string().length(26) });
const idempotencyHeaders = z.object({ 'idempotency-key': z.string().min(8).max(128) });

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

type GoalPilotApp = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression,
  RawReplyDefaultExpression,
  Logger,
  ZodTypeProvider
>;

export async function buildApp(dependencies: AppDependencies): Promise<GoalPilotApp> {
  const { configuration, database } = dependencies;
  const repository = new GoalPilotRepository(database);
  const clock = dependencies.clock ?? new PersistedApplicationClock(repository);
  const rateProvider = dependencies.rateProvider ?? new StaticRateProvider();
  const authProvider = new LocalAuthProvider(repository);
  const goalAccountProvider = new SimulatedGoalAccountProvider(repository);
  const contributionProvider = new SimulatedContributionProvider(repository);
  const app = Fastify({
    loggerInstance: createLogger(configuration.LOG_LEVEL),
    bodyLimit: 64 * 1024,
    genReqId: () => ulid(),
    logController: new LogController({ disableRequestLogging: true }),
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(cookie, { secret: configuration.SESSION_SECRET });
  await app.register(cors, {
    origin: [configuration.WEB_ORIGIN],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
      },
    },
  });
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  await app.register(sensible);
  await app.register(swagger, {
    openapi: {
      info: { title: 'GoalPilot local API', version: '0.1.0' },
      servers: [{ url: configuration.API_ORIGIN }],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  app.addHook('onResponse', async (request, reply) => {
    request.log.info(
      {
        requestId: request.id,
        method: request.method,
        route: request.routeOptions.url,
        statusCode: reply.statusCode,
        durationMs: Math.round(reply.elapsedTime),
      },
      'Request completed',
    );
  });

  app.addHook('onRequest', async (request) => {
    if (!['POST', 'PATCH', 'DELETE', 'PUT'].includes(request.method)) return;
    if (request.headers.origin !== configuration.WEB_ORIGIN) throw new ForbiddenOperationError();
    if (request.url.startsWith('/auth/logout')) {
      await verifyCsrf(request, repository);
      return;
    }
    if (!request.url.startsWith('/api/v1/') || request.url.startsWith('/api/v1/previews')) return;
    await verifyCsrf(request, repository);
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      void reply.status(error.httpStatus).send({
        error: {
          code: error.code,
          message: error.message,
          requestId: request.id,
          fieldErrors: null,
        },
      });
      return;
    }
    if (typeof error === 'object' && error !== null && 'validation' in error) {
      void reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Check the highlighted information and try again.',
          requestId: request.id,
          fieldErrors: null,
        },
      });
      return;
    }
    if (
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof error.statusCode === 'number' &&
      error.statusCode >= 400 &&
      error.statusCode < 500
    ) {
      const statusCode = error.statusCode;
      const code =
        statusCode === 413
          ? 'PAYLOAD_TOO_LARGE'
          : statusCode === 429
            ? 'RATE_LIMITED'
            : 'BAD_REQUEST';
      const message =
        statusCode === 413
          ? 'The request is larger than GoalPilot accepts.'
          : statusCode === 429
            ? 'Too many requests. Wait a moment and try again.'
            : 'The request could not be understood.';
      void reply.status(statusCode).send({
        error: { code, message, requestId: request.id, fieldErrors: null },
      });
      return;
    }
    request.log.error(
      { ...safeErrorContext(error), requestId: request.id },
      'Unexpected request failure',
    );
    void reply.status(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong. Try again with the request reference shown.',
        requestId: request.id,
        fieldErrors: null,
      },
    });
  });

  app.get('/health/live', { schema: { tags: ['health'] } }, () => ({ status: 'live' }));
  app.get('/health/ready', { schema: { tags: ['health'] } }, async (_request, reply) => {
    try {
      await checkDatabase(database);
      return { status: 'ready', database: 'ready' };
    } catch {
      return reply.status(503).send({ status: 'not_ready', database: 'unavailable' });
    }
  });

  app.get('/api/v1/vehicle-catalog', async () => {
    const asOfDate = await clock.today();
    const vehicles = await rateProvider.getCatalog(asOfDate);
    return {
      assumptionVersion: vehicles[0]?.assumptionVersion ?? 'missing',
      vehicles,
    };
  });

  app.post('/api/v1/previews', { schema: { body: previewInputSchema } }, async (request) => {
    const { asOfDate: explicitDate, ...goalFields } = request.body;
    const asOfDate = explicitDate ?? (await clock.today());
    const goal = goalInputSchema.parse(goalFields);
    try {
      return compareVehicles(goal, asOfDate, await rateProvider.getCatalog(asOfDate));
    } catch (error) {
      if (error instanceof RangeError) throw new ValidationAppError(error.message);
      throw error;
    }
  });

  app.post(
    '/auth/register',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: { body: registerInputSchema },
    },
    async (request, reply) => {
      try {
        const user = await authProvider.register(request.body);
        const csrfToken = await issueSession(repository, configuration, user.id, reply);
        await repository.audit(user.id, 'auth.registered');
        return await reply.status(201).send({ user, csrfToken });
      } catch (error) {
        if (isUniqueViolation(error))
          throw new ConflictAppError('An account with this email already exists.');
        throw error;
      }
    },
  );

  app.post(
    '/auth/login',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: { body: loginInputSchema },
    },
    async (request, reply) => {
      const user = await authProvider.verify(request.body.email, request.body.password);
      if (user === null)
        throw new AuthenticationRequiredError('The email or password is incorrect.');
      const oldToken = request.cookies[sessionCookieName];
      if (oldToken !== undefined) await repository.deleteSession(sha256(oldToken));
      const csrfToken = await issueSession(repository, configuration, user.id, reply);
      await repository.audit(user.id, 'auth.logged_in');
      return { user, csrfToken };
    },
  );

  app.post('/auth/logout', async (request, reply) => {
    const token = request.cookies[sessionCookieName];
    if (token !== undefined) await repository.deleteSession(sha256(token));
    clearSessionCookies(reply);
    return reply.status(204).send();
  });

  app.get('/api/v1/me', async (request) => {
    const user = await requireUser(request, repository);
    return { user, csrfToken: request.cookies[csrfCookieName] ?? null };
  });

  app.get('/api/v1/goals', async (request) => {
    const user = await requireUser(request, repository);
    return { goals: await repository.listGoals(user.id) };
  });

  app.post(
    '/api/v1/goals',
    { schema: { body: goalInputSchema, headers: idempotencyHeaders } },
    async (request, reply) => {
      const user = await requireUser(request, repository);
      try {
        if (request.body.targetDate < (await clock.today()))
          throw new ValidationAppError('Target date cannot be before the application date.');
        const result = await repository.createGoalIdempotent({
          userId: user.id,
          goal: request.body,
          key: request.headers['idempotency-key'],
          requestHash: sha256(JSON.stringify(request.body)),
        });
        if (result.replayed) reply.header('idempotency-replayed', 'true');
        return await reply.status(201).send(result.goal);
      } catch (error) {
        if (error instanceof IdempotencyConflictError) throw new ConflictAppError(error.message);
        if (isUniqueViolation(error))
          throw new ConflictAppError('Only one running goal is allowed.');
        throw error;
      }
    },
  );

  app.get('/api/v1/goals/:goalId', { schema: { params: goalIdParameters } }, async (request) => {
    const user = await requireUser(request, repository);
    const goal = await repository.getGoal(user.id, request.params.goalId);
    if (goal === null) throw new ResourceNotFoundError();
    const applicationDate = await clock.today();
    const account = await goalAccountProvider.summary(user.id, goal.id, applicationDate);
    return { goal, account, applicationDate };
  });

  app.patch(
    '/api/v1/goals/:goalId',
    { schema: { params: goalIdParameters, body: goalUpdateSchema } },
    async (request) => {
      const user = await requireUser(request, repository);
      const existing = await repository.getGoal(user.id, request.params.goalId);
      if (existing === null) throw new ResourceNotFoundError();
      const { version, ...changes } = request.body;
      if (
        existing.status !== 'draft' &&
        Object.keys(changes).some((key) => !['name', 'category', 'notes'].includes(key))
      )
        throw new ConflictAppError(
          'After activation, only the goal name, category, and notes can be edited.',
        );
      const existingInput = goalInputSchema.parse({
        name: existing.name,
        category: existing.category,
        targetAmountCents: existing.targetAmountCents,
        currentSavedCents: existing.currentSavedCents,
        targetDate: existing.targetDate,
        recurringContributionCents: existing.recurringContributionCents,
        contributionCadence: existing.contributionCadence,
        liquidityNeed: existing.liquidityNeed,
        preservationPreference: existing.preservationPreference,
        confidence: existing.confidence,
        notes: existing.notes,
      });
      const merged = goalInputSchema.parse({ ...existingInput, ...changes });
      if (merged.targetDate < (await clock.today()))
        throw new ValidationAppError('Target date cannot be before the application date.');
      const updated = await repository.updateGoal(user.id, existing.id, merged, version);
      if (updated === null) throw new ConflictAppError('The goal changed. Refresh and try again.');
      return updated;
    },
  );

  app.delete(
    '/api/v1/goals/:goalId',
    { schema: { params: goalIdParameters } },
    async (request, reply) => {
      const user = await requireUser(request, repository);
      if (!(await repository.deleteGoal(user.id, request.params.goalId)))
        throw new ResourceNotFoundError();
      return reply.status(204).send();
    },
  );

  app.post(
    '/api/v1/goals/:goalId/activate',
    { schema: { params: goalIdParameters, body: activationInputSchema } },
    async (request, reply) => {
      const user = await requireUser(request, repository);
      const goal = await repository.getGoal(user.id, request.params.goalId);
      if (goal === null) throw new ResourceNotFoundError();
      const asOfDate = await clock.today();
      const projection = compareVehicles(goal, asOfDate, await rateProvider.getCatalog(asOfDate));
      const selected = projection.vehicles.find(
        (vehicle) => vehicle.vehicleCode === request.body.vehicleCode,
      );
      if (!selected?.eligible)
        throw new ConflictAppError('Choose an eligible illustrative vehicle.');
      const nextContributionDate =
        generateContributionDates(asOfDate, goal.targetDate, goal.contributionCadence)[0] ?? null;
      try {
        await goalAccountProvider.open({
          userId: user.id,
          goal,
          vehicleCode: request.body.vehicleCode,
          projection,
          asOfDate,
          nextContributionDate,
        });
      } catch (error) {
        if (isUniqueViolation(error))
          throw new ConflictAppError('Only one running goal is allowed.');
        if (error instanceof StateConflictError) throw new ConflictAppError(error.message);
        throw error;
      }
      return reply
        .status(201)
        .send({ account: await goalAccountProvider.summary(user.id, goal.id, asOfDate) });
    },
  );

  const stateRoute = (
    path: string,
    fromStates: readonly ('active' | 'paused' | 'purchase_ready')[],
    toState: 'active' | 'paused' | 'completed' | 'archived',
    eventType: 'paused' | 'resumed' | 'goal_completed',
  ): void => {
    app.post(path, { schema: { params: goalIdParameters } }, async (request) => {
      const user = await requireUser(request, repository);
      const effectiveDate = await clock.today();
      if (
        !(await repository.setGoalState(
          user.id,
          request.params.goalId,
          fromStates,
          toState,
          eventType,
          effectiveDate,
        ))
      )
        throw new ResourceNotFoundError();
      return { goal: await repository.getGoal(user.id, request.params.goalId) };
    });
  };
  stateRoute('/api/v1/goals/:goalId/pause', ['active'], 'paused', 'paused');
  stateRoute('/api/v1/goals/:goalId/resume', ['paused'], 'active', 'resumed');
  stateRoute('/api/v1/goals/:goalId/complete', ['purchase_ready'], 'completed', 'goal_completed');
  app.post(
    '/api/v1/goals/:goalId/archive',
    { schema: { params: goalIdParameters } },
    async (request) => {
      const user = await requireUser(request, repository);
      if (!(await repository.archiveGoal(user.id, request.params.goalId)))
        throw new ResourceNotFoundError();
      return { goal: await repository.getGoal(user.id, request.params.goalId) };
    },
  );

  app.get(
    '/api/v1/goals/:goalId/ledger',
    { schema: { params: goalIdParameters } },
    async (request) => {
      const user = await requireUser(request, repository);
      if ((await repository.getGoal(user.id, request.params.goalId)) === null)
        throw new ResourceNotFoundError();
      return { activity: await goalAccountProvider.getActivity(user.id, request.params.goalId) };
    },
  );

  app.post(
    '/api/v1/goals/:goalId/contributions',
    {
      schema: {
        params: goalIdParameters,
        body: contributionInputSchema,
        headers: idempotencyHeaders,
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, repository);
      if ((await repository.getGoal(user.id, request.params.goalId)) === null)
        throw new ResourceNotFoundError();
      const key = request.headers['idempotency-key'];
      if (request.body.effectiveDate !== (await clock.today()))
        throw new ValidationAppError(
          'Simulated contributions must use the current application date.',
        );
      const occurrenceId = `manual:${sha256(`${user.id}:${key}`)}`;
      let result;
      try {
        result = await contributionProvider.post({
          userId: user.id,
          goalId: request.params.goalId,
          amountCents: request.body.amountCents,
          effectiveDate: request.body.effectiveDate,
          occurrenceId,
          idempotencyKey: key,
          requestHash: sha256(JSON.stringify(request.body)),
          simulateFailure: request.body.simulateFailure ?? false,
        });
      } catch (error) {
        if (error instanceof IdempotencyConflictError) throw new ConflictAppError(error.message);
        if (error instanceof StateConflictError) throw new ConflictAppError(error.message);
        throw error;
      }
      return reply.status(result.duplicate ? 200 : 201).send(result);
    },
  );

  app.post('/api/v1/data-exports', async (request, reply) => {
    const user = await requireUser(request, repository);
    const result = await repository.createCompletedExport(user.id);
    return reply.status(201).send({ ...result, status: 'completed' });
  });

  app.post('/api/v1/account-deletion', async (request, reply) => {
    const user = await requireUser(request, repository);
    const deleted = await repository.deleteAccount(
      user.id,
      sha256(`deleted:${user.id}:${configuration.SESSION_SECRET}`),
    );
    clearSessionCookies(reply);
    return reply.status(deleted ? 200 : 204).send(deleted ? { status: 'completed' } : undefined);
  });

  app.get('/api/v1/session-status', async (request) => ({
    authenticated: (await currentUser(request, repository)) !== null,
  }));

  return app;
}
