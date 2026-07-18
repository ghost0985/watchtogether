import { searchYouTubeVideos } from "@/lib/youtubeSearch";

const MAX_QUERY_LENGTH = 100;

export async function POST(request: Request) {
  let body: { query?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const { query } = body;
  if (!query || typeof query !== "string" || !query.trim()) {
    return Response.json({ error: "Missing query." }, { status: 400 });
  }

  const results = await searchYouTubeVideos(query.trim().slice(0, MAX_QUERY_LENGTH));
  return Response.json({ results });
}
