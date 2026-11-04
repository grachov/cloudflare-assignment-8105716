import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';
import { datasetHash, loadDataset } from './dataset';
import { reconcile } from './engine/reconcile';
import { DatasetValidationError } from './engine/types';
import { toRows } from './findings';
import {
  markComplete,
  markErrored,
  markRunning,
  writeFindings,
  type ReconParams,
} from './runs';

export type { ReconParams };

/** Thin shell over D1: every write is idempotent and guarded, so retries and replays are safe. */
export class ReconWorkflow extends WorkflowEntrypoint<Env, ReconParams> {
  async run(
    event: WorkflowEvent<ReconParams>,
    step: WorkflowStep,
  ): Promise<void> {
    const { runId, asOfDate } = event.payload;
    const db = this.env.DB;

    try {
      const findings = await step.do('load-and-reconcile', async () => {
        const dataset = await loadDataset(db);
        const hash = await datasetHash(dataset);
        let result;

        try {
          result = reconcile(dataset, asOfDate);
        } catch (error) {
          // Bad data never heals on retry.
          if (error instanceof DatasetValidationError) {
            throw new NonRetryableError(error.message, error.name);
          }

          throw error;
        }

        await markRunning(db, runId, hash);

        return result;
      });

      await step.do(
        'write-findings',
        {
          retries: {
            limit: 3,
            delay: '2 seconds',
            backoff: 'exponential',
          },
          timeout: '30 seconds',
        },
        async () => {
          const { attempt } = await writeFindings(
            db,
            runId,
            await toRows(runId, findings),
          );

          // The batch has committed; the platform retry re-runs it as a no-op (ON CONFLICT DO NOTHING).
          if (
            attempt?.mode === 'simulate_failure' &&
            attempt.write_attempts === 1
          ) {
            throw new Error('Simulated transient failure after commit');
          }
        },
      );

      await step.do('complete', async () => {
        await markComplete(db, runId, new Date().toISOString());
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      await step.do('mark-errored', async () => {
        await markErrored(db, runId, message);
      });

      throw error;
    }
  }
}
