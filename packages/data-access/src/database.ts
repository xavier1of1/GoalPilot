import postgres from 'postgres';

export type DatabaseClient = ReturnType<typeof postgres>;

export function createDatabaseClient(databaseUrl: string, maxConnections = 10): DatabaseClient {
  return postgres(databaseUrl, {
    max: maxConnections,
    idle_timeout: 20,
    connect_timeout: 10,
    transform: { undefined: null },
  });
}

export async function checkDatabase(client: DatabaseClient): Promise<void> {
  const rows = await client<{ ready: boolean }[]>`
    SELECT
      EXISTS(SELECT 1 FROM schema_migrations) AND
      EXISTS(SELECT 1 FROM application_clock WHERE singleton = true) AND
      EXISTS(SELECT 1 FROM vehicle_assumption_versions WHERE is_live = false) AS ready
  `;
  if (!rows[0]?.ready)
    throw new Error('Required migrations or deterministic seed data are missing.');
}
