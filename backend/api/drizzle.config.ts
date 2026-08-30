import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://unsaid:unsaid_local_dev@localhost:54332/unsaid',
  },
  strict: true,
  verbose: true,
});
