import { useEffect, useState } from 'react';
import { api, type RunDTO } from '../api';
import { RUN_MODE_LABELS, RUN_STATUS_LABELS } from '../labels';

export function RunsList({
  refreshKey,
  selectedId,
  onSelect,
}: {
  refreshKey: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [runs, setRuns] = useState<RunDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .listRuns()
      .then((r) => !cancelled && setRuns(r))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  if (error)
    return (
      <p role="alert" className="error-text">
        Could not load runs: {error}
      </p>
    );
  if (!runs) return <p className="muted">Loading runs…</p>;
  if (runs.length === 0) return <p className="muted">No runs yet.</p>;

  return (
    <ul className="runs-list" aria-label="Recent runs">
      {runs.map((r) => (
        <li key={r.id}>
          <button
            type="button"
            className="run-item"
            aria-pressed={r.id === selectedId}
            onClick={() => onSelect(r.id)}
          >
            <span className="mono">{r.id}</span>
            <span className={`pill pill-${r.status}`}>
              {RUN_STATUS_LABELS[r.status]}
            </span>
            <span className="muted">
              {RUN_MODE_LABELS[r.mode]} · {r.findings_count} findings
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
