import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const ignoredDirectories = new Set(['.git', 'node_modules', 'dist', 'coverage', 'artifacts']);
const allowedFiles = new Set(['.env.example', 'security-scan.test.ts']);
const forbiddenPatterns = [
  /AKIA[0-9A-Z]{16}/g,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  /(?:api[_-]?key|secret[_-]?key)\s*[:=]\s*['"][^'"]{12,}['"]/gi,
];

async function sourceFiles(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries
      .filter((entry) => !ignoredDirectories.has(entry.name))
      .map(async (entry) => {
        const fullPath = path.join(directory, entry.name);
        return entry.isDirectory() ? sourceFiles(fullPath) : [fullPath];
      }),
  );
  return nested.flat();
}

const findings: string[] = [];
for (const filename of await sourceFiles('.')) {
  if (allowedFiles.has(path.basename(filename))) continue;
  const extension = path.extname(filename).toLowerCase();
  if (!['.ts', '.tsx', '.js', '.json', '.yaml', '.yml', '.md', '.sql', '.sh'].includes(extension))
    continue;
  const source = await readFile(filename, 'utf8');
  if (
    forbiddenPatterns.some((pattern) => {
      pattern.lastIndex = 0;
      return pattern.test(source);
    })
  )
    findings.push(filename);
}
if (findings.length > 0) {
  process.stderr.write(`Potential secret material found in:\n${findings.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('No committed secret patterns detected.\n');
}
