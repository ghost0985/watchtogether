// Standard YouTube category IDs (stable, documented) — used to get
// "trending within a category" from the cheap videos.list?chart=mostPopular
// endpoint (1 quota unit) instead of an expensive search.list call (100
// units) per category. Not server-only: this is just static data, safe for
// both the client (VideoBrowser) and server (lib/youtubeSearch.ts) to import.
export const VIDEO_CATEGORIES = [
  { id: "10", label: "Music" },
  { id: "20", label: "Gaming" },
  { id: "23", label: "Comedy" },
  { id: "24", label: "Movies & Entertainment" },
] as const;
