"use client";

import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import type { FeedItem } from "@/lib/types";

type Props = {
  feed: FeedItem[];
  myUserId: string;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onSend: (text: string) => void;
};

// Sheet peeks at ~30% by default and drags up to ~86% (leaving room for the
// pinned mini video bar + header up top). See CLAUDE.md's design system.
const PEEK_VH = 0.32;
const FULL_VH = 0.82;

export default function ChatSheet({ feed, myUserId, expanded, onExpandedChange, onSend }: Props) {
  const [text, setText] = useState("");
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const dragRef = useRef<{ startY: number; startHeight: number; moved: boolean } | null>(null);
  const justDraggedRef = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the newest message.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [feed.length]);

  const bounds = () => ({
    min: window.innerHeight * PEEK_VH,
    max: window.innerHeight * FULL_VH,
  });

  const handlePointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    const { min, max } = bounds();
    dragRef.current = { startY: e.clientY, startHeight: expanded ? max : min, moved: false };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const delta = drag.startY - e.clientY; // dragging up = taller
    if (Math.abs(delta) > 4) drag.moved = true;
    const { min, max } = bounds();
    setDragHeight(Math.min(max, Math.max(min, drag.startHeight + delta)));
  };

  const handlePointerUp = () => {
    const drag = dragRef.current;
    if (drag?.moved && dragHeight !== null) {
      const { min, max } = bounds();
      onExpandedChange(dragHeight > (min + max) / 2);
      justDraggedRef.current = true;
    }
    dragRef.current = null;
    setDragHeight(null);
  };

  const handleHandleClick = () => {
    if (justDraggedRef.current) {
      justDraggedRef.current = false;
      return;
    }
    onExpandedChange(!expanded);
  };

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText("");
  };

  const isDragging = dragHeight !== null;

  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-30 flex flex-col rounded-t-2xl border-t border-white/6 bg-surface ${
        isDragging ? "" : `transition-[height] duration-300 ease-out ${expanded ? "h-[82vh]" : "h-[32vh]"}`
      }`}
      style={isDragging ? { height: dragHeight } : undefined}
    >
      <button
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onClick={handleHandleClick}
        aria-label={expanded ? "Collapse chat" : "Expand chat"}
        className="flex h-6 w-full shrink-0 touch-none select-none items-center justify-center"
      >
        <span className="h-1 w-10 rounded-full bg-white/15" />
      </button>

      <div ref={listRef} className="flex-1 overflow-y-auto px-4 pb-2">
        {feed.length === 0 ? (
          <p className="pt-6 text-center text-sm text-text-dim">
            Say something to start the conversation.
          </p>
        ) : (
          <ul className="flex flex-col gap-2 py-2">
            {feed.map((item) =>
              item.kind === "system" ? (
                <li key={item.id} className="py-1 text-center text-xs text-text-dim">
                  {item.text}
                </li>
              ) : (
                <li
                  key={item.id}
                  className={`flex max-w-[80%] flex-col gap-0.5 rounded-2xl bg-surface-2 px-3.5 py-2 ${
                    item.userId === myUserId ? "ml-auto items-end" : "items-start"
                  }`}
                >
                  {item.userId !== myUserId && (
                    <span className="text-xs font-medium text-text-dim">{item.name}</span>
                  )}
                  <span className="text-[15px] leading-relaxed text-text">{item.text}</span>
                </li>
              )
            )}
          </ul>
        )}
      </div>

      <form onSubmit={handleSend} className="flex shrink-0 items-center gap-2 border-t border-white/6 p-3">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Message"
          maxLength={500}
          onFocus={() => !expanded && onExpandedChange(true)}
          className="min-w-0 flex-1 rounded-full border border-white/6 bg-surface-2 px-4 py-2.5 text-[15px] text-text placeholder:text-text-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
    </div>
  );
}
