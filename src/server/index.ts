import { Hono } from 'hono';
import { routeAgentRequest } from 'agents';
import { z } from 'zod';
import { guard } from './auth';
import { invoiceRoutes } from './api/invoices';
import { runRoutes } from './api/runs';
import { sessionRoutes } from './api/session';
import { requireSession, toJsonError, type AppEnv } from './http';

const app = new Hono<AppEnv>();

app.onError(toJsonError);
app.notFound((c) => c.json({ error: 'not_found' }, 404));

// Public: registered before requireSession (middleware applies in registration order).
app.get('/api/health', (c) => c.json({ ok: true }));
app.route('/api/session', sessionRoutes);

app.use('/api/*', requireSession);
app.route('/api/invoices', invoiceRoutes);
app.route('/api/runs', runRoutes);

// `/agents/<agent>/<name>[/...]`: the name is the client's conversation id and must be a UUID.
const AgentPath = z
  .tuple([z.literal(''), z.literal('agents'), z.string(), z.uuid()])
  .rest(z.string());

/** Auth first (Origin + cookie), then the instance name; returns the guarded request or a refusal. */
async function admitAgent(req: Request, env: Env): Promise<Request | Response> {
  const guarded = await guard(req, env, { agent: true });
  if (guarded instanceof Response) return guarded;
  if (!AgentPath.safeParse(new URL(req.url).pathname.split('/')).success)
    return Response.json({ error: 'invalid_request' }, { status: 400 });
  return guarded;
}

app.all(
  '/agents/*',
  async (c) =>
    (await routeAgentRequest(c.req.raw, c.env, {
      onBeforeConnect: (r) => admitAgent(r, c.env),
      onBeforeRequest: (r) => admitAgent(r, c.env),
    })) ?? c.notFound(),
);

export default app;
export { ChatAgent } from './agent';
export { ReconWorkflow } from './workflow';
