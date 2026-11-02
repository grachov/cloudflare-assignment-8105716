import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const TABLES = [
  'findings',
  'invoices',
  'payments',
  'reconciliation_runs',
  'subscriptions',
];

describe('schema (migrations/0001_init.sql)', () => {
  it('has exactly the 5 application tables', async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND name <> 'd1_migrations' ORDER BY name",
    ).all<{ name: string }>();
    expect(results.map((r) => r.name)).toEqual(TABLES);
  });

  it('has no REAL (or other float) column in any table', async () => {
    for (const table of TABLES) {
      const { results } = await env.DB.prepare(
        `PRAGMA table_info(${table})`,
      ).all<{ name: string; type: string }>();
      expect(results.length).toBeGreaterThan(0);
      for (const col of results)
        expect(col.type.toUpperCase()).not.toMatch(/REAL|FLOA|DOUB/);
      for (const col of results.filter((c) => c.name.endsWith('_minor')))
        expect(col.type).toBe('INTEGER');
    }
  });

  it('rejects a fractional amount_minor', async () => {
    const err = await env.DB.prepare(
      "INSERT INTO payments (id, invoice_ref, amount_minor, currency, received_at, provider_ref) VALUES ('PX1', NULL, ?1, 'USD', '2026-10-01', 'pi_PX1')",
    )
      .bind(1.5)
      .run()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/CHECK constraint failed/);
  });

  it('rejects a currency that is not 3 characters', async () => {
    const err = await env.DB.prepare(
      "INSERT INTO invoices (id, subscription_id, period_start, period_end, amount_minor, currency, issued_at, due_at) VALUES ('INV-X', 'S1', '2026-10-01', '2026-10-31', 100, 'US', '2026-10-01', '2026-10-15')",
    )
      .run()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/CHECK constraint failed/);
  });

  it('is seeded with 5 subscriptions, 15 invoices and 18 payments', async () => {
    const row = await env.DB.prepare(
      'SELECT (SELECT COUNT(*) FROM subscriptions) s, (SELECT COUNT(*) FROM invoices) i, (SELECT COUNT(*) FROM payments) p',
    ).first<{ s: number; i: number; p: number }>();
    expect(row).toEqual({ s: 5, i: 15, p: 18 });
  });
});
