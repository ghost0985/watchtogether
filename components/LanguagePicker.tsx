"use client";

import { useState } from "react";
import { Check, Globe } from "lucide-react";
import { LANGUAGES } from "@/lib/languages";

type Props = {
  value: string;
  onChange: (code: string) => void;
};

/** Small button + bottom-sheet picker for the per-user chat translation language. */
export default function LanguagePicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Change chat language"
        title="Show chat translated into…"
        className="flex h-8 items-center gap-1 rounded-full bg-surface-2 px-2.5 text-xs font-medium text-text-dim transition duration-150 ease-out active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Globe className="h-3.5 w-3.5" />
        {value.toUpperCase()}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-bg/70 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-h-[70vh] w-full max-w-sm overflow-y-auto rounded-t-2xl border-t border-white/6 bg-surface p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
          >
            <p className="px-3 py-3 text-xs font-medium text-text-dim">
              Show chat translated into
            </p>
            <ul className="flex flex-col gap-0.5">
              {LANGUAGES.map((lang) => (
                <li key={lang.code}>
                  <button
                    onClick={() => {
                      onChange(lang.code);
                      setOpen(false);
                    }}
                    className="flex w-full items-center justify-between rounded-xl px-3 py-3 text-left text-[15px] text-text transition duration-150 ease-out active:bg-surface-2"
                  >
                    {lang.label}
                    {lang.code === value && <Check className="h-4 w-4 text-accent" />}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
