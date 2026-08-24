import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
  assertReleaseDatabaseUrl,
  createReleaseEnvironment,
  parseReleaseArguments,
  resolveReleaseDatabaseUrl,
} from './local-release.js';
import {
  assertNoAwsDependencyNames,
  assertLatestTimingLabAssessment,
  assertTimingLabOpenApiPaths,
  assertTimingLabRunCreatedAssessment,
  cookiePairs,
  parseSmokeArguments,
  timingLabFixtureItemId,
} from './local-smoke.js';

describe('local release safety policy', () => {
  it('requires an explicit mode and dedicated, distinct ports', () => {
    assert.deepEqual(parseReleaseArguments(['--mode', 'local']), {
      mode: 'local',
      apiPort: 3200,
      webPort: 5373,
    });
    assert.deepEqual(
      parseReleaseArguments(['--mode', 'demo', '--api-port', '4320', '--web-port', '6373']),
      { mode: 'demo', apiPort: 4320, webPort: 6373 },
    );
    assert.throws(() => parseReleaseArguments([]), /mode is required/i);
    assert.throws(() => parseReleaseArguments(['--mode', 'staging']), /local.*demo/i);
    assert.throws(
      () => parseReleaseArguments(['--mode', 'local', '--api-port', '3000']),
      /dedicated/i,
    );
    assert.throws(
      () => parseReleaseArguments(['--mode', 'local', '--api-port', '4320', '--web-port', '4320']),
      /different ports/i,
    );
  });

  it('accepts only the loopback non-test PostgreSQL database', () => {
    assert.equal(
      assertReleaseDatabaseUrl('postgres://goalpilot:secret@127.0.0.1:5432/goalpilot_local')
        .hostname,
      '127.0.0.1',
    );
    assert.throws(
      () =>
        assertReleaseDatabaseUrl(
          'postgres://goalpilot:secret@host.docker.internal:5432/goalpilot_local',
        ),
      /loopback/i,
    );
    assert.equal(
      assertReleaseDatabaseUrl(
        'postgres://goalpilot:secret@host.docker.internal:5432/goalpilot_local',
        true,
      ).hostname,
      'host.docker.internal',
    );
    assert.equal(
      new URL(
        resolveReleaseDatabaseUrl(
          'postgres://goalpilot:secret@localhost:5432/goalpilot_local',
          true,
        ),
      ).hostname,
      'host.docker.internal',
    );
    assert.equal(
      new URL(
        resolveReleaseDatabaseUrl(
          'postgres://goalpilot:secret@localhost:5432/goalpilot_local',
          false,
        ),
      ).hostname,
      'localhost',
    );
    assert.throws(
      () => assertReleaseDatabaseUrl('postgres://goalpilot:secret@localhost:5432/goalpilot_test'),
      /goalpilot_local/i,
    );
  });

  it('pins local simulation flags and removes inherited AWS settings', () => {
    const base = {
      SESSION_SECRET: 'local-test-secret-at-least-thirty-two-characters',
      AWS_REGION: 'us-east-1',
      AWS_ACCESS_KEY_ID: 'not-used',
      GOALPILOT_DEVCONTAINER: 'true',
    };
    const local = createReleaseEnvironment(
      { mode: 'local', apiPort: 3200, webPort: 5373 },
      'postgres://goalpilot:secret@localhost:5432/goalpilot_local',
      base,
    );
    assert.equal(local['API_BIND_HOST'], '127.0.0.1');
    assert.equal(local['NODE_ENV'], 'production');
    assert.equal(local['FINANCIAL_PROVIDER_MODE'], 'simulated');
    assert.equal(local['DEMO_STORY_ENABLED'], 'false');
    assert.equal(local['PURCHASE_TIMING_LAB_ENABLED'], 'false');
    assert.equal(local['AWS_REGION'], undefined);
    assert.equal(local['AWS_ACCESS_KEY_ID'], undefined);
    assert.equal(local['GOALPILOT_DEVCONTAINER'], undefined);

    const demo = createReleaseEnvironment(
      { mode: 'demo', apiPort: 3200, webPort: 5373 },
      'postgres://goalpilot:secret@localhost:5432/goalpilot_local',
      base,
    );
    assert.equal(demo['DEMO_STORY_ENABLED'], 'true');
    assert.equal(demo['PURCHASE_TIMING_LAB_ENABLED'], 'true');
  });
});

describe('local smoke helpers', () => {
  it('parses matching dedicated smoke ports', () => {
    assert.deepEqual(parseSmokeArguments([]), { apiPort: 3200, webPort: 5373 });
    assert.deepEqual(parseSmokeArguments(['--api-port', '4320', '--web-port', '6373']), {
      apiPort: 4320,
      webPort: 6373,
    });
    assert.throws(
      () => parseSmokeArguments(['--api-port', '4320', '--web-port', '4320']),
      /different/i,
    );
    assert.throws(() => parseSmokeArguments(['--web-port', '5173']), /dedicated/i);
  });

  it('retains cookie name/value pairs and rejects AWS runtime dependencies', () => {
    assert.deepEqual(
      cookiePairs([
        'goalpilot_session=abc.def; Path=/; HttpOnly; SameSite=Lax',
        'goalpilot_csrf=token; Path=/; SameSite=Lax',
      ]),
      ['goalpilot_session=abc.def', 'goalpilot_csrf=token'],
    );
    assert.doesNotThrow(() =>
      assertNoAwsDependencyNames(['fastify', '@goalpilot/domain', 'postgres']),
    );
    assert.throws(
      () => assertNoAwsDependencyNames(['fastify', '@aws-sdk/client-s3']),
      /AWS runtime dependencies/i,
    );
  });

  it('requires every Timing Lab OpenAPI operation used by demo smoke', () => {
    const completePaths = {
      '/api/v1/timing-lab/purchase-items': { get: {} },
      '/api/v1/timing-lab/run-due-price-checks': { post: {} },
      '/api/v1/timing-lab/purchase-items/{itemId}/latest': { get: {} },
    };
    assert.doesNotThrow(() => assertTimingLabOpenApiPaths(completePaths));
    assert.throws(
      () =>
        assertTimingLabOpenApiPaths({
          ...completePaths,
          '/api/v1/timing-lab/run-due-price-checks': undefined,
        }),
      /requires OpenAPI path.*run-due-price-checks/i,
    );
    assert.throws(
      () =>
        assertTimingLabOpenApiPaths({
          ...completePaths,
          '/api/v1/timing-lab/purchase-items/{itemId}/latest': { post: {} },
        }),
      /requires GET.*latest/i,
    );
  });

  it('rejects optional or stale Timing Lab run success', () => {
    const completed = {
      status: 'completed',
      duePolicyCount: 1,
      completedRunCount: 1,
      failedRunCount: 0,
      assessmentsCreated: 1,
    };
    assert.doesNotThrow(() => assertTimingLabRunCreatedAssessment(completed));
    assert.throws(
      () => assertTimingLabRunCreatedAssessment({ ...completed, status: 'no_due_policies' }),
      /expected "completed"/i,
    );
    assert.throws(
      () => assertTimingLabRunCreatedAssessment({ ...completed, assessmentsCreated: 0 }),
      /newly created assessment/i,
    );
    assert.throws(
      () => assertTimingLabRunCreatedAssessment({ ...completed, failedRunCount: 1 }),
      /failed run count/i,
    );
  });

  it('requires the seeded fixture item and its latest assessment', () => {
    const goalId = '01K3C8DEMX0000000000000000';
    const itemId = '01K3C8DEMX0000000000000001';
    assert.equal(
      timingLabFixtureItemId(
        {
          items: [
            {
              id: itemId,
              goalId,
              fixtureCode: 'synthetic_oled_65_v1',
            },
          ],
        },
        goalId,
      ),
      itemId,
    );
    assert.throws(
      () => timingLabFixtureItemId({ items: [] }, goalId),
      /missing the seeded synthetic OLED item/i,
    );
    assert.doesNotThrow(() =>
      assertLatestTimingLabAssessment(
        { item: { id: itemId }, assessment: { state: 'wait' } },
        itemId,
      ),
    );
    assert.throws(
      () => assertLatestTimingLabAssessment({ item: { id: itemId }, assessment: null }, itemId),
      /without producing a latest assessment/i,
    );
    assert.throws(
      () => assertLatestTimingLabAssessment({ item: { id: itemId } }, itemId),
      /without producing a latest assessment/i,
    );
  });
});
