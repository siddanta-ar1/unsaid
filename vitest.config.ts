import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

/**
 * Loads `.env` for integration tests. Deliberately not `dotenv`: the file is a
 * handful of KEY=VALUE lines and the API's own config validator does the real
 * checking, so an extra dependency in the security-critical path is not worth it.
 */
function loadDotEnv(path = '.env'): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync(path, 'utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
        .map((line) => {
          const eq = line.indexOf('=');
          return [line.slice(0, eq).trim(), line.slice(eq + 1).trim()];
        }),
    );
  } catch {
    return {};
  }
}

export default defineConfig({
  test: {
    // Node 20's global WebCrypto is the same SubtleCrypto implementation the
    // browser exposes, so crypto tests run identically in both.
    environment: 'node',
    include: ['**/src/**/*.test.ts', '**/tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    env: loadDotEnv(),
    // Integration tests share one Postgres and one bucket; run them serially.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
