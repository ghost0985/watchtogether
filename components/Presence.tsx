import type { Participant } from "@/lib/types";
import { initials } from "@/lib/room";

type Props = {
  participants: Participant[];
  /** True when the room is playing and everyone's connected — "in sync". */
  synced: boolean;
};

/**
 * The signature element: a thin accent ring around each presence avatar that
 * pulses softly in unison when playback is synced, and sits dim and still
 * when someone's disconnected. Only counts participants who've named
 * themselves (silent sockets kept open just for pre-name video sync don't
 * show up here).
 */
export default function Presence({ participants, synced }: Props) {
  const named = participants.filter((p) => p.name);
  if (named.length === 0) return null;

  return (
    <div className="flex items-center -space-x-2">
      {named.map((p) => (
        <span
          key={p.userId}
          title={p.connected ? p.name : `${p.name} (disconnected)`}
          className={`flex h-7 w-7 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-text ring-2 ${
            p.connected && synced
              ? "ring-accent motion-safe:animate-pulse"
              : p.connected
                ? "ring-accent/40"
                : "ring-white/10 opacity-50"
          }`}
        >
          {initials(p.name)}
        </span>
      ))}
    </div>
  );
}
