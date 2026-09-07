"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/lib/ai/types";
import type { Status } from "./Workbench";

const SUGGESTIONS = [
  "A pomodoro timer with a circular progress ring",
  "A kanban board with drag-free column controls",
  "A markdown note app that saves to localStorage",
];

interface Props {
  messages: ChatMessage[];
  liveText: string;
  activity: { id: string; label: string }[];
  status: Status;
  notice: string | null;
  error: string | null;
  onSend: (text: string) => void;
  onStop: () => void;
  onReset: () => void;
}

export default function ChatPanel({
  messages,
  liveText,
  activity,
  status,
  notice,
  error,
  onSend,
  onStop,
  onReset,
}: Props) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  // Follow the stream only while the user is already at the bottom — never
  // yank the view down while they are scrolled up reading earlier messages.
  const pinnedRef = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedRef.current) el.scrollTo({ top: el.scrollHeight });
  }, [messages, liveText, activity]);

  const submit = () => {
    if (!draft.trim() || status === "running") return;
    onSend(draft);
    setDraft("");
  };

  const isEmpty = messages.length === 0;

  return (
    <aside className="flex h-full w-[420px] shrink-0 flex-col border-r border-neutral-800 bg-neutral-950">
      <header className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-emerald-400" />
          <span className="text-sm font-medium tracking-tight">muAi</span>
        </div>
        <button
          onClick={onReset}
          className="rounded px-2 py-1 text-xs text-neutral-500 transition hover:bg-neutral-900 hover:text-neutral-300"
        >
          New project
        </button>
      </header>

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
        }}
        className="flex-1 space-y-4 overflow-y-auto p-4"
      >
        {isEmpty && (
          <div className="pt-8">
            <h1 className="text-lg font-medium text-neutral-200">
              What do you want to build?
            </h1>
            <p className="mt-1 text-sm text-neutral-500">
              Describe an app and it appears in the preview.
            </p>
            <div className="mt-5 space-y-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => onSend(s)}
                  className="block w-full rounded-lg border border-neutral-800 px-3 py-2.5 text-left text-sm text-neutral-400 transition hover:border-neutral-700 hover:bg-neutral-900 hover:text-neutral-200"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message, i) => (
          <MessageRow key={i} message={message} />
        ))}

        {liveText && <AssistantText text={liveText} />}

        {activity.map((a) => (
          <ActivityRow key={a.id} text={a.label} pending />
        ))}

        {status === "running" && !liveText && activity.length === 0 && (
          <div className="text-sm text-neutral-500">Thinking…</div>
        )}

        {notice && (
          <div className="flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-2 text-xs text-neutral-400">
            <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-sky-400" />
            {notice}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-amber-900/60 bg-amber-950/40 px-3 py-2 text-sm text-amber-200">
            {error}
          </div>
        )}
      </div>

      <div className="border-t border-neutral-800 p-3">
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 focus-within:border-neutral-700">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={3}
            placeholder="Describe a change…"
            className="w-full resize-none bg-transparent px-3 py-2.5 text-sm text-neutral-100 outline-none placeholder:text-neutral-600"
          />
          <div className="flex items-center justify-between px-3 pb-2.5">
            <span className="text-[11px] text-neutral-600">
              Enter to send, Shift+Enter for a new line
            </span>
            {status === "running" ? (
              <button
                onClick={onStop}
                className="rounded-md bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-200 transition hover:bg-neutral-700"
              >
                Stop
              </button>
            ) : (
              <button
                onClick={submit}
                disabled={!draft.trim()}
                className="rounded-md bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-900 transition hover:bg-white disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-600"
              >
                Send
              </button>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}

function MessageRow({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="ml-6 rounded-xl bg-neutral-800/80 px-3.5 py-2.5 text-sm leading-relaxed text-neutral-100">
        {message.content}
      </div>
    );
  }

  if (message.role === "tool") {
    const meta = message.meta as { summary?: string; ok?: boolean } | undefined;
    return <ActivityRow text={meta?.summary ?? "Tool ran"} ok={meta?.ok !== false} />;
  }

  return message.content ? <AssistantText text={message.content} /> : null;
}

function AssistantText({ text }: { text: string }) {
  return (
    <div className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-300">
      {text}
    </div>
  );
}

function ActivityRow({
  text,
  ok = true,
  pending = false,
}: {
  text: string;
  ok?: boolean;
  pending?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 font-mono text-[11px] text-neutral-500">
      <span
        className={
          pending
            ? "h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-neutral-500"
            : ok
              ? "h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500/70"
              : "h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500/80"
        }
      />
      <span className="truncate">{text}</span>
    </div>
  );
}
