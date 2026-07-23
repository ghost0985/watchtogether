import { translateChatMessage, type ContextMessage } from "@/lib/gemini";

const MAX_TEXT_LENGTH = 500;
const MAX_TARGET_LANGUAGES = 10;
const MAX_CONTEXT_MESSAGES = 5;

function isContextMessage(value: unknown): value is ContextMessage {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as ContextMessage).name === "string" &&
    typeof (value as ContextMessage).text === "string"
  );
}

export async function POST(request: Request) {
  let body: { text?: string; targetLanguages?: string[]; context?: ContextMessage[] };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const { text, targetLanguages, context } = body;
  if (!text || typeof text !== "string" || !text.trim()) {
    return Response.json({ error: "Missing text." }, { status: 400 });
  }
  if (!Array.isArray(targetLanguages) || targetLanguages.some((l) => typeof l !== "string")) {
    return Response.json({ error: "targetLanguages must be a string array." }, { status: 400 });
  }
  if (context !== undefined && (!Array.isArray(context) || context.some((m) => !isContextMessage(m)))) {
    return Response.json({ error: "context must be an array of { name, text }." }, { status: 400 });
  }

  const translations = await translateChatMessage(
    text.slice(0, MAX_TEXT_LENGTH),
    targetLanguages.slice(0, MAX_TARGET_LANGUAGES),
    (context ?? [])
      .slice(-MAX_CONTEXT_MESSAGES)
      .map((m) => ({ name: m.name.slice(0, 24), text: m.text.slice(0, MAX_TEXT_LENGTH) }))
  );

  return Response.json({ translations });
}
