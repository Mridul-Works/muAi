import { getProvider, ProviderNotConfiguredError } from "@/lib/ai/provider";
import { runAgent } from "@/lib/agent/loop";
import { encodeSSE } from "@/lib/agent/events";
import { sanitizeHistory, validateChatRequest } from "@/lib/agent/history";
import { VirtualFS, type FileMap } from "@/lib/fs/virtual-fs";
import { defaultTemplate } from "@/lib/templates";
import type { ChatMessage } from "@/lib/ai/types";

export const runtime = "nodejs";
export const maxDuration = 300;

interface ChatRequest {
  messages: ChatMessage[];
  files: FileMap;
}

export async function POST(request: Request) {
  let body: ChatRequest;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const invalid = validateChatRequest(body);
  if (invalid) {
    return Response.json({ error: invalid }, { status: 400 });
  }

  let provider;
  try {
    provider = getProvider();
  } catch (err) {
    if (err instanceof ProviderNotConfiguredError) {
      return Response.json({ error: err.message }, { status: 503 });
    }
    throw err;
  }

  const fs = new VirtualFS(body.files ?? {});

  // Repair dangling tool_calls (Stop mid-round, dropped connections) so a
  // half-finished previous turn can never brick the session.
  const messages = sanitizeHistory(body.messages);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true; // client went away mid-stream
        }
      };

      try {
        for await (const event of runAgent({
          provider,
          fs,
          template: defaultTemplate,
          messages,
          signal: request.signal,
        })) {
          send(encodeSSE(event));
        }
      } catch (err) {
        // The client disconnecting mid-stream is normal, not an error.
        if (!request.signal.aborted) {
          send(encodeSSE({ type: "error", message: (err as Error).message }));
        }
      } finally {
        if (!closed) {
          try {
            controller.close();
          } catch {
            // already closed by the runtime after a cancel — fine
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Stops proxies (and `next start` behind one) from buffering the stream.
      "X-Accel-Buffering": "no",
    },
  });
}
