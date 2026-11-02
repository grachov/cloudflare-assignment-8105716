import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

describe('integration project', () => {
  it('GET /api/health returns 200 and AI is stubbed', async () => {
    const res = await exports.default.fetch('http://example.com/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const aiError = await env.AI.run(
      '@cf/meta/llama-4-scout-17b-16e-instruct',
      { prompt: 'x' },
    ).catch((e: unknown) => e);
    expect(aiError).toBeInstanceOf(Error);
    expect((aiError as Error).message).toBe('AI must not be called in tests');
  });
});
