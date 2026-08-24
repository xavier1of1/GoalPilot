import { hashPassword } from '@goalpilot/auth';
import { createDatabaseClient } from '@goalpilot/data-access';
import { catalogVersion, illustrativeAssumptions } from '@goalpilot/domain';

import { seedJapanTripFixture } from './demo-fixture.js';
import { getDatabaseUrl, loadLocalEnvironment } from './runtime-config.js';

loadLocalEnvironment();
const database = createDatabaseClient(getDatabaseUrl(), 1);

try {
  const fixtureUsers = [
    {
      id: '01K3C8ALEX0000000000000000',
      email: 'alex@example.test',
      displayName: 'Alex Morgan',
      password: 'GoalPilot-Alex-2026!',
    },
    {
      id: '01K3C8SAM00000000000000000',
      email: 'sam@example.test',
      displayName: 'Sam Rivera',
      password: 'GoalPilot-Sam-2026!',
    },
  ] as const;
  for (const user of fixtureUsers) {
    const passwordHash = await hashPassword(user.password, Buffer.from(user.id.slice(0, 16)));
    const restoredUsers = await database<{ readonly id: string }[]>`
      INSERT INTO users (id, email, display_name, password_hash)
      VALUES (${user.id}, ${user.email}, ${user.displayName}, ${passwordHash})
      ON CONFLICT (email) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        password_hash = EXCLUDED.password_hash,
        updated_at = now(),
        deleted_at = NULL
      WHERE users.id = EXCLUDED.id
      RETURNING id
    `;
    if (restoredUsers[0]?.id !== user.id) {
      throw new Error(
        `Refusing to overwrite non-fixture user state for seeded identity ${user.email}.`,
      );
    }
  }
  const firstAssumption = illustrativeAssumptions[0];
  if (firstAssumption === undefined) throw new Error('The illustrative catalog cannot be empty.');
  await database`
    INSERT INTO vehicle_assumption_versions
      (version, effective_date, reviewed_date, source_type, is_live)
    VALUES (
      ${catalogVersion}, ${firstAssumption.effectiveDate}, ${firstAssumption.reviewedDate},
      ${firstAssumption.sourceType}, false
    )
    ON CONFLICT (version) DO NOTHING
  `;
  for (const assumption of illustrativeAssumptions) {
    await database`
      INSERT INTO vehicle_assumptions
        (version, vehicle_code, display_name, apy_basis_points, liquidity_days, lock_days,
         minimum_cents, source_label, enabled)
      VALUES (
        ${assumption.assumptionVersion}, ${assumption.vehicleCode}, ${assumption.displayName},
        ${assumption.apyBasisPoints}, ${assumption.liquidityDays}, ${assumption.lockDays},
        ${assumption.minimumCents}, ${assumption.sourceLabel}, ${assumption.enabled}
      )
      ON CONFLICT (version, vehicle_code) DO NOTHING
    `;
  }
  const applicationDate = process.env['APPLICATION_DATE'] ?? '2026-08-23';
  await database`
    INSERT INTO application_clock (singleton, application_date)
    VALUES (true, ${applicationDate})
    ON CONFLICT (singleton) DO UPDATE SET
      application_date = EXCLUDED.application_date,
      updated_at = now()
  `;
  await seedJapanTripFixture(database);
  process.stdout.write(
    'Loaded deterministic local users, assumptions, application clock, and Japan-trip fixture.\n',
  );
} finally {
  await database.end();
}
