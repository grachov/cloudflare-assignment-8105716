import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { InvoiceDTO, RunDTO } from '../../src/shared/types';
import { ORIGIN, api, newKey, postRun, runToCompletion } from './helpers';

/** POST a run without a Workflow introspector (disposing one removes the instance) and poll until it completes. */
async function runWithoutIntrospector(key: string): Promise<void> {
  expect((await postRun(key, 'normal')).status).toBe(202);
  await expect
    .poll(
      async () =>
        ((await (await api(`/api/runs/run-${key}`)).json()) as RunDTO).status,
      { timeout: 15_000, interval: 200 },
    )
    .toBe('complete');
}

async function count(table: 'findings' | 'reconciliation_runs') {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{
    n: number;
  }>();
  return row?.n;
}

describe('DELETE /api/runs (demo reset)', () => {
  it('deletes every run and finding, keeps the ledger, and retires used keys', async () => {
    const key = newKey();
    await runWithoutIntrospector(key);
    await runToCompletion('simulate_failure');

    const res = await api('/api/runs', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: { runs: 2, findings: 34 } });
    expect(await count('reconciliation_runs')).toBe(0);
    expect(await count('findings')).toBe(0);

    const invoices = (await (await api('/api/invoices')).json()) as {
      latestRunId: string | null;
      invoices: InvoiceDTO[];
    };
    expect(invoices.latestRunId).toBeNull();
    expect(invoices.invoices).toHaveLength(15);
    expect(new Set(invoices.invoices.map((i) => i.status))).toEqual(
      new Set(['not_reconciled']),
    );

    // The finished Workflow instance outlives the reset, so the old key can never run again: 409, no row left.
    const replay = await postRun(key, 'normal');
    expect(replay.status).toBe(409);
    expect(await replay.json()).toEqual({ error: 'idempotency_key_retired' });
    expect(await count('reconciliation_runs')).toBe(0);

    // A new key still works after the reset.
    const fresh = await runToCompletion('normal');
    expect(fresh.run.status).toBe('complete');
    expect(fresh.run.findings_count).toBe(17);
  });

  it('requires a session', async () => {
    const res = await exports.default.fetch(
      new Request(`${ORIGIN}/api/runs`, { method: 'DELETE' }),
    );
    expect(res.status).toBe(401);
  });
});
