// Read-only chat tools. All SQL is a fixed SELECT constant with numbered params, run through
// ReadOnlyDb; amounts leave this module only as {minor, formatted} so the model never formats or sums money.
import { tool } from 'ai';
import { z } from 'zod';
import { formatMinor } from '../shared/money';
import { KINDS, type FindingKind } from '../shared/types';

// Structural subset of D1Database, so this module also type-checks in the Node unit-test project.
interface QueryDb {
  prepare(query: string): {
    bind(...values: unknown[]): {
      all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
    };
  };
}

const SELECT_ONLY = /^\s*SELECT\s/i;

/** The only D1 handle the tools see: SELECT-only, single statement, and no prepare/batch/exec surface. */
export class ReadOnlyDb {
  readonly #db: QueryDb;

  constructor(db: QueryDb) {
    this.#db = db;
  }

  async query<T>(sql: string, ...params: unknown[]): Promise<T[]> {
    if (!SELECT_ONLY.test(sql) || sql.includes(';'))
      throw new Error('ReadOnlyDb: only a single SELECT is allowed');
    const { results } = await this.#db
      .prepare(sql)
      .bind(...params)
      .all<T>();
    return results;
  }
}

const LATEST_COMPLETE_RUN_SQL =
  "SELECT id FROM reconciliation_runs WHERE status='complete' ORDER BY completed_at DESC, id DESC LIMIT 1";
const LIST_RUNS_SQL =
  'SELECT id, mode, status, as_of_date, write_attempts, started_at, completed_at FROM reconciliation_runs ORDER BY started_at DESC, id DESC LIMIT ?1';
const RUN_SQL =
  'SELECT id, mode, status, as_of_date, write_attempts, started_at, completed_at FROM reconciliation_runs WHERE id=?1';
const RUN_SUMMARY_SQL =
  'SELECT kind, currency, COUNT(*) n, SUM(delta_minor) d FROM findings WHERE run_id=?1 GROUP BY kind, currency ORDER BY MIN(seq)';
const LIST_FINDINGS_SQL =
  'SELECT id, seq, kind, invoice_id, payment_id, expected_minor, actual_minor, delta_minor, currency, detail FROM findings WHERE run_id=?1 AND (?2 IS NULL OR kind=?2) ORDER BY seq LIMIT ?3';
const INVOICE_SQL = `SELECT i.id, i.period_start, i.period_end, i.amount_minor, i.currency, i.issued_at, i.due_at,
  s.id AS subscription_id, s.customer_name, s.plan, s.unit_price_minor, s.currency AS subscription_currency, s.billing_interval
  FROM invoices i JOIN subscriptions s ON s.id = i.subscription_id WHERE i.id=?1`;
const PAYMENTS_SQL =
  'SELECT id, amount_minor, currency, received_at, provider_ref FROM payments WHERE invoice_ref=?1 ORDER BY received_at, id';
const INVOICE_FINDINGS_SQL =
  'SELECT id, seq, kind, invoice_id, payment_id, expected_minor, actual_minor, delta_minor, currency, detail FROM findings WHERE run_id=?2 AND invoice_id=?1 ORDER BY seq';

const RunId = z.string().regex(/^run-[0-9a-f-]{36}$/);

type Money = { minor: number; formatted: string };
const money = (minor: number, currency: string): Money => ({
  minor,
  formatted: formatMinor(minor, currency),
});

interface RunRow {
  id: string;
  mode: string;
  status: string;
  as_of_date: string;
  write_attempts: number;
  started_at: string | null;
  completed_at: string | null;
}

interface FindingRow {
  id: string;
  seq: number;
  kind: FindingKind;
  invoice_id: string | null;
  payment_id: string | null;
  expected_minor: number;
  actual_minor: number;
  delta_minor: number;
  currency: string;
  detail: string;
}

interface InvoiceRow {
  id: string;
  period_start: string;
  period_end: string;
  amount_minor: number;
  currency: string;
  issued_at: string;
  due_at: string;
  subscription_id: string;
  customer_name: string;
  plan: string;
  unit_price_minor: number;
  subscription_currency: string;
  billing_interval: string;
}

const toRun = (r: RunRow) => ({
  id: r.id,
  mode: r.mode,
  status: r.status,
  asOfDate: r.as_of_date,
  writeAttempts: r.write_attempts,
  startedAt: r.started_at,
  completedAt: r.completed_at,
});

const toFinding = (f: FindingRow) => ({
  id: f.id,
  kind: f.kind,
  invoiceId: f.invoice_id,
  paymentId: f.payment_id,
  expected: money(f.expected_minor, f.currency),
  actual: money(f.actual_minor, f.currency),
  delta: money(f.delta_minor, f.currency),
  detail: f.detail,
});

async function latestCompleteRunId(db: ReadOnlyDb): Promise<string | null> {
  const [row] = await db.query<{ id: string }>(LATEST_COMPLETE_RUN_SQL);
  return row?.id ?? null;
}

/** An explicit runId must exist; an omitted one resolves to the latest complete run (null when there is none). */
async function resolveRun(
  db: ReadOnlyDb,
  runId: string | undefined,
): Promise<RunRow | null> {
  const id = runId ?? (await latestCompleteRunId(db));
  if (id === null) return null;
  const [run] = await db.query<RunRow>(RUN_SQL, id);
  return run ?? null;
}

export function createTools(db: ReadOnlyDb) {
  return {
    listRuns: tool({
      description: 'List reconciliation runs, newest first.',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(20).default(10),
      }),
      execute: async ({ limit }) => ({
        runs: (await db.query<RunRow>(LIST_RUNS_SQL, limit)).map(toRun),
      }),
    }),

    getRunSummary: tool({
      description:
        'Summarise one reconciliation run: finding counts and total deltas per kind and currency. Defaults to the latest complete run.',
      inputSchema: z.object({ runId: RunId.optional() }),
      execute: async ({ runId }) => {
        const run = await resolveRun(db, runId);
        if (run === null)
          return { found: false as const, runId: runId ?? null };
        const rows = await db.query<{
          kind: FindingKind;
          currency: string;
          n: number;
          d: number;
        }>(RUN_SUMMARY_SQL, run.id);
        return {
          found: true as const,
          run: toRun(run),
          byKind: rows.map((r) => ({
            kind: r.kind,
            currency: r.currency,
            count: r.n,
            totalDelta: money(r.d, r.currency),
          })),
        };
      },
    }),

    listFindings: tool({
      description:
        'List findings of a reconciliation run in engine order, optionally filtered by kind. Defaults to the latest complete run.',
      inputSchema: z.object({
        runId: RunId.optional(),
        kind: z.enum(KINDS).optional(),
        limit: z.number().int().min(1).max(50).default(50),
      }),
      execute: async ({ runId, kind, limit }) => {
        const run = await resolveRun(db, runId);
        if (run === null)
          return { found: false as const, runId: runId ?? null };
        const rows = await db.query<FindingRow>(
          LIST_FINDINGS_SQL,
          run.id,
          kind ?? null,
          limit,
        );
        return {
          found: true as const,
          runId: run.id,
          findings: rows.map(toFinding),
        };
      },
    }),

    getInvoice: tool({
      description:
        'Look up one invoice with its subscription, its payments, and its findings in the latest complete run.',
      inputSchema: z.object({ invoiceId: z.string().min(1).max(32) }),
      execute: async ({ invoiceId }) => {
        const [inv] = await db.query<InvoiceRow>(INVOICE_SQL, invoiceId);
        if (inv === undefined) return { found: false as const, invoiceId };
        const payments = await db.query<{
          id: string;
          amount_minor: number;
          currency: string;
          received_at: string;
          provider_ref: string;
        }>(PAYMENTS_SQL, invoiceId);
        const run = await resolveRun(db, undefined);
        const findings =
          run === null
            ? []
            : await db.query<FindingRow>(
                INVOICE_FINDINGS_SQL,
                invoiceId,
                run.id,
              );
        return {
          found: true as const,
          invoice: {
            id: inv.id,
            periodStart: inv.period_start,
            periodEnd: inv.period_end,
            amount: money(inv.amount_minor, inv.currency),
            issuedAt: inv.issued_at,
            dueAt: inv.due_at,
          },
          subscription: {
            id: inv.subscription_id,
            customerName: inv.customer_name,
            plan: inv.plan,
            unitPrice: money(inv.unit_price_minor, inv.subscription_currency),
            billingInterval: inv.billing_interval,
          },
          payments: payments.map((p) => ({
            id: p.id,
            amount: money(p.amount_minor, p.currency),
            receivedAt: p.received_at,
            providerRef: p.provider_ref,
          })),
          findings: findings.map(toFinding),
          runId: run?.id ?? null,
        };
      },
    }),
  };
}

export const SYSTEM_PROMPT = `You are a billing reconciliation assistant for a synthetic demo ledger of subscriptions, invoices and payments.

Rules:
1. Before any factual answer, call the tools. Answer only from tool results; never guess or invent records.
2. Cite record IDs exactly as returned (INV-…, P…, run-…).
3. Use the "formatted" amounts verbatim. Never compute, convert or sum amounts yourself, and never combine different currencies.
4. If a tool returns found:false, say that the record cannot be found.
5. Finding kinds:
   - MATCHED: the invoice's payments equal the invoice amount.
   - UNDERPAID: payments are below the invoice amount (detail "not_yet_due" means the due date has not passed yet).
   - OVERPAID: non-duplicate payments exceed the invoice amount.
   - UNPAID_OVERDUE: no payment was received and the due date has passed.
   - DUPLICATE_PAYMENT: a repeated full-amount payment for an invoice that was already settled.
   - UNMATCHED_PAYMENT: a payment whose invoice reference is missing or unknown.
   When an invoice has duplicate payments and its net cash covers the amount, the DUPLICATE_PAYMENT deltas plus the OVERPAID delta make up the total excess. Quote each delta from the tools; do not add them up.
6. You are read-only. Refuse any request to change data or to start a reconciliation run; the user can do that in the app.
7. Be concise.`;

export const SESSION_EXPIRED_TEXT = 'Session expired — please reload the page.';
export const CONVERSATION_CAP = 40;
export const CAP_TEXT = `This conversation has reached its limit of ${CONVERSATION_CAP} messages. Please start a new conversation.`;
export const SLOW_DOWN_TEXT =
  'You are sending messages too quickly — please slow down and try again in a minute.';

export interface ChatLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** Returns a refusal text, or null when the turn may call the model. Order: sid (fail closed), cap, rate limit. */
export async function chatPreflight({
  limiter,
  sid,
  convUserCount,
}: {
  limiter: ChatLimiter;
  sid: string | null | undefined;
  convUserCount: number;
}): Promise<string | null> {
  if (!sid) return SESSION_EXPIRED_TEXT;
  if (convUserCount > CONVERSATION_CAP) return CAP_TEXT;
  if (!(await limiter.limit({ key: sid })).success) return SLOW_DOWN_TEXT;
  return null;
}
