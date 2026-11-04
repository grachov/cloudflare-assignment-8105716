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
    subscriptions: byId(dataset.subscriptions).map((subscription) => ({
      id: subscription.id,
      customer_name: subscription.customer_name,
      plan: subscription.plan,
      unit_price_minor: subscription.unit_price_minor,
      currency: subscription.currency,
      billing_interval: subscription.billing_interval,
    })),
    invoices: byId(dataset.invoices).map((invoice) => ({
      id: invoice.id,
      subscription_id: invoice.subscription_id,
      period_start: invoice.period_start,
      period_end: invoice.period_end,
      amount_minor: invoice.amount_minor,
      currency: invoice.currency,
      issued_at: invoice.issued_at,
      due_at: invoice.due_at,
    })),
    payments: byId(dataset.payments).map((payment) => ({
      id: payment.id,
      invoice_ref: payment.invoice_ref,
      amount_minor: payment.amount_minor,
      currency: payment.currency,
      received_at: payment.received_at,
      provider_ref: payment.provider_ref,
    })),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(canonical));
  const digest = await crypto.subtle.digest('SHA-256', bytes);

  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
