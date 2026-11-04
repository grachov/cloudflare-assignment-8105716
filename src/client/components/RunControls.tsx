import { useState } from 'react';
import { api, ApiError, type RunMode } from '../api';

interface Props {
  onRun: (runId: string, duplicate: boolean) => void;
}

export function RunControls({ onRun }: Props) {
  const [lastRun, setLastRun] = useState<{ key: string; mode: RunMode } | null>(
    null,
  );
  const [isBusy, setIsBusy] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [message, setMessage] = useState<{
    kind: 'info' | 'error';
    text: string;
  } | null>(null);

  async function send(req: { key: string; mode: RunMode }) {
    setLastRun(req);
    setIsBusy(true);
    setIsMenuOpen(false);
    setMessage(null);

    try {
      const response = await api.startRun(req.key, req.mode);

      setMessage({
        kind: 'info',
        text: response.duplicate
          ? `Existing run ${response.run.id} returned (same request key).`
          : `Run ${response.run.id} started.`,
      });
      onRun(response.run.id, response.duplicate);
    } catch (error) {
      if (!(error instanceof ApiError)) {
        setMessage({
          kind: 'error',
          text: 'Network error. Try again.',
        });
      } else if (error.status === 422) {
        setMessage({
          kind: 'error',
          text: 'This request key was already used with a different mode.',
        });
      } else if (error.status === 409) {
        setMessage({
          kind: 'error',
          text: 'This request key was used before the data reset. Start a new run instead.',
        });
      } else if (error.status === 503) {
        setMessage({
          kind: 'error',
          text: 'The workflow could not be started. Use "Replay last request" to retry safely.',
        });
      } else if (error.status === 401) {
        setMessage(null);
      } else {
        setMessage({
          kind: 'error',
          text: error.message,
        });
      }
    } finally {
      setIsBusy(false);
    }
  }

  const start = (mode: RunMode) =>
    send({
      key: crypto.randomUUID(),
      mode,
    });

  return (
    <div className="run-controls">
      <div
        className="split"
        onKeyDown={(e) => e.key === 'Escape' && setIsMenuOpen(false)}
      >
        <button
          type="button"
          className="btn primary"
          disabled={isBusy}
          onClick={() => start('normal')}
        >
          {isBusy ? 'Starting…' : 'Run reconciliation'}
        </button>
        <button
          type="button"
          className="btn primary split-toggle"
          aria-haspopup="menu"
          aria-expanded={isMenuOpen}
          aria-label="More run options"
          disabled={isBusy}
          onClick={() => setIsMenuOpen((o) => !o)}
        >
          ▾
        </button>
        {isMenuOpen && (
          <div role="menu" className="menu">
            <button
              type="button"
              role="menuitem"
              onClick={() => start('simulate_failure')}
            >
              Run with simulated failure
            </button>
          </div>
        )}
      </div>
      <button
        type="button"
        className="btn"
        disabled={!lastRun || isBusy}
        onClick={() => lastRun && send(lastRun)}
      >
        Replay last request
      </button>
      <p
        role="status"
        aria-live="polite"
        className={message?.kind === 'error' ? 'error-text' : 'muted'}
      >
        {message?.text}
      </p>
    </div>
  );
}
