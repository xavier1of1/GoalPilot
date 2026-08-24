import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { priceCheckRunSummarySchema, type PriceCheckRunSummary } from '@goalpilot/contracts';
import { runDuePriceChecks } from '@goalpilot/api';
import {
  createDatabaseClient,
  GoalPilotRepository,
  PlanExperienceRepository,
  ProductExperienceRepository,
  PurchaseTimingRepository,
  type DatabaseClient,
} from '@goalpilot/data-access';
import {
  FixtureHistoricalPriceProvider,
  SimulatedGoalAccountProvider,
} from '@goalpilot/provider-simulators';
import { assertLocalDatabaseUrl, getDatabaseUrl, loadLocalEnvironment } from './runtime-config.js';

interface JapanFixtureClock {
  readonly userId: string;
  readonly applicationDate: string;
}

function calendarDate(value: string | Date): string {
  return typeof value === 'string' ? value : value.toISOString().slice(0, 10);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function localSessionSecret(): string {
  const secret = process.env['SESSION_SECRET'];
  if (secret === undefined || secret.length < 32) {
    throw new Error('SESSION_SECRET must contain at least 32 characters for routine telemetry.');
  }
  return secret;
}

export function assertPriceWatchRunTarget(
  databaseUrl: string,
  environment: string | undefined,
): 'goalpilot_local' | 'goalpilot_test' {
  if (environment !== 'local' && environment !== 'test')
    throw new Error('Price Watch execution is disabled outside local/test.');
  const expectedDatabase = environment === 'test' ? 'goalpilot_test' : 'goalpilot_local';
  assertLocalDatabaseUrl(databaseUrl, expectedDatabase);
  return expectedDatabase;
}

export async function resolveJapanFixtureClock(
  database: DatabaseClient,
): Promise<JapanFixtureClock> {
  const rows = await database<
    { readonly user_id: string; readonly application_date: string | Date }[]
  >`
    SELECT fixture.user_id, clock.application_date
    FROM demo_fixture_users fixture
    JOIN users owner ON owner.id = fixture.user_id AND owner.deleted_at IS NULL
    JOIN user_application_clocks clock ON clock.user_id = fixture.user_id
    WHERE fixture.fixture_key = 'japan-trip'
      AND owner.email = 'demo.japan@example.test'
  `;
  if (rows.length !== 1)
    throw new Error('The dedicated Japan demo fixture and owner clock must exist exactly once.');
  const fixture = rows[0];
  if (fixture === undefined) throw new Error('The dedicated Japan demo fixture is unavailable.');
  return { userId: fixture.user_id, applicationDate: calendarDate(fixture.application_date) };
}

export async function runJapanFixturePriceWatch(
  database: DatabaseClient,
): Promise<PriceCheckRunSummary> {
  const fixture = await resolveJapanFixtureClock(database);
  const repository = new GoalPilotRepository(database);
  const experienceRepository = new ProductExperienceRepository(database);
  const sessionSecret = localSessionSecret();
  return runDuePriceChecks(
    {
      timingRepository: new PurchaseTimingRepository(database),
      planRepository: new PlanExperienceRepository(database),
      goalAccountProvider: new SimulatedGoalAccountProvider(repository),
      historicalPriceProvider: new FixtureHistoricalPriceProvider(),
      recordOutcomeEvent: async (outcome) => {
        const event = {
          eventName: outcome.eventName,
          demo: true,
          applicationVersion: 'product-experience-v1' as const,
        };
        await experienceRepository.recordProductEvent({
          userId: outcome.userId,
          subjectHash: sha256(`product-event:${outcome.userId}:${sessionSecret}`),
          event,
          idempotencyKey: [
            'timing-routine',
            outcome.applicationDate,
            outcome.eventName,
            'demo',
          ].join(':'),
          requestHash: sha256(JSON.stringify(event)),
        });
      },
    },
    fixture,
  );
}

export async function main(): Promise<void> {
  loadLocalEnvironment();
  const databaseUrl = getDatabaseUrl();
  const environment = process.env['ENVIRONMENT'];
  assertPriceWatchRunTarget(databaseUrl, environment);
  const database = createDatabaseClient(databaseUrl, 2);
  try {
    const summary = priceCheckRunSummarySchema.parse(await runJapanFixturePriceWatch(database));
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } finally {
    await database.end();
  }
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(invokedPath)).href
) {
  await main();
}
