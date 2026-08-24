import { describe, expect, it } from 'vitest';

import { hashPassword, LocalAuthProvider, verifyPassword } from './index.js';

describe('local authentication', () => {
  it('hashes passwords with a salt and verifies without retaining plaintext', async () => {
    const first = await hashPassword('GoalPilot-Strong-Test-Password!');
    const second = await hashPassword('GoalPilot-Strong-Test-Password!');
    expect(first).not.toBe(second);
    expect(first).not.toContain('Strong-Test-Password');
    await expect(verifyPassword('GoalPilot-Strong-Test-Password!', first)).resolves.toBe(true);
    await expect(verifyPassword('wrong password', first)).resolves.toBe(false);
  });

  it('returns null for an unknown user after performing password work', async () => {
    const provider = new LocalAuthProvider({
      createUser: () => Promise.reject(new Error('not used')),
      findCredentialByEmail: () => Promise.resolve(null),
    });
    await expect(provider.verify('missing@example.test', 'synthetic password')).resolves.toBeNull();
  });

  it.each([
    '$scrypt$16384$8$1$00$zz',
    '$scrypt$16384$8$1$00112233445566778899aabbccddeeff$',
    '$scrypt$32768$8$1$00112233445566778899aabbccddeeff$' + '00'.repeat(64),
    '$argon2$16384$8$1$00112233445566778899aabbccddeeff$' + '00'.repeat(64),
  ])('rejects a malformed or unsupported stored hash: %s', async (encoded) => {
    await expect(verifyPassword('any password', encoded)).resolves.toBe(false);
  });
});
