// Pure, synchronous reconciliation engine (rules R0-R7).
// No clock, no crypto, no I/O: the same dataset and as-of date always give the same findings.
import { KINDS, type Finding, type FindingKind } from '../../shared/types';
import { z } from 'zod';
import { DatasetValidationError, type Dataset, type Payment } from './types';

// Rejects well-formed but impossible dates such as 2026-13-45 or 2026-02-30 (pure: no clock access).
function isCalendarDate(isoDate: string): boolean {
  const [year, month, dayOfMonth] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, dayOfMonth));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === dayOfMonth
  );
}

type UnsequencedFinding = Omit<Finding, 'seq'>;

/** Code-unit string comparison (never localeCompare). */
function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** The YYYY-MM-DD part of a date or timestamp. */
function toDay(dateOrTimestamp: string): string {
  return dateOrTimestamp.slice(0, 10);
}

const Day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}/, 'expected a YYYY-MM-DD date')
  .refine((value) => isCalendarDate(toDay(value)), 'not a calendar date');
const Currency = z.enum(['USD', 'EUR']);
const Id = z.string().min(1);

const SubscriptionSchema = z.object({
  id: Id,
  customer_name: z.string(),
  plan: z.string(),
  unit_price_minor: z.int().min(0),
  currency: Currency,
  billing_interval: z.string(),
});

const InvoiceSchema = z.object({
  id: Id,
  subscription_id: z.string(),
  period_start: Day,
  period_end: Day,
  amount_minor: z.int().min(0),
  currency: Currency,
  issued_at: Day,
  due_at: Day,
});

const PaymentSchema = z.object({
  id: Id,
  invoice_ref: z.string().nullable(),
  amount_minor: z.int().min(1),
  currency: Currency,
  received_at: Day,
  provider_ref: z.string(),
});

function checkUniqueIds(
  table: string,
  rows: { id: string }[],
  ctx: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    if (seen.has(row.id))
      ctx.addIssue({
        code: 'custom',
        path: [table, index, 'id'],
        message: `duplicate id ${row.id}`,
      });
    seen.add(row.id);
  });
}

/** R0: field rules per row, then cross-row rules (unique ids, currencies agree along subscription -> invoice -> payment). */
const DatasetSchema = z
  .object({
    subscriptions: z.array(SubscriptionSchema),
    invoices: z.array(InvoiceSchema),
    payments: z.array(PaymentSchema),
  })
  .superRefine((dataset, ctx) => {
    checkUniqueIds('subscriptions', dataset.subscriptions, ctx);
    checkUniqueIds('invoices', dataset.invoices, ctx);
    checkUniqueIds('payments', dataset.payments, ctx);

    const currencyBySubscription = new Map(
      dataset.subscriptions.map((sub) => [sub.id, sub.currency]),
    );
    const currencyByInvoice = new Map(
      dataset.invoices.map((invoice) => [invoice.id, invoice.currency]),
    );

    dataset.invoices.forEach((invoice, index) => {
      const subscriptionCurrency = currencyBySubscription.get(
        invoice.subscription_id,
      );
      if (subscriptionCurrency !== invoice.currency)
        ctx.addIssue({
          code: 'custom',
          path: ['invoices', index, 'currency'],
          message:
            subscriptionCurrency === undefined
              ? `unknown subscription ${invoice.subscription_id}`
              : `currency ${invoice.currency} differs from subscription currency ${subscriptionCurrency}`,
        });
    });

    dataset.payments.forEach((payment, index) => {
      // A null or unknown ref is not an error here: it becomes an unmatched_payment finding.
      const invoiceCurrency =
        payment.invoice_ref === null
          ? undefined
          : currencyByInvoice.get(payment.invoice_ref);
      if (invoiceCurrency !== undefined && invoiceCurrency !== payment.currency)
        ctx.addIssue({
          code: 'custom',
          path: ['payments', index, 'currency'],
          message: `currency ${payment.currency} differs from invoice ${payment.invoice_ref} currency ${invoiceCurrency}`,
        });
    });
  });

/** R0: throws DatasetValidationError on any invalid input. */
export function validateDataset(dataset: Dataset, asOfDate: string): void {
  const result = z
    .object({ asOfDate: Day, dataset: DatasetSchema })
    .safeParse({ asOfDate, dataset });
  if (!result.success) {
    throw new DatasetValidationError(
      result.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; '),
    );
  }
}

function pluralize(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

const KIND_RANK = new Map<FindingKind, number>(
  KINDS.map((kind, rank) => [kind, rank]),
);

/** Sorts after every real invoice id, so payment-only findings come last. */
const AFTER_ALL_INVOICE_IDS = '￿';

/** R3: oldest first by received day, then by payment id. */
function byReceivedThenId(left: Payment, right: Payment): number {
  return (
    compareStrings(toDay(left.received_at), toDay(right.received_at)) ||
    compareStrings(left.id, right.id)
  );
}

/** R7: by invoice id (payment-only findings last), then kind rank, then payment id. */
function byFindingOrder(
  left: UnsequencedFinding,
  right: UnsequencedFinding,
): number {
  return (
    compareStrings(
      left.invoice_id ?? AFTER_ALL_INVOICE_IDS,
      right.invoice_id ?? AFTER_ALL_INVOICE_IDS,
    ) ||
    KIND_RANK.get(left.kind)! - KIND_RANK.get(right.kind)! ||
    compareStrings(left.payment_id ?? '', right.payment_id ?? '')
  );
}

export function reconcile(dataset: Dataset, asOfDate: string): Finding[] {
  validateDataset(dataset, asOfDate);
  const asOfDay = toDay(asOfDate);
  const findings: UnsequencedFinding[] = [];

  // R1: ignore payments received after the as-of date.
  const receivedPayments = dataset.payments.filter(
    (payment) => toDay(payment.received_at) <= asOfDay,
  );

  // R2: group by explicit invoice_ref; null or unknown refs are unmatched.
  const invoiceIds = new Set(dataset.invoices.map((invoice) => invoice.id));
  const paymentsByInvoice = new Map<string, Payment[]>();
  for (const payment of receivedPayments) {
    const ref = payment.invoice_ref;
    if (ref === null || !invoiceIds.has(ref)) {
      findings.push({
        kind: 'unmatched_payment',
        invoice_id: null,
        payment_id: payment.id,
        expected_minor: 0,
        actual_minor: payment.amount_minor,
        delta_minor: payment.amount_minor,
        currency: payment.currency,
        detail:
          ref === null
            ? 'Payment has no invoice reference'
            : `Payment references unknown invoice ${ref}`,
      });
      continue;
    }
    const invoicePayments = paymentsByInvoice.get(ref);
    if (invoicePayments) invoicePayments.push(payment);
    else paymentsByInvoice.set(ref, [payment]);
  }

  for (const invoice of dataset.invoices) {
    const invoiceAmount = invoice.amount_minor;
    const dueDay = toDay(invoice.due_at);
    const payments = (paymentsByInvoice.get(invoice.id) ?? [])
      .slice()
      .sort(byReceivedThenId);

    // R4: full-amount payments beyond the first are duplicates and are excluded from the net total.
    const fullPayments =
      invoiceAmount > 0
        ? payments.filter((payment) => payment.amount_minor === invoiceAmount)
        : [];
    const duplicates = new Set<Payment>();
    if (fullPayments.length >= 2) {
      const [settlingPayment, ...repeatedPayments] = fullPayments;
      for (const duplicate of repeatedPayments) {
        duplicates.add(duplicate);
        findings.push({
          kind: 'duplicate_payment',
          invoice_id: invoice.id,
          payment_id: duplicate.id,
          expected_minor: 0,
          actual_minor: duplicate.amount_minor,
          delta_minor: duplicate.amount_minor,
          currency: invoice.currency,
          detail: `Repeats the full payment ${settlingPayment.id}, which already settled the invoice`,
        });
      }
    }

    // R5: at most one invoice-level outcome over the non-duplicate payments.
    const countedPayments = payments.filter(
      (payment) => !duplicates.has(payment),
    );
    const paymentCount = countedPayments.length;
    const paidAmount = countedPayments.reduce(
      (total, payment) => total + payment.amount_minor,
      0,
    );
    const paymentsText = pluralize(paymentCount, 'payment');
    const isNotYetDue = dueDay >= asOfDay;
    const invoiceFinding = {
      invoice_id: invoice.id,
      payment_id: null,
      expected_minor: invoiceAmount,
      actual_minor: paidAmount,
      currency: invoice.currency,
    };

    if (paidAmount === invoiceAmount) {
      findings.push({
        ...invoiceFinding,
        kind: 'matched',
        delta_minor: 0,
        detail:
          paymentCount === 0
            ? 'Nothing to pay'
            : `Paid in full by ${paymentsText}`,
      });
    } else if (paymentCount === 0) {
      // An unpaid invoice that is not yet due is simply open: no finding.
      if (!isNotYetDue)
        findings.push({
          ...invoiceFinding,
          kind: 'unpaid_overdue',
          delta_minor: invoiceAmount,
          detail: `No payment received by the due date ${dueDay}`,
        });
    } else if (paidAmount < invoiceAmount) {
      findings.push({
        ...invoiceFinding,
        kind: 'underpaid',
        delta_minor: invoiceAmount - paidAmount,
        detail: isNotYetDue
          ? `Partly paid by ${paymentsText}; not yet due (due ${dueDay})`
          : `Partly paid by ${paymentsText}; due date ${dueDay} has passed`,
      });
    } else {
      findings.push({
        ...invoiceFinding,
        kind: 'overpaid',
        delta_minor: paidAmount - invoiceAmount,
        detail: `Payments exceed the invoice amount (${paymentsText})`,
      });
    }
  }

  // R7: deterministic order, then seq = index with the fixed key order.
  return findings.sort(byFindingOrder).map((finding, seq) => ({
    seq,
    kind: finding.kind,
    invoice_id: finding.invoice_id,
    payment_id: finding.payment_id,
    expected_minor: finding.expected_minor,
    actual_minor: finding.actual_minor,
    delta_minor: finding.delta_minor,
    currency: finding.currency,
    detail: finding.detail,
  }));
}
