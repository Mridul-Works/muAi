import { envFloatOrOff, envInt } from "@/lib/env";
import { createOpenAICompatibleProvider } from "./openai-compatible";
import type { ModelProvider } from "./types";

/**
 * Provider presets. All of these speak the OpenAI chat-completions shape, so
 * they share one adapter — picking a provider is `AI_PROVIDER` + `AI_API_KEY`
 * in .env.local, nothing else.
 *
 * Free tiers move constantly. If a default model 404s, override AI_MODEL
 * rather than editing this table.
 */
const PRESETS: Record<string, { baseUrl: string; model: string; keyUrl: string }> = {
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-3.5-flash-lite",
    keyUrl: "https://aistudio.google.com/apikey",
  },
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
    keyUrl: "https://console.groq.com/keys",
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    model: "deepseek/deepseek-chat-v3.1:free",
    keyUrl: "https://openrouter.ai/keys",
  },
  cerebras: {
    baseUrl: "https://api.cerebras.ai/v1",
    model: "llama-3.3-70b",
    keyUrl: "https://cloud.cerebras.ai/",
  },
  mistral: {
    baseUrl: "https://api.mistral.ai/v1",
    model: "mistral-large-latest",
    keyUrl: "https://console.mistral.ai/api-keys/",
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    keyUrl: "https://platform.openai.com/api-keys",
  },
};

export class ProviderNotConfiguredError extends Error {}

export function getProvider(): ModelProvider {
  const id = (process.env.AI_PROVIDER ?? "gemini").toLowerCase();
  const apiKey = process.env.AI_API_KEY;

  const preset = PRESETS[id];
  const baseUrl = process.env.AI_BASE_URL ?? preset?.baseUrl;
  const model = process.env.AI_MODEL ?? preset?.model;

  if (!preset && !process.env.AI_BASE_URL) {
    throw new ProviderNotConfiguredError(
      `Unknown AI_PROVIDER "${id}". Known: ${Object.keys(PRESETS).join(", ")}. ` +
        `For anything else, set AI_BASE_URL and AI_MODEL explicitly.`,
    );
  }
  if (!apiKey) {
    throw new ProviderNotConfiguredError(
      `AI_API_KEY is not set. Create .env.local and add a key` +
        (preset ? ` — get a free one at ${preset.keyUrl}` : "") +
        `.\n\n  AI_PROVIDER=${id}\n  AI_API_KEY=...\n`,
    );
  }
  if (!baseUrl || !model) {
    throw new ProviderNotConfiguredError(
      "AI_BASE_URL and AI_MODEL must both be set for a custom provider.",
    );
  }

  return createOpenAICompatibleProvider({
    id,
    baseUrl,
    apiKey,
    model,
    // "none" omits the parameter entirely (some models reject it); malformed
    // values fall back to the default instead of sending NaN or 0.
    maxTokens: envFloatOrOff("AI_MAX_TOKENS", 8192, { min: 256, max: 1_000_000 }),
    temperature: envFloatOrOff("AI_TEMPERATURE", 0.2, { min: 0, max: 2 }),
    maxRetries: envInt("AI_MAX_RETRIES", 8, { min: 1, max: 20 }),
    headers:
      id === "openrouter"
        ? {
            "HTTP-Referer": "http://localhost:3000",
            "X-Title": "muAi",
          }
        : undefined,
  });
}
