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
  it('reports every invoice as not_reconciled', async () => {
    const body = await getInvoices();
    expect(body.asOfDate).toBe('2026-10-15');
    expect(body.latestRunId).toBeNull();
    expect(body.invoices).toHaveLength(15);
    expect(new Set(body.invoices.map((i) => i.status))).toEqual(
      new Set(['not_reconciled']),
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
      'INV-1001': 'matched',
      'INV-1002': 'matched',
      'INV-1003': 'matched',
      'INV-1004': 'matched',
      'INV-1005': 'underpaid',
      'INV-1006': 'open',
      'INV-1007': 'unpaid_overdue',
      'INV-1008': 'unpaid_overdue',
      'INV-1009': 'overpaid',
      'INV-1010': 'matched',
      'INV-1011': 'overpaid',
      'INV-1012': 'underpaid',
      'INV-1013': 'matched',
      'INV-1014': 'unpaid_overdue',
      'INV-1015': 'open',
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
      { kind: 'matched', currency: 'USD', count: 5 },
      { kind: 'duplicate_payment', currency: 'USD', count: 1 },
      { kind: 'underpaid', currency: 'USD', count: 1 },
      { kind: 'unpaid_overdue', currency: 'USD', count: 3 },
      { kind: 'overpaid', currency: 'USD', count: 1 },
      { kind: 'matched', currency: 'EUR', count: 1 },
      { kind: 'overpaid', currency: 'EUR', count: 1 },
      { kind: 'duplicate_payment', currency: 'EUR', count: 1 },
      { kind: 'underpaid', currency: 'EUR', count: 1 },
      { kind: 'unmatched_payment', currency: 'USD', count: 2 },
    ]);

    const list = (await (await api('/api/runs?limit=50')).json()) as {
      runs: RunDTO[];
    };
    expect(list.runs.map((r) => r.id)).toContain(id);
    const started = list.runs.map((r) => r.started_at ?? '');
    expect(started).toEqual([...started].sort().reverse());
    expect((await api('/api/runs?limit=0')).status).toBe(400);
    expect((await api('/api/runs?limit=51')).status).toBe(400);

    const overpaid = await api(`/api/runs/${id}/findings?kind=overpaid`);
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
