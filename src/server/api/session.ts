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

const LoginBodySchema = z.object({
  passcode: z.string().min(1).max(256),
});

// Public router (registered before requireSession). LOGIN_LIMITER, 5 per 60s per client IP.
export const sessionRoutes = new Hono<AppEnv>()
  .post(
    '/',
    zValidator('json', LoginBodySchema, throwOnInvalid),
    async (ctx) => {
      const ip = ctx.req.header('CF-Connecting-IP') ?? 'local';
      const { success } = await ctx.env.LOGIN_LIMITER.limit({
        key: ip,
      });

      if (!success) {
        return ctx.json(
          {
            error: 'rate_limited',
          },
          429,
        );
      }

      if (!(await verifyPasscode(ctx.env, ctx.req.valid('json').passcode))) {
        return ctx.json(
          {
            error: 'unauthorized',
          },
          401,
        );
      }

      const { token } = await signSession(ctx.env);

      ctx.header('Set-Cookie', sessionCookie(token));

      return ctx.json({
        ok: true,
      });
    },
  )
  .get('/', async (ctx) => {
    const session = await readSession(ctx.req.raw, ctx.env);

    if (!session) {
      return ctx.json(
        {
          error: 'unauthorized',
        },
        401,
      );
    }

    return ctx.json({
      authenticated: true,
      expiresAt: new Date(session.exp * 1_000).toISOString(),
    });
  })
  .delete('/', (ctx) => {
    ctx.header('Set-Cookie', clearedSessionCookie());

    return ctx.body(null, 204);
  });
