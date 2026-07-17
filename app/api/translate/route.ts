import { translateChatMessage } from "@/lib/gemini";

const MAX_TEXT_LENGTH = 500;
const MAX_TARGET_LANGUAGES = 10;

export async function POST(request: Request) {
  let body: { text?: string; targetLanguages?: string[] };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const { text, targetLanguages } = body;
  if (!text || typeof text !== "string" || !text.trim()) {
    return Response.json({ error: "Missing text." }, { status: 400 });
  }
  if (!Array.isArray(targetLanguages) || targetLanguages.some((l) => typeof l !== "string")) {
    return Response.json({ error: "targetLanguages must be a string array." }, { status: 400 });
  }

  const translations = await translateChatMessage(
    text.slice(0, MAX_TEXT_LENGTH),
    targetLanguages.slice(0, MAX_TARGET_LANGUAGES)
  );

  return Response.json({ translations });
}
