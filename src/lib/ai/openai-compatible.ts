import type {
  ChatMessage,
  ModelProvider,
  ProviderEvent,
  StreamArgs,
  ToolCall,
  ToolSchema,
} from "./types";

/**
 * One adapter for every provider that speaks the OpenAI chat-completions
 * shape: Gemini (via its /openai compat endpoint), Groq, OpenRouter,
 * Cerebras, Mistral, Together, and OpenAI itself.
 */
export interface OpenAICompatibleConfig {
  id: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  /** Extra headers some hosts want (OpenRouter attribution, etc). */
  headers?: Record<string, string>;
  /**
   * Total attempts for a retryable failure (429 / 5xx). Defaults high because
   * free tiers meter per minute (Gemini's is 5 req/min) while a single build
   * costs 10-20 requests — without a generous retry budget the agent gives up
   * halfway through.
   */
  maxRetries?: number;
}

const MAX_BACKOFF_SECONDS = 60;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("aborted"));
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * How long to wait before retrying. Prefers what the server told us —
 * `Retry-After`, or Google's `retryDelay: "26s"` inside the error body —
 * and falls back to exponential backoff.
 */
function retryAfterSeconds(res: Response, body: string, attempt: number): number {
  const header = res.headers.get("retry-after");
  if (header) {
    // Delta-seconds form ("30") or HTTP-date form ("Wed, 02 Sep 2026 ...").
    const secs = Number(header);
    if (Number.isFinite(secs) && secs > 0) {
      return Math.min(Math.ceil(secs), MAX_BACKOFF_SECONDS);
    }
    const dateMs = Date.parse(header);
    if (!Number.isNaN(dateMs)) {
      const delta = (dateMs - Date.now()) / 1000;
      if (delta > 0) return Math.min(Math.ceil(delta) + 1, MAX_BACKOFF_SECONDS);
    }
  }

  const match = body.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  if (match) {
    return Math.min(Math.ceil(Number(match[1])) + 1, MAX_BACKOFF_SECONDS);
  }

  return Math.min(5 * 2 ** attempt, MAX_BACKOFF_SECONDS);
}

type WireMessage =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: {
        id: string;
        type: "function";
        function: { name: string; arguments: string };
        extra_content?: Record<string, unknown>;
      }[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

function toWire(system: string, messages: ChatMessage[]): WireMessage[] {
  const out: WireMessage[] = [{ role: "system", content: system }];

  for (const m of messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      // content:null is only legal ALONGSIDE tool_calls. An assistant entry
      // with null content and no tool_calls is rejected by several providers,
      // which would poison the whole session on every following turn.
      out.push({
        role: "assistant",
        content: m.toolCalls?.length ? m.content || null : (m.content ?? ""),
        ...(m.toolCalls?.length
          ? {
              tool_calls: m.toolCalls.map((c) => ({
                id: c.id,
                type: "function" as const,
                function: { name: c.name, arguments: c.arguments },
                ...(c.extra ? { extra_content: c.extra } : {}),
              })),
            }
          : {}),
      });
    } else {
      out.push({
        role: "tool",
        tool_call_id: m.toolCallId ?? "",
        content: m.content,
      });
    }
  }

  return out;
}

function toWireTools(tools: ToolSchema[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

interface RawToolCallDelta {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
  extra_content?: Record<string, unknown>;
}

/**
 * Reassembles tool calls from streamed fragments. Providers disagree on how
 * they identify which fragment belongs to which call:
 *
 *   OpenAI/Groq  every fragment carries `index`; only the first carries `id`.
 *   Gemini       parallel calls each carry a distinct `id` and NO `index`.
 *
 * Keying on array position breaks Gemini (two calls in separate frames are
 * both at position 0, so their arguments get concatenated into one invalid
 * JSON string). Keying on `id` alone breaks OpenAI (continuation fragments
 * have no id). So: resolve to a stable key per call, and remember the
 * index->key mapping for continuations.
 */
class ToolCallAccumulator {
  private byKey = new Map<
    string,
    { id: string; name: string; args: string; extra?: Record<string, unknown> }
  >();
  private indexToKey = new Map<number, string>();
  private lastKey: string | null = null;

  private resolveKey(raw: RawToolCallDelta, position: number): string {
    // A continuation fragment for a call we have already started.
    if (raw.index !== undefined) {
      const known = this.indexToKey.get(raw.index);
      if (known) return known;
    }

    let key: string;
    if (raw.id) key = `id:${raw.id}`;
    else if (raw.index !== undefined) key = `idx:${raw.index}`;
    else key = this.lastKey ?? `pos:${position}`;

    if (raw.index !== undefined) this.indexToKey.set(raw.index, key);
    return key;
  }

  push(raw: RawToolCallDelta, position: number) {
    const key = this.resolveKey(raw, position);
    const cur = this.byKey.get(key) ?? { id: "", name: "", args: "" };

    if (raw.id) cur.id = raw.id;
    if (raw.function?.name) cur.name = raw.function.name;
    if (raw.function?.arguments) cur.args += raw.function.arguments;
    if (raw.extra_content) cur.extra = raw.extra_content;

    this.byKey.set(key, cur);
    this.lastKey = key;
  }

  /** Returns calls in the order the model emitted them. */
  drain(): ToolCall[] {
    const calls = [...this.byKey.values()]
      .filter((c) => c.name)
      .map((c, i) => ({
        id: c.id || `call_${i}_${Date.now()}`,
        name: c.name,
        arguments: c.args || "{}",
        ...(c.extra ? { extra: c.extra } : {}),
      }));

    this.byKey.clear();
    this.indexToKey.clear();
    this.lastKey = null;
    return calls;
  }
}

export function createOpenAICompatibleProvider(
  cfg: OpenAICompatibleConfig,
): ModelProvider {
  return {
    id: cfg.id,
    model: cfg.model,

    async *stream({
      system,
      messages,
      tools,
      signal,
    }: StreamArgs): AsyncGenerator<ProviderEvent> {
      const body: Record<string, unknown> = {
        model: cfg.model,
        stream: true,
        messages: toWire(system, messages),
      };
      // undefined means "omit the parameter" — some models reject them.
      if (cfg.maxTokens !== undefined) body.max_tokens = cfg.maxTokens;
      if (cfg.temperature !== undefined) body.temperature = cfg.temperature;
      if (tools.length) {
        body.tools = toWireTools(tools);
        body.tool_choice = "auto";
      }

      const url = `${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`;
      const maxAttempts = cfg.maxRetries ?? 8;
      let res: Response | null = null;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          res = await fetch(url, {
            method: "POST",
            signal,
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${cfg.apiKey}`,
              ...cfg.headers,
            },
            body: JSON.stringify(body),
          });
        } catch (err) {
          if ((err as Error).name === "AbortError") return;
          yield {
            type: "error",
            message: `Could not reach ${cfg.id}: ${(err as Error).message}`,
          };
          return;
        }

        // Free tiers rate-limit aggressively, and one message costs many
        // requests. Without backoff the app is unusable on a free key.
        const retryable = res.status === 429 || res.status >= 500;
        if (!retryable || attempt === maxAttempts - 1) break;

        const detail = await res.text().catch(() => "");
        const waitSeconds = retryAfterSeconds(res, detail, attempt);
        yield {
          type: "notice",
          message:
            res.status === 429
              ? `Rate limited by ${cfg.id}. Retrying in ${waitSeconds}s…`
              : `${cfg.id} returned ${res.status}. Retrying in ${waitSeconds}s…`,
        };

        try {
          await sleep(waitSeconds * 1000, signal);
        } catch {
          return; // aborted while waiting
        }
      }

      if (!res || !res.ok || !res.body) {
        const detail = res ? await res.text().catch(() => "") : "";
        yield {
          type: "error",
          message: `${cfg.id} returned ${res?.status ?? "no response"}. ${detail.slice(0, 600)}`,
        };
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const acc = new ToolCallAccumulator();
      let buffer = "";
      let finishReason = "stop";

      let ended = false;
      while (!ended) {
        const { done, value } = await reader.read();
        if (done) {
          // Flush the decoder and parse whatever is still buffered — a final
          // frame with no trailing blank line would otherwise be dropped.
          ended = true;
          buffer += decoder.decode();
        } else {
          buffer += decoder.decode(value, { stream: true });
        }

        // SSE frames are separated by a blank line; the spec allows CRLF, LF,
        // or CR line endings, and splitting on "\n\n" alone drops a CRLF
        // stream in its entirety.
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = ended ? "" : (frames.pop() ?? "");

        for (const frame of frames) {
          for (const line of frame.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;

            let chunk: {
              choices?: {
                delta?: {
                  content?: string | null;
                  tool_calls?: {
                    index?: number;
                    id?: string;
                    function?: { name?: string; arguments?: string };
                    extra_content?: Record<string, unknown>;
                  }[];
                };
                finish_reason?: string | null;
              }[];
              error?: { message?: string };
            };
            try {
              chunk = JSON.parse(payload);
            } catch {
              continue; // partial frame, ignore
            }

            if (chunk.error) {
              yield {
                type: "error",
                message: chunk.error.message ?? "Unknown provider error",
              };
              return;
            }

            const choice = chunk.choices?.[0];
            if (!choice) continue;
            if (choice.finish_reason) finishReason = choice.finish_reason;

            const text = choice.delta?.content;
            if (text) yield { type: "text", delta: text };

            for (const [i, tc] of (choice.delta?.tool_calls ?? []).entries()) {
              acc.push(tc, i);
            }
          }
        }
      }

      for (const call of acc.drain()) {
        yield { type: "tool_call", call };
      }
      yield { type: "done", finishReason };
    },
  };
}
