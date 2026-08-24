import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

async function typescriptFiles(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return typescriptFiles(path);
      return entry.isFile() && path.endsWith('.ts') ? [path] : [];
    }),
  );
  return nested.flat();
}

describe('application entrypoint boundaries', () => {
  it('uses public workspace exports instead of deep source imports', async () => {
    const files = await typescriptFiles('scripts');
    const violations: string[] = [];

    for (const file of files) {
      const source = await readFile(file, 'utf8');
      if (/from\s+['"]\.\.\/(?:apps|packages)\/[^'"]*\/src\//.test(source)) {
        violations.push(file);
      }
    }

    expect(violations).toEqual([]);
  });

  it('runs the price-watch CLI through stable public package entrypoints', async () => {
    const source = await readFile('scripts/price-watch-run.ts', 'utf8');

    expect(source).toContain("from '@goalpilot/api'");
    expect(source).toContain("from '@goalpilot/provider-simulators'");
    expect(source).not.toMatch(/from\s+['"]@goalpilot\/(?:api|provider-simulators)\//);
  });
});
