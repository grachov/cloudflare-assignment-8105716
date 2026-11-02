import { Hono } from 'hono';
import { routeAgentRequest } from 'agents';
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

app.all(
  '/agents/*',
  async (c) =>
    (await routeAgentRequest(c.req.raw, c.env, {
      onBeforeConnect: (r) => guard(r, c.env, { agent: true }),
      onBeforeRequest: (r) => guard(r, c.env, { agent: true }),
    })) ?? c.notFound(),
);

export default app;
export { ChatAgent } from './agent';
export { ReconWorkflow } from './workflow';
