import { describe, expect, it } from 'vitest';
import {
  SESSION_TTL_S,
  guard,
  signSession,
  verifyPasscode,
  verifySession,
} from '../../src/server/auth';

const env = { SESSION_SECRET: 'unit-secret', DEMO_PASSCODE: 'open-sesame' };

/** Flip one character of `s` at index i to a different base64url character. */
function flip(s: string, i: number): string {
  return s.slice(0, i) + (s[i] === 'A' ? 'B' : 'A') + s.slice(i + 1);
}

describe('session cookie', () => {
  it('round-trips sid and exp', async () => {
    const now = 1_800_000_000;
    const { token, sid, exp } = await signSession(env, now);
    expect(sid).toMatch(/^[0-9a-f]{32}$/);
    expect(exp).toBe(now + SESSION_TTL_S);
    expect(await verifySession(env, token, now)).toEqual({ sid, exp });
  });

  it('issues a fresh random sid per session', async () => {
    const [a, b] = await Promise.all([signSession(env), signSession(env)]);
    expect(a.sid).not.toBe(b.sid);
  });

  it('rejects tampered payload, tampered mac, truncated, malformed and wrong-secret tokens', async () => {
    const { token } = await signSession(env);
    const [payload, mac] = token.split('.') as [string, string];
    const other = await signSession(env);
    const bad = [
      `${flip(payload, 3)}.${mac}`,
      `${payload}.${flip(mac, 5)}`,
      `${other.token.split('.')[0]}.${mac}`,
      token.slice(0, -4),
      payload,
      `${payload}.`,
      `.${mac}`,
      `${token}.extra`,
      `${payload}.${mac}!`,
      '',
      'garbage',
    ];
    for (const t of bad) expect(await verifySession(env, t), t).toBeNull();
    expect(
      await verifySession({ SESSION_SECRET: 'other-secret' }, token),
    ).toBeNull();
    expect(await verifySession({}, token)).toBeNull();
  });

  it('rejects an expired token', async () => {
    const { token, exp } = await signSession(env, 1_000);
    expect(await verifySession(env, token, exp - 1)).not.toBeNull();
    expect(await verifySession(env, token, exp)).toBeNull();
    expect(await verifySession(env, token)).toBeNull();
  });
});

describe('verifyPasscode', () => {
  it('accepts only the configured passcode', async () => {
    expect(await verifyPasscode(env, 'open-sesame')).toBe(true);
    expect(await verifyPasscode(env, 'open-sesamE')).toBe(false);
    expect(await verifyPasscode(env, '')).toBe(false);
  });

  it('fails closed when secrets are missing', async () => {
    expect(await verifyPasscode({ SESSION_SECRET: 's' }, '')).toBe(false);
    expect(await verifyPasscode({ DEMO_PASSCODE: 'p' }, 'p')).toBe(false);
  });
});

describe('guard', () => {
  it('replaces a client-supplied x-session-id without mutating the original request', async () => {
    const { token, sid } = await signSession(env);
    const req = new Request('http://app.test/api/runs', {
      headers: { Cookie: `recon_session=${token}`, 'x-session-id': 'forged' },
    });
    const out = await guard(req, env, { agent: false });
    expect(out).toBeInstanceOf(Request);
    expect((out as Request).headers.get('x-session-id')).toBe(sid);
    expect(req.headers.get('x-session-id')).toBe('forged');
  });
});
