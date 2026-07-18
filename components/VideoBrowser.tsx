"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { VIDEO_CATEGORIES } from "@/lib/videoCategories";
import type { VideoResult } from "@/lib/youtubeSearch";

type Props = {
  onSelect: (videoId: string) => void;
};

function VideoCard({
  video,
  onSelect,
  fixedWidth,
}: {
  video: VideoResult;
  onSelect: (videoId: string) => void;
  /** Rows scroll horizontally (needs a fixed card width); the search grid
   * wraps instead, so its cards should fill their grid cell. */
  fixedWidth: boolean;
}) {
  return (
    <button
      onClick={() => onSelect(video.videoId)}
      className={`flex shrink-0 flex-col gap-2 rounded-2xl border border-white/6 bg-surface-2 p-2 text-left transition duration-150 ease-out active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        fixedWidth ? "w-40" : "w-full"
      }`}
    >
      {video.thumbnailUrl ? (
        // Plain <img>, not next/image: one-off external thumbnails from
        // YouTube's CDN, not worth a remotePatterns config entry.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={video.thumbnailUrl} alt="" className="aspect-video w-full rounded-lg object-cover" />
      ) : (
        <div className="aspect-video w-full rounded-lg bg-surface" />
      )}
      <div className="min-w-0 px-1 pb-1">
        <p className="line-clamp-2 text-sm text-text">{video.title}</p>
        <p className="truncate text-xs text-text-dim">{video.channelTitle}</p>
      </div>
    </button>
  );
}

/** Full-width wrapping grid — used for search results, where filling the space matters more than a compact row. */
function VideoGrid({ videos, onSelect }: { videos: VideoResult[]; onSelect: (videoId: string) => void }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {videos.map((video) => (
        <VideoCard key={video.videoId} video={video} onSelect={onSelect} fixedWidth={false} />
      ))}
    </div>
  );
}

/** Horizontally-scrolling row — used for the browse rows (Subscriptions/Trending/categories), YouTube-homepage style. */
function VideoRow({
  label,
  videos,
  status,
  errorText,
  onSelect,
}: {
  label: string;
  videos: VideoResult[];
  status: "loading" | "idle" | "error";
  errorText: string;
  onSelect: (videoId: string) => void;
}) {
  if (status === "idle" && videos.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-text-dim">{label}</p>
      {status === "error" ? (
        <p className="text-xs text-text-dim">{errorText}</p>
      ) : status === "loading" ? (
        <div className="flex h-24 items-center">
          <Loader2 className="h-4 w-4 animate-spin text-text-dim" />
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-1">
          {videos.map((video) => (
            <VideoCard key={video.videoId} video={video} onSelect={onSelect} fixedWidth />
          ))}
        </div>
      )}
    </div>
  );
}

type RowState = { videos: VideoResult[]; status: "loading" | "idle" | "error" };
const ROW_LOADING: RowState = { videos: [], status: "loading" };

/**
 * Search is explicit-submit only (no search-as-you-type): the YouTube Data
 * API's free quota is small (~100 searches/day total), so every keystroke
 * hitting the API would burn through it in minutes. A per-session cache
 * avoids re-spending quota on a query someone already ran. Everything else
 * here (trending, per-category trending, subscriptions) uses cheap 1-unit
 * calls, so it's fetched freely and shown as rows, YouTube-homepage style.
 */
export default function VideoBrowser({ onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<VideoResult[] | null>(null);
  const [searchStatus, setSearchStatus] = useState<"idle" | "loading" | "error">("idle");
  const cacheRef = useRef<Map<string, VideoResult[]>>(new Map());

  const [trending, setTrending] = useState<RowState>(ROW_LOADING);
  const [categoryRows, setCategoryRows] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(VIDEO_CATEGORIES.map((c) => [c.id, ROW_LOADING]))
  );

  const [signedIn, setSignedIn] = useState(false);
  const [subscriptions, setSubscriptions] = useState<RowState>(ROW_LOADING);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/trending-youtube")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const found: VideoResult[] = Array.isArray(data?.results) ? data.results : [];
        setTrending({ videos: found, status: found.length > 0 ? "idle" : "error" });
      })
      .catch(() => {
        if (!cancelled) setTrending({ videos: [], status: "error" });
      });

    for (const category of VIDEO_CATEGORIES) {
      fetch(`/api/trending-youtube?category=${category.id}`)
        .then((res) => res.json())
        .then((data) => {
          if (cancelled) return;
          const found: VideoResult[] = Array.isArray(data?.results) ? data.results : [];
          setCategoryRows((prev) => ({
            ...prev,
            [category.id]: { videos: found, status: found.length > 0 ? "idle" : "error" },
          }));
        })
        .catch(() => {
          if (!cancelled) {
            setCategoryRows((prev) => ({ ...prev, [category.id]: { videos: [], status: "error" } }));
          }
        });
    }

    fetch("/api/auth/google/status")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const isSignedIn = !!data?.signedIn;
        setSignedIn(isSignedIn);
        if (!isSignedIn) return;
        fetch("/api/youtube/subscriptions")
          .then((res) => res.json())
          .then((subsData) => {
            if (cancelled) return;
            const found: VideoResult[] = Array.isArray(subsData?.results) ? subsData.results : [];
            setSubscriptions({ videos: found, status: found.length > 0 ? "idle" : "error" });
          })
          .catch(() => {
            if (!cancelled) setSubscriptions({ videos: [], status: "error" });
          });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = () => {
    window.location.href = `/api/auth/google?returnTo=${encodeURIComponent(window.location.pathname)}`;
  };

  const signOut = async () => {
    await fetch("/api/auth/google/signout", { method: "POST" }).catch(() => {});
    setSignedIn(false);
    setSubscriptions(ROW_LOADING);
  };

  const runSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;

    const cached = cacheRef.current.get(q);
    if (cached) {
      setSearchResults(cached);
      setSearchStatus(cached.length > 0 ? "idle" : "error");
      return;
    }

    setSearchStatus("loading");
    try {
      const res = await fetch("/api/search-youtube", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      const data = await res.json();
      const found: VideoResult[] = Array.isArray(data?.results) ? data.results : [];
      cacheRef.current.set(q, found);
      setSearchResults(found);
      setSearchStatus(found.length > 0 ? "idle" : "error");
    } catch {
      setSearchResults([]);
      setSearchStatus("error");
    }
  };

  const clearSearch = () => {
    setQuery("");
    setSearchResults(null);
    setSearchStatus("idle");
  };

  const showingSearch = searchResults !== null;

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={runSearch} className="flex gap-2">
        <input
          type="text"
          inputMode="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for a video"
          className="min-w-0 flex-1 rounded-2xl border border-white/6 bg-surface-2 px-4 py-3 text-sm text-text placeholder:text-text-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        <button
          type="submit"
          disabled={searchStatus === "loading" || !query.trim()}
          aria-label="Search"
          title="Search"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-surface-2 text-text transition duration-150 ease-out active:opacity-80 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {searchStatus === "loading" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Search className="h-4 w-4" />
          )}
        </button>
      </form>

      {showingSearch ? (
        <>
          <div className="flex items-center justify-between">
            <p className="text-xs text-text-dim">Results for “{query}”</p>
            <button
              type="button"
              onClick={clearSearch}
              className="text-xs text-text-dim underline-offset-2 hover:underline"
            >
              Back to browse
            </button>
          </div>
          {searchStatus === "error" ? (
            <p className="text-xs text-text-dim">
              Couldn’t find anything for that — try different words, or paste a link instead.
            </p>
          ) : (
            <VideoGrid videos={searchResults} onSelect={onSelect} />
          )}
        </>
      ) : (
        <>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={signedIn ? signOut : signIn}
              className="text-xs text-text-dim underline-offset-2 hover:underline"
            >
              {signedIn ? "Sign out" : "Sign in with Google"}
            </button>
          </div>

          <div className="flex flex-col gap-5">
            {signedIn && (
              <VideoRow
                label="Subscriptions"
                videos={subscriptions.videos}
                status={subscriptions.status}
                errorText="Couldn’t load your subscriptions — try trending or search instead."
                onSelect={onSelect}
              />
            )}
            <VideoRow
              label="Trending now"
              videos={trending.videos}
              status={trending.status}
              errorText="Couldn’t load trending videos right now — try searching instead."
              onSelect={onSelect}
            />
            {VIDEO_CATEGORIES.map((category) => (
              <VideoRow
                key={category.id}
                label={category.label}
                videos={categoryRows[category.id]?.videos ?? []}
                status={categoryRows[category.id]?.status ?? "loading"}
                errorText={`Couldn’t load ${category.label} videos right now.`}
                onSelect={onSelect}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
