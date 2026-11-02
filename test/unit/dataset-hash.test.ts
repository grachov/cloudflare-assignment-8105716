import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { datasetHash } from '../../src/server/dataset';
import type { Dataset } from '../../src/server/engine/types';
import { seedDataset } from '../fixtures/seed-dataset';

const tiny: Dataset = {
  subscriptions: [
    {
      id: 'S1',
      customer_name: 'A',
      plan: 'p',
      unit_price_minor: 100,
      currency: 'USD',
      billing_interval: 'monthly',
    },
  ],
  invoices: [
    {
      id: 'I2',
      subscription_id: 'S1',
      period_start: '2026-09-01',
      period_end: '2026-09-30',
      amount_minor: 100,
      currency: 'USD',
      issued_at: '2026-09-01',
      due_at: '2026-09-15',
    },
    {
      id: 'I1',
      subscription_id: 'S1',
      period_start: '2026-08-01',
      period_end: '2026-08-31',
      amount_minor: 100,
      currency: 'USD',
      issued_at: '2026-08-01',
      due_at: '2026-08-15',
    },
  ],
  payments: [
    {
      id: 'P1',
      invoice_ref: null,
      amount_minor: 5,
      currency: 'USD',
      received_at: '2026-09-02',
      provider_ref: 'pi_P1',
    },
  ],
};

describe('datasetHash', () => {
  it('is SHA-256 hex of the canonical JSON (arrays sorted by id, schema column order)', async () => {
    const canonical =
      '{"subscriptions":[{"id":"S1","customer_name":"A","plan":"p","unit_price_minor":100,"currency":"USD","billing_interval":"monthly"}],' +
      '"invoices":[{"id":"I1","subscription_id":"S1","period_start":"2026-08-01","period_end":"2026-08-31","amount_minor":100,"currency":"USD","issued_at":"2026-08-01","due_at":"2026-08-15"},' +
      '{"id":"I2","subscription_id":"S1","period_start":"2026-09-01","period_end":"2026-09-30","amount_minor":100,"currency":"USD","issued_at":"2026-09-01","due_at":"2026-09-15"}],' +
      '"payments":[{"id":"P1","invoice_ref":null,"amount_minor":5,"currency":"USD","received_at":"2026-09-02","provider_ref":"pi_P1"}]}';
    expect(await datasetHash(tiny)).toBe(
      createHash('sha256').update(canonical).digest('hex'),
    );
  });

  it('ignores row order and key order', async () => {
    const reordered: Dataset = {
      subscriptions: seedDataset.subscriptions.slice().reverse(),
      invoices: seedDataset.invoices
        .slice()
        .reverse()
        .map(
          (i) =>
            ({
              ...Object.fromEntries(Object.entries(i).reverse()),
            }) as typeof i,
        ),
      payments: seedDataset.payments.slice().reverse(),
    };
    expect(await datasetHash(reordered)).toBe(await datasetHash(seedDataset));
  });

  it('changes when any amount changes', async () => {
    const changed: Dataset = {
      ...seedDataset,
      payments: seedDataset.payments.map((p, i) =>
        i === 0 ? { ...p, amount_minor: p.amount_minor + 1 } : p,
      ),
    };
    const h = await datasetHash(seedDataset);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await datasetHash(changed)).not.toBe(h);
  });
});
