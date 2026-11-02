import type { Finding } from '../shared/types';

export type FindingRow = Finding & { id: string; run_id: string };

/** R8: hex(SHA-256("v1|run_id|kind|invoice_id|payment_id")), stable across retries and replays. */
export async function findingId(
  runId: string,
  f: Pick<Finding, 'kind' | 'invoice_id' | 'payment_id'>,
): Promise<string> {
  const key = `v1|${runId}|${f.kind}|${f.invoice_id ?? ''}|${f.payment_id ?? ''}`;
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(key),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}

export async function toRows(
  runId: string,
  findings: Finding[],
): Promise<FindingRow[]> {
  return Promise.all(
    findings.map(async (f) => ({
      ...f,
      id: await findingId(runId, f),
      run_id: runId,
    })),
  );
}
