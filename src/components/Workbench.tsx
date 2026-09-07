"use client";

import { useCallback, useRef, useState } from "react";
import type { ChatMessage } from "@/lib/ai/types";
import type { FileMap } from "@/lib/fs/virtual-fs";
import { decodeSSE } from "@/lib/agent/events";
import { defaultTemplate } from "@/lib/templates";
import ChatPanel from "./ChatPanel";
import PreviewPanel from "./PreviewPanel";

export type Status = "idle" | "running";

export default function Workbench() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [files, setFiles] = useState<FileMap>(defaultTemplate.files);
  const [liveText, setLiveText] = useState("");
  // Only tools currently IN FLIGHT — completed tools render from their
  // committed tool message, so showing them here too would duplicate rows.
  const [activity, setActivity] = useState<{ id: string; label: string }[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [resetKey, setResetKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus("idle");
  }, []);

  const send = useCallback(
    async (text: string) => {
      if (status === "running" || !text.trim()) return;

      const userMessage: ChatMessage = { role: "user", content: text.trim() };

      // Snapshot the history we send, so we don't race the state update.
      const outgoing = [...messages, userMessage];
      setMessages(outgoing);
      setLiveText("");
      setActivity([]);
      setError(null);
      setNotice(null);
      setStatus("running");

      const controller = new AbortController();
      abortRef.current = controller;

      // The files map mutates as events arrive; keep a local copy so each
      // update is applied to the latest version rather than a stale closure.
      let nextFiles = { ...files };

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: outgoing, files: nextFiles }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const detail = await res.json().catch(() => ({ error: res.statusText }));
          setError(detail.error ?? `Request failed (${res.status}).`);
          setStatus("idle");
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const { events, rest } = decodeSSE(buffer);
          buffer = rest;

          for (const event of events) {
            switch (event.type) {
              case "text":
                // Output resuming means any retry we were waiting on landed.
                setNotice(null);
                setLiveText((prev) => prev + event.delta);
                break;

              case "tool_start":
                setNotice(null);
                setActivity((prev) => [
                  ...prev,
                  {
                    id: event.id,
                    label: event.path ? `${event.name} ${event.path}` : event.name,
                  },
                ]);
                break;

              case "tool_end":
                setActivity((prev) => prev.filter((a) => a.id !== event.id));
                break;

              case "file_write":
                nextFiles = { ...nextFiles, [event.path]: event.content };
                setFiles(nextFiles);
                break;

              case "file_delete": {
                const remaining = { ...nextFiles };
                delete remaining[event.path];
                nextFiles = remaining;
                setFiles(nextFiles);
                break;
              }

              case "message":
                setMessages((prev) => [...prev, event.message]);
                // Prose is now committed to history; clear the live buffer.
                if (event.message.role === "assistant") setLiveText("");
                break;

              case "notice":
                setNotice(event.message);
                break;

              case "limit":
                setError(event.reason);
                break;

              case "error":
                setError(event.message);
                break;

              case "done":
                break;
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setError((err as Error).message);
        }
      } finally {
        setStatus("idle");
        setLiveText("");
        setNotice(null);
        setActivity([]);
        abortRef.current = null;
      }
    },
    [files, messages, status],
  );

  const reset = useCallback(() => {
    stop();
    setMessages([]);
    setFiles(defaultTemplate.files);
    setError(null);
    setResetKey((k) => k + 1);
  }, [stop]);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-neutral-950 text-neutral-100">
      <ChatPanel
        messages={messages}
        liveText={liveText}
        activity={activity}
        status={status}
        notice={notice}
        error={error}
        onSend={send}
        onStop={stop}
        onReset={reset}
      />
      <PreviewPanel files={files} resetKey={resetKey} />
    </div>
  );
}
