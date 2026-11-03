/** The six finding kinds, in R7 KIND_RANK order. */
export const KINDS = [
  'matched',
  'underpaid',
  'overpaid',
  'unpaid_overdue',
  'duplicate_payment',
  'unmatched_payment',
] as const;

export type FindingKind = (typeof KINDS)[number];

/** Engine output row; keys are in the fixed R7 order. All *_minor values are integer minor units, delta >= 0. */
export interface Finding {
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

export const RUN_MODES = ['normal', 'simulate_failure'] as const;

export type RunMode = (typeof RUN_MODES)[number];

export type RunStatus = 'queued' | 'running' | 'complete' | 'errored';

/** Workflow steps in execution order (mark-errored only runs on failure). */
export const RUN_STEPS = [
  'load-and-reconcile',
  'write-findings',
  'complete',
] as const;

export type RunStep = (typeof RUN_STEPS)[number];

export interface RunSummaryRow {
  kind: FindingKind;
  currency: string;
  count: number;
}

/** GET /api/runs/:id. */
export interface RunDTO {
  id: string;
  mode: RunMode;
  status: RunStatus;
  current_step: string | null;
  steps: RunStep[];
  as_of_date: string;
  dataset_hash: string | null;
  write_attempts: number;
  failure_injected: number;
  findings_count: number;
  summary: RunSummaryRow[];
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
}

/** A persisted finding (GET /api/runs/:id/findings). */
export interface FindingDTO {
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

export type InvoiceStatus =
  | 'matched'
  | 'underpaid'
  | 'overpaid'
  | 'unpaid_overdue'
  | 'open'
  | 'not_reconciled';

/** One row of GET /api/invoices. */
export interface InvoiceDTO {
  id: string;
  customer: string;
  period_start: string;
  period_end: string;
  amount_minor: number;
  paid_minor: number;
  duplicate_minor: number;
  currency: string;
  status: InvoiceStatus;
}

/** GET /api/invoices. */
export interface InvoicesResponse {
  asOfDate: string;
  latestRunId: string | null;
  invoices: InvoiceDTO[];
}
