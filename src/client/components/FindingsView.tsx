import { useEffect, useState } from 'react';
import { formatMinor } from '../../shared/money';
import { api, type FindingDTO, type FindingKind } from '../api';
import { KIND_LABELS } from '../labels';

export function FindingsView({
  runId,
  enabled,
}: {
  runId: string;
  enabled: boolean;
}) {
  const [findings, setFindings] = useState<FindingDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setFindings(null);
    api
      .getFindings(runId)
      .then((f) => !cancelled && setFindings(f))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [runId, enabled]);

  if (!enabled)
    return <p className="muted">Findings appear when the run completes.</p>;
  if (error)
    return (
      <p role="alert" className="error-text">
        Could not load findings: {error}
      </p>
    );
  if (!findings) return <p className="muted">Loading findings…</p>;
  if (findings.length === 0) return <p className="muted">No findings.</p>;

  // Groups keep the order in which kinds first appear (seq order).
  const groups = new Map<FindingKind, FindingDTO[]>();
  for (const f of findings) {
    const list = groups.get(f.kind);
    if (list) list.push(f);
    else groups.set(f.kind, [f]);
  }

  return (
    <div className="findings">
      {[...groups].map(([kind, rows]) => (
        <section key={kind} aria-labelledby={`f-${kind}`}>
          <h4 id={`f-${kind}`}>
            {KIND_LABELS[kind]} <span className="count">{rows.length}</span>
          </h4>
          <div
            className="table-wrap"
            role="region"
            aria-label={`${KIND_LABELS[kind]} findings`}
            tabIndex={0}
          >
            <table>
              <thead>
                <tr>
                  <th scope="col">Invoice / payment</th>
                  <th scope="col" className="num">
                    Expected
                  </th>
                  <th scope="col" className="num">
                    Actual
                  </th>
                  <th scope="col" className="num">
                    Delta
                  </th>
                  <th scope="col">Detail</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((f) => (
                  <tr key={f.id}>
                    <th scope="row" className="mono">
                      {[f.invoice_id, f.payment_id].filter(Boolean).join(' / ')}
                    </th>
                    <td className="num">
                      {formatMinor(f.expected_minor, f.currency)}
                    </td>
                    <td className="num">
                      {formatMinor(f.actual_minor, f.currency)}
                    </td>
                    <td className="num">
                      {formatMinor(f.delta_minor, f.currency)}
                    </td>
                    <td>{f.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
