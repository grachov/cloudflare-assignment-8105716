import { env } from 'cloudflare:workers';
import { applyD1Migrations, type D1Migration } from 'cloudflare:test';

// Test-only bindings injected by vitest.config.ts (kept off Cloudflare.Env so worker code cannot see them).
const testEnv = env as typeof env & {
  TEST_MIGRATIONS: D1Migration[];
  TEST_SEED_SQL: string;
};

// Both steps are idempotent (migrations are tracked by name; the seed uses INSERT OR IGNORE).
await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);

// seed/seed.sql has one statement per line ending in ';'; comment and blank lines are skipped.
const statements = testEnv.TEST_SEED_SQL.split('\n')
  .map((line) => line.trim())
  .filter((line) => line !== '' && !line.startsWith('--'));
await testEnv.DB.batch(statements.map((sql) => testEnv.DB.prepare(sql)));
