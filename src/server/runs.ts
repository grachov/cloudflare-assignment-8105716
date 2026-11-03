// Run state in D1 (the sole status authority) plus Workflow instance creation.
// Every state UPDATE is conditional on the run not being terminal, so a late or replayed step never rewrites history.
import {
  RUN_STEPS,
  type RunDTO,
  type RunMode,
  type RunStatus,
  type RunSummaryRow,
} from '../shared/types';
import type { FindingRow } from './findings';

export type ReconParams = { runId: string; mode: RunMode; asOfDate: string };

export interface RunRow {
  id: string;
  idempotency_key: string;
  dataset_hash: string | null;
  mode: RunMode;
  as_of_date: string;
  status: RunStatus;
  workflow_instance_id: string;
  current_step: string | null;
  write_attempts: number;
  failure_injected: number;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  summary_json: string | null;
}

const NOT_TERMINAL = "status NOT IN ('complete', 'errored')";

export type EnsuredWorkflow = 'created' | InstanceStatus['status'];

/**
 * Create the Workflow instance for a run. Any create error (already exists, transient, unknown) is confirmed by
 * reading the instance back, and the existing instance's status is returned; only if that also fails is the
 * original error rethrown. Error codes are never matched.
 */
export async function ensureWorkflow(
  env: Env,
  id: string,
  params: ReconParams,
): Promise<EnsuredWorkflow> {
  try {
    await env.RECON.create({ id, params });
    return 'created';
  } catch (e) {
    try {
      return (await (await env.RECON.get(id)).status()).status;
    } catch {
      throw e;
    }
  }
}

export function paramsOf(row: RunRow): ReconParams {
  return { runId: row.id, mode: row.mode, asOfDate: row.as_of_date };
}

/** Returns true when a new row was inserted, false when the idempotency key already exists. */
export async function insertRun(
  db: D1Database,
  run: {
    id: string;
    key: string;
    mode: RunMode;
    asOfDate: string;
    startedAt: string;
  },
): Promise<boolean> {
  const row = await db
    .prepare(
      `INSERT INTO reconciliation_runs (id, idempotency_key, workflow_instance_id, mode, as_of_date, status, started_at)
       VALUES (?1, ?2, ?1, ?3, ?4, 'queued', ?5)
       ON CONFLICT(idempotency_key) DO NOTHING RETURNING id`,
    )
    .bind(run.id, run.key, run.mode, run.asOfDate, run.startedAt)
    .first<{ id: string }>();
  return row !== null;
}

export function getRun(db: D1Database, id: string): Promise<RunRow | null> {
  return db
    .prepare('SELECT * FROM reconciliation_runs WHERE id = ?1')
    .bind(id)
    .first<RunRow>();
}

export function getRunByKey(
  db: D1Database,
  key: string,
): Promise<RunRow | null> {
  return db
    .prepare('SELECT * FROM reconciliation_runs WHERE idempotency_key = ?1')
    .bind(key)
    .first<RunRow>();
}

export async function listRuns(
  db: D1Database,
  limit: number,
): Promise<RunRow[]> {
  const { results } = await db
    .prepare(
      'SELECT * FROM reconciliation_runs ORDER BY started_at DESC, id DESC LIMIT ?1',
    )
    .bind(limit)
    .all<RunRow>();
  return results;
}

export async function markRunning(
  db: D1Database,
  id: string,
  datasetHash: string,
): Promise<number> {
  const res = await db
    .prepare(
      `UPDATE reconciliation_runs SET status = 'running', current_step = 'load-and-reconcile', dataset_hash = ?2
       WHERE id = ?1 AND ${NOT_TERMINAL}`,
    )
    .bind(id, datasetHash)
    .run();
  return res.meta.changes;
}

const INSERT_FINDING_SQL = `INSERT INTO findings
  (id, run_id, seq, kind, invoice_id, payment_id, expected_minor, actual_minor, delta_minor, currency, detail)
  SELECT ?2, ?1, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11
  WHERE EXISTS (SELECT 1 FROM reconciliation_runs WHERE id = ?1 AND ${NOT_TERMINAL})
  ON CONFLICT(id) DO NOTHING`;

const WRITE_ATTEMPT_SQL = `UPDATE reconciliation_runs
  SET write_attempts = write_attempts + 1, current_step = 'write-findings',
      failure_injected = CASE WHEN mode = 'simulate_failure' THEN 1 ELSE failure_injected END
  WHERE id = ?1 AND ${NOT_TERMINAL}
  RETURNING write_attempts, mode`;

/**
 * One atomic batch of guarded, conflict-free finding INSERTs plus the attempt counter UPDATE.
 * `attempt` is null when the run is already terminal (nothing was written).
 */
export async function writeFindings(
  db: D1Database,
  runId: string,
  rows: FindingRow[],
): Promise<{
  inserted: number;
  attempt: { write_attempts: number; mode: RunMode } | null;
}> {
  const inserts = rows.map((finding) =>
    db
      .prepare(INSERT_FINDING_SQL)
      .bind(
        runId,
        finding.id,
        finding.seq,
        finding.kind,
        finding.invoice_id,
        finding.payment_id,
        finding.expected_minor,
        finding.actual_minor,
        finding.delta_minor,
        finding.currency,
        finding.detail,
      ),
  );
  const results = await db.batch<{ write_attempts: number; mode: RunMode }>([
    ...inserts,
    db.prepare(WRITE_ATTEMPT_SQL).bind(runId),
  ]);
  const last = results[results.length - 1];
  const inserted = results.slice(0, -1).reduce((n, r) => n + r.meta.changes, 0);
  return { inserted, attempt: last.results[0] ?? null };
}

export async function markComplete(
  db: D1Database,
  id: string,
  completedAt: string,
): Promise<number> {
  const summary = await findingsSummary(db, [id]);
  const summaryJson = JSON.stringify(
    summary.get(id) ?? { findings_count: 0, summary: [] },
  );
  const res = await db
    .prepare(
      `UPDATE reconciliation_runs SET status = 'complete', current_step = 'complete', completed_at = ?2, summary_json = ?3
       WHERE id = ?1 AND ${NOT_TERMINAL}`,
    )
    .bind(id, completedAt, summaryJson)
    .run();
  return res.meta.changes;
}

export async function markErrored(
  db: D1Database,
  id: string,
  error: string,
): Promise<number> {
  const res = await db
    .prepare(
      `UPDATE reconciliation_runs SET status = 'errored', error = ?2 WHERE id = ?1 AND ${NOT_TERMINAL}`,
    )
    .bind(id, error)
    .run();
  return res.meta.changes;
}

type RunSummary = { findings_count: number; summary: RunSummaryRow[] };

/** Per run: findings count plus {kind, currency, count} grouped by kind and currency, in first-seq order. */
async function findingsSummary(
  db: D1Database,
  runIds: string[],
): Promise<Map<string, RunSummary>> {
  const { results } = await db
    .prepare(
      `SELECT run_id, kind, currency, COUNT(*) AS count FROM findings
       WHERE run_id IN (SELECT value FROM json_each(?1))
       GROUP BY run_id, kind, currency ORDER BY run_id, MIN(seq)`,
    )
    .bind(JSON.stringify(runIds))
    .all<RunSummaryRow & { run_id: string }>();
  const byRun = new Map<string, RunSummary>();
  for (const { run_id, kind, currency, count } of results) {
    const entry = byRun.get(run_id) ?? { findings_count: 0, summary: [] };
    entry.findings_count += count;
    entry.summary.push({ kind, currency, count });
    byRun.set(run_id, entry);
  }
  return byRun;
}

export async function toRunDTOs(
  db: D1Database,
  rows: RunRow[],
): Promise<RunDTO[]> {
  const summaries =
    rows.length > 0
      ? await findingsSummary(
          db,
          rows.map((run) => run.id),
        )
      : new Map<string, RunSummary>();
  return rows.map((run) => ({
    id: run.id,
    mode: run.mode,
    status: run.status,
    current_step: run.current_step,
    steps: [...RUN_STEPS],
    as_of_date: run.as_of_date,
    dataset_hash: run.dataset_hash,
    write_attempts: run.write_attempts,
    failure_injected: run.failure_injected,
    findings_count: summaries.get(run.id)?.findings_count ?? 0,
    summary: summaries.get(run.id)?.summary ?? [],
    error: run.error,
    started_at: run.started_at,
    completed_at: run.completed_at,
  }));
}

export async function toRunDTO(db: D1Database, row: RunRow): Promise<RunDTO> {
  const [dto] = await toRunDTOs(db, [row]);

  return dto;
}

/** Demo reset: removes every run and finding in one atomic batch (findings first, for the foreign key). */
export async function deleteAllRuns(
  db: D1Database,
): Promise<{ runs: number; findings: number }> {
  const [findings, runs] = await db.batch([
    db.prepare('DELETE FROM findings'),
    db.prepare('DELETE FROM reconciliation_runs'),
  ]);
  return { runs: runs.meta.changes, findings: findings.meta.changes };
}

/** Deletes a run only while it is still queued; returns true when a row was removed. */
export async function deleteQueuedRun(
  db: D1Database,
  id: string,
): Promise<boolean> {
  const res = await db
    .prepare(
      "DELETE FROM reconciliation_runs WHERE id = ?1 AND status = 'queued'",
    )
    .bind(id)
    .run();
  return res.meta.changes > 0;
}
