import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDatabase } from './client.js';
import { loadConfig } from '../lib/config.js';

/** Forward-only migrations, run in CI and on deploy (§20.2). */
const config = loadConfig();
const db = createDatabase(config.DATABASE_URL);

await migrate(db, { migrationsFolder: new URL('../../drizzle', import.meta.url).pathname });
console.log('migrations applied');
process.exit(0);
