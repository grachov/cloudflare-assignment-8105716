import { useState } from 'react';
import { api, ApiError, type RunMode } from '../api';

interface Props {
  onRun: (runId: string, duplicate: boolean) => void;
}

export function RunControls({ onRun }: Props) {
  const [last, setLast] = useState<{ key: string; mode: RunMode } | null>(null);
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [message, setMessage] = useState<{
    kind: 'info' | 'error';
    text: string;
  } | null>(null);

  async function send(req: { key: string; mode: RunMode }) {
    setLast(req);
    setBusy(true);
    setMenuOpen(false);
    setMessage(null);
    try {
      const res = await api.startRun(req.key, req.mode);
      setMessage({
        kind: 'info',
        text: res.duplicate
          ? `Existing run ${res.run.id} returned (same request key).`
          : `Run ${res.run.id} started.`,
      });
      onRun(res.run.id, res.duplicate);
    } catch (e) {
      if (!(e instanceof ApiError))
        setMessage({ kind: 'error', text: 'Network error. Try again.' });
      else if (e.status === 422)
        setMessage({
          kind: 'error',
          text: 'This request key was already used with a different mode.',
        });
      else if (e.status === 503)
        setMessage({
          kind: 'error',
          text: 'The workflow could not be started. Use "Replay last request" to retry safely.',
        });
      else if (e.status === 401) setMessage(null);
      else setMessage({ kind: 'error', text: e.message });
    } finally {
      setBusy(false);
    }
  }

  const start = (mode: RunMode) => send({ key: crypto.randomUUID(), mode });

  return (
    <div className="run-controls">
      <div
        className="split"
        onKeyDown={(e) => e.key === 'Escape' && setMenuOpen(false)}
      >
        <button
          type="button"
          className="btn primary"
          disabled={busy}
          onClick={() => start('normal')}
        >
          {busy ? 'Starting…' : 'Run reconciliation'}
        </button>
        <button
          type="button"
          className="btn primary split-toggle"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label="More run options"
          disabled={busy}
          onClick={() => setMenuOpen((o) => !o)}
        >
          ▾
        </button>
        {menuOpen && (
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
        disabled={!last || busy}
        onClick={() => last && send(last)}
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
