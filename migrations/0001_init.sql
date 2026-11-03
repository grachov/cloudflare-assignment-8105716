-- Money is always INTEGER minor units (cents); no REAL column exists anywhere.
-- Dates are ISO 'YYYY-MM-DD' text; timestamps are ISO-8601 text.

CREATE TABLE subscriptions (
  id               TEXT PRIMARY KEY,
  customer_name    TEXT NOT NULL,
  plan             TEXT NOT NULL,
  unit_price_minor INTEGER NOT NULL CHECK (typeof(unit_price_minor) = 'integer' AND unit_price_minor >= 0),
  currency         TEXT NOT NULL CHECK (length(currency) = 3),
  billing_interval TEXT NOT NULL
);

CREATE TABLE invoices (
  id              TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id),
  period_start    TEXT NOT NULL,
  period_end      TEXT NOT NULL,
  amount_minor    INTEGER NOT NULL CHECK (typeof(amount_minor) = 'integer' AND amount_minor >= 0),
  currency        TEXT NOT NULL CHECK (length(currency) = 3),
  issued_at       TEXT NOT NULL,
  due_at          TEXT NOT NULL
);

-- invoice_ref is deliberately NOT a foreign key: unmatched payments need null and unknown refs.
CREATE TABLE payments (
  id           TEXT PRIMARY KEY,
  invoice_ref  TEXT,
  amount_minor INTEGER NOT NULL CHECK (typeof(amount_minor) = 'integer' AND amount_minor > 0),
  currency     TEXT NOT NULL CHECK (length(currency) = 3),
  received_at  TEXT NOT NULL,
  provider_ref TEXT NOT NULL UNIQUE
);

CREATE TABLE reconciliation_runs (
  id                   TEXT PRIMARY KEY,
  idempotency_key      TEXT NOT NULL UNIQUE,
  dataset_hash         TEXT,
  mode                 TEXT NOT NULL CHECK (mode IN ('normal', 'simulate_failure')),
  as_of_date           TEXT NOT NULL,
  status               TEXT NOT NULL CHECK (status IN ('queued', 'running', 'complete', 'errored')),
  workflow_instance_id TEXT NOT NULL,
  current_step         TEXT,
  write_attempts       INTEGER NOT NULL DEFAULT 0,
  failure_injected     INTEGER NOT NULL DEFAULT 0,
  error                TEXT,
  started_at           TEXT,
  completed_at         TEXT,
  summary_json         TEXT
);

-- id = hex(SHA-256("v1|run_id|kind|invoice_id|payment_id")); seq = engine output index (all reads ORDER BY seq).
-- invoice_id / payment_id are NOT foreign keys (an unmatched payment has no invoice).
CREATE TABLE findings (
  id             TEXT PRIMARY KEY,
  run_id         TEXT NOT NULL REFERENCES reconciliation_runs(id),
  seq            INTEGER NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('matched', 'underpaid', 'overpaid', 'duplicate_payment', 'unpaid_overdue', 'unmatched_payment')),
  invoice_id     TEXT,
  payment_id     TEXT,
  expected_minor INTEGER NOT NULL CHECK (typeof(expected_minor) = 'integer' AND expected_minor >= 0),
  actual_minor   INTEGER NOT NULL CHECK (typeof(actual_minor) = 'integer' AND actual_minor >= 0),
  delta_minor    INTEGER NOT NULL CHECK (typeof(delta_minor) = 'integer' AND delta_minor >= 0),
  currency       TEXT NOT NULL CHECK (length(currency) = 3),
  detail         TEXT NOT NULL
);

-- Not UNIQUE: ON CONFLICT(id) stays the only conflict path.
CREATE INDEX findings_run_seq ON findings (run_id, seq);
