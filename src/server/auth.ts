// Session cookie, passcode check and request guard. Framework-free and Web Crypto only, so it runs in Node and workerd.

export type AuthSecrets = { DEMO_PASSCODE?: string; SESSION_SECRET?: string };

export const COOKIE_NAME = 'recon_session';
export const SESSION_TTL_S = 43_200;
const COOKIE_ATTRS = 'HttpOnly; Secure; SameSite=Strict; Path=/';
const PAYLOAD_RE = /^([0-9a-f]{32})\.(\d{1,12})$/;

const utf8 = new TextEncoder();
const nowS = (): number => Math.floor(Date.now() / 1000);

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Strict decode: returns null on any character outside the base64url alphabet. */
function fromB64url(s: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

function hmacKey(secret: string) {
  return crypto.subtle.importKey(
    'raw',
    utf8.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/** Mint a session: `b64url(sid.exp).b64url(HMAC(SESSION_SECRET, b64url(sid.exp)))`. */
export async function signSession(
  env: AuthSecrets,
  now: number = nowS(),
): Promise<{ token: string; sid: string; exp: number }> {
  if (!env.SESSION_SECRET) throw new Error('SESSION_SECRET is not configured');
  const sid = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
  const exp = now + SESSION_TTL_S;
  const payload = b64url(utf8.encode(`${sid}.${exp}`));
  const mac = new Uint8Array(
    await crypto.subtle.sign(
      'HMAC',
      await hmacKey(env.SESSION_SECRET),
      utf8.encode(payload),
    ),
  );
  return { token: `${payload}.${b64url(mac)}`, sid, exp };
}

/** Returns the session for a valid, unexpired token; null for anything malformed, tampered, truncated or expired. */
export async function verifySession(
  env: AuthSecrets,
  token: string | null | undefined,
  now: number = nowS(),
): Promise<{ sid: string; exp: number } | null> {
  if (!env.SESSION_SECRET || !token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, macB64] = parts as [string, string];
  const mac = fromB64url(macB64);
  const raw = fromB64url(payload);
  if (!mac || !raw) return null;
  const ok = await crypto.subtle.verify(
    'HMAC',
    await hmacKey(env.SESSION_SECRET),
    mac,
    utf8.encode(payload),
  );
  if (!ok) return null;
  const m = PAYLOAD_RE.exec(new TextDecoder().decode(raw));
  if (!m) return null;
  const exp = Number(m[2]);
  return exp > now ? { sid: m[1] as string, exp } : null;
}

/** Constant-time passcode check via HMAC verify (portable; no node:crypto timingSafeEqual). */
export async function verifyPasscode(
  env: AuthSecrets,
  provided: string,
): Promise<boolean> {
  if (!env.SESSION_SECRET || !env.DEMO_PASSCODE) return false;
  const key = await hmacKey(env.SESSION_SECRET);
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    utf8.encode(env.DEMO_PASSCODE),
  );
  return crypto.subtle.verify('HMAC', key, mac, utf8.encode(provided));
}

export function sessionCookie(token: string): string {
  return `${COOKIE_NAME}=${token}; ${COOKIE_ATTRS}; Max-Age=${SESSION_TTL_S}`;
}

export function clearedSessionCookie(): string {
  return `${COOKIE_NAME}=; ${COOKIE_ATTRS}; Max-Age=0`;
}

function readCookie(req: Request): string | null {
  for (const part of (req.headers.get('Cookie') ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === COOKIE_NAME)
      return part.slice(eq + 1).trim();
  }
  return null;
}

export function readSession(
  req: Request,
  env: AuthSecrets,
): Promise<{ sid: string; exp: number } | null> {
  return verifySession(env, readCookie(req));
}

function sameHost(origin: string, reqUrl: string): boolean {
  try {
    return new URL(origin).host === new URL(reqUrl).host;
  } catch {
    return false;
  }
}

const deny = (status: 401 | 403): Response =>
  Response.json(
    { error: status === 401 ? 'unauthorized' : 'forbidden' },
    { status },
  );

/**
 * Agent requests: a WebSocket upgrade needs a same-host Origin; plain HTTP is refused only for a present, different
 * Origin. Then the cookie must verify. On success returns a NEW Request whose `x-session-id` is the cookie sid
 * (any client-supplied value is dropped); the original request is never mutated.
 */
export async function guard(
  req: Request,
  env: AuthSecrets,
  opts: { agent: boolean },
): Promise<Request | Response> {
  if (opts.agent) {
    const origin = req.headers.get('Origin');
    const upgrade = req.headers.get('Upgrade')?.toLowerCase() === 'websocket';
    if (
      upgrade
        ? !origin || !sameHost(origin, req.url)
        : origin !== null && !sameHost(origin, req.url)
    ) {
      return deny(403);
    }
  }
  const session = await readSession(req, env);
  if (!session) return deny(401);
  const headers = new Headers(req.headers);
  headers.delete('x-session-id');
  headers.set('x-session-id', session.sid);
  return new Request(req, { headers });
}
