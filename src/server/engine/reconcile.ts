// Pure, synchronous reconciliation engine (rules R0-R7).
// No clock, no crypto, no I/O: the same dataset and as-of date always give the same findings.
import { KINDS, type Finding, type FindingKind } from '../../shared/types';
import { DatasetValidationError, type Dataset, type Payment } from './types';

const CURRENCIES = new Set(['USD', 'EUR']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}/;

// Rejects well-formed but impossible dates such as 2026-13-45 or 2026-02-30 (pure: no clock access).
function isCalendarDate(ymd: string): boolean {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

type Unsequenced = Omit<Finding, 'seq'>;

function fail(message: string): never {
  throw new DatasetValidationError(message);
}

/** Code-unit string comparison (never localeCompare). */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function day(value: string): string {
  return value.slice(0, 10);
}

function checkAmount(where: string, value: unknown, min: number): void {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < min
  ) {
    fail(
      `${where}: amount must be a safe integer >= ${min}, got ${String(value)}`,
    );
  }
}

function checkCurrency(where: string, value: unknown): void {
  if (
    typeof value !== 'string' ||
    !/^[A-Z]{3}$/.test(value) ||
    !CURRENCIES.has(value)
  ) {
    fail(`${where}: unsupported currency ${String(value)}`);
  }
}

function checkDate(where: string, value: unknown): void {
  if (
    typeof value !== 'string' ||
    !DATE_RE.test(value) ||
    !isCalendarDate(value.slice(0, 10))
  ) {
    fail(`${where}: invalid date ${String(value)}`);
  }
}

function checkUniqueIds(table: string, rows: { id: unknown }[]): void {
  const seen = new Set<unknown>();
  for (const row of rows) {
    if (typeof row.id !== 'string' || row.id === '')
      fail(`${table}: invalid id ${String(row.id)}`);
    if (seen.has(row.id)) fail(`${table}: duplicate id ${row.id}`);
    seen.add(row.id);
  }
}

/** R0: throws DatasetValidationError on any invalid input. */
export function validateDataset(dataset: Dataset, asOfDate: string): void {
  checkDate('asOfDate', asOfDate);
  const { subscriptions, invoices, payments } = dataset;
  checkUniqueIds('subscriptions', subscriptions);
  checkUniqueIds('invoices', invoices);
  checkUniqueIds('payments', payments);

  const subCurrency = new Map<string, string>();
  for (const s of subscriptions) {
    checkAmount(`subscription ${s.id}`, s.unit_price_minor, 0);
    checkCurrency(`subscription ${s.id}`, s.currency);
    subCurrency.set(s.id, s.currency);
  }

  const invCurrency = new Map<string, string>();
  for (const i of invoices) {
    const where = `invoice ${i.id}`;
    checkAmount(where, i.amount_minor, 0);
    checkCurrency(where, i.currency);
    checkDate(where, i.period_start);
    checkDate(where, i.period_end);
    checkDate(where, i.issued_at);
    checkDate(where, i.due_at);
    const sc = subCurrency.get(i.subscription_id);
    if (sc === undefined)
      fail(`${where}: unknown subscription ${i.subscription_id}`);
    if (sc !== i.currency)
      fail(
        `${where}: currency ${i.currency} differs from subscription currency ${sc}`,
      );
    invCurrency.set(i.id, i.currency);
  }

  for (const p of payments) {
    const where = `payment ${p.id}`;
    checkAmount(where, p.amount_minor, 1);
    checkCurrency(where, p.currency);
    checkDate(where, p.received_at);
    if (p.invoice_ref !== null && typeof p.invoice_ref !== 'string')
      fail(`${where}: invalid invoice_ref`);
    const ic =
      p.invoice_ref === null ? undefined : invCurrency.get(p.invoice_ref);
    if (ic !== undefined && ic !== p.currency) {
      fail(
        `${where}: currency ${p.currency} differs from invoice ${p.invoice_ref} currency ${ic}`,
      );
    }
  }
}

const KIND_RANK = new Map<FindingKind, number>(KINDS.map((k, i) => [k, i]));

function finding(
  kind: FindingKind,
  invoice_id: string | null,
  payment_id: string | null,
  expected_minor: number,
  actual_minor: number,
  delta_minor: number,
  currency: string,
  detail: string,
): Unsequenced {
  return {
    kind,
    invoice_id,
    payment_id,
    expected_minor,
    actual_minor,
    delta_minor,
    currency,
    detail,
  };
}

export function reconcile(dataset: Dataset, asOfDate: string): Finding[] {
  validateDataset(dataset, asOfDate);
  const asOf = day(asOfDate);
  const out: Unsequenced[] = [];

  // R1: ignore payments received after the as-of date.
  const payments = dataset.payments.filter((p) => day(p.received_at) <= asOf);

  // R2: group by explicit invoice_ref; null or unknown refs are unmatched.
  const invoiceIds = new Set(dataset.invoices.map((i) => i.id));
  const byInvoice = new Map<string, Payment[]>();
  for (const p of payments) {
    if (p.invoice_ref === null || !invoiceIds.has(p.invoice_ref)) {
      out.push(
        finding(
          'UNMATCHED_PAYMENT',
          null,
          p.id,
          0,
          p.amount_minor,
          p.amount_minor,
          p.currency,
          `ref=${p.invoice_ref ?? 'null'}`,
        ),
      );
      continue;
    }
    const group = byInvoice.get(p.invoice_ref);
    if (group) group.push(p);
    else byInvoice.set(p.invoice_ref, [p]);
  }

  for (const inv of dataset.invoices) {
    // R3: (received_at, id) ascending.
    const ps = (byInvoice.get(inv.id) ?? [])
      .slice()
      .sort(
        (a, b) =>
          cmp(day(a.received_at), day(b.received_at)) || cmp(a.id, b.id),
      );

    // R4: full-amount payments beyond the first are duplicates and are excluded from S.
    const full =
      inv.amount_minor > 0
        ? ps.filter((p) => p.amount_minor === inv.amount_minor)
        : [];
    const duplicates = new Set<Payment>();
    if (full.length >= 2) {
      const settledBy = full[0].id;
      for (const p of full.slice(1)) {
        duplicates.add(p);
        out.push(
          finding(
            'DUPLICATE_PAYMENT',
            inv.id,
            p.id,
            0,
            p.amount_minor,
            p.amount_minor,
            inv.currency,
            `settled_by=${settledBy}`,
          ),
        );
      }
    }

    // R5: at most one invoice-level outcome over the non-duplicate payments.
    const counted = ps.filter((p) => !duplicates.has(p));
    const n = counted.length;
    const s = counted.reduce((sum, p) => sum + p.amount_minor, 0);
    const amount = inv.amount_minor;
    const detail = `payments=${n}`;
    const notYetDue = day(inv.due_at) >= asOf;
    if (s === amount) {
      out.push(
        finding('MATCHED', inv.id, null, amount, s, 0, inv.currency, detail),
      );
    } else if (n === 0) {
      if (!notYetDue)
        out.push(
          finding(
            'UNPAID_OVERDUE',
            inv.id,
            null,
            amount,
            0,
            amount,
            inv.currency,
            detail,
          ),
        );
    } else if (s < amount) {
      const d = notYetDue ? `${detail};not_yet_due` : detail;
      out.push(
        finding(
          'UNDERPAID',
          inv.id,
          null,
          amount,
          s,
          amount - s,
          inv.currency,
          d,
        ),
      );
    } else {
      out.push(
        finding(
          'OVERPAID',
          inv.id,
          null,
          amount,
          s,
          s - amount,
          inv.currency,
          detail,
        ),
      );
    }
  }

  // R7: deterministic order, then seq = index with the fixed key order.
  out.sort(
    (a, b) =>
      cmp(a.invoice_id ?? '￿', b.invoice_id ?? '￿') ||
      KIND_RANK.get(a.kind)! - KIND_RANK.get(b.kind)! ||
      cmp(a.payment_id ?? '', b.payment_id ?? ''),
  );
  return out.map((f, seq) => ({
    seq,
    kind: f.kind,
    invoice_id: f.invoice_id,
    payment_id: f.payment_id,
    expected_minor: f.expected_minor,
    actual_minor: f.actual_minor,
    delta_minor: f.delta_minor,
    currency: f.currency,
    detail: f.detail,
  }));
}
