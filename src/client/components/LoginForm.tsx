import { useState, type SubmitEvent } from 'react';
import { api, ApiError } from '../api';

export function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  async function submit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsBusy(true);
    setError(null);

    try {
      await api.login(passcode);
      onSuccess();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setError('Wrong passcode');
      } else if (error instanceof ApiError && error.status === 429) {
        setError('Too many attempts, wait a minute');
      } else {
        setError('Could not sign in. Try again.');
      }
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <main className="login">
      <form className="card login-card" onSubmit={submit}>
        <h1>Billing Reconciliation Assistant</h1>
        <label htmlFor="passcode">Passcode</label>
        <input
          id="passcode"
          type="password"
          autoComplete="current-password"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby="login-error"
          required
          autoFocus
        />
        <div id="login-error" role="alert" className="error-text">
          {error}
        </div>
        <button
          type="submit"
          className="btn primary"
          disabled={isBusy || !passcode}
        >
          {isBusy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
