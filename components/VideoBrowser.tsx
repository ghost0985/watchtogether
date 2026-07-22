"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { VIDEO_CATEGORIES } from "@/lib/videoCategories";
import type { VideoResult } from "@/lib/youtubeSearch";

type Props = {
  onSelect: (videoId: string) => void;
};

function VideoCard({ video, onSelect }: { video: VideoResult; onSelect: (videoId: string) => void }) {
  return (
    <button
      onClick={() => onSelect(video.videoId)}
      className="flex w-full flex-col gap-2 rounded-xl text-left transition duration-150 ease-out active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
    >
      {video.thumbnailUrl ? (
        // Plain <img>, not next/image: one-off external thumbnails from
        // YouTube's CDN, not worth a remotePatterns config entry.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={video.thumbnailUrl} alt="" className="aspect-video w-full rounded-xl object-cover" />
      ) : (
        <div className="aspect-video w-full rounded-xl bg-surface" />
      )}
      <div className="min-w-0">
        <p className="truncate text-sm text-text">{video.title}</p>
        <p className="truncate text-xs text-text-dim">{video.channelTitle}</p>
      </div>
    </button>
  );
}

function VideoGrid({ videos, onSelect }: { videos: VideoResult[]; onSelect: (videoId: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {videos.map((video) => (
        <VideoCard key={video.videoId} video={video} onSelect={onSelect} />
      ))}
    </div>
  );
}

type RowState = { videos: VideoResult[]; status: "loading" | "idle" | "error" };
const ROW_LOADING: RowState = { videos: [], status: "loading" };

/** One tab's worth of content: a loading spinner, an error message, or the grid. */
function CategorySection({
  state,
  errorText,
  onSelect,
}: {
  state: RowState;
  errorText: string;
  onSelect: (videoId: string) => void;
}) {
  if (state.status === "error") {
    return <p className="text-xs text-text-dim">{errorText}</p>;
  }
  if (state.status === "loading") {
    return (
      <div className="flex h-24 items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-text-dim" />
      </div>
    );
  }
  return <VideoGrid videos={state.videos} onSelect={onSelect} />;
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-full px-4 py-2 text-xs font-medium transition duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        active ? "bg-accent text-white" : "bg-surface-2 text-text-dim active:opacity-70"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Search is explicit-submit only (no search-as-you-type): the YouTube Data
 * API's free quota is small (~100 searches/day total), so every keystroke
 * hitting the API would burn through it in minutes. A per-session cache
 * avoids re-spending quota on a query someone already ran. Everything else
 * here (trending, per-category trending, subscriptions) uses cheap 1-unit
 * calls, so it's fetched freely, organized into tabs so only one section's
 * videos show at a time instead of every category stacked on the page at
 * once.
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
  const [googleAuthError, setGoogleAuthError] = useState(false);

  const [activeTab, setActiveTab] = useState<string>("trending");

  // /api/auth/google redirects back with this flag instead of crashing when
  // sign-in isn't configured (missing GOOGLE_CLIENT_ID/SECRET) -- surface it
  // once, then strip it so it doesn't linger across refreshes/back-nav.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("googleAuthError") !== "1") return;
    // Reading window.location is a genuine external-system sync (only safe
    // post-mount), not state derivable during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGoogleAuthError(true);
    url.searchParams.delete("googleAuthError");
    window.history.replaceState(null, "", url.toString());
  }, []);

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
    // The Subscriptions tab disappears once signed out -- if it was active,
    // switch away so we don't leave the picker on a tab that no longer
    // exists (it would otherwise sit on a permanent loading spinner, since
    // subscriptions never re-fetch after sign-out).
    setActiveTab((prev) => (prev === "subscriptions" ? "trending" : prev));
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
          className="min-w-0 flex-1 rounded-2xl border border-white/6 bg-surface-2 px-4 py-3 text-base text-text placeholder:text-text-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
          <div className="flex flex-col items-end gap-1">
            <button
              type="button"
              onClick={signedIn ? signOut : signIn}
              className="text-xs text-text-dim underline-offset-2 hover:underline"
            >
              {signedIn ? "Sign out" : "Sign in with Google"}
            </button>
            {googleAuthError && (
              <p className="text-xs text-text-dim">Google sign-in isn’t set up here yet — try trending or search instead.</p>
            )}
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1">
            {signedIn && (
              <TabButton active={activeTab === "subscriptions"} onClick={() => setActiveTab("subscriptions")}>
                Subscriptions
              </TabButton>
            )}
            <TabButton active={activeTab === "trending"} onClick={() => setActiveTab("trending")}>
              Trending now
            </TabButton>
            {VIDEO_CATEGORIES.map((category) => (
              <TabButton key={category.id} active={activeTab === category.id} onClick={() => setActiveTab(category.id)}>
                {category.label}
              </TabButton>
            ))}
          </div>

          {activeTab === "subscriptions" && (
            <CategorySection
              state={subscriptions}
              errorText="Couldn’t load your subscriptions — try trending or search instead."
              onSelect={onSelect}
            />
          )}
          {activeTab === "trending" && (
            <CategorySection
              state={trending}
              errorText="Couldn’t load trending videos right now — try searching instead."
              onSelect={onSelect}
            />
          )}
          {VIDEO_CATEGORIES.map(
            (category) =>
              activeTab === category.id && (
                <CategorySection
                  key={category.id}
                  state={categoryRows[category.id] ?? ROW_LOADING}
                  errorText={`Couldn’t load ${category.label} videos right now.`}
                  onSelect={onSelect}
                />
              )
          )}
        </>
      )}
    </div>
  );
}
