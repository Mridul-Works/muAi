# muAi

An AI app builder: describe an app in chat, watch a coding agent build it
file-by-file into a live in-browser preview.

## Quick start

```bash
npm install
cp .env.example .env.local   # add your AI_API_KEY (free: aistudio.google.com/apikey)
npm run dev                  # http://localhost:3000
```

## How it works

The browser holds the conversation and a virtual file map, and POSTs both to
`/api/chat`. The server runs a streaming tool-calling agent loop against any
OpenAI-compatible provider (Gemini free tier by default) and streams SSE
events back; every file write lands in a Sandpack preview as it happens.

- `src/lib/ai/` — provider abstraction (one adapter covers Gemini, Groq,
  OpenRouter, Cerebras, Mistral, OpenAI; swap with `AI_PROVIDER`)
- `src/lib/agent/` — the loop, 8 file tools, system prompt, SSE protocol,
  history sanitizer
- `src/lib/fs/` — in-memory virtual filesystem
- `src/lib/templates/` — the starter project the agent composes from
- `src/components/` — workbench UI (chat, Sandpack preview, code view)

See `OVERVIEW.txt` for the full architecture, measured free-tier provider
limits, verification status, and the roadmap (persistence, error auto-fix,
GitHub export, hosted product layer).
