import type { ErrorHandler } from 'hono';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import { guard } from './auth';

export type AppEnv = { Bindings: Env; Variables: { sid: string } };

const ERROR_CODES: Record<number, string> = {
  400: 'invalid_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  422: 'unprocessable',
  429: 'rate_limited',
};

/** zValidator hook: hand validation failures to toJsonError instead of returning the raw zod result. */
export function throwOnInvalid(result: {
  success: boolean;
  error?: unknown;
}): void {
  if (!result.success) throw result.error;
}

/** app.onError: HTTPException/ZodError become `{error, ...}` JSON; anything else is a 500 that leaks nothing. */
export const toJsonError: ErrorHandler<AppEnv> = (err, c) => {
  if (err instanceof HTTPException) {
    return c.json(
      { error: ERROR_CODES[err.status] ?? 'http_error', message: err.message },
      err.status,
    );
  }
  if (err instanceof ZodError) {
    const issues = err.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    }));
    return c.json({ error: 'invalid_request', issues }, 400);
  }
  console.error(
    JSON.stringify({
      event: 'unhandled_error',
      message: String(err instanceof Error ? err.stack : err),
    }),
  );
  return c.json({ error: 'internal_error' }, 500);
};

/** `/api/*` middleware: guard() without the agent Origin rule; exposes the cookie sid as `c.get('sid')`. */
export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  // A body-less copy: guard's `new Request(req, …)` would take over the body stream the route handler still needs.
  const result = await guard(
    new Request(c.req.url, { headers: c.req.raw.headers }),
    c.env,
    { agent: false },
  );
  if (result instanceof Response) return result;
  c.set('sid', result.headers.get('x-session-id') as string);
  await next();
});
