import { env, exports } from 'cloudflare:workers';
import { introspectWorkflowInstance } from 'cloudflare:test';
import type { RunDTO, RunMode } from '../../src/shared/types';

export const ORIGIN = 'http://example.com';
/** Fixed client IP for helper logins, so tests that exercise LOGIN_LIMITER can use their own IPs. */
const HELPER_IP = '198.51.100.1';

export function newKey(): string {
  return crypto.randomUUID();
}

/** POST /api/session; returns the response without consuming the body. */
export function postLogin(passcode: string, ip = HELPER_IP): Promise<Response> {
  return exports.default.fetch(
    new Request(ORIGIN + '/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
      body: JSON.stringify({ passcode }),
    }),
  );
}

let cookie: Promise<string> | undefined;

/** Logs in once per test file (LOGIN_LIMITER allows 5/min) and returns the `recon_session=...` Cookie header value. */
export function login(): Promise<string> {
  cookie ??= (async () => {
    const res = await postLogin(env.DEMO_PASSCODE);
    if (res.status !== 200)
      throw new Error(`login returned ${res.status}: ${await res.text()}`);
    const setCookie = res.headers.get('Set-Cookie') ?? '';
    return setCookie.split(';')[0] as string;
  })();
  return cookie;
}

/** Headers sent on every API call: the session cookie. */
async function baseHeaders(): Promise<Record<string, string>> {
  return { Cookie: await login() };
}

export async function api(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(await baseHeaders());
  for (const [k, v] of new Headers(init.headers)) headers.set(k, v);
  return exports.default.fetch(
    new Request(ORIGIN + path, { ...init, headers }),
  );
}

export function postRun(
  key: string,
  mode: RunMode | string = 'normal',
): Promise<Response> {
  return api('/api/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify({ mode }),
  });
}

/** POST a run and wait until its Workflow instance completes; the introspector is attached before the POST. */
export async function runToCompletion(
  mode: RunMode = 'normal',
): Promise<{ key: string; id: string; run: RunDTO }> {
  const key = newKey();
  const id = `run-${key}`;
  await using instance = await introspectWorkflowInstance(env.RECON, id);
  await instance.modify(async (m) => {
    await m.disableRetryDelays();
  });
  const res = await postRun(key, mode);
  if (res.status !== 202)
    throw new Error(
      `POST /api/runs returned ${res.status}: ${await res.text()}`,
    );
  await instance.waitForStatus('complete');
  const run = (await (await api(`/api/runs/${id}`)).json()) as RunDTO;
  return { key, id, run };
}
