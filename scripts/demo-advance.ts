import { createDatabaseClient, GoalPilotRepository } from '@goalpilot/data-access';
import { calendarDateSchema } from '@goalpilot/contracts';
import { addCalendarDays, daysBetween } from '@goalpilot/domain';
import { processDemoAutopilot } from '@goalpilot/api/demo-autopilot';

import { getDatabaseUrl, loadLocalEnvironment } from './runtime-config.js';

loadLocalEnvironment();
if (!['local', 'test'].includes(process.env['ENVIRONMENT'] ?? '')) {
  throw new Error('Demo Autopilot is disabled outside local/test.');
}
const database = createDatabaseClient(getDatabaseUrl(), 1);
const repository = new GoalPilotRepository(database);
try {
  const currentDate = await repository.getApplicationDate();
  const daysIndex = process.argv.indexOf('--days');
  const toIndex = process.argv.indexOf('--to');
  const days = daysIndex >= 0 ? Number(process.argv[daysIndex + 1]) : null;
  const explicitDate = toIndex >= 0 ? process.argv[toIndex + 1] : undefined;
  if (days === null && explicitDate === undefined)
    throw new Error('Use --days 30 or --to YYYY-MM-DD.');
  if (days !== null && (!Number.isInteger(days) || days < 0 || days > 366))
    throw new Error('--days must be an integer from 0 through 366.');
  const targetDate = calendarDateSchema.parse(
    explicitDate ?? addCalendarDays(currentDate, days ?? 0),
  );
  if (daysBetween(currentDate, targetDate) > 366)
    throw new Error('Demo Autopilot can advance at most 366 days per command.');
  const result = await processDemoAutopilot(repository, targetDate);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.failures.length > 0) process.exitCode = 1;
} finally {
  await database.end();
}
