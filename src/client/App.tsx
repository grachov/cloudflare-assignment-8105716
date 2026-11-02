import { useCallback, useEffect, useState } from 'react';
import { api, setOnUnauthorized } from './api';
import { LoginForm } from './components/LoginForm';
import { InvoicesTable } from './components/InvoicesTable';
import { RunControls } from './components/RunControls';
import { RunDetail } from './components/RunDetail';
import { RunsList } from './components/RunsList';
import { ChatPanel } from './components/ChatPanel';
import './styles.css';

type Auth = 'loading' | 'out' | 'in';
type Tab = 'invoices' | 'runs';

export function App() {
  const [auth, setAuth] = useState<Auth>('loading');

  useEffect(() => {
    setOnUnauthorized(() => setAuth('out'));
    api
      .getSession()
      .then(() => setAuth('in'))
      .catch(() => setAuth('out'));
    return () => setOnUnauthorized(null);
  }, []);

  if (auth === 'loading') return <p className="muted center">Loading…</p>;
  if (auth === 'out') return <LoginForm onSuccess={() => setAuth('in')} />;
  return <Main onLogout={() => setAuth('out')} />;
}

function Main({ onLogout }: { onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>('invoices');
  const [asOf, setAsOf] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [runId, setRunId] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState(false);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  const logout = async () => {
    try {
      await api.logout();
    } finally {
      onLogout();
    }
  };

  const onRun = (id: string, dup: boolean) => {
    setRunId(id);
    setDuplicate(dup);
    setTab('runs');
    refresh();
  };

  return (
    <>
      <header className="app-header">
        <h1>Billing Reconciliation Assistant</h1>
        {asOf && <span className="asof">As of {asOf}</span>}
        <button type="button" className="btn small" onClick={logout}>
          Log out
        </button>
      </header>

      <div className="layout">
        <main className="content">
          <RunControls onRun={onRun} />
          <div role="tablist" aria-label="Views" className="tabs">
            {(['invoices', 'runs'] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                id={`tab-${t}`}
                aria-selected={tab === t}
                aria-controls={`panel-${t}`}
                className="tab"
                onClick={() => setTab(t)}
              >
                {t === 'invoices' ? 'Invoices' : 'Runs'}
              </button>
            ))}
          </div>

          <div
            role="tabpanel"
            id="panel-invoices"
            aria-labelledby="tab-invoices"
            hidden={tab !== 'invoices'}
          >
            <InvoicesTable
              refreshKey={refreshKey}
              onLoaded={(d) => setAsOf(d.asOfDate)}
            />
          </div>
          <div
            role="tabpanel"
            id="panel-runs"
            aria-labelledby="tab-runs"
            hidden={tab !== 'runs'}
          >
            <div className="runs-grid">
              <RunsList
                refreshKey={refreshKey}
                selectedId={runId}
                onSelect={(id) => {
                  setRunId(id);
                  setDuplicate(false);
                }}
              />
              {runId ? (
                <RunDetail
                  runId={runId}
                  duplicate={duplicate}
                  onTerminal={refresh}
                />
              ) : (
                <p className="muted">Select a run or start a new one.</p>
              )}
            </div>
          </div>
        </main>
        <aside className="side">
          <ChatPanel />
        </aside>
      </div>
    </>
  );
}
