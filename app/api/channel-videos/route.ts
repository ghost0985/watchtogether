import { getChannelUploads } from "@/lib/youtubeSearch";

export async function POST(request: Request) {
  let body: { channelId?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const { channelId } = body;
  if (!channelId || typeof channelId !== "string") {
    return Response.json({ error: "Missing channelId." }, { status: 400 });
  }

  const result = await getChannelUploads(channelId);
  if (!result) return Response.json({ channelTitle: "", results: [] });
  return Response.json({ channelTitle: result.channelTitle, results: result.videos });
}
