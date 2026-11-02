import { env } from 'cloudflare:workers';
import {
  introspectWorkflow,
  introspectWorkflowInstance,
} from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import app from '../../src/server/index';
import { toRows } from '../../src/server/findings';
import { markErrored, writeFindings } from '../../src/server/runs';
import type { Finding, RunDTO } from '../../src/shared/types';
import expectedFindings from '../fixtures/expected-findings.json';
import { api, login, newKey, postRun, runToCompletion } from './helpers';

type RunRow = {
  status: string;
  write_attempts: number;
  failure_injected: number;
  current_step: string | null;
};

async function runRow(id: string): Promise<RunRow | null> {
  return env.DB.prepare(
    'SELECT status, write_attempts, failure_injected, current_step FROM reconciliation_runs WHERE id = ?1',
  )
    .bind(id)
    .first<RunRow>();
}

async function findingCounts(id: string): Promise<{ n: number; d: number }> {
  return (await env.DB.prepare(
    'SELECT COUNT(*) n, COUNT(DISTINCT id) d FROM findings WHERE run_id = ?1',
  )
    .bind(id)
    .first<{ n: number; d: number }>())!;
}

async function findingIds(id: string): Promise<Set<string>> {
  const { results } = await env.DB.prepare(
    'SELECT id FROM findings WHERE run_id = ?1',
  )
    .bind(id)
    .all<{ id: string }>();
  return new Set(results.map((r) => r.id));
}

describe('POST /api/runs + ReconWorkflow', () => {
  it('AC7: the same key twice returns the same run, duplicate:true, and creates exactly one instance', async () => {
    const key = newKey();
    const id = `run-${key}`;
    await using workflows = await introspectWorkflow(env.RECON);

    const first = await postRun(key, 'normal');
    expect(first.status).toBe(202);
    const a = (await first.json()) as { run: RunDTO; duplicate: boolean };
    expect(a).toMatchObject({ duplicate: false, run: { id, mode: 'normal' } });

    const second = await postRun(key, 'normal');
    expect(second.status).toBe(200);
    const b = (await second.json()) as { run: RunDTO; duplicate: boolean };
    expect(b).toMatchObject({ duplicate: true, run: { id } });

    const instances = await workflows.get();
    expect(instances).toHaveLength(1);
    await instances[0].waitForStatus('complete');

    expect(await runRow(id)).toMatchObject({
      status: 'complete',
      write_attempts: 1,
      failure_injected: 0,
    });
    expect(await findingCounts(id)).toEqual({ n: 17, d: 17 });

    // A replay of a finished run is still a duplicate and does not create anything.
    const third = await postRun(key, 'normal');
    expect(third.status).toBe(200);
    expect(await workflows.get()).toHaveLength(1);
  });

  it('AC8: a new key gives a new run with 17 findings and a disjoint id set', async () => {
    const r1 = await runToCompletion('normal');
    const r2 = await runToCompletion('normal');
    expect(r2.id).not.toBe(r1.id);
    expect(r1.run.findings_count).toBe(17);
    expect(r2.run.findings_count).toBe(17);
    const ids1 = await findingIds(r1.id);
    const ids2 = await findingIds(r2.id);
    expect(ids1.size).toBe(17);
    expect(ids2.size).toBe(17);
    expect([...ids1].filter((x) => ids2.has(x))).toEqual([]);
  });

  it('AC9: simulate_failure fails once after commit, is retried by the platform, and completes with 17 findings', async () => {
    const key = newKey();
    const id = `run-${key}`;
    await using instance = await introspectWorkflowInstance(env.RECON, id);
    await instance.modify(async (m) => {
      await m.disableRetryDelays();
    });

    expect((await postRun(key, 'simulate_failure')).status).toBe(202);
    await instance.waitForStatus('complete');

    expect(await runRow(id)).toEqual({
      status: 'complete',
      write_attempts: 2,
      failure_injected: 1,
      current_step: 'complete',
    });
    expect(await findingCounts(id)).toEqual({ n: 17, d: 17 });
  });

  it('AC10: a mocked transient write-findings error is retried without duplicate findings', async () => {
    const key = newKey();
    const id = `run-${key}`;
    await using instance = await introspectWorkflowInstance(env.RECON, id);
    await instance.modify(async (m) => {
      await m.disableRetryDelays();
      await m.mockStepError(
        { name: 'write-findings' },
        new Error('transient'),
        1,
      );
    });

    expect((await postRun(key, 'normal')).status).toBe(202);
    await instance.waitForStatus('complete');

    expect((await runRow(id))?.status).toBe('complete');
    expect(await findingCounts(id)).toEqual({ n: 17, d: 17 });
  });

  it('seed parity: D1 findings ORDER BY seq equal the hand-authored fixture', async () => {
    const { id } = await runToCompletion('normal');
    const { results } = await env.DB.prepare(
      `SELECT seq, kind, invoice_id, payment_id, expected_minor, actual_minor, delta_minor, currency, detail
       FROM findings WHERE run_id = ?1 ORDER BY seq`,
    )
      .bind(id)
      .all<Finding>();
    expect(results).toEqual(expectedFindings);
  });

  it('returns 422 when a key is reused with a different mode', async () => {
    const { key } = await runToCompletion('normal');
    const res = await postRun(key, 'simulate_failure');
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'idempotency_key_mismatch' });
  });

  it('returns 400 for a missing or non-UUID Idempotency-Key and for a bad body', async () => {
    const noKey = await api('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'normal' }),
    });
    expect(noKey.status).toBe(400);
    expect(await noKey.json()).toMatchObject({ error: 'invalid_request' });

    expect((await postRun('not-a-uuid', 'normal')).status).toBe(400);
    expect((await postRun(newKey(), 'turbo')).status).toBe(400);

    const malformed = await api('/api/runs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': newKey(),
      },
      body: '{',
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: 'invalid_request' });

    const { n } = (await env.DB.prepare(
      "SELECT COUNT(*) n FROM reconciliation_runs WHERE mode NOT IN ('normal','simulate_failure')",
    ).first<{ n: number }>())!;
    expect(n).toBe(0);
  });

  it('recovery: a failed create returns 503 with the row queued, and a replay of the same key completes it', async () => {
    const key = newKey();
    const id = `run-${key}`;
    // The Workflow binding rejects create, and get() cannot confirm an instance (none exists).
    const failingRecon = {
      create: async () => {
        throw new Error('simulated create outage');
      },
      get: (instanceId: string) => env.RECON.get(instanceId),
    };
    const brokenEnv = {
      ...env,
      RECON: failingRecon as unknown as Env['RECON'],
    };
    const failed = await app.request(
      '/api/runs',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': key,
          Cookie: await login(),
        },
        body: JSON.stringify({ mode: 'normal' }),
      },
      brokenEnv,
    );
    expect(failed.status).toBe(503);
    expect(await failed.json()).toMatchObject({
      error: 'workflow_create_unconfirmed',
      run: { id, status: 'queued' },
    });
    expect((await runRow(id))?.status).toBe('queued');

    await using instance = await introspectWorkflowInstance(env.RECON, id);
    const replay = await postRun(key, 'normal');
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ duplicate: true, run: { id } });
    await instance.waitForStatus('complete');
    expect((await runRow(id))?.status).toBe('complete');
    expect(await findingCounts(id)).toEqual({ n: 17, d: 17 });
  });

  it('recovery: GET of a stale queued row whose instance was never created creates it (documented side effect)', async () => {
    const key = newKey();
    const id = `run-${key}`;
    const startedAt = new Date(Date.now() - 60_000).toISOString();
    await env.DB.prepare(
      `INSERT INTO reconciliation_runs (id, idempotency_key, workflow_instance_id, mode, as_of_date, status, started_at)
       VALUES (?1, ?2, ?1, 'normal', ?3, 'queued', ?4)`,
    )
      .bind(id, key, env.AS_OF_DATE, startedAt)
      .run();

    await using instance = await introspectWorkflowInstance(env.RECON, id);
    const res = await api(`/api/runs/${id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id, status: 'queued' });
    await instance.waitForStatus('complete');
    expect(await findingCounts(id)).toEqual({ n: 17, d: 17 });
  });

  it('terminal guard: write-findings and mark-errored SQL change nothing on a complete run', async () => {
    const { id } = await runToCompletion('normal');
    const before = await runRow(id);
    await env.DB.prepare('DELETE FROM findings WHERE run_id = ?1 AND seq = 0')
      .bind(id)
      .run();

    const rows = await toRows(id, expectedFindings as Finding[]);
    const result = await writeFindings(env.DB, id, rows);
    expect(result).toEqual({ inserted: 0, attempt: null });
    expect((await findingCounts(id)).n).toBe(16);

    expect(await markErrored(env.DB, id, 'late failure')).toBe(0);
    expect(await runRow(id)).toEqual(before);
  });
});
