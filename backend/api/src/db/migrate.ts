import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDatabase } from './client.js';
import { loadConfig } from '../lib/config.js';

/** Forward-only migrations, run in CI and on deploy (§20.2). */
const config = loadConfig();
const db = createDatabase(config.DATABASE_URL);

// Say which database this is about to alter. Migrations are forward-only, so
// running them against the wrong host is not something you undo — and the two
// candidates differ by one environment variable.
const { hostname, port, pathname } = new URL(config.DATABASE_URL);
console.log(`migrating ${hostname}:${port || 5432}${pathname}`);

await migrate(db, { migrationsFolder: new URL('../../drizzle', import.meta.url).pathname });
console.log('migrations applied');
process.exit(0);
