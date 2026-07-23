"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Play, Ticket } from "lucide-react";
import { generateRoomCode, getRecentRooms, normalizeRoomCode, timeAgo, type RecentRoom } from "@/lib/room";

export default function Home() {
  const router = useRouter();
  const [showJoin, setShowJoin] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  // Starts empty (server has no localStorage to read) and fills in after
  // mount, same hydration-safe pattern as Room.tsx's cached name/language.
  const [recentRooms, setRecentRooms] = useState<RecentRoom[]>([]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRecentRooms(getRecentRooms());
  }, []);

  const createRoom = () => {
    router.push(`/room/${generateRoomCode()}`);
  };

  const joinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    const code = normalizeRoomCode(joinCode);
    if (code.length === 6) router.push(`/room/${code}`);
  };

  const canJoin = normalizeRoomCode(joinCode).length === 6;

  return (
    <main className="flex flex-1 flex-col">
      <div className="px-6 pt-8">
        <span className="text-sm font-semibold tracking-tight text-text-dim">
          WatchTogether
        </span>
      </div>

      {/* Quiet middle — sets the mood, no hero block */}
      <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
        <p className="max-w-[260px] text-[15px] leading-relaxed text-text-dim">
          A private room for two. Paste a video, hit play, watch it together.
        </p>
      </div>

      {/* Primary action, kept in the bottom half for one-handed reach */}
      <div className="flex flex-col gap-3 px-6 pb-10">
        <button
          onClick={createRoom}
          className="flex h-14 w-full items-center justify-center gap-2 rounded-full bg-accent text-base font-semibold text-white transition duration-150 ease-out active:scale-[0.98] active:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          <Play className="h-5 w-5" fill="currentColor" strokeWidth={0} />
          Start watching
        </button>

        {!showJoin ? (
          <button
            onClick={() => setShowJoin(true)}
            className="flex h-11 items-center justify-center gap-1.5 rounded-full text-sm font-medium text-text-dim transition duration-150 ease-out active:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Ticket className="h-4 w-4" />
            Have a room code?
          </button>
        ) : (
          <form onSubmit={joinRoom} className="flex gap-2">
            <input
              type="text"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="Enter code"
              autoFocus
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              maxLength={6}
              className="min-w-0 flex-1 rounded-2xl border border-white/6 bg-surface px-4 py-3.5 text-center font-mono text-lg tracking-[0.3em] text-text placeholder:font-sans placeholder:text-sm placeholder:tracking-normal placeholder:text-text-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
            <button
              type="submit"
              disabled={!canJoin}
              className="shrink-0 rounded-2xl bg-surface-2 px-5 text-sm font-semibold text-text transition duration-150 ease-out active:bg-surface disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Join
            </button>
          </form>
        )}

        {recentRooms.length > 0 && (
          <div className="flex flex-col gap-2 pt-1">
            <span className="text-xs font-medium text-text-dim">Jump back in</span>
            <div className="flex flex-wrap gap-2">
              {recentRooms.map((room) => (
                <button
                  key={room.code}
                  onClick={() => router.push(`/room/${room.code}`)}
                  className="flex items-center gap-2 rounded-full border border-white/6 bg-surface px-4 py-2.5 transition duration-150 ease-out active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <span className="font-mono text-sm tracking-[0.15em] text-text">{room.code}</span>
                  <span className="text-xs text-text-dim">{timeAgo(room.lastVisited)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
