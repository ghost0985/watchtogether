import "server-only";

const SEARCH_URL = "https://www.googleapis.com/youtube/v3/search";
const VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos";

export type VideoResult = {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnailUrl: string;
};

type RawSnippet = {
  title?: string;
  channelTitle?: string;
  thumbnails?: Record<string, { url?: string } | undefined>;
};

// search.list nests the id in an object; videos.list (used for trending) puts
// the plain video id string directly in `id`.
type RawItem = { id?: string | { videoId?: string }; snippet?: RawSnippet };

// YouTube's API hands back titles/channel names HTML-escaped (e.g. "Tom &amp;
// Jerry"). We're not rendering into HTML via dangerouslySetInnerHTML, so React
// would otherwise show the raw "&amp;" — decode the common entities here.
const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
};

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&apos;/g, (entity) => HTML_ENTITIES[entity])
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function toVideoResult(videoId: string | undefined, snippet: RawSnippet | undefined): VideoResult | null {
  if (!videoId) return null;
  const thumbnails = snippet?.thumbnails ?? {};
  return {
    videoId,
    title: decodeHtmlEntities(snippet?.title ?? ""),
    channelTitle: decodeHtmlEntities(snippet?.channelTitle ?? ""),
    thumbnailUrl: thumbnails.medium?.url ?? thumbnails.default?.url ?? thumbnails.high?.url ?? "",
  };
}

async function fetchVideoList(url: URL, label: string): Promise<VideoResult[]> {
  try {
    const res = await fetch(url.toString());
    if (!res.ok) {
      console.error(`YouTube ${label} failed:`, res.status, await res.text());
      return [];
    }
    const data: unknown = await res.json();
    const items = (data as { items?: unknown[] })?.items;
    if (!Array.isArray(items)) return [];
    return items
      .map((raw) => {
        const item = raw as RawItem;
        const videoId = typeof item.id === "string" ? item.id : item.id?.videoId;
        return toVideoResult(videoId, item.snippet);
      })
      .filter((result): result is VideoResult => result !== null);
  } catch (err) {
    console.error(`YouTube ${label} failed:`, err);
    return [];
  }
}

/**
 * Searches public YouTube videos matching `query`. Returns [] on any failure
 * (missing key, quota exceeded, network error) so the video picker degrades
 * to "no results" — the paste-a-link fallback still works either way.
 */
export async function searchYouTubeVideos(query: string): Promise<VideoResult[]> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return [];

  const url = new URL(SEARCH_URL);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("type", "video");
  // 50 is YouTube's own hard cap per call, not an arbitrary choice here.
  url.searchParams.set("maxResults", "50");
  url.searchParams.set("q", query);
  url.searchParams.set("key", apiKey);

  return fetchVideoList(url, "search");
}

/**
 * Currently-popular videos (same list for everyone — not personalized, since
 * that would require each person to sign into a Google account through this
 * app), optionally scoped to one category (see VIDEO_CATEGORIES). Costs only
 * 1 quota unit per call (vs. 100 for a search), so it's fine to fetch this —
 * even several of these for different categories — on every visit.
 */
export async function getTrendingVideos(categoryId?: string): Promise<VideoResult[]> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return [];

  const url = new URL(VIDEOS_URL);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("chart", "mostPopular");
  url.searchParams.set("regionCode", "US");
  url.searchParams.set("maxResults", "24");
  url.searchParams.set("key", apiKey);
  if (categoryId) url.searchParams.set("videoCategoryId", categoryId);

  return fetchVideoList(url, "trending");
}

type SubscriptionItem = { snippet?: { resourceId?: { channelId?: string } } };
type ChannelItem = { contentDetails?: { relatedPlaylists?: { uploads?: string } } };
type PlaylistItem = {
  snippet?: RawSnippet & { resourceId?: { videoId?: string }; publishedAt?: string };
};

async function fetchAuthedJson<T>(url: string, accessToken: string): Promise<T | null> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    console.error("YouTube authed request failed:", url, res.status, await res.text());
    return null;
  }
  return res.json();
}

/**
 * Recent uploads from channels the signed-in user is subscribed to — the
 * closest thing to "personalized" that YouTube's public API exposes. There is
 * no API for YouTube's actual recommended-for-you home feed at any auth
 * level; this is a deliberately different, simpler feature (see CLAUDE.md
 * discussion / project memory).
 *
 * Three cheap calls instead of one expensive one: subscriptions.list (1 unit)
 * -> channels.list for all channel IDs in a single batched call (1 unit) ->
 * playlistItems.list per channel's uploads playlist (1 unit each, up to 15
 * channels). All well under quota even fetched on every visit.
 */
export async function getSubscriptionFeed(accessToken: string): Promise<VideoResult[]> {
  const subsUrl = new URL("https://www.googleapis.com/youtube/v3/subscriptions");
  subsUrl.searchParams.set("part", "snippet");
  subsUrl.searchParams.set("mine", "true");
  subsUrl.searchParams.set("maxResults", "25");
  const subsData = await fetchAuthedJson<{ items?: SubscriptionItem[] }>(subsUrl.toString(), accessToken);
  const channelIds = (subsData?.items ?? [])
    .map((item) => item.snippet?.resourceId?.channelId)
    .filter((id): id is string => !!id);
  if (channelIds.length === 0) return [];

  const channelsUrl = new URL("https://www.googleapis.com/youtube/v3/channels");
  channelsUrl.searchParams.set("part", "contentDetails");
  channelsUrl.searchParams.set("id", channelIds.join(","));
  const channelsData = await fetchAuthedJson<{ items?: ChannelItem[] }>(channelsUrl.toString(), accessToken);
  const uploadsPlaylistIds = (channelsData?.items ?? [])
    .map((item) => item.contentDetails?.relatedPlaylists?.uploads)
    .filter((id): id is string => !!id)
    .slice(0, 15);

  const perChannel = await Promise.all(
    uploadsPlaylistIds.map(async (playlistId) => {
      const url = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
      url.searchParams.set("part", "snippet");
      url.searchParams.set("playlistId", playlistId);
      url.searchParams.set("maxResults", "3");
      const data = await fetchAuthedJson<{ items?: PlaylistItem[] }>(url.toString(), accessToken);
      return (data?.items ?? []).map((item) => ({
        videoId: item.snippet?.resourceId?.videoId,
        snippet: item.snippet,
        publishedAt: item.snippet?.publishedAt ?? "",
      }));
    })
  );

  return perChannel
    .flat()
    .filter((item) => item.videoId)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, 30)
    .map((item) => toVideoResult(item.videoId, item.snippet))
    .filter((result): result is VideoResult => result !== null);
}
