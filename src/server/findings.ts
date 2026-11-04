import type { Finding } from '../shared/types';

export type FindingRow = Finding & { id: string; run_id: string };

/** R8: hex(SHA-256("v1|run_id|kind|invoice_id|payment_id")), stable across retries and replays. */
export async function findingId(
  runId: string,
  finding: Pick<Finding, 'kind' | 'invoice_id' | 'payment_id'>,
): Promise<string> {
  const key = `v1|${runId}|${finding.kind}|${finding.invoice_id ?? ''}|${finding.payment_id ?? ''}`;
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
    findings.map(async (finding) => ({
      ...finding,
      id: await findingId(runId, finding),
      run_id: runId,
    })),
  );
}
