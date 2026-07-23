"use client";

import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";

/**
 * Shown instead of the whole room when the server rejects us with a
 * "roomFull" message (see party/worker.ts's MAX_PARTICIPANTS) -- nothing
 * else in the room works at that point (no video, no chat), so this
 * replaces it entirely rather than trying to layer on top.
 */
export default function RoomFull() {
  const router = useRouter();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-2 text-text-dim">
        <Lock className="h-6 w-6" />
      </span>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-lg font-semibold tracking-tight text-text">
          This room already has two people in it
        </h1>
        <p className="max-w-[260px] text-[15px] leading-relaxed text-text-dim">
          WatchTogether rooms are just for two. Start your own to watch something.
        </p>
      </div>
      <button
        onClick={() => router.push("/")}
        className="flex h-12 items-center justify-center rounded-full bg-accent px-6 text-base font-semibold text-white transition duration-150 ease-out active:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        Back to start
      </button>
    </div>
  );
}
