import { AIChatAgent, type OnChatMessageOptions } from '@cloudflare/ai-chat';
import {
  getCurrentAgent,
  type Connection,
  type ConnectionContext,
} from 'agents';
import { createAI } from 'agents/models/ai-sdk';
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  toUIMessageStream,
  type LanguageModel,
} from 'ai';
import {
  chatPreflight,
  createTools,
  ReadOnlyDb,
  SYSTEM_PROMPT,
  type ChatLimiter,
} from './agent-tools';

export const MODEL_ID = '@cf/meta/llama-4-scout-17b-16e-instruct';

type ConnState = { sid: string | null };

export class ChatAgent extends AIChatAgent<Env> {
  maxPersistedMessages = 200;

  // The Worker guard replaced any client x-session-id with the verified cookie sid before forwarding the upgrade.
  async onConnect(
    connection: Connection,
    ctx: ConnectionContext,
  ): Promise<void> {
    connection.setState({
      sid: ctx.request.headers.get('x-session-id'),
    } satisfies ConnState);
    return super.onConnect(connection, ctx);
  }

  /** The sid of the connection driving this turn. No fallback: programmatic turns have no connection and fail closed. */
  resolveSid(): string | undefined {
    const sid =
      (getCurrentAgent().connection?.state as ConnState | null | undefined)
        ?.sid ?? undefined;
    if (sid === undefined) console.warn('sid_missing', this.name);
    return sid;
  }

  getLimiter(): ChatLimiter {
    return this.env.CHAT_LIMITER;
  }

  createModel(): LanguageModel {
    return createAI({ binding: this.env.AI })(MODEL_ID);
  }

  async onChatMessage(
    _onFinish: unknown,
    options?: OnChatMessageOptions,
  ): Promise<Response> {
    const refusal = await chatPreflight({
      limiter: this.getLimiter(),
      sid: this.resolveSid(),
      userMessageCount: this.messages.filter((m) => m.role === 'user').length,
    });
    if (refusal !== null) return refusalResponse(refusal);

    const tools = createTools(new ReadOnlyDb(this.env.DB));
    const result = streamText({
      model: this.createModel(),
      system: SYSTEM_PROMPT,
      messages: await convertToModelMessages(this.messages),
      tools,
      stopWhen: stepCountIs(5),
      abortSignal: options?.abortSignal,
    });
    return createUIMessageStreamResponse({
      stream: toUIMessageStream({ stream: result.stream, tools }),
    });
  }
}

/** One assistant text part; the model is never involved. */
function refusalResponse(text: string): Response {
  const id = crypto.randomUUID();
  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      writer.write({ type: 'text-start', id });
      writer.write({ type: 'text-delta', id, delta: text });
      writer.write({ type: 'text-end', id });
    },
  });
  return createUIMessageStreamResponse({ stream });
}
