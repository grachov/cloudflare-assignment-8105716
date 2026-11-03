// Human-readable labels for API enum values; the API itself always uses lowercase snake_case.
import type {
  FindingKind,
  InvoiceStatus,
  RunMode,
  RunStatus,
  RunStep,
} from '../shared/types';

export const KIND_LABELS: Record<FindingKind, string> = {
  matched: 'Matched',
  underpaid: 'Underpaid',
  overpaid: 'Overpaid',
  unpaid_overdue: 'Unpaid overdue',
  duplicate_payment: 'Duplicate payment',
  unmatched_payment: 'Unmatched payment',
};

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  matched: 'Matched',
  underpaid: 'Underpaid',
  overpaid: 'Overpaid',
  unpaid_overdue: 'Unpaid overdue',
  open: 'Open',
  not_reconciled: 'Not reconciled',
};

export const RUN_MODE_LABELS: Record<RunMode, string> = {
  normal: 'Normal',
  simulate_failure: 'Simulated failure',
};

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  complete: 'Complete',
  errored: 'Errored',
};

export const RUN_STEP_LABELS: Record<RunStep, string> = {
  'load-and-reconcile': 'Load and reconcile',
  'write-findings': 'Write findings',
  complete: 'Complete',
};
