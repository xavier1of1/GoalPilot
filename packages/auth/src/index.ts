import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

import type { AuthProvider } from '@goalpilot/provider-ports';
import type { UserDto } from '@goalpilot/contracts';

const keyLength = 64;
const scryptCost = 16_384;

function deriveKey(
  password: string,
  salt: Buffer,
  length: number,
  options: { readonly N: number; readonly r: number; readonly p: number; readonly maxmem: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, length, options, (error, derivedKey) => {
      if (error !== null) reject(error);
      else resolve(derivedKey);
    });
  });
}

export interface CredentialStore {
  createUser(input: {
    readonly email: string;
    readonly passwordHash: string;
    readonly displayName: string;
  }): Promise<UserDto>;
  findCredentialByEmail(
    email: string,
  ): Promise<{ readonly user: UserDto; readonly passwordHash: string } | null>;
}

export async function hashPassword(password: string, salt = randomBytes(16)): Promise<string> {
  const derived = await deriveKey(password, salt, keyLength, {
    N: scryptCost,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return `$scrypt$${String(scryptCost)}$8$1$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parsed = /^\$scrypt\$16384\$8\$1\$([0-9a-f]{32})\$([0-9a-f]{128})$/.exec(encoded);
  if (parsed === null) return false;
  const [, saltHex, expectedHex] = parsed;
  if (saltHex === undefined || expectedHex === undefined) return false;
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = await deriveKey(password, Buffer.from(saltHex, 'hex'), keyLength, {
    N: scryptCost,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return timingSafeEqual(actual, expected);
}

export class LocalAuthProvider implements AuthProvider {
  public constructor(private readonly credentials: CredentialStore) {}

  public async register(input: {
    readonly email: string;
    readonly password: string;
    readonly displayName: string;
  }): Promise<UserDto> {
    const passwordHash = await hashPassword(input.password);
    return this.credentials.createUser({
      email: input.email,
      passwordHash,
      displayName: input.displayName,
    });
  }

  public async verify(email: string, password: string): Promise<UserDto | null> {
    const credential = await this.credentials.findCredentialByEmail(email);
    if (credential === null) {
      await hashPassword(password, Buffer.alloc(16, 1));
      return null;
    }
    return (await verifyPassword(password, credential.passwordHash)) ? credential.user : null;
  }
}
