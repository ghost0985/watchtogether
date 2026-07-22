"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Send } from "lucide-react";
import type { FeedItem } from "@/lib/types";
import LanguagePicker from "./LanguagePicker";

type Props = {
  feed: FeedItem[];
  myUserId: string;
  myLanguage: string;
  onLanguageChange: (code: string) => void;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onSend: (text: string) => void;
};

/** The scrollable message list — shared between the normal chat sheet/sidebar
 * and the fullscreen chat overlay (see Room.tsx), since fullscreen hides
 * everything outside the video container, so that overlay needs its own
 * copy of this UI rather than reusing this same component instance. */
export function ChatMessageList({
  feed,
  myUserId,
  myLanguage,
}: {
  feed: FeedItem[];
  myUserId: string;
  myLanguage: string;
}) {
  const [showOriginalIds, setShowOriginalIds] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [feed.length]);

  const toggleShowOriginal = (id: string) => {
    setShowOriginalIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div ref={listRef} className="flex-1 overflow-y-auto px-4 pb-2">
      {feed.length === 0 ? (
        <p className="pt-6 text-center text-sm text-text-dim">Say something to start the conversation.</p>
      ) : (
        <ul className="flex flex-col gap-2 py-2">
          {feed.map((item) => {
            if (item.kind === "system") {
              return (
                <li key={item.id} className="py-1 text-center text-xs text-text-dim">
                  {item.text}
                </li>
              );
            }

            const isMine = item.userId === myUserId;
            const translation = !isMine ? item.translations?.[myLanguage] : undefined;
            const showingOriginal = showOriginalIds.has(item.id);
            const displayText = translation && !showingOriginal ? translation : item.text;

            return (
              <li
                key={item.id}
                className={`flex max-w-[80%] flex-col gap-0.5 rounded-2xl bg-surface-2 px-3.5 py-2 ${
                  isMine ? "ml-auto items-end" : "items-start"
                }`}
              >
                {!isMine && <span className="text-xs font-medium text-text-dim">{item.name}</span>}
                <span className="text-[15px] leading-relaxed text-text">{displayText}</span>
                {translation && (
                  <button
                    onClick={() => toggleShowOriginal(item.id)}
                    className="text-xs text-text-dim underline decoration-dotted underline-offset-2"
                  >
                    {showingOriginal ? "Show translation" : "Show original"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** The message composer — same reuse reason as ChatMessageList above. */
export function ChatComposer({ onSend }: { onSend: (text: string) => void }) {
  const [text, setText] = useState("");

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText("");
  };

  return (
    <form onSubmit={handleSend} className="flex shrink-0 items-center gap-2 border-t border-white/6 p-3">
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Message"
        maxLength={500}
        className="min-w-0 flex-1 rounded-full border border-white/6 bg-surface-2 px-4 py-2.5 text-base text-text placeholder:text-text-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      />
      <button
        type="submit"
        disabled={!text.trim()}
        aria-label="Send"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-2 text-text transition duration-150 ease-out active:opacity-80 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      >
        <Send className="h-4 w-4" />
      </button>
    </form>
  );
}

export default function ChatSheet({
  feed,
  myUserId,
  myLanguage,
  onLanguageChange,
  expanded,
  onExpandedChange,
  onSend,
}: Props) {
  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-md flex-col overflow-hidden rounded-t-2xl border-t border-white/6 bg-surface transition-[height] duration-300 ease-out lg:sticky lg:top-4 lg:inset-x-auto lg:bottom-auto lg:z-auto lg:h-[calc(100vh-2rem)] lg:w-96 lg:max-w-none lg:shrink-0 lg:overflow-visible lg:rounded-2xl lg:border ${
        expanded ? "h-[82vh]" : "h-0"
      } lg:!h-[calc(100vh-2rem)]`}
    >
      <div className="relative flex h-11 w-full shrink-0 items-center justify-center border-b border-white/6 px-4 lg:justify-start">
        <span className="text-sm font-semibold text-text">Chat</span>
        {/* Mobile-only: tap to go back to the video (Watch tab). Desktop's
            sidebar has no such toggle — it's always showing. */}
        <button
          onClick={() => onExpandedChange(false)}
          aria-label="Back to video"
          title="Back to video"
          className="absolute left-3 flex h-8 w-8 items-center justify-center rounded-full text-text-dim lg:hidden"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
        <div className="absolute right-3">
          <LanguagePicker value={myLanguage} onChange={onLanguageChange} />
        </div>
      </div>

      <ChatMessageList feed={feed} myUserId={myUserId} myLanguage={myLanguage} />
      <ChatComposer onSend={onSend} />
    </div>
  );
}
