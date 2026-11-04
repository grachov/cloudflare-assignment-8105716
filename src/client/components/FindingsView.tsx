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
    if (!enabled) {
      return;
    }

    let isCancelled = false;

    setFindings(null);

    api
      .getFindings(runId)
      .then((findings) => !isCancelled && setFindings(findings))
      .catch((error: Error) => !isCancelled && setError(error.message));

    return () => {
      isCancelled = true;
    };
  }, [runId, enabled]);

  if (!enabled) {
    return <p className="muted">Findings appear when the run completes.</p>;
  }

  if (error) {
    return (
      <p role="alert" className="error-text">
        Could not load findings: {error}
      </p>
    );
  }

  if (!findings) {
    return <p className="muted">Loading findings…</p>;
  }

  if (findings.length === 0) {
    return <p className="muted">No findings.</p>;
  }

  // Groups keep the order in which kinds first appear (seq order).
  const groups = new Map<FindingKind, FindingDTO[]>();

  for (const finding of findings) {
    const list = groups.get(finding.kind);

    if (list) {
      list.push(finding);
    } else {
      groups.set(finding.kind, [finding]);
    }
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
                {rows.map((finding) => (
                  <tr key={finding.id}>
                    <th scope="row" className="mono">
                      {[finding.invoice_id, finding.payment_id]
                        .filter(Boolean)
                        .join(' / ')}
                    </th>
                    <td className="num">
                      {formatMinor(finding.expected_minor, finding.currency)}
                    </td>
                    <td className="num">
                      {formatMinor(finding.actual_minor, finding.currency)}
                    </td>
                    <td className="num">
                      {formatMinor(finding.delta_minor, finding.currency)}
                    </td>
                    <td>{finding.detail}</td>
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
