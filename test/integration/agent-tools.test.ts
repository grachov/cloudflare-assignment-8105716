import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createTools, ReadOnlyDb } from '../../src/server/agent-tools';
import { loadDataset } from '../../src/server/dataset';
import { reconcile } from '../../src/server/engine/reconcile';
import { toRows } from '../../src/server/findings';
import {
  insertRun,
  markComplete,
  markRunning,
  writeFindings,
} from '../../src/server/runs';
import expectedFindings from '../fixtures/expected-findings.json';

type Tools = ReturnType<typeof createTools>;

// Calls a tool's execute the way the AI SDK would; the options are irrelevant to these tools.
type Exec<K extends keyof Tools> = NonNullable<Tools[K]['execute']>;
function call<K extends keyof Tools>(
  tools: Tools,
  name: K,
  input: Parameters<Exec<K>>[0],
): Promise<Exclude<Awaited<ReturnType<Exec<K>>>, AsyncIterable<unknown>>> {
  const execute = tools[name].execute as (
    input: unknown,
    options: unknown,
  ) => Promise<never>;
  return execute(input, { toolCallId: 't', messages: [] });
}

let runId: string;

// A completed run written through the same engine + D1 path as ReconWorkflow (no HTTP, no Workflow).
beforeAll(async () => {
  const key = crypto.randomUUID();
  runId = `run-${key}`;
  const asOfDate = env.AS_OF_DATE;
  expect(
    await insertRun(env.DB, {
      id: runId,
      key,
      mode: 'normal',
      asOfDate,
      startedAt: new Date().toISOString(),
    }),
  ).toBe(true);
  const dataset = await loadDataset(env.DB);
  await markRunning(env.DB, runId, 'test-hash');
  await writeFindings(
    env.DB,
    runId,
    await toRows(runId, reconcile(dataset, asOfDate)),
  );
  expect(await markComplete(env.DB, runId, new Date().toISOString())).toBe(1);
});

describe('agent tools against the seeded D1', () => {
  const tools = () => createTools(new ReadOnlyDb(env.DB));

  it('getInvoice("INV-1011") returns its payments in order and formatted findings from the latest complete run', async () => {
    const res = await call(tools(), 'getInvoice', { invoiceId: 'INV-1011' });
    if (!res.found) throw new Error('INV-1011 not found');
    expect(res.runId).toBe(runId);
    expect(res.invoice).toMatchObject({
      id: 'INV-1011',
      amount: { minor: 25000, formatted: '€250.00' },
    });
    expect(res.subscription).toMatchObject({ id: 'S4' });
    expect(res.payments.map((p) => p.id)).toEqual(['P2012', 'P2013', 'P2014']);
    expect(res.payments[2].amount).toEqual({
      minor: 1000,
      formatted: '€10.00',
    });
    expect(res.findings.map((f) => [f.kind, f.paymentId])).toEqual([
      ['OVERPAID', null],
      ['DUPLICATE_PAYMENT', 'P2013'],
    ]);
    const formatted = res.findings.map((f) => f.delta.formatted);
    expect(formatted).toContain('€250.00');
    expect(formatted).toContain('€10.00');
  });

  it('getInvoice("INV-9999") returns found:false', async () => {
    expect(
      await call(tools(), 'getInvoice', { invoiceId: 'INV-9999' }),
    ).toEqual({ found: false, invoiceId: 'INV-9999' });
  });

  it('getRunSummary returns per-currency OVERPAID rows and never sums across currencies', async () => {
    const res = await call(tools(), 'getRunSummary', {});
    if (!res.found) throw new Error('no complete run');
    expect(res.run.id).toBe(runId);
    const overpaid = res.byKind.filter((r) => r.kind === 'OVERPAID');
    expect(overpaid).toEqual([
      {
        kind: 'OVERPAID',
        currency: 'USD',
        count: 1,
        totalDelta: { minor: 600, formatted: '$6.00' },
      },
      {
        kind: 'OVERPAID',
        currency: 'EUR',
        count: 1,
        totalDelta: { minor: 1000, formatted: '€10.00' },
      },
    ]);
    expect(res.byKind.reduce((n, r) => n + r.count, 0)).toBe(17);
  });

  it('getRunSummary with an unknown run id returns found:false', async () => {
    const unknown = 'run-00000000-0000-0000-0000-000000000000';
    expect(await call(tools(), 'getRunSummary', { runId: unknown })).toEqual({
      found: false,
      runId: unknown,
    });
  });

  it('listFindings filters by kind and keeps seq order', async () => {
    const all = await call(tools(), 'listFindings', { limit: 50 });
    if (!all.found) throw new Error('no complete run');
    expect(all.findings.map((f) => [f.kind, f.invoiceId, f.paymentId])).toEqual(
      expectedFindings.map((f) => [f.kind, f.invoice_id, f.payment_id]),
    );

    const dup = await call(tools(), 'listFindings', {
      runId,
      kind: 'DUPLICATE_PAYMENT',
      limit: 50,
    });
    if (!dup.found) throw new Error('run not found');
    expect(dup.findings.map((f) => [f.invoiceId, f.paymentId])).toEqual([
      ['INV-1002', 'P2003'],
      ['INV-1011', 'P2013'],
    ]);
    expect(dup.findings[1].delta).toEqual({
      minor: 25000,
      formatted: '€250.00',
    });
  });

  it('listRuns lists the completed run', async () => {
    const { runs } = await call(tools(), 'listRuns', { limit: 10 });
    expect(runs.find((r) => r.id === runId)).toMatchObject({
      status: 'complete',
      mode: 'normal',
      writeAttempts: 1,
    });
  });

  it('every SQL the tools send to D1 is a single SELECT', async () => {
    const prepare = vi.spyOn(env.DB, 'prepare');
    try {
      const t = tools();
      await call(t, 'listRuns', { limit: 5 });
      await call(t, 'getRunSummary', {});
      await call(t, 'listFindings', { kind: 'OVERPAID', limit: 50 });
      await call(t, 'getInvoice', { invoiceId: 'INV-1011' });
      await call(t, 'getInvoice', { invoiceId: 'INV-9999' });
      const sqls = prepare.mock.calls.map(([sql]) => sql);
      expect(sqls.length).toBeGreaterThanOrEqual(10);
      for (const sql of sqls) {
        expect(sql).toMatch(/^\s*SELECT\s/i);
        expect(sql).not.toContain(';');
      }
    } finally {
      prepare.mockRestore();
    }
  });

  it('ReadOnlyDb throws on UPDATE before reaching D1', async () => {
    const prepare = vi.spyOn(env.DB, 'prepare');
    try {
      const db = new ReadOnlyDb(env.DB);
      const err = await db
        .query("UPDATE reconciliation_runs SET status = 'errored'")
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect(prepare).not.toHaveBeenCalled();
    } finally {
      prepare.mockRestore();
    }
  });

  it('createTools only gets the ReadOnlyDb wrapper, which exposes no prepare/batch/exec', async () => {
    const db = new ReadOnlyDb(env.DB);
    const query = vi.spyOn(db, 'query');
    const t = createTools(db);
    for (const key of ['prepare', 'batch', 'exec', 'dump']) {
      expect((db as unknown as Record<string, unknown>)[key]).toBeUndefined();
    }
    await call(t, 'getInvoice', { invoiceId: 'INV-1011' });
    expect(query).toHaveBeenCalled();
  });
});
