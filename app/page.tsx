"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { generateRoomCode, normalizeRoomCode } from "@/lib/room";

export default function Home() {
  const router = useRouter();
  const [joinCode, setJoinCode] = useState("");

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
    <main className="flex flex-1 flex-col items-center justify-center gap-10 bg-neutral-950 px-6 py-16 text-neutral-100">
      <div className="flex flex-col items-center gap-3 text-center">
        <h1 className="text-4xl font-bold tracking-tight">WatchTogether</h1>
        <p className="max-w-xs text-neutral-400">
          Watch YouTube in perfect sync with someone. Create a room, share the
          link, hit play.
        </p>
      </div>

      <div className="flex w-full max-w-sm flex-col gap-6">
        <button
          onClick={createRoom}
          className="w-full rounded-xl bg-indigo-500 px-5 py-3.5 text-base font-semibold text-white active:bg-indigo-600"
        >
          Create a room
        </button>

        <div className="flex items-center gap-3 text-xs text-neutral-500">
          <span className="h-px flex-1 bg-neutral-800" />
          or join
          <span className="h-px flex-1 bg-neutral-800" />
        </div>

        <form onSubmit={joinRoom} className="flex gap-2">
          <input
            type="text"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            placeholder="Enter code"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={6}
            className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 text-center font-mono text-lg tracking-widest text-neutral-100 placeholder:font-sans placeholder:text-base placeholder:tracking-normal placeholder:text-neutral-500 focus:border-indigo-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!canJoin}
            className="shrink-0 rounded-lg bg-neutral-800 px-5 py-3 text-sm font-semibold text-neutral-100 active:bg-neutral-700 disabled:opacity-40"
          >
            Join
          </button>
        </form>
      </div>
    </main>
  );
}
