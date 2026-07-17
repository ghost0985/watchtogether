"use client";

import { useState } from "react";

type Props = {
  onSubmit: (name: string) => void;
};

/**
 * Blocking name picker shown once per browser, the first time someone joins
 * any room. Video sync keeps running underneath — this only gates chat/presence.
 */
export default function NamePrompt({ onSubmit }: Props) {
  const [name, setName] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed) onSubmit(trimmed);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/95 px-6 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-white/6 bg-surface p-6"
      >
        <div className="flex flex-col gap-1.5">
          <h2 className="text-lg font-semibold tracking-tight text-text">
            What should we call you?
          </h2>
          <p className="text-sm text-text-dim">
            Just for this watch party — no account needed.
          </p>
        </div>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          autoFocus
          maxLength={24}
          className="rounded-2xl border border-white/6 bg-surface-2 px-4 py-3.5 text-base text-text placeholder:text-text-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        <button
          type="submit"
          disabled={!name.trim()}
          className="flex h-12 w-full items-center justify-center rounded-full bg-accent text-base font-semibold text-white transition duration-150 ease-out active:opacity-90 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          Continue
        </button>
      </form>
    </div>
  );
}
