/**
 * Provider-agnostic chat types.
 *
 * Everything downstream of this file (the agent loop, the tools, the route
 * handler) talks in these types only. Swapping Gemini for Anthropic is a new
 * file in this directory plus one env var — not a refactor.
 */

export type ChatRole = "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON string as emitted by the model. Always parse, never string-match. */
  arguments: string;
  /**
   * Opaque provider metadata that must be echoed back verbatim on the next
   * request. Gemini 3.x puts a required `thought_signature` here and rejects
   * follow-up turns without it. Other providers leave it undefined.
   */
  extra?: Record<string, unknown>;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Present on assistant messages that requested tools. */
  toolCalls?: ToolCall[];
  /** Present on tool messages, links the result back to the call. */
  toolCallId?: string;
  /** UI-only: what the tool did, for rendering. Never sent to the model. */
  meta?: Record<string, unknown>;
}

export interface ToolSchema {
  name: string;
  description: string;
  /** JSON Schema for the tool's arguments. */
  parameters: Record<string, unknown>;
}

export type ProviderEvent =
  | { type: "text"; delta: string }
  | { type: "tool_call"; call: ToolCall }
  /** Transient status worth showing the user, e.g. waiting out a rate limit. */
  | { type: "notice"; message: string }
  | { type: "done"; finishReason: string }
  | { type: "error"; message: string };

export interface StreamArgs {
  system: string;
  messages: ChatMessage[];
  tools: ToolSchema[];
  signal?: AbortSignal;
}

export interface ModelProvider {
  /** Human-readable id, e.g. "gemini". Surfaced in the UI and logs. */
  id: string;
  model: string;
  stream(args: StreamArgs): AsyncGenerator<ProviderEvent>;
}
