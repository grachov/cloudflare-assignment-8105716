import { readFile } from 'node:fs/promises';
import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';

// Auxiliary Worker bound as `AI` in tests: every method throws so a test can never reach Workers AI.
const aiStubScript = `
import { WorkerEntrypoint } from 'cloudflare:workers';
const fail = () => { throw new Error('AI must not be called in tests'); };
export class AiStub extends WorkerEntrypoint {
  async run() { fail(); }
  async models() { fail(); }
  gateway() { fail(); }
  async toMarkdown() { fail(); }
  autorag() { fail(); }
}
export default { fetch: fail };
`;

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['test/unit/**/*.test.ts'],
        },
      },
      {
        plugins: [
          cloudflareTest(async () => ({
            remoteBindings: false,
            wrangler: { configPath: './wrangler.jsonc' },
            miniflare: {
              // Read in Node and applied by test/integration/setup.ts (seed/seed.sql is the single seed source).
              bindings: {
                TEST_MIGRATIONS: await readD1Migrations('./migrations'),
                TEST_SEED_SQL: await readFile('./seed/seed.sql', 'utf8'),
                // Fixed test-only values (not real secrets); production uses `wrangler secret put`.
                DEMO_PASSCODE: 'test-passcode',
                SESSION_SECRET: 'test-session-secret-not-for-production',
              },
              // Workers AI is remote-only. Merging cannot delete the wrangler.jsonc `ai` binding, so it is renamed
              // out of the way and `AI` is bound to the throwing stub instead.
              ai: { binding: 'AI_REMOTE_UNUSED' },
              serviceBindings: {
                AI: { name: 'ai-stub', entrypoint: 'AiStub' },
              },
              workers: [
                {
                  name: 'ai-stub',
                  modules: true,
                  script: aiStubScript,
                  compatibilityDate: '2026-10-30',
                },
              ],
            },
          })),
        ],
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          setupFiles: ['./test/integration/setup.ts'],
          // The first request transforms the agents/ai-chat module graph inside workerd (several seconds cold).
          testTimeout: 30_000,
        },
      },
    ],
  },
});
