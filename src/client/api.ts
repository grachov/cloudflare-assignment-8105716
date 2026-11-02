import type { FindingKind } from '../shared/types';

export type InvoiceStatus =
  | 'MATCHED'
  | 'UNDERPAID'
  | 'OVERPAID'
  | 'UNPAID_OVERDUE'
  | 'OPEN'
  | 'NOT_RECONCILED';

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

export interface InvoicesResponse {
  asOfDate: string;
  latestRunId: string | null;
  invoices: InvoiceDTO[];
}

export type RunMode = 'normal' | 'simulate_failure';
export type RunStatus = 'queued' | 'running' | 'complete' | 'errored';
export type RunStep = 'load-and-reconcile' | 'write-findings' | 'complete';

export interface RunDTO {
  id: string;
  mode: RunMode;
  status: RunStatus;
  current_step: string | null;
  steps: RunStep[];
  as_of_date: string;
  dataset_hash: string | null;
  write_attempts: number;
  failure_injected: boolean | number;
  findings_count: number;
  summary: { kind: FindingKind; currency: string; count: number }[];
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface FindingDTO {
  id: number;
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

export interface SessionInfo {
  authenticated: boolean;
  expiresAt: string | number;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

let onUnauthorized: (() => void) | null = null;
export function setOnUnauthorized(cb: (() => void) | null): void {
  onUnauthorized = cb;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  opts: { skip401?: boolean } = {},
): Promise<{ status: number; body: T }> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  const res = await fetch(path, {
    ...init,
    headers,
    credentials: 'same-origin',
  });
  if (res.status === 401 && !opts.skip401) onUnauthorized?.();
  const text = res.status === 204 ? '' : await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  if (!res.ok) {
    const msg =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : `Request failed (${res.status})`;
    throw new ApiError(res.status, msg);
  }
  return { status: res.status, body: body as T };
}

export const api = {
  login: (passcode: string) =>
    request<{ ok: true }>(
      '/api/session',
      { method: 'POST', body: JSON.stringify({ passcode }) },
      { skip401: true },
    ).then((r) => r.body),
  getSession: () =>
    request<SessionInfo>('/api/session', {}, { skip401: true }).then(
      (r) => r.body,
    ),
  logout: () =>
    request<null>('/api/session', { method: 'DELETE' }, { skip401: true }).then(
      () => undefined,
    ),
  getInvoices: () =>
    request<InvoicesResponse>('/api/invoices').then((r) => r.body),
  startRun: (key: string, mode: RunMode) =>
    request<{ run: RunDTO; duplicate: boolean }>('/api/runs', {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify({ mode }),
    }).then((r) => ({ ...r.body, status: r.status })),
  listRuns: (limit = 20) =>
    request<{ runs: RunDTO[] }>(`/api/runs?limit=${limit}`).then(
      (r) => r.body.runs,
    ),
  getRun: (id: string) =>
    request<RunDTO>(`/api/runs/${encodeURIComponent(id)}`).then((r) => r.body),
  getFindings: (id: string, kind?: FindingKind) =>
    request<{ findings: FindingDTO[] }>(
      `/api/runs/${encodeURIComponent(id)}/findings${kind ? `?kind=${kind}` : ''}`,
    ).then((r) => r.body.findings),
};
