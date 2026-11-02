import { useEffect, useRef, useState } from 'react';
import { api, type RunDTO } from '../api';
import { FindingsView } from './FindingsView';

const STEPS = ['load-and-reconcile', 'write-findings', 'complete'] as const;
const isTerminal = (r: RunDTO | null) =>
  r?.status === 'complete' || r?.status === 'errored';

function stepState(
  run: RunDTO,
  index: number,
): 'done' | 'active' | 'pending' | 'failed' {
  if (run.status === 'complete') return 'done';
  const current = Math.max(
    0,
    STEPS.findIndex((s) => s === run.current_step),
  );
  if (index < current) return 'done';
  if (index === current) return run.status === 'errored' ? 'failed' : 'active';
  return 'pending';
}

export function RunDetail({
  runId,
  duplicate,
  onTerminal,
}: {
  runId: string;
  duplicate: boolean;
  onTerminal: (run: RunDTO) => void;
}) {
  const [run, setRun] = useState<RunDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const notified = useRef<string | null>(null);
  const onTerminalRef = useRef(onTerminal);
  onTerminalRef.current = onTerminal;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setRun(null);
    setError(null);

    const tick = async () => {
      try {
        const r = await api.getRun(runId);
        if (cancelled) return;
        setRun(r);
        setError(null);
        if (isTerminal(r)) {
          if (notified.current !== r.id) {
            notified.current = r.id;
            onTerminalRef.current(r);
          }
          return;
        }
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message);
      }
      timer = setTimeout(tick, 1000);
    };
    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [runId]);

  if (!run) {
    return error ? (
      <p role="alert" className="error-text">
        Could not load run: {error}
      </p>
    ) : (
      <p className="muted">Loading run…</p>
    );
  }

  return (
    <article className="card run-detail" aria-label={`Run ${run.id}`}>
      {duplicate && (
        <div role="status" className="banner info">
          Duplicate request — existing run returned
        </div>
      )}
      <header className="run-head">
        <h3 className="mono">{run.id}</h3>
        <span
          className={`pill pill-${run.status}`}
          role="status"
          aria-live="polite"
        >
          {run.status}
        </span>
        <span className="muted">mode: {run.mode}</span>
      </header>

      <ol className="steps" aria-label="Progress">
        {STEPS.map((s, i) => {
          const st = stepState(run, i);
          return (
            <li
              key={s}
              className={`step step-${st}`}
              aria-current={st === 'active' ? 'step' : undefined}
            >
              <span className="step-dot" aria-hidden="true">
                {st === 'done' ? '✓' : st === 'failed' ? '✕' : i + 1}
              </span>
              <span>{s}</span>
              <span className="visually-hidden"> ({st})</span>
            </li>
          );
        })}
      </ol>

      {run.write_attempts > 1 && (
        <div role="status" className="banner warn">
          Retried after a transient failure
        </div>
      )}
      {run.error && (
        <div role="alert" className="banner danger">
          Error: {run.error}
        </div>
      )}

      <dl className="facts">
        <div>
          <dt>Write attempts</dt>
          <dd>{run.write_attempts}</dd>
        </div>
        <div>
          <dt>Failure injected</dt>
          <dd>{run.failure_injected ? 'yes' : 'no'}</dd>
        </div>
        <div>
          <dt>Findings</dt>
          <dd>{run.findings_count}</dd>
        </div>
        <div>
          <dt>As of</dt>
          <dd>{run.as_of_date}</dd>
        </div>
      </dl>

      {run.summary.length > 0 && (
        <ul className="summary" aria-label="Summary by kind and currency">
          {run.summary.map((s) => (
            <li key={`${s.kind}-${s.currency}`}>
              <strong>{s.count}</strong> {s.kind}{' '}
              <span className="muted">{s.currency}</span>
            </li>
          ))}
        </ul>
      )}

      <h3>Findings</h3>
      <FindingsView runId={run.id} enabled={run.status === 'complete'} />
    </article>
  );
}
