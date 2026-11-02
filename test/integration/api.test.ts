import { describe, expect, it } from 'vitest';
import type { FindingDTO, InvoiceDTO, RunDTO } from '../../src/shared/types';
import { api, runToCompletion } from './helpers';

type InvoicesBody = {
  asOfDate: string;
  latestRunId: string | null;
  invoices: InvoiceDTO[];
};

async function getInvoices(): Promise<InvoicesBody> {
  const res = await api('/api/invoices');
  expect(res.status).toBe(200);
  return (await res.json()) as InvoicesBody;
}

// Kept first: storage is shared by the tests in this file, so no run exists yet here.
describe('GET /api/invoices before any run', () => {
  it('reports every invoice as NOT_RECONCILED', async () => {
    const body = await getInvoices();
    expect(body.asOfDate).toBe('2026-10-15');
    expect(body.latestRunId).toBeNull();
    expect(body.invoices).toHaveLength(15);
    expect(new Set(body.invoices.map((i) => i.status))).toEqual(
      new Set(['NOT_RECONCILED']),
    );
    expect(body.invoices.find((i) => i.id === 'INV-1011')).toMatchObject({
      paid_minor: 51000,
      duplicate_minor: 0,
    });
  });
});

describe('after a normal run', () => {
  it('GET /api/invoices reflects the latest complete run', async () => {
    const { id } = await runToCompletion('normal');
    const body = await getInvoices();
    expect(body.latestRunId).toBe(id);

    const status = Object.fromEntries(
      body.invoices.map((i) => [i.id, i.status]),
    );
    expect(status).toEqual({
      'INV-1001': 'MATCHED',
      'INV-1002': 'MATCHED',
      'INV-1003': 'MATCHED',
      'INV-1004': 'MATCHED',
      'INV-1005': 'UNDERPAID',
      'INV-1006': 'OPEN',
      'INV-1007': 'UNPAID_OVERDUE',
      'INV-1008': 'UNPAID_OVERDUE',
      'INV-1009': 'OVERPAID',
      'INV-1010': 'MATCHED',
      'INV-1011': 'OVERPAID',
      'INV-1012': 'UNDERPAID',
      'INV-1013': 'MATCHED',
      'INV-1014': 'UNPAID_OVERDUE',
      'INV-1015': 'OPEN',
    });
    const byId = new Map(body.invoices.map((i) => [i.id, i]));
    expect(byId.get('INV-1011')).toMatchObject({
      customer: 'Umbrella GmbH',
      amount_minor: 25000,
      paid_minor: 51000,
      duplicate_minor: 25000,
      currency: 'EUR',
    });
    expect(byId.get('INV-1002')).toMatchObject({
      paid_minor: 9800,
      duplicate_minor: 4900,
    });
    expect(byId.get('INV-1006')).toMatchObject({
      paid_minor: 0,
      duplicate_minor: 0,
    });
  });

  it('GET /api/runs/:id, GET /api/runs and the findings filter have the contract shape', async () => {
    const { id } = await runToCompletion('normal');

    const res = await api(`/api/runs/${id}`);
    expect(res.status).toBe(200);
    const run = (await res.json()) as RunDTO;
    expect(Object.keys(run).sort()).toEqual(
      [
        'id',
        'mode',
        'status',
        'current_step',
        'steps',
        'as_of_date',
        'dataset_hash',
        'write_attempts',
        'failure_injected',
        'findings_count',
        'summary',
        'error',
        'started_at',
        'completed_at',
      ].sort(),
    );
    expect(run).toMatchObject({
      id,
      mode: 'normal',
      status: 'complete',
      current_step: 'complete',
      steps: ['load-and-reconcile', 'write-findings', 'complete'],
      as_of_date: '2026-10-15',
      write_attempts: 1,
      failure_injected: 0,
      findings_count: 17,
      error: null,
    });
    expect(run.dataset_hash).toMatch(/^[0-9a-f]{64}$/);
    // Grouped by (kind, currency) in first-seq order; currencies are never merged.
    expect(run.summary).toEqual([
      { kind: 'MATCHED', currency: 'USD', count: 5 },
      { kind: 'DUPLICATE_PAYMENT', currency: 'USD', count: 1 },
      { kind: 'UNDERPAID', currency: 'USD', count: 1 },
      { kind: 'UNPAID_OVERDUE', currency: 'USD', count: 3 },
      { kind: 'OVERPAID', currency: 'USD', count: 1 },
      { kind: 'MATCHED', currency: 'EUR', count: 1 },
      { kind: 'OVERPAID', currency: 'EUR', count: 1 },
      { kind: 'DUPLICATE_PAYMENT', currency: 'EUR', count: 1 },
      { kind: 'UNDERPAID', currency: 'EUR', count: 1 },
      { kind: 'UNMATCHED_PAYMENT', currency: 'USD', count: 2 },
    ]);

    const list = (await (await api('/api/runs?limit=50')).json()) as {
      runs: RunDTO[];
    };
    expect(list.runs.map((r) => r.id)).toContain(id);
    const started = list.runs.map((r) => r.started_at ?? '');
    expect(started).toEqual([...started].sort().reverse());
    expect((await api('/api/runs?limit=0')).status).toBe(400);
    expect((await api('/api/runs?limit=51')).status).toBe(400);

    const overpaid = await api(`/api/runs/${id}/findings?kind=OVERPAID`);
    expect(overpaid.status).toBe(200);
    const { findings } = (await overpaid.json()) as { findings: FindingDTO[] };
    expect(
      findings.map((f) => [f.invoice_id, f.currency, f.delta_minor]),
    ).toEqual([
      ['INV-1009', 'USD', 600],
      ['INV-1011', 'EUR', 1000],
    ]);
    expect(findings[0].seq).toBeLessThan(findings[1].seq);
    expect(findings[0].id).toMatch(/^[0-9a-f]{64}$/);

    const all = (await (await api(`/api/runs/${id}/findings`)).json()) as {
      findings: FindingDTO[];
    };
    expect(all.findings.map((f) => f.seq)).toEqual([...Array(17).keys()]);
  });

  it('returns 400 for an unknown kind and 404 for an unknown run', async () => {
    const { id } = await runToCompletion('normal');
    const bad = await api(`/api/runs/${id}/findings?kind=BAD`);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: 'invalid_request' });

    const unknown = `run-${crypto.randomUUID()}`;
    expect((await api(`/api/runs/${unknown}`)).status).toBe(404);
    expect((await api(`/api/runs/${unknown}/findings`)).status).toBe(404);
    expect(await (await api('/api/nope')).json()).toEqual({
      error: 'not_found',
    });
  });
});
