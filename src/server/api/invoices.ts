import { Hono } from 'hono';
import type { InvoiceDTO, InvoiceStatus } from '../../shared/types';
import type { AppEnv } from '../http';

const LATEST_COMPLETE_RUN_SQL =
  "SELECT id, as_of_date FROM reconciliation_runs WHERE status = 'complete' ORDER BY completed_at DESC, id DESC LIMIT 1";

// paid = payments referencing the invoice received on or before as-of (?1, the latest run's own as-of date so
// paid, duplicates and status never mix two as-of dates); duplicates and status come from the latest complete run (?2). The invoice-level finding is the one with no payment_id (at most one per invoice, R5).
const INVOICES_SQL = `SELECT i.id, s.customer_name AS customer, i.period_start, i.period_end, i.amount_minor,
    COALESCE((SELECT SUM(p.amount_minor) FROM payments p
              WHERE p.invoice_ref = i.id AND substr(p.received_at, 1, 10) <= ?1), 0) AS paid_minor,
    COALESCE((SELECT SUM(f.delta_minor) FROM findings f
              WHERE f.run_id = ?2 AND f.invoice_id = i.id AND f.kind = 'duplicate_payment'), 0) AS duplicate_minor,
    i.currency,
    (SELECT f.kind FROM findings f
     WHERE f.run_id = ?2 AND f.invoice_id = i.id AND f.payment_id IS NULL ORDER BY f.seq LIMIT 1) AS finding_kind
  FROM invoices i JOIN subscriptions s ON s.id = i.subscription_id
  ORDER BY i.id`;

export const invoiceRoutes = new Hono<AppEnv>().get('/', async (ctx) => {
  const db = ctx.env.DB;
  const latestRun = await db
    .prepare(LATEST_COMPLETE_RUN_SQL)
    .first<{ id: string; as_of_date: string }>();
  const latestRunId = latestRun?.id ?? null;
  const asOfDate = latestRun?.as_of_date ?? ctx.env.AS_OF_DATE;
  const { results } = await db
    .prepare(INVOICES_SQL)
    .bind(asOfDate, latestRunId)
    .all<Omit<InvoiceDTO, 'status'> & { finding_kind: InvoiceStatus | null }>();
  const invoices: InvoiceDTO[] = results.map(({ finding_kind, ...row }) => ({
    ...row,
    status: latestRunId === null ? 'not_reconciled' : (finding_kind ?? 'open'),
  }));

  return ctx.json({
    asOfDate,
    latestRunId,
    invoices,
  });
});
