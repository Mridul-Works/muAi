import type { ChatMessage, ToolCall } from "@/lib/ai/types";

/**
 * Repairs a conversation history so it can always be sent to a provider.
 *
 * The failure this exists for: the server streams the assistant message
 * (with tool_calls) BEFORE executing the tools, so a Stop click or dropped
 * connection mid-round leaves the client holding an assistant entry whose
 * tool_calls never received results. Providers reject such a history with a
 * 400 — on every subsequent message, permanently bricking the session.
 *
 * Repairs applied:
 *  - every unanswered tool_call gets a synthesized "cancelled" tool result
 *    (inserted directly after its round, before the next user turn);
 *  - tool messages that answer no known call are dropped;
 *  - duplicate answers to the same call are dropped;
 *  - assistant entries with no content AND no tool_calls are dropped
 *    (serialized as content:null, which providers reject).
 */
export function sanitizeHistory(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  let pending = new Map<string, ToolCall>();

  const flushPending = () => {
    for (const call of pending.values()) {
      out.push({
        role: "tool",
        toolCallId: call.id,
        content:
          "Error: this tool call was cancelled before it ran (the user stopped " +
          "the response or the connection dropped). The file operation did NOT " +
          "happen. Re-issue it if it is still needed.",
        meta: { name: call.name, ok: false, summary: "Cancelled" },
      });
    }
    pending = new Map();
  };

  for (const m of messages) {
    if (m.role === "tool") {
      // Keep only the first answer to a call this round actually made.
      if (m.toolCallId && pending.has(m.toolCallId)) {
        pending.delete(m.toolCallId);
        out.push(m);
      }
      continue;
    }

    // A user or assistant turn closes the previous tool round.
    flushPending();

    if (m.role === "assistant") {
      if (!m.content && !m.toolCalls?.length) continue; // unsendable, drop
      out.push(m);
      for (const call of m.toolCalls ?? []) pending.set(call.id, call);
    } else {
      out.push(m);
    }
  }

  flushPending();
  return out;
}

/**
 * Shape-validates an incoming /api/chat payload. Returns an error string for
 * a malformed request, or null when valid. Content the model wrote (tool
 * results, file text) is data, not trusted structure — everything is checked.
 */
export function validateChatRequest(body: {
  messages?: unknown;
  files?: unknown;
}): string | null {
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return "messages must be a non-empty array.";
  }
  for (const [i, m] of body.messages.entries()) {
    if (typeof m !== "object" || m === null) return `messages[${i}] is not an object.`;
    const msg = m as Record<string, unknown>;
    if (!["user", "assistant", "tool"].includes(msg.role as string)) {
      return `messages[${i}].role must be user, assistant or tool.`;
    }
    if (typeof msg.content !== "string") {
      return `messages[${i}].content must be a string.`;
    }
    if (msg.toolCalls !== undefined) {
      if (!Array.isArray(msg.toolCalls)) return `messages[${i}].toolCalls must be an array.`;
      for (const c of msg.toolCalls) {
        const call = c as Record<string, unknown>;
        if (
          typeof call?.id !== "string" ||
          typeof call?.name !== "string" ||
          typeof call?.arguments !== "string"
        ) {
          return `messages[${i}] has a malformed tool call.`;
        }
      }
    }
  }

  if (body.files !== undefined) {
    if (typeof body.files !== "object" || body.files === null || Array.isArray(body.files)) {
      return "files must be an object mapping path to content.";
    }
    for (const [path, content] of Object.entries(body.files)) {
      if (typeof content !== "string") {
        return `files[${JSON.stringify(path)}] must be a string.`;
      }
    }
  }

  return null;
}
