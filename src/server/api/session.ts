import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  clearedSessionCookie,
  readSession,
  sessionCookie,
  signSession,
  verifyPasscode,
} from '../auth';
import { throwOnInvalid, type AppEnv } from '../http';

const loginBody = z.object({ passcode: z.string().min(1).max(256) });

// Public router (registered before requireSession). LOGIN_LIMITER, 5 per 60s per client IP.
export const sessionRoutes = new Hono<AppEnv>()
  .post('/', zValidator('json', loginBody, throwOnInvalid), async (c) => {
    const ip = c.req.header('CF-Connecting-IP') ?? 'local';
    const { success } = await c.env.LOGIN_LIMITER.limit({ key: ip });
    if (!success) return c.json({ error: 'rate_limited' }, 429);
    if (!(await verifyPasscode(c.env, c.req.valid('json').passcode)))
      return c.json({ error: 'unauthorized' }, 401);
    const { token } = await signSession(c.env);
    c.header('Set-Cookie', sessionCookie(token));
    return c.json({ ok: true });
  })
  .get('/', async (c) => {
    const session = await readSession(c.req.raw, c.env);
    if (!session) return c.json({ error: 'unauthorized' }, 401);
    return c.json({
      authenticated: true,
      expiresAt: new Date(session.exp * 1000).toISOString(),
    });
  })
  .delete('/', (c) => {
    c.header('Set-Cookie', clearedSessionCookie());
    return c.body(null, 204);
  });
