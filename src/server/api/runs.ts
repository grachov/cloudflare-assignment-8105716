import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { KINDS, RUN_MODES, type FindingDTO } from '../../shared/types';
import { throwOnInvalid, type AppEnv } from '../http';
import {
  ensureWorkflow,
  getRun,
  getRunByKey,
  insertRun,
  listRuns,
  paramsOf,
  toRunDTO,
  toRunDTOs,
  type RunRow,
} from '../runs';

/** A queued row older than this is assumed to have lost its Workflow create and is re-ensured on read. */
const STALE_QUEUED_MS = 10_000;

const keyHeader = z.object({ 'idempotency-key': z.uuid() });
const runBody = z.object({ mode: z.enum(RUN_MODES) });
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
const runParam = z.object({ id: z.string().min(1).max(64) });
const findingsQuery = z.object({ kind: z.enum(KINDS).optional() });

async function tryEnsure(env: Env, row: RunRow): Promise<boolean> {
  try {
    await ensureWorkflow(env, row.workflow_instance_id, paramsOf(row));
    return true;
  } catch (e) {
    console.error(
      JSON.stringify({
        event: 'workflow_create_unconfirmed',
        runId: row.id,
        message: String(e),
      }),
    );
    return false;
  }
}

export const runRoutes = new Hono<AppEnv>()
  .post(
    '/',
    zValidator('header', keyHeader, throwOnInvalid),
    zValidator('json', runBody, throwOnInvalid),
    async (c) => {
      const key = c.req.valid('header')['idempotency-key'].toLowerCase();
      const { mode } = c.req.valid('json');
      const db = c.env.DB;
      const id = `run-${key}`;

      const inserted = await insertRun(db, {
        id,
        key,
        mode,
        asOfDate: c.env.AS_OF_DATE,
        startedAt: new Date().toISOString(),
      });
      const existing = await getRunByKey(db, key);
      if (!existing) throw new Error(`run row missing after insert: ${id}`);

      if (!inserted && existing.mode !== mode)
        return c.json({ error: 'idempotency_key_mismatch' }, 422);

      // New rows always need an instance; a replayed key re-ensures only while the row is still queued.
      if (inserted || existing.status === 'queued') {
        if (!(await tryEnsure(c.env, existing))) {
          return c.json(
            {
              error: 'workflow_create_unconfirmed',
              run: await toRunDTO(db, existing),
            },
            503,
          );
        }
      }
      const run = await toRunDTO(db, (await getRun(db, id)) ?? existing);
      return inserted
        ? c.json({ run, duplicate: false }, 202)
        : c.json({ run, duplicate: true }, 200);
    },
  )
  .get('/', zValidator('query', listQuery, throwOnInvalid), async (c) => {
    const rows = await listRuns(c.env.DB, c.req.valid('query').limit);
    return c.json({ runs: await toRunDTOs(c.env.DB, rows) });
  })
  .get('/:id', zValidator('param', runParam, throwOnInvalid), async (c) => {
    const row = await getRun(c.env.DB, c.req.valid('param').id);
    if (!row) return c.json({ error: 'not_found' }, 404);
    // Documented side effect: a stale queued row (lost create) gets its deterministic instance created here.
    // This is idempotent and changes no D1 row; the Workflow itself moves the run forward.
    if (
      row.status === 'queued' &&
      row.started_at &&
      Date.parse(row.started_at) < Date.now() - STALE_QUEUED_MS
    ) {
      await tryEnsure(c.env, row);
    }
    return c.json(await toRunDTO(c.env.DB, row));
  })
  .get(
    '/:id/findings',
    zValidator('param', runParam, throwOnInvalid),
    zValidator('query', findingsQuery, throwOnInvalid),
    async (c) => {
      const { id } = c.req.valid('param');
      const row = await getRun(c.env.DB, id);
      if (!row) return c.json({ error: 'not_found' }, 404);
      const { results } = await c.env.DB.prepare(
        `SELECT id, seq, kind, invoice_id, payment_id, expected_minor, actual_minor, delta_minor, currency, detail
         FROM findings WHERE run_id = ?1 AND (?2 IS NULL OR kind = ?2) ORDER BY seq`,
      )
        .bind(id, c.req.valid('query').kind ?? null)
        .all<FindingDTO>();
      return c.json({ findings: results });
    },
  );
