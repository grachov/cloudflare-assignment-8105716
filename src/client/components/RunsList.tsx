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
    let isCancelled = false;

    api
      .listRuns()
      .then((runs) => !isCancelled && setRuns(runs))
      .catch((error: Error) => !isCancelled && setError(error.message));

    return () => {
      isCancelled = true;
    };
  }, [refreshKey]);

  if (error) {
    return (
      <p role="alert" className="error-text">
        Could not load runs: {error}
      </p>
    );
  }

  if (!runs) {
    return <p className="muted">Loading runs…</p>;
  }

  if (runs.length === 0) {
    return <p className="muted">No runs yet.</p>;
  }

  return (
    <ul className="runs-list" aria-label="Recent runs">
      {runs.map((run) => (
        <li key={run.id}>
          <button
            type="button"
            className="run-item"
            aria-pressed={run.id === selectedId}
            onClick={() => onSelect(run.id)}
          >
            <span className="mono">{run.id}</span>
            <span className={`pill pill-${run.status}`}>
              {RUN_STATUS_LABELS[run.status]}
            </span>
            <span className="muted">
              {RUN_MODE_LABELS[run.mode]} · {run.findings_count} findings
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
