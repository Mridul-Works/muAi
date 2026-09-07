import type { ChatMessage } from "@/lib/ai/types";

/** The wire protocol between the agent loop and the browser, over SSE. */
export type AgentEvent =
  /** Streamed assistant prose. */
  | { type: "text"; delta: string }
  /** A tool is about to run. Lets the UI show activity before the result. */
  | { type: "tool_start"; id: string; name: string; path?: string }
  /** A tool finished. `summary` is the one-liner shown in the chat. */
  | { type: "tool_end"; id: string; name: string; ok: boolean; summary: string }
  /** Apply to the client-side file map, then hand to Sandpack. */
  | { type: "file_write"; path: string; content: string }
  | { type: "file_delete"; path: string }
  /** Append verbatim to the client's message history for the next request. */
  | { type: "message"; message: ChatMessage }
  /** Transient status, e.g. waiting out a provider rate limit. */
  | { type: "notice"; message: string }
  /** The loop guard tripped. Not an error — the turn just stopped early. */
  | { type: "limit"; reason: string }
  | { type: "error"; message: string }
  | { type: "done" };

export function encodeSSE(event: AgentEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/** Parses a raw SSE text chunk into events. Returns leftover partial data. */
export function decodeSSE(buffer: string): {
  events: AgentEvent[];
  rest: string;
} {
  const events: AgentEvent[] = [];
  const frames = buffer.split("\n\n");
  const rest = frames.pop() ?? "";

  for (const frame of frames) {
    for (const line of frame.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      try {
        events.push(JSON.parse(payload) as AgentEvent);
      } catch {
        // Ignore malformed frames rather than killing the stream.
      }
    }
  }

  return { events, rest };
}
