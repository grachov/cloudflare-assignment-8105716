import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import {
  getAgentByName,
  type Connection,
  type ConnectionContext,
} from 'agents';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatAgent } from '../../src/server/agent';
import {
  CAP_TEXT,
  chatPreflight,
  SESSION_EXPIRED_TEXT,
} from '../../src/server/agent-tools';

const allow = () => ({ limit: vi.fn(async () => ({ success: true })) });
const deny = () => ({ limit: vi.fn(async () => ({ success: false })) });

/** Concatenates the text-delta chunks of a UI message stream (SSE) response. */
async function streamedText(res: Response): Promise<string> {
  const body = await res.text();
  let text = '';
  for (const line of body.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const payload = line.slice('data: '.length);
    if (payload === '[DONE]') continue;
    const chunk = JSON.parse(payload) as { type: string; delta?: string };
    if (chunk.type === 'text-delta') text += chunk.delta ?? '';
  }
  return text;
}

async function agentStub(name: string) {
  return getAgentByName(env.ChatAgent, name);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('chatPreflight (pure)', () => {
  it('a denying limiter gives the "slow down" text', async () => {
    const limiter = deny();
    expect(
      await chatPreflight({ limiter, sid: 'sid-1', userMessageCount: 1 }),
    ).toMatch(/slow down/i);
    expect(limiter.limit).toHaveBeenCalledWith({ key: 'sid-1' });
  });

  it('more than 40 user messages gives the cap text before the limiter is consulted', async () => {
    const limiter = allow();
    expect(
      await chatPreflight({ limiter, sid: 'sid-1', userMessageCount: 41 }),
    ).toBe(CAP_TEXT);
    expect(limiter.limit).not.toHaveBeenCalled();
    expect(
      await chatPreflight({ limiter, sid: 'sid-1', userMessageCount: 40 }),
    ).toBeNull();
  });

  it('a missing sid fails closed without calling the limiter', async () => {
    for (const sid of [undefined, null, '']) {
      const limiter = allow();
      expect(await chatPreflight({ limiter, sid, userMessageCount: 0 })).toBe(
        SESSION_EXPIRED_TEXT,
      );
      expect(limiter.limit).not.toHaveBeenCalled();
    }
  });

  it('an allowed turn returns null', async () => {
    expect(
      await chatPreflight({
        limiter: allow(),
        sid: 'sid-1',
        userMessageCount: 0,
      }),
    ).toBeNull();
  });
});

describe('ChatAgent guard (in the Durable Object)', () => {
  it('(a2) no sid: "Session expired", no model, no limiter, sid_missing warning', async () => {
    const stub = await agentStub('guard-a2');
    await runInDurableObject(stub, async (agent: ChatAgent) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const limiter = allow();
      vi.spyOn(agent, 'getLimiter').mockReturnValue(limiter);
      const createModel = vi.spyOn(agent, 'createModel');

      // The real resolveSid runs: there is no current connection here, so it must fail closed.
      const res = await agent.onChatMessage(() => {}, { requestId: 'req-1' });
      expect(await streamedText(res)).toMatch(/session expired/i);
      expect(createModel).not.toHaveBeenCalled();
      expect(limiter.limit).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith('sid_missing', 'guard-a2');
    });
  });

  it('(a2) resolveSid mocked to undefined also fails closed', async () => {
    const stub = await agentStub('guard-a2-mock');
    await runInDurableObject(stub, async (agent: ChatAgent) => {
      vi.spyOn(agent, 'resolveSid').mockReturnValue(undefined);
      const limiter = allow();
      vi.spyOn(agent, 'getLimiter').mockReturnValue(limiter);
      const createModel = vi.spyOn(agent, 'createModel');

      const res = await agent.onChatMessage(() => {}, { requestId: 'req-1' });
      expect(await streamedText(res)).toMatch(/session expired/i);
      expect(createModel).not.toHaveBeenCalled();
      expect(limiter.limit).not.toHaveBeenCalled();
    });
  });

  it('(b) a rate-limited sid gets "slow down" and the model is never created', async () => {
    const stub = await agentStub('guard-b');
    await runInDurableObject(stub, async (agent: ChatAgent) => {
      vi.spyOn(agent, 'resolveSid').mockReturnValue('sid-123');
      const limiter = deny();
      vi.spyOn(agent, 'getLimiter').mockReturnValue(limiter);
      const createModel = vi.spyOn(agent, 'createModel');

      const res = await agent.onChatMessage(() => {}, { requestId: 'req-1' });
      expect(limiter.limit).toHaveBeenCalledWith({ key: 'sid-123' });
      expect(await streamedText(res)).toMatch(/slow down/i);
      expect(createModel).not.toHaveBeenCalled();
    });
  });

  it('(c) onConnect stores the guard-verified x-session-id on the connection', async () => {
    const stub = await agentStub('guard-c');
    await runInDurableObject(stub, async (agent: ChatAgent) => {
      // Shaped like a partyserver connection (state getter + setState), which the Agents SDK wraps on connect.
      let state: unknown = null;
      const setState = vi.fn((next: unknown) => (state = next));
      const conn = {
        id: 'conn-1',
        uri: null,
        readyState: 1,
        get state() {
          return state;
        },
        setState,
        send: vi.fn(),
      } as unknown as Connection;
      const ctx = {
        request: new Request('http://example.com/agents/chat-agent/guard-c', {
          headers: { 'x-session-id': 'sid-abc' },
        }),
      } as ConnectionContext;
      await agent.onConnect(conn, ctx);
      expect(setState).toHaveBeenCalledWith({ sid: 'sid-abc' });
      expect(conn.state).toEqual({ sid: 'sid-abc' });
    });
  });
});
