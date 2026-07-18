import { NextRequest } from "next/server";
import { getTrendingVideos } from "@/lib/youtubeSearch";

export async function GET(request: NextRequest) {
  const categoryId = request.nextUrl.searchParams.get("category") ?? undefined;
  const results = await getTrendingVideos(categoryId);
  return Response.json({ results });
}
