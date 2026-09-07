"use client";

import { useEffect, useRef, useState } from "react";
import {
  SandpackCodeEditor,
  SandpackFileExplorer,
  SandpackPreview,
  SandpackProvider,
  useSandpack,
} from "@codesandbox/sandpack-react";
import type { FileMap } from "@/lib/fs/virtual-fs";
import { defaultTemplate } from "@/lib/templates";

type Tab = "preview" | "code";

/**
 * Pushes file changes into the running Sandpack client. The provider is
 * mounted UNCONTROLLED (its `files` prop never changes): sandpack-react
 * resets active/visible files whenever the prop changes identity, so a
 * controlled provider would jump the editor around on every generated write.
 * All updates flow through this component instead.
 */
function FileSync({ files }: { files: FileMap }) {
  const { sandpack } = useSandpack();
  const previous = useRef<FileMap>(defaultTemplate.files);
  // The sandpack context object changes identity on every internal state
  // change; going through a ref lets the sync effects depend only on what
  // should actually re-trigger them (files, status).
  const sandpackRef = useRef(sandpack);
  useEffect(() => {
    sandpackRef.current = sandpack;
  }, [sandpack]);

  useEffect(() => {
    const sp = sandpackRef.current;
    const prev = previous.current;

    for (const path of Object.keys(prev)) {
      if (!(path in files)) sp.deleteFile(path);
    }

    const changed: FileMap = {};
    for (const [path, content] of Object.entries(files)) {
      if (prev[path] !== content) changed[path] = content;
    }
    if (Object.keys(changed).length) sp.updateFile(changed);

    previous.current = files;
  }, [files]);

  // Updates sent while the bundler was still booting can be dropped —
  // re-assert the full file map once it reports running.
  const status = sandpack.status;
  useEffect(() => {
    if (status === "running") {
      sandpackRef.current.updateFile(previous.current);
    }
  }, [status]);

  return null;
}

export default function PreviewPanel({
  files,
  resetKey,
}: {
  files: FileMap;
  /** Incremented by the workbench on "New project" to remount the bundler. */
  resetKey: number;
}) {
  const [tab, setTab] = useState<Tab>("preview");

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col bg-neutral-900">
      <div className="flex items-center gap-1 border-b border-neutral-800 px-3 py-2">
        {(["preview", "code"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition ${
              tab === t
                ? "bg-neutral-800 text-neutral-100"
                : "text-neutral-500 hover:text-neutral-300"
            }`}
          >
            {t}
          </button>
        ))}
        <span className="ml-auto font-mono text-[11px] text-neutral-600">
          {Object.keys(files).length} files
        </span>
      </div>

      <div className="min-h-0 flex-1">
        <SandpackProvider
          key={resetKey}
          template={defaultTemplate.sandpackTemplate}
          theme="dark"
          files={defaultTemplate.files}
          options={{ activeFile: defaultTemplate.entry, recompileMode: "delayed" }}
        >
          <FileSync files={files} />

          {/* Both panes stay mounted so switching tabs never restarts the
              bundler; the inactive one is just hidden. */}
          <div className="h-full" hidden={tab !== "preview"}>
            <SandpackPreview
              showNavigator
              showRefreshButton
              showOpenInCodeSandbox={false}
              style={{ height: "100%" }}
            />
          </div>

          <div className="flex h-full" hidden={tab !== "code"}>
            <SandpackFileExplorer style={{ height: "100%", width: 220 }} />
            {/* Read-only: hand edits here would never reach the agent's file
                map and the next generated write would silently revert them.
                Slice 2+ can add a real editing round-trip. */}
            <SandpackCodeEditor
              readOnly
              showLineNumbers
              showTabs
              style={{ height: "100%", flex: 1 }}
            />
          </div>
        </SandpackProvider>
      </div>
    </main>
  );
}
