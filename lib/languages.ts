// Curated language list for the per-user translation setting. Not exhaustive —
// just a useful global spread. ISO 639-1 codes.

export type Language = { code: string; label: string };

export const LANGUAGES: Language[] = [
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "pt", label: "Portuguese" },
  { code: "it", label: "Italian" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "zh", label: "Chinese (Simplified)" },
  { code: "ar", label: "Arabic" },
  { code: "hi", label: "Hindi" },
  { code: "ru", label: "Russian" },
  { code: "vi", label: "Vietnamese" },
  { code: "tl", label: "Tagalog" },
  { code: "pl", label: "Polish" },
];

const BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l]));

export function languageLabel(code: string): string {
  return BY_CODE.get(code)?.label ?? code.toUpperCase();
}
