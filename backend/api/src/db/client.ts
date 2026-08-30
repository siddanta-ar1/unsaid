import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { loadConfig } from '../lib/config.js';
import { schema } from './schema.js';

export type Database = ReturnType<typeof createDatabase>;

export function createDatabase(url = loadConfig().DATABASE_URL) {
  const sql = postgres(url, {
    max: 10,
    idle_timeout: 20,
    // Query text can contain nothing sensitive by construction, but disabling
    // notice logging keeps the server's log surface minimal regardless.
    onnotice: () => {},
  });
  return drizzle(sql, { schema });
}

let cached: Database | undefined;

export function getDatabase(): Database {
  cached ??= createDatabase();
  return cached;
}
