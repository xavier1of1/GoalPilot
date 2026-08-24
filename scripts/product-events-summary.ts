import { createDatabaseClient } from '@goalpilot/data-access';

import { getDatabaseUrl, loadLocalEnvironment } from './runtime-config.js';

loadLocalEnvironment();
const database = createDatabaseClient(getDatabaseUrl(), 1);

try {
  const eventCounts = await database<{ readonly event_name: string; readonly count: string }[]>`
    SELECT event_name, COUNT(*)::text AS count
    FROM product_events
    GROUP BY event_name
    ORDER BY event_name
  `;
  const builderStepCounts = await database<
    { readonly builder_step: string; readonly count: string }[]
  >`
    SELECT builder_step, COUNT(*)::text AS count
    FROM product_events
    WHERE builder_step IS NOT NULL
    GROUP BY builder_step
    ORDER BY CASE builder_step
      WHEN 'goal' THEN 1
      WHEN 'starting_point' THEN 2
      WHEN 'budget_fit' THEN 3
      WHEN 'access' THEN 4
      ELSE 5
    END
  `;
  process.stdout.write(
    `${JSON.stringify(
      {
        eventCounts: eventCounts.map((row) => ({
          eventName: row.event_name,
          count: Number(row.count),
        })),
        builderStepCounts: builderStepCounts.map((row) => ({
          builderStep: row.builder_step,
          count: Number(row.count),
        })),
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await database.end();
}
