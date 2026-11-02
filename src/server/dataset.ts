import type { Dataset, Invoice, Payment, Subscription } from './engine/types';

// Structural subset of D1Database, so this module also type-checks in the Node unit-test project.
interface QueryDb {
  prepare(query: string): {
    all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  };
}

const SUBSCRIPTION_SQL =
  'SELECT id, customer_name, plan, unit_price_minor, currency, billing_interval FROM subscriptions ORDER BY id';
const INVOICE_SQL =
  'SELECT id, subscription_id, period_start, period_end, amount_minor, currency, issued_at, due_at FROM invoices ORDER BY id';
const PAYMENT_SQL =
  'SELECT id, invoice_ref, amount_minor, currency, received_at, provider_ref FROM payments ORDER BY id';

export async function loadDataset(db: QueryDb): Promise<Dataset> {
  const [subscriptions, invoices, payments] = await Promise.all([
    db.prepare(SUBSCRIPTION_SQL).all<Subscription>(),
    db.prepare(INVOICE_SQL).all<Invoice>(),
    db.prepare(PAYMENT_SQL).all<Payment>(),
  ]);
  return {
    subscriptions: subscriptions.results,
    invoices: invoices.results,
    payments: payments.results,
  };
}

function byId<T extends { id: string }>(rows: T[]): T[] {
  return rows.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** SHA-256 hex of the canonical JSON: arrays sorted by id (code units), row keys in schema column order. */
export async function datasetHash(dataset: Dataset): Promise<string> {
  const canonical = {
    subscriptions: byId(dataset.subscriptions).map((s) => ({
      id: s.id,
      customer_name: s.customer_name,
      plan: s.plan,
      unit_price_minor: s.unit_price_minor,
      currency: s.currency,
      billing_interval: s.billing_interval,
    })),
    invoices: byId(dataset.invoices).map((i) => ({
      id: i.id,
      subscription_id: i.subscription_id,
      period_start: i.period_start,
      period_end: i.period_end,
      amount_minor: i.amount_minor,
      currency: i.currency,
      issued_at: i.issued_at,
      due_at: i.due_at,
    })),
    payments: byId(dataset.payments).map((p) => ({
      id: p.id,
      invoice_ref: p.invoice_ref,
      amount_minor: p.amount_minor,
      currency: p.currency,
      received_at: p.received_at,
      provider_ref: p.provider_ref,
    })),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(canonical));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
