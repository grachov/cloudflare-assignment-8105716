import { useState, type SubmitEvent } from 'react';
import { useAgent } from 'agents/react';
import { useAgentChat } from '@cloudflare/ai-chat/react';
import { getToolName, isToolUIPart, type UIMessage } from 'ai';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { z } from 'zod';

const STORAGE_KEY = 'recon.conversationId';
const PROMPTS = [
  'Why is INV-1011 flagged?',
  'Summarize the latest run',
  'Show unmatched payments',
];

// Conversation ids name the chat Durable Object; the server rejects anything that is not a UUID.
const ConversationId = z.uuid();
const isConversationId = (v: string | null): v is string =>
  ConversationId.safeParse(v).success;
const newConversationId = (): string => crypto.randomUUID();

/** The ?c= query param, else the stored id, else a new one; an invalid candidate is skipped, not used. */
function initialConversationId(): string {
  const fromUrl = new URLSearchParams(window.location.search).get('c');
  if (isConversationId(fromUrl)) return fromUrl;
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
  return isConversationId(stored) ? stored : newConversationId();
}

// Model output is untrusted: react-markdown never renders raw HTML and strips unsafe URLs; links open in a new tab.
const MARKDOWN_COMPONENTS: Components = {
  a: ({ node: _node, ...props }) => (
    <a {...props} target="_blank" rel="noreferrer" />
  ),
};

function persist(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
  const url = new URL(window.location.href);
  url.searchParams.set('c', id);
  history.replaceState(null, '', url);
}

export function ChatPanel() {
  const [conversationId, setConversationId] = useState(() => {
    const id = initialConversationId();
    persist(id);
    return id;
  });

  const newConversation = () => {
    const id = newConversationId();
    persist(id);
    setConversationId(id);
  };

  // key remounts the inner component so each conversation gets a fresh connection.
  return (
    <ChatSession
      key={conversationId}
      conversationId={conversationId}
      onNew={newConversation}
    />
  );
}

function ToolRow({
  part,
}: {
  part: Extract<
    UIMessage['parts'][number],
    { type: `tool-${string}` | 'dynamic-tool' }
  >;
}) {
  const name = getToolName(part);
  const input =
    'input' in part && part.input !== undefined
      ? JSON.stringify(part.input)
      : '';
  const state = part.state;
  const label =
    state === 'output-available'
      ? 'done'
      : state === 'output-error'
        ? 'error'
        : 'running';
  return (
    <div className={`tool-row tool-${label}`}>
      <code>
        {name}({input})
      </code>
      <span className="tool-state">{label}</span>
    </div>
  );
}

function ChatSession({
  conversationId,
  onNew,
}: {
  conversationId: string;
  onNew: () => void;
}) {
  const agent = useAgent({ agent: 'chat-agent', name: conversationId });
  const { messages, sendMessage, status, stop, isStreaming, error } =
    useAgentChat({ agent });
  const [input, setInput] = useState('');
  const busy = isStreaming || status === 'submitted' || status === 'streaming';

  const send = (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    void sendMessage({ text: t });
    setInput('');
  };

  const submit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    send(input);
  };

  return (
    <section className="card chat" aria-label="Assistant chat">
      <header className="chat-head">
        <h2>Assistant</h2>
        <button type="button" className="btn small" onClick={onNew}>
          New conversation
        </button>
      </header>

      <div
        className="chat-log"
        role="log"
        aria-live="polite"
        aria-label="Conversation"
      >
        {messages.length === 0 && (
          <div className="suggestions">
            <p className="muted">Try asking:</p>
            {PROMPTS.map((p) => (
              <button
                key={p}
                type="button"
                className="chip"
                disabled={busy}
                onClick={() => send(p)}
              >
                {p}
              </button>
            ))}
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`msg msg-${m.role}`}>
            <span className="msg-role">
              {m.role === 'user' ? 'You' : 'Assistant'}
            </span>
            {m.parts.map((part, i) => {
              if (part.type === 'text') {
                return m.role === 'user' ? (
                  <p key={i} className="msg-text">
                    {part.text}
                  </p>
                ) : (
                  <div key={i} className="msg-text msg-markdown">
                    <Markdown
                      remarkPlugins={[remarkGfm]}
                      components={MARKDOWN_COMPONENTS}
                    >
                      {part.text}
                    </Markdown>
                  </div>
                );
              }
              if (isToolUIPart(part)) return <ToolRow key={i} part={part} />;
              return null;
            })}
          </div>
        ))}
        {busy && (
          <p className="muted" aria-hidden="true">
            Thinking…
          </p>
        )}
        {error && (
          <p role="alert" className="error-text">
            {error.message}
          </p>
        )}
      </div>

      <form className="chat-form" onSubmit={submit}>
        <label htmlFor="chat-input" className="visually-hidden">
          Message
        </label>
        <input
          id="chat-input"
          type="text"
          value={input}
          placeholder="Ask about invoices or runs"
          autoComplete="off"
          onChange={(e) => setInput(e.target.value)}
        />
        {busy ? (
          <button type="button" className="btn" onClick={() => void stop()}>
            Stop
          </button>
        ) : (
          <button
            type="submit"
            className="btn primary"
            disabled={!input.trim()}
          >
            Send
          </button>
        )}
      </form>
    </section>
  );
}
