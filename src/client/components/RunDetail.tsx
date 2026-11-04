import { useEffect, useRef, useState } from 'react';
import { api, type RunDTO } from '../api';
import { FindingsView } from './FindingsView';
import {
  KIND_LABELS,
  RUN_MODE_LABELS,
  RUN_STATUS_LABELS,
  RUN_STEP_LABELS,
} from '../labels';
import { RUN_STEPS } from '../../shared/types';

const isTerminal = (run: RunDTO | null) =>
  run?.status === 'complete' || run?.status === 'errored';

function stepState(
  run: RunDTO,
  index: number,
): 'done' | 'active' | 'pending' | 'failed' {
  if (run.status === 'complete') {
    return 'done';
  }

  const current = Math.max(
    0,
    RUN_STEPS.findIndex((step) => step === run.current_step),
  );

  if (index < current) {
    return 'done';
  }

  if (index === current) {
    return run.status === 'errored' ? 'failed' : 'active';
  }

  return 'pending';
}

export function RunDetail({
  runId,
  isDuplicate,
  onTerminal,
}: {
  runId: string;
  isDuplicate: boolean;
  onTerminal: (run: RunDTO) => void;
}) {
  const [run, setRun] = useState<RunDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const notified = useRef<string | null>(null);
  const onTerminalRef = useRef(onTerminal);

  onTerminalRef.current = onTerminal;

  useEffect(() => {
    let isCancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    setRun(null);
    setError(null);

    const tick = async () => {
      try {
        const run = await api.getRun(runId);

        if (isCancelled) {
          return;
        }

        setRun(run);
        setError(null);

        if (isTerminal(run)) {
          if (notified.current !== run.id) {
            notified.current = run.id;
            onTerminalRef.current(run);
          }

          return;
        }
      } catch (error) {
        if (isCancelled) {
          return;
        }

        setError((error as Error).message);
      }

      timer = setTimeout(tick, 1_000);
    };

    void tick();

    return () => {
      isCancelled = true;

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
      {isDuplicate && (
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
          {RUN_STATUS_LABELS[run.status]}
        </span>
        <span className="muted">Mode: {RUN_MODE_LABELS[run.mode]}</span>
      </header>

      <ol className="steps" aria-label="Progress">
        {RUN_STEPS.map((step, i) => {
          const state = stepState(run, i);

          return (
            <li
              key={step}
              className={`step step-${state}`}
              aria-current={state === 'active' ? 'step' : undefined}
            >
              <span className="step-dot" aria-hidden="true">
                {state === 'done' ? '✓' : state === 'failed' ? '✕' : i + 1}
              </span>
              <span>{RUN_STEP_LABELS[step]}</span>
              <span className="visually-hidden"> ({state})</span>
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
          {run.summary.map((row) => (
            <li key={`${row.kind}-${row.currency}`}>
              <strong>{row.count}</strong> {KIND_LABELS[row.kind]}{' '}
              <span className="muted">{row.currency}</span>
            </li>
          ))}
        </ul>
      )}

      <h3>Findings</h3>
      <FindingsView runId={run.id} enabled={run.status === 'complete'} />
    </article>
  );
}
