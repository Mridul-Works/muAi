import type { ChatMessage, ModelProvider, ToolCall } from "@/lib/ai/types";
import type { Template } from "@/lib/templates/types";
import type { VirtualFS } from "@/lib/fs/virtual-fs";
import { envInt } from "@/lib/env";
import type { AgentEvent } from "./events";
import { buildSystemPrompt } from "./prompt";
import { TOOL_SCHEMAS, executeTool } from "./tools";

/**
 * Loop guard. Not a billing control — this exists so a model that gets stuck
 * editing the same file in circles stops on its own instead of draining a
 * rate limit at 3am.
 */
const MAX_ITERATIONS = envInt("AGENT_MAX_ITERATIONS", 25, { min: 1, max: 200 });

export interface RunAgentArgs {
  provider: ModelProvider;
  fs: VirtualFS;
  template: Template;
  /** Full history, including prior assistant tool calls and tool results. */
  messages: ChatMessage[];
  signal?: AbortSignal;
}

export async function* runAgent({
  provider,
  fs,
  template,
  messages,
  signal,
}: RunAgentArgs): AsyncGenerator<AgentEvent> {
  const history = [...messages];

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    if (signal?.aborted) return;

    // The system prompt is rebuilt each iteration so the file tree stays
    // current; the history itself stays append-only.
    const system = buildSystemPrompt(template, fs);

    let text = "";
    const toolCalls: ToolCall[] = [];
    let failed = false;
    let finishReason = "stop";

    for await (const ev of provider.stream({
      system,
      messages: history,
      tools: TOOL_SCHEMAS,
      signal,
    })) {
      if (ev.type === "text") {
        text += ev.delta;
        yield { type: "text", delta: ev.delta };
      } else if (ev.type === "tool_call") {
        toolCalls.push(ev.call);
      } else if (ev.type === "notice") {
        yield { type: "notice", message: ev.message };
      } else if (ev.type === "done") {
        finishReason = ev.finishReason;
      } else if (ev.type === "error") {
        failed = true;
        yield { type: "error", message: ev.message };
      }
    }

    if (failed) return;

    // A completely empty turn must not enter history: an assistant entry
    // with no content and no tool_calls is rejected by several providers on
    // the next request, which would poison the session permanently.
    if (!text && !toolCalls.length) {
      yield {
        type: "notice",
        message:
          finishReason === "length"
            ? "The model hit the output token limit before producing anything. Raise AI_MAX_TOKENS or try again."
            : "The model returned an empty response. Try again or rephrase.",
      };
      yield { type: "done" };
      return;
    }

    const assistantMessage: ChatMessage = {
      role: "assistant",
      content: text,
      ...(toolCalls.length ? { toolCalls } : {}),
    };
    history.push(assistantMessage);
    yield { type: "message", message: assistantMessage };

    // No tools requested means the model considers the turn finished.
    if (!toolCalls.length) {
      if (finishReason === "length") {
        yield {
          type: "notice",
          message:
            "The reply was cut off by the output token limit (AI_MAX_TOKENS) and may be incomplete.",
        };
      }
      yield { type: "done" };
      return;
    }

    for (const call of toolCalls) {
      if (signal?.aborted) return;

      let args: Record<string, unknown> = {};
      let parseError: string | null = null;
      try {
        const parsed: unknown = call.arguments ? JSON.parse(call.arguments) : {};
        // JSON.parse("null") and JSON.parse("[1]") succeed but are not
        // argument objects; touching their properties would crash the stream.
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          parseError = `Error: arguments for ${call.name} must be a JSON object.`;
        } else {
          args = parsed as Record<string, unknown>;
        }
      } catch {
        parseError =
          finishReason === "length"
            ? `Error: the ${call.name} call was cut off by the output token limit ` +
              `before its arguments finished. Split the work into smaller pieces — ` +
              `for example, write smaller files one at a time — and retry.`
            : `Error: arguments for ${call.name} were not valid JSON. ` +
              `Re-issue the call with well-formed JSON.`;
      }

      yield {
        type: "tool_start",
        id: call.id,
        name: call.name,
        path: typeof args.path === "string" ? args.path : undefined,
      };

      const outcome = parseError
        ? { ok: false, content: parseError, summary: `Bad arguments for ${call.name}` }
        : executeTool(fs, call.name, args);

      // Stream file mutations as they happen so the preview rebuilds live.
      for (const mutation of fs.mutations.splice(0)) {
        yield mutation.kind === "write"
          ? { type: "file_write", path: mutation.path, content: mutation.content }
          : { type: "file_delete", path: mutation.path };
      }

      yield {
        type: "tool_end",
        id: call.id,
        name: call.name,
        ok: outcome.ok,
        summary: outcome.summary,
      };

      const toolMessage: ChatMessage = {
        role: "tool",
        toolCallId: call.id,
        content: outcome.content,
        meta: { name: call.name, ok: outcome.ok, summary: outcome.summary },
      };
      history.push(toolMessage);
      yield { type: "message", message: toolMessage };
    }
  }

  yield {
    type: "limit",
    reason: `Stopped after ${MAX_ITERATIONS} tool rounds. Send another message to continue.`,
  };
  yield { type: "done" };
}
