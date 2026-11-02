import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { guard, signSession } from '../../src/server/auth';
import { ORIGIN, api, login, postLogin } from './helpers';

const AGENT = `${ORIGIN}/agents/chat-agent/x`;

function raw(
  url: string,
  headers: Record<string, string> = {},
  method = 'GET',
): Promise<Response> {
  return exports.default.fetch(new Request(url, { method, headers }));
}

const WS = {
  Upgrade: 'websocket',
  Connection: 'Upgrade',
  'Sec-WebSocket-Version': '13',
  'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
};

describe('no cookie -> 401', () => {
  it('rejects /api/invoices, /api/runs and /agents/* (HTTP and WebSocket upgrade with a valid Origin)', async () => {
    for (const path of ['/api/invoices', '/api/runs']) {
      const res = await raw(ORIGIN + path);
      expect(res.status, path).toBe(401);
      expect(await res.json()).toEqual({ error: 'unauthorized' });
    }
    expect((await raw(`${ORIGIN}/api/runs`, {}, 'POST')).status).toBe(401);
    expect((await raw(AGENT)).status).toBe(401);
    const ws = await raw(AGENT, { ...WS, Origin: ORIGIN });
    expect(ws.status).toBe(401);
    expect(ws.webSocket).toBeNull();
  });

  it('keeps /api/health public', async () => {
    expect((await raw(`${ORIGIN}/api/health`)).status).toBe(200);
  });
});

describe('agent Origin check', () => {
  it('403s an upgrade with a missing, different or unparsable Origin (even with a valid cookie)', async () => {
    const Cookie = await login();
    for (const origin of [
      undefined,
      'http://evil.example',
      'http://example.com:8080',
      'null',
    ]) {
      const headers: Record<string, string> = { ...WS, Cookie };
      if (origin !== undefined) headers.Origin = origin;
      const res = await raw(AGENT, headers);
      expect(res.status, String(origin)).toBe(403);
      expect(await res.json()).toEqual({ error: 'forbidden' });
    }
  });

  it('403s an HTTP agent request whose Origin is present and different', async () => {
    const res = await raw(`${AGENT}/get-messages`, {
      Cookie: await login(),
      Origin: 'http://evil.example',
    });
    expect(res.status).toBe(403);
  });

  it('allows a same-origin HTTP agent GET with no Origin and a valid cookie (AC15 history hydration)', async () => {
    const res = await raw(
      `${ORIGIN}/agents/chat-agent/${crypto.randomUUID()}/get-messages`,
      { Cookie: await login() },
    );
    expect(res.status).toBe(200);
  });
});

describe('POST/GET/DELETE /api/session', () => {
  it('401s a wrong passcode and 400s a missing one', async () => {
    const wrong = await postLogin('nope', '203.0.113.10');
    expect(wrong.status).toBe(401);
    expect(wrong.headers.get('Set-Cookie')).toBeNull();
    const missing = await exports.default.fetch(
      new Request(`${ORIGIN}/api/session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'CF-Connecting-IP': '203.0.113.10',
        },
        body: '{}',
      }),
    );
    expect(missing.status).toBe(400);
  });

  it('sets a hardened cookie on a valid passcode, and the cookie authenticates', async () => {
    const res = await postLogin(env.DEMO_PASSCODE, '203.0.113.11');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const setCookie = res.headers.get('Set-Cookie') ?? '';
    expect(setCookie).toMatch(/^recon_session=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+;/);
    for (const attr of [
      'HttpOnly',
      'Secure',
      'SameSite=Strict',
      'Path=/',
      'Max-Age=43200',
    ])
      expect(setCookie).toContain(attr);

    const Cookie = setCookie.split(';')[0] as string;
    expect((await raw(`${ORIGIN}/api/invoices`, { Cookie })).status).toBe(200);
    const me = await raw(`${ORIGIN}/api/session`, { Cookie });
    expect(me.status).toBe(200);
    const body = (await me.json()) as {
      authenticated: boolean;
      expiresAt: string;
    };
    expect(body.authenticated).toBe(true);
    expect(Date.parse(body.expiresAt)).toBeGreaterThan(Date.now());
  });

  it('GET without a cookie is 401; DELETE clears the cookie with 204', async () => {
    expect((await raw(`${ORIGIN}/api/session`)).status).toBe(401);
    const del = await raw(`${ORIGIN}/api/session`, {}, 'DELETE');
    expect(del.status).toBe(204);
    expect(del.headers.get('Set-Cookie')).toMatch(
      /^recon_session=;.*Max-Age=0/,
    );
  });

  it('401s tampered and expired cookies', async () => {
    const valid = (await login()).slice('recon_session='.length);
    const [payload, mac] = valid.split('.') as [string, string];
    const tampered = `${payload}.${mac.slice(0, 4)}${mac[4] === 'A' ? 'B' : 'A'}${mac.slice(5)}`;
    const expired = (
      await signSession(env, Math.floor(Date.now() / 1000) - 43_201)
    ).token;
    for (const token of [tampered, expired, valid.slice(0, -3)]) {
      expect(
        (
          await raw(`${ORIGIN}/api/invoices`, {
            Cookie: `recon_session=${token}`,
          })
        ).status,
      ).toBe(401);
    }
    expect((await api('/api/invoices')).status).toBe(200);
  });

  it('429s the 6th login from one IP within 60s (miniflare LOGIN_LIMITER)', async () => {
    const ip = '203.0.113.99';
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++)
      statuses.push(
        (await postLogin(i % 2 ? 'wrong' : env.DEMO_PASSCODE, ip)).status,
      );
    expect(statuses).toEqual([200, 401, 200, 401, 200, 429]);
    expect((await postLogin(env.DEMO_PASSCODE, ip)).status).toBe(429);
    expect((await postLogin(env.DEMO_PASSCODE, '203.0.113.100')).status).toBe(
      200,
    );
  });
});

describe('guard() sid propagation', () => {
  it('replaces a client-supplied x-session-id with the cookie sid and leaves the original request untouched', async () => {
    const { token, sid } = await signSession(env);
    const req = new Request(`${AGENT}/get-messages`, {
      headers: {
        Cookie: `recon_session=${token}`,
        'x-session-id': 'forged',
        Origin: ORIGIN,
      },
    });
    const out = await guard(req, env, { agent: true });
    expect(out).toBeInstanceOf(Request);
    expect((out as Request).headers.get('x-session-id')).toBe(sid);
    expect((out as Request).url).toBe(req.url);
    expect(req.headers.get('x-session-id')).toBe('forged');

    const ws = new Request(AGENT, {
      headers: {
        ...WS,
        Origin: ORIGIN,
        Cookie: `recon_session=${token}`,
        'x-session-id': 'forged',
      },
    });
    const wsOut = await guard(ws, env, { agent: true });
    expect((wsOut as Request).headers.get('x-session-id')).toBe(sid);
    expect((wsOut as Request).headers.get('Upgrade')).toBe('websocket');
  });
});
