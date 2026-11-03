import type {
  FindingDTO,
  FindingKind,
  InvoicesResponse,
  RunDTO,
  RunMode,
} from '../shared/types';

export type {
  FindingDTO,
  FindingKind,
  InvoiceDTO,
  InvoiceStatus,
  InvoicesResponse,
  RunDTO,
  RunMode,
  RunStatus,
} from '../shared/types';

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
  // handlesAuth: the caller deals with an unauthenticated response itself (the session endpoints),
  // so it must not trigger the app-wide "signed out" handler.
  opts: { handlesAuth?: boolean } = {},
): Promise<{ status: number; body: T }> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  const res = await fetch(path, {
    ...init,
    headers,
    credentials: 'same-origin',
  });
  if (res.status === 401 && !opts.handlesAuth) onUnauthorized?.();
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
      { handlesAuth: true },
    ).then((r) => r.body),
  getSession: () =>
    request<SessionInfo>('/api/session', {}, { handlesAuth: true }).then(
      (r) => r.body,
    ),
  logout: () =>
    request<null>(
      '/api/session',
      { method: 'DELETE' },
      { handlesAuth: true },
    ).then(() => undefined),
  getInvoices: () =>
    request<InvoicesResponse>('/api/invoices').then((r) => r.body),
  startRun: (key: string, mode: RunMode) =>
    request<{ run: RunDTO; duplicate: boolean }>('/api/runs', {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify({ mode }),
    }).then((r) => ({ ...r.body, status: r.status })),
  deleteAllRuns: () =>
    request<{ deleted: { runs: number; findings: number } }>('/api/runs', {
      method: 'DELETE',
    }).then((r) => r.body.deleted),
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
