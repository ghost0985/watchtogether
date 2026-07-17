import "server-only";
import { languageLabel } from "./languages";

// Free-tier chat model, same choice as the chat-with-PDF project. Called via
// plain REST fetch (no SDK) per this project's stack convention.
const CHAT_MODEL = "gemini-flash-lite-latest";
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${CHAT_MODEL}:generateContent`;

async function withRetry<T>(fn: () => Promise<T>, retries = 3, baseDelayMs = 800): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isRetryable = err instanceof RetryableError;
      if (!isRetryable || attempt >= retries) throw err;
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** attempt));
    }
  }
}

class RetryableError extends Error {}

async function generate(prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set in the environment");

  return withRetry(async () => {
    const res = await fetch(`${API_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2 },
      }),
    });

    if (res.status === 429 || res.status === 503) {
      throw new RetryableError(`Gemini returned ${res.status}`);
    }
    if (!res.ok) {
      throw new Error(`Gemini request failed: ${res.status} ${await res.text()}`);
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== "string") throw new Error("Gemini response had no text");
    return text;
  });
}

/** Extracts the first {...} block from a response, tolerating markdown fences. */
function extractJsonObject(raw: string): unknown {
  const withoutFences = raw.replace(/```(?:json)?/gi, "");
  const match = withoutFences.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

/**
 * Translates one chat message into each of `targetLanguages` in a single
 * Gemini call (batched, so a busy chat doesn't multiply API calls per
 * message per recipient). Returns whatever translations could be parsed —
 * on any failure (missing key, rate limit, bad response) returns {} so chat
 * degrades to "no translation" instead of failing to send.
 */
export async function translateChatMessage(
  text: string,
  targetLanguages: string[]
): Promise<Record<string, string>> {
  if (targetLanguages.length === 0) return {};

  const targetList = targetLanguages.map((code) => `${code} (${languageLabel(code)})`).join(", ");
  const prompt = `Translate the chat message below into each of these languages: ${targetList}.

Respond with ONLY a JSON object, no markdown formatting, no commentary. The object's keys must be exactly these language codes: ${targetLanguages.join(", ")}. Each value is the message translated into that language, preserving tone and casualness — this is a chat message between friends, not a formal document.

Message: "${text.replace(/"/g, '\\"')}"`;

  try {
    const raw = await generate(prompt);
    const parsed = extractJsonObject(raw);
    if (!parsed || typeof parsed !== "object") return {};

    const result: Record<string, string> = {};
    for (const code of targetLanguages) {
      const value = (parsed as Record<string, unknown>)[code];
      if (typeof value === "string" && value.trim()) result[code] = value.trim();
    }
    return result;
  } catch (err) {
    console.error("Translation failed:", err);
    return {};
  }
}
