import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { reconcile, validateDataset } from '../../src/server/engine/reconcile';
import {
  DatasetValidationError,
  type Dataset,
  type Invoice,
  type Payment,
} from '../../src/server/engine/types';
import type { Finding } from '../../src/shared/types';
import { seedDataset } from '../fixtures/seed-dataset';

const AS_OF = '2026-10-15';
const expectedFindings: Finding[] = JSON.parse(
  readFileSync(
    new URL('../fixtures/expected-findings.json', import.meta.url),
    'utf8',
  ),
);

function inv(
  id: string,
  amount: number,
  due: string,
  currency = 'USD',
): Invoice {
  return {
    id,
    subscription_id: currency === 'EUR' ? 'SE' : 'SU',
    period_start: '2026-09-01',
    period_end: '2026-09-30',
    amount_minor: amount,
    currency,
    issued_at: '2026-09-01',
    due_at: due,
  };
}

function pay(
  id: string,
  ref: string | null,
  amount: number,
  received: string,
  currency = 'USD',
): Payment {
  return {
    id,
    invoice_ref: ref,
    amount_minor: amount,
    currency,
    received_at: received,
    provider_ref: `pi_${id}`,
  };
}

function ds(invoices: Invoice[], payments: Payment[]): Dataset {
  return {
    subscriptions: [
      {
        id: 'SU',
        customer_name: 'U',
        plan: 'p',
        unit_price_minor: 1000,
        currency: 'USD',
        billing_interval: 'monthly',
      },
      {
        id: 'SE',
        customer_name: 'E',
        plan: 'p',
        unit_price_minor: 1000,
        currency: 'EUR',
        billing_interval: 'monthly',
      },
    ],
    invoices,
    payments,
  };
}

const PAST = '2026-09-15';
const kinds = (fs: Finding[]) =>
  fs.map((f) => [f.kind, f.invoice_id, f.payment_id, f.delta_minor]);

function shuffle<T>(rows: T[], seed: number): T[] {
  const a = rows.slice();
  let x = seed;
  for (let i = a.length - 1; i > 0; i--) {
    x = (x * 1103515245 + 12345) % 2147483648;
    const j = x % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

describe('reconcile: seed dataset', () => {
  it('deep-equals the hand-authored expected-findings.json', () => {
    expect(reconcile(seedDataset, AS_OF)).toEqual(expectedFindings);
  });

  it('fixture covers all 6 kinds with the planned counts', () => {
    const counts: Record<string, number> = {};
    for (const f of expectedFindings)
      counts[f.kind] = (counts[f.kind] ?? 0) + 1;
    expect(counts).toEqual({
      matched: 6,
      underpaid: 2,
      overpaid: 2,
      duplicate_payment: 2,
      unpaid_overdue: 3,
      unmatched_payment: 2,
    });
  });

  it('shuffled input gives byte-identical JSON', () => {
    const baseline = JSON.stringify(reconcile(seedDataset, AS_OF));
    for (const seed of [1, 7, 42, 1234]) {
      const shuffled: Dataset = {
        subscriptions: shuffle(seedDataset.subscriptions, seed),
        invoices: shuffle(seedDataset.invoices, seed + 1),
        payments: shuffle(seedDataset.payments, seed + 2),
      };
      expect(JSON.stringify(reconcile(shuffled, AS_OF))).toBe(baseline);
    }
  });

  it('every *_minor is a safe integer and every delta is >= 0', () => {
    for (const f of reconcile(seedDataset, AS_OF)) {
      for (const v of [f.expected_minor, f.actual_minor, f.delta_minor])
        expect(Number.isSafeInteger(v)).toBe(true);
      expect(f.delta_minor).toBeGreaterThanOrEqual(0);
    }
  });

  it('emits keys in the fixed R7 order', () => {
    for (const f of reconcile(seedDataset, AS_OF)) {
      expect(Object.keys(f)).toEqual([
        'seq',
        'kind',
        'invoice_id',
        'payment_id',
        'expected_minor',
        'actual_minor',
        'delta_minor',
        'currency',
        'detail',
      ]);
    }
  });
});

describe('reconcile: per-kind', () => {
  it('matched: one exact payment', () => {
    const [f] = reconcile(
      ds([inv('I1', 1000, PAST)], [pay('P1', 'I1', 1000, '2026-09-10')]),
      AS_OF,
    );
    expect(f).toMatchObject({
      kind: 'matched',
      expected_minor: 1000,
      actual_minor: 1000,
      delta_minor: 0,
      detail: 'Paid in full by 1 payment',
    });
  });

  it('underpaid after due date: delta = amount - paid, detail says the due date passed', () => {
    const [f] = reconcile(
      ds([inv('I1', 1000, PAST)], [pay('P1', 'I1', 300, '2026-09-10')]),
      AS_OF,
    );
    expect(f).toMatchObject({
      kind: 'underpaid',
      actual_minor: 300,
      delta_minor: 700,
      detail: 'Partly paid by 1 payment; due date 2026-09-15 has passed',
    });
  });

  it('underpaid before the due date says it is not yet due', () => {
    const [f] = reconcile(
      ds([inv('I1', 1000, '2026-10-20')], [pay('P1', 'I1', 300, '2026-10-01')]),
      AS_OF,
    );
    expect(f.kind).toBe('underpaid');
    expect(f.detail).toBe(
      'Partly paid by 1 payment; not yet due (due 2026-10-20)',
    );
  });

  it('overpaid: delta = paid - amount', () => {
    const [f] = reconcile(
      ds([inv('I1', 1000, PAST)], [pay('P1', 'I1', 1600, '2026-09-10')]),
      AS_OF,
    );
    expect(f).toMatchObject({
      kind: 'overpaid',
      actual_minor: 1600,
      delta_minor: 600,
    });
  });

  it('unpaid_overdue: no payment and due < as_of', () => {
    const [f] = reconcile(ds([inv('I1', 1000, PAST)], []), AS_OF);
    expect(f).toMatchObject({
      kind: 'unpaid_overdue',
      expected_minor: 1000,
      actual_minor: 0,
      delta_minor: 1000,
      detail: 'No payment received by the due date 2026-09-15',
    });
  });

  it('unmatched_payment: null and unknown refs', () => {
    const out = reconcile(
      ds(
        [],
        [
          pay('P2', 'NOPE', 50, '2026-09-10'),
          pay('P1', null, 40, '2026-09-10'),
        ],
      ),
      AS_OF,
    );
    expect(out).toEqual([
      {
        seq: 0,
        kind: 'unmatched_payment',
        invoice_id: null,
        payment_id: 'P1',
        expected_minor: 0,
        actual_minor: 40,
        delta_minor: 40,
        currency: 'USD',
        detail: 'Payment has no invoice reference',
      },
      {
        seq: 1,
        kind: 'unmatched_payment',
        invoice_id: null,
        payment_id: 'P2',
        expected_minor: 0,
        actual_minor: 50,
        delta_minor: 50,
        currency: 'USD',
        detail: 'Payment references unknown invoice NOPE',
      },
    ]);
  });

  it('due == as_of with no payment gives no finding', () => {
    expect(reconcile(ds([inv('I1', 1000, AS_OF)], []), AS_OF)).toEqual([]);
  });

  it('due > as_of with no payment gives no finding', () => {
    expect(reconcile(ds([inv('I1', 1000, '2026-10-31')], []), AS_OF)).toEqual(
      [],
    );
  });

  it('zero-amount invoice with no payments is matched', () => {
    const [f] = reconcile(ds([inv('I1', 0, PAST)], []), AS_OF);
    expect(f).toMatchObject({
      kind: 'matched',
      expected_minor: 0,
      actual_minor: 0,
      delta_minor: 0,
      detail: 'Nothing to pay',
    });
  });

  it('3 partials summing exactly are matched', () => {
    const out = reconcile(
      ds(
        [inv('I1', 1000, PAST)],
        [
          pay('P1', 'I1', 200, '2026-09-01'),
          pay('P2', 'I1', 300, '2026-09-02'),
          pay('P3', 'I1', 500, '2026-09-03'),
        ],
      ),
      AS_OF,
    );
    expect(kinds(out)).toEqual([['matched', 'I1', null, 0]]);
    expect(out[0].detail).toBe('Paid in full by 3 payments');
  });

  it('a payment received after as_of is ignored', () => {
    const out = reconcile(
      ds(
        [inv('I1', 1000, PAST)],
        [pay('P1', 'I1', 1000, '2026-10-16'), pay('P2', null, 5, '2026-10-20')],
      ),
      AS_OF,
    );
    expect(kinds(out)).toEqual([['unpaid_overdue', 'I1', null, 1000]]);
  });

  it('a payment received on as_of is counted', () => {
    const out = reconcile(
      ds([inv('I1', 1000, PAST)], [pay('P1', 'I1', 1000, AS_OF)]),
      AS_OF,
    );
    expect(kinds(out)).toEqual([['matched', 'I1', null, 0]]);
  });
});

describe('reconcile: R4 duplicates', () => {
  it('two full payments: first settles, second is duplicate_payment', () => {
    const out = reconcile(
      ds(
        [inv('I1', 1000, PAST)],
        [
          pay('P2', 'I1', 1000, '2026-09-11'),
          pay('P1', 'I1', 1000, '2026-09-10'),
        ],
      ),
      AS_OF,
    );
    expect(kinds(out)).toEqual([
      ['matched', 'I1', null, 0],
      ['duplicate_payment', 'I1', 'P2', 1000],
    ]);
    expect(out[1]).toMatchObject({
      expected_minor: 0,
      actual_minor: 1000,
      detail: 'Repeats the full payment P1, which already settled the invoice',
    });
  });

  it('same received_at: payment id breaks the tie for which payment settles', () => {
    const out = reconcile(
      ds(
        [inv('I1', 1000, PAST)],
        [
          pay('PB', 'I1', 1000, '2026-09-10'),
          pay('PA', 'I1', 1000, '2026-09-10'),
        ],
      ),
      AS_OF,
    );
    expect(out[1]).toMatchObject({
      kind: 'duplicate_payment',
      payment_id: 'PB',
      detail: 'Repeats the full payment PA, which already settled the invoice',
    });
  });

  it('dup + overpaid: both emitted and deltas sum to the excess cash', () => {
    const payments = [
      pay('P1', 'I1', 1000, '2026-09-01'),
      pay('P2', 'I1', 1000, '2026-09-02'),
      pay('P3', 'I1', 1000, '2026-09-03'),
      pay('P4', 'I1', 250, '2026-09-04'),
    ];
    const out = reconcile(ds([inv('I1', 1000, PAST)], payments), AS_OF);
    expect(kinds(out)).toEqual([
      ['overpaid', 'I1', null, 250],
      ['duplicate_payment', 'I1', 'P2', 1000],
      ['duplicate_payment', 'I1', 'P3', 1000],
    ]);
    const cash = payments.reduce((s, p) => s + p.amount_minor, 0);
    expect(out.reduce((s, f) => s + f.delta_minor, 0)).toBe(cash - 1000);
  });

  it('identical partials are never duplicates', () => {
    const out = reconcile(
      ds(
        [inv('I1', 1000, PAST)],
        [
          pay('P1', 'I1', 500, '2026-09-01'),
          pay('P2', 'I1', 500, '2026-09-02'),
        ],
      ),
      AS_OF,
    );
    expect(kinds(out)).toEqual([['matched', 'I1', null, 0]]);
  });

  it('a full payment after partials is overpaid, not duplicate_payment', () => {
    const out = reconcile(
      ds(
        [inv('I1', 1000, PAST)],
        [
          pay('P1', 'I1', 500, '2026-09-01'),
          pay('P2', 'I1', 500, '2026-09-02'),
          pay('P3', 'I1', 1000, '2026-09-03'),
        ],
      ),
      AS_OF,
    );
    expect(kinds(out)).toEqual([['overpaid', 'I1', null, 1000]]);
  });

  it('zero-amount invoice never yields duplicates', () => {
    const out = reconcile(
      ds(
        [inv('I1', 0, PAST)],
        [pay('P1', 'I1', 5, '2026-09-01'), pay('P2', 'I1', 5, '2026-09-02')],
      ),
      AS_OF,
    );
    expect(kinds(out)).toEqual([['overpaid', 'I1', null, 10]]);
  });
});

describe('validateDataset (R0)', () => {
  const ok = () =>
    ds([inv('I1', 1000, PAST)], [pay('P1', 'I1', 1000, '2026-09-10')]);

  it('accepts the seed dataset', () => {
    expect(() => validateDataset(seedDataset, AS_OF)).not.toThrow();
  });

  it('payment currency differing from its invoice currency throws', () => {
    const d = ds(
      [inv('I1', 1000, PAST)],
      [pay('P1', 'I1', 1000, '2026-09-10', 'EUR')],
    );
    expect(() => reconcile(d, AS_OF)).toThrow(
      'dataset.payments.0.currency: currency EUR differs from invoice I1 currency USD',
    );
  });

  it('invoice currency differing from its subscription currency throws', () => {
    const d = ok();
    d.invoices[0].subscription_id = 'SE';
    expect(() => reconcile(d, AS_OF)).toThrow(DatasetValidationError);
  });

  it('float amounts are rejected', () => {
    const a = ok();
    a.payments[0].amount_minor = 10.5;
    expect(() => reconcile(a, AS_OF)).toThrow(DatasetValidationError);
    const b = ok();
    b.invoices[0].amount_minor = 1000.01;
    expect(() => reconcile(b, AS_OF)).toThrow(DatasetValidationError);
  });

  it('well-formed but impossible dates are rejected', () => {
    for (const bad of ['2026-13-45', '2026-02-30', '2026-00-10']) {
      const d = ok();
      d.payments[0].received_at = bad;
      expect(() => reconcile(d, AS_OF)).toThrow(DatasetValidationError);
    }
  });

  it('unsafe integers, negative invoices and non-positive payments are rejected', () => {
    for (const mutate of [
      (d: Dataset) =>
        (d.invoices[0].amount_minor = Number.MAX_SAFE_INTEGER + 1),
      (d: Dataset) => (d.invoices[0].amount_minor = -1),
      (d: Dataset) => (d.payments[0].amount_minor = 0),
    ]) {
      const d = ok();
      mutate(d);
      expect(() => reconcile(d, AS_OF)).toThrow(DatasetValidationError);
    }
  });

  it('unsupported currency, bad date and duplicate ids are rejected', () => {
    for (const mutate of [
      (d: Dataset) => (d.payments[0].currency = 'usd'),
      (d: Dataset) => (d.subscriptions[0].currency = 'GBP'),
      (d: Dataset) => (d.invoices[0].due_at = '15/09/2026'),
      (d: Dataset) => d.payments.push(pay('P1', null, 5, '2026-09-10')),
    ]) {
      const d = ok();
      mutate(d);
      expect(() => reconcile(d, AS_OF)).toThrow(DatasetValidationError);
    }
  });
});
