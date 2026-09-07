import type { Template } from "./types";

/**
 * Starter project on Sandpack's CLASSIC bundler (environment
 * "create-react-app", served from *-sandpack.codesandbox.io). Measured
 * 2026-09-02: renders in ~3s headless. The "vite-react-ts" template was
 * rejected — it runs on Nodebox (a Node-in-browser runtime) which failed to
 * render within 120s and wedged the page.
 *
 * Two hard-won constraints shape this file — verified in a real browser:
 *
 * 1. GHOST FILES: Sandpack MERGES the base template's files with ours; any
 *    base file we don't override still exists in the preview and file
 *    explorer, invisible to the agent's VirtualFS. So this template uses the
 *    react-ts base layout and overrides every base file (/App.tsx,
 *    /index.tsx, /styles.css, /public/index.html, /package.json,
 *    tsconfig.json) instead of inventing a /src layout that would leave the
 *    base files dangling as ghosts.
 *
 * 2. TAILWIND: the classic bundler serves its own HTML shell — <script> tags
 *    in /public/index.html never execute. The Tailwind v4 browser build is
 *    injected at runtime from /index.tsx instead.
 */
export const reactClassicTemplate: Template = {
  id: "react-classic",
  label: "React + TypeScript + Tailwind",
  sandpackTemplate: "react-ts",
  entry: "/App.tsx",

  files: {
    "/index.tsx": `import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

// Tailwind v4 (browser build). The sandbox serves its own HTML shell, so
// a <script> tag in index.html would never execute — inject it at runtime.
if (!document.querySelector("script[data-tailwind]")) {
  const tw = document.createElement("script");
  tw.src = "https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4";
  tw.setAttribute("data-tailwind", "");
  document.head.appendChild(tw);
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
`,

    "/App.tsx": `export default function App() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-900">
      <div className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Ready</h1>
        <p className="mt-2 text-slate-500">
          Describe what you want to build in the chat.
        </p>
      </div>
    </main>
  );
}
`,

    "/styles.css": `:root {
  color-scheme: light dark;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
`,

    "/public/index.html": `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>App</title>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`,

    "/package.json": JSON.stringify(
      {
        name: "generated-app",
        private: true,
        version: "0.0.0",
        main: "/index.tsx",
        dependencies: {
          react: "^19.0.0",
          "react-dom": "^19.0.0",
        },
        devDependencies: {
          "@types/react": "^19.0.0",
          "@types/react-dom": "^19.0.0",
          typescript: "^5.0.0",
        },
      },
      null,
      2,
    ),

    "/tsconfig.json": `{
  "include": ["./**/*"],
  "compilerOptions": {
    "strict": true,
    "esModuleInterop": true,
    "lib": ["dom", "es2020"],
    "jsx": "react-jsx"
  }
}
`,
  },

  promptFragment: `## Target stack

You are editing a React 19 + TypeScript project bundled in the browser.

- \`/index.tsx\` is the entry point; it renders \`/App.tsx\`. Never modify
  \`/index.tsx\`, \`/public/index.html\` or \`/tsconfig.json\` — the preview
  depends on them.
- **Styling is Tailwind CSS v4** (loaded by the entry point). Use Tailwind
  utility classes in JSX. There is no build-time Tailwind, so:
  - Do NOT create \`tailwind.config.js\` — it will not be read.
  - Do NOT write \`@tailwind\` or \`@apply\` directives in CSS files.
  - For custom colors, use arbitrary values like \`bg-[#0f172a]\`.
- Plain CSS in \`/styles.css\` works for global resets and CSS variables.
- The app lives in \`/App.tsx\`; components go in \`/components/\`, one
  component per file, default export, imported like
  \`import Header from "./components/Header"\`.
- The preview runs in a browser sandbox with no server. There is no Node
  backend, no filesystem, and no environment variables. Persist with
  \`localStorage\` and use \`fetch\` only against public CORS-enabled APIs.
- Any npm package you import must first be added with \`add_dependency\`.
  Prefer zero dependencies; reach for a package only when hand-writing it
  would be genuinely worse.`,
};
