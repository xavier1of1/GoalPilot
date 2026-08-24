import { describe, expect, it } from 'vitest';

import {
  assertLocalDatabaseUrl,
  databaseIdentity,
  resolveDatabaseUrlForRuntime,
  sameDatabase,
} from '../scripts/runtime-config.js';

describe('local database target safety', () => {
  it('normalizes equivalent loopback identities and default ports', () => {
    expect(
      sameDatabase(
        'postgres://goalpilot:secret@localhost:5432/goalpilot_test',
        'postgres://goalpilot:secret@127.0.0.1/goalpilot_test?application_name=test',
      ),
    ).toBe(true);
    expect(databaseIdentity('postgres://goalpilot:secret@[::1]/goalpilot_test')).toMatchObject({
      host: 'loopback',
      port: '5432',
      database: 'goalpilot_test',
    });
  });

  it('requires exact role-specific names on loopback hosts', () => {
    expect(() =>
      assertLocalDatabaseUrl(
        'postgres://goalpilot:secret@localhost/goalpilot_test_copy',
        'goalpilot_test',
      ),
    ).toThrow('Refusing destructive database action');
    expect(() =>
      assertLocalDatabaseUrl(
        'postgres://goalpilot:secret@database.example/goalpilot_test',
        'goalpilot_test',
      ),
    ).toThrow('Refusing destructive database action');
    expect(() =>
      assertLocalDatabaseUrl(
        'postgres://goalpilot:secret@host.docker.internal:55432/goalpilot_local',
        'goalpilot_local',
        false,
      ),
    ).toThrow('Refusing destructive database action');
    expect(
      assertLocalDatabaseUrl(
        'postgres://goalpilot:secret@host.docker.internal:55432/goalpilot_local',
        'goalpilot_local',
        true,
      ).pathname,
    ).toBe('/goalpilot_local');
    expect(() =>
      assertLocalDatabaseUrl('https://localhost/goalpilot_local', 'goalpilot_local'),
    ).toThrow('Refusing destructive database action');
  });

  it('uses the explicit Dev Container marker for loopback bridge translation', () => {
    const bridged = new URL(
      resolveDatabaseUrlForRuntime(
        'postgres://goalpilot:secret@127.0.0.1:55432/goalpilot_test?application_name=test',
        true,
      ),
    );
    expect(bridged.hostname).toBe('host.docker.internal');
    expect(bridged.port).toBe('55432');
    expect(bridged.searchParams.get('application_name')).toBe('test');

    expect(
      resolveDatabaseUrlForRuntime(
        'postgres://goalpilot:secret@database.example:5432/goalpilot_test',
        true,
      ),
    ).toBe('postgres://goalpilot:secret@database.example:5432/goalpilot_test');
  });
});
