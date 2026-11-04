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

  if (init.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(path, {
    ...init,
    headers,
    credentials: 'same-origin',
  });

  if (response.status === 401 && !opts.handlesAuth) {
    onUnauthorized?.();
  }

  const text = response.status === 204 ? '' : await response.text();

  let body: unknown = null;

  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : `Request failed (${response.status})`;

    throw new ApiError(response.status, message);
  }

  return {
    status: response.status,
    body: body as T,
  };
}

export const api = {
  login: (passcode: string) =>
    request<{ ok: true }>(
      '/api/session',
      {
        method: 'POST',
        body: JSON.stringify({
          passcode,
        }),
      },
      {
        handlesAuth: true,
      },
    ).then(({ body }) => body),
  getSession: () =>
    request<SessionInfo>(
      '/api/session',
      {},
      {
        handlesAuth: true,
      },
    ).then(({ body }) => body),
  logout: () =>
    request<null>(
      '/api/session',
      {
        method: 'DELETE',
      },
      {
        handlesAuth: true,
      },
    ).then(() => undefined),
  getInvoices: () =>
    request<InvoicesResponse>('/api/invoices').then(({ body }) => body),
  startRun: (key: string, mode: RunMode) =>
    request<{ run: RunDTO; duplicate: boolean }>('/api/runs', {
      method: 'POST',
      headers: {
        'Idempotency-Key': key,
      },
      body: JSON.stringify({
        mode,
      }),
    }).then((response) => ({
      ...response.body,
      status: response.status,
    })),
  deleteAllRuns: () =>
    request<{ deleted: { runs: number; findings: number } }>('/api/runs', {
      method: 'DELETE',
    }).then(({ body }) => body.deleted),
  listRuns: (limit = 20) =>
    request<{ runs: RunDTO[] }>(`/api/runs?limit=${limit}`).then(
      ({ body }) => body.runs,
    ),
  getRun: (id: string) =>
    request<RunDTO>(`/api/runs/${encodeURIComponent(id)}`).then(
      ({ body }) => body,
    ),
  getFindings: (id: string, kind?: FindingKind) =>
    request<{ findings: FindingDTO[] }>(
      `/api/runs/${encodeURIComponent(id)}/findings${kind ? `?kind=${kind}` : ''}`,
    ).then(({ body }) => body.findings),
};
