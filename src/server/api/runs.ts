import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { KINDS, RUN_MODES, type FindingDTO } from '../../shared/types';
import { throwOnInvalid, type AppEnv } from '../http';
import {
  deleteAllRuns,
  deleteQueuedRun,
  ensureWorkflow,
  getRun,
  getRunByKey,
  insertRun,
  listRuns,
  paramsOf,
  toRunDTO,
  toRunDTOs,
  type EnsuredWorkflow,
  type RunRow,
} from '../runs';

/** A queued row older than this is assumed to have lost its Workflow create and is re-ensured on read. */
const STALE_QUEUED_MS = 10_000;

const IdempotencyKeySchema = z.object({
  'idempotency-key': z.uuid(),
});
const RunBodySchema = z.object({
  mode: z.enum(RUN_MODES),
});
const ListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
const GetParamsSchema = z.object({
  id: z.string().min(1).max(64),
});
const FindingsQuerySchema = z.object({
  kind: z.enum(KINDS).optional(),
});

/** Instance states that will never run the Workflow again. */
const FINISHED_INSTANCE = new Set<EnsuredWorkflow>([
  'complete',
  'errored',
  'terminated',
]);

/** The instance's state, or null when its creation could not be confirmed. */
async function tryEnsure(
  env: Env,
  row: RunRow,
): Promise<EnsuredWorkflow | null> {
  try {
    return await ensureWorkflow(env, row.workflow_instance_id, paramsOf(row));
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'workflow_create_unconfirmed',
        runId: row.id,
        message: String(error),
      }),
    );

    return null;
  }
}

export const runRoutes = new Hono<AppEnv>()
  .post(
    '/',
    zValidator('header', IdempotencyKeySchema, throwOnInvalid),
    zValidator('json', RunBodySchema, throwOnInvalid),
    async (ctx) => {
      const key = ctx.req.valid('header')['idempotency-key'].toLowerCase();
      const { mode } = ctx.req.valid('json');
      const db = ctx.env.DB;
      const id = `run-${key}`;

      const isInserted = await insertRun(db, {
        id,
        key,
        mode,
        asOfDate: ctx.env.AS_OF_DATE,
        startedAt: new Date().toISOString(),
      });
      const existingRun = await getRunByKey(db, key);

      if (!existingRun) {
        throw new Error(`run row missing after insert: ${id}`);
      }

      if (!isInserted && existingRun.mode !== mode) {
        return ctx.json(
          {
            error: 'idempotency_key_mismatch',
          },
          422,
        );
      }

      // New rows always need an instance; a replayed key re-ensures only while the row is still queued.
      if (isInserted || existingRun.status === 'queued') {
        const instance = await tryEnsure(ctx.env, existingRun);

        if (instance === null) {
          return ctx.json(
            {
              error: 'workflow_create_unconfirmed',
              run: await toRunDTO(db, existingRun),
            },
            503,
          );
        }

        // A brand-new row whose instance had already finished means the key was used before a data reset:
        // Workflows keeps finished instances, so this run could never start. Drop the row (only if the
        // instance really never touched it) and refuse the key.
        if (
          isInserted &&
          FINISHED_INSTANCE.has(instance) &&
          (await deleteQueuedRun(db, id))
        ) {
          return ctx.json(
            {
              error: 'idempotency_key_retired',
            },
            409,
          );
        }
      }

      const run = await toRunDTO(db, (await getRun(db, id)) ?? existingRun);

      if (isInserted) {
        return ctx.json(
          {
            run,
            duplicate: false,
          },
          202,
        );
      }

      return ctx.json(
        {
          run,
          duplicate: true,
        },
        200,
      );
    },
  )
  // Demo reset: in-flight Workflows become no-ops because every finding and status write requires the run row.
  .delete('/', async (ctx) =>
    ctx.json({
      deleted: await deleteAllRuns(ctx.env.DB),
    }),
  )
  .get(
    '/',
    zValidator('query', ListQuerySchema, throwOnInvalid),
    async (ctx) => {
      const rows = await listRuns(ctx.env.DB, ctx.req.valid('query').limit);

      return ctx.json({
        runs: await toRunDTOs(ctx.env.DB, rows),
      });
    },
  )
  .get(
    '/:id',
    zValidator('param', GetParamsSchema, throwOnInvalid),
    async (ctx) => {
      const row = await getRun(ctx.env.DB, ctx.req.valid('param').id);

      if (!row) {
        return ctx.json(
          {
            error: 'not_found',
          },
          404,
        );
      }

      // Documented side effect: a stale queued row (lost create) gets its deterministic instance created here.
      // This is idempotent and changes no D1 row; the Workflow itself moves the run forward.
      if (
        row.status === 'queued' &&
        row.started_at &&
        Date.parse(row.started_at) < Date.now() - STALE_QUEUED_MS
      ) {
        await tryEnsure(ctx.env, row);
      }

      return ctx.json(await toRunDTO(ctx.env.DB, row));
    },
  )
  .get(
    '/:id/findings',
    zValidator('param', GetParamsSchema, throwOnInvalid),
    zValidator('query', FindingsQuerySchema, throwOnInvalid),
    async (ctx) => {
      const { id } = ctx.req.valid('param');
      const row = await getRun(ctx.env.DB, id);

      if (!row) {
        return ctx.json(
          {
            error: 'not_found',
          },
          404,
        );
      }

      const { results } = await ctx.env.DB.prepare(
        `SELECT id, seq, kind, invoice_id, payment_id, expected_minor, actual_minor, delta_minor, currency, detail
         FROM findings WHERE run_id = ?1 AND (?2 IS NULL OR kind = ?2) ORDER BY seq`,
      )
        .bind(id, ctx.req.valid('query').kind ?? null)
        .all<FindingDTO>();

      return ctx.json({
        findings: results,
      });
    },
  );
