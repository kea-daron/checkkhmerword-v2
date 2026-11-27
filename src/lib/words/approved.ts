import "server-only";
import { neon } from "@neondatabase/serverless";
import { getStore } from "@/lib/dict/store";
import { normalizeKey } from "@/lib/khmer/normalize";

/**
 * Words an admin approved (Neon table `kh_dictionary_new_word`), which the
 * spell checker looks a word up in first, before the Chuon Nath headwords.
 */
export type ApprovedWords = {
  /** Approved words as stored, minus those the base dictionary already has. */
  words: string[];
  /** Normalized lookup keys (see `normalizeKey`) of every approved word, including those the base dictionary also has. */
  keys: ReadonlySet<string>;
  /** The same keys, each with the word as stored, which is how the checker spells it in a suggestion. */
  byKey: ReadonlyMap<string, string>;
};

/** How long one server instance reuses the list before asking Neon again. */
const TTL_MS = 30_000;
const EMPTY: ApprovedWords = { words: [], keys: new Set(), byKey: new Map() };

let cache: { at: number; value: ApprovedWords } | null = null;
let pending: Promise<ApprovedWords> | null = null;

async function load(): Promise<ApprovedWords> {
  const url = process.env.DATABASE_URL;
  if (!url) return EMPTY;
  const rows = (await neon(url)`SELECT word FROM kh_dictionary_new_word ORDER BY word`) as { word: string }[];
  const base = getStore().byKey;
  const keys = new Set<string>();
  const byKey = new Map<string, string>();
  const words: string[] = [];
  for (const { word } of rows) {
    const key = normalizeKey(word ?? "");
    if (!key || keys.has(key)) continue;
    // Every approved word is a key, so the checker finds it here before it asks the base dictionary.
    keys.add(key);
    byKey.set(key, word.trim().normalize("NFC"));
    if (!base.has(key)) words.push(word.trim());
  }
  return { words, keys, byKey };
}

/**
 * The approved words, cached briefly. Never throws: when the database cannot
 * be reached the last known list (or an empty one) is used, so the checker
 * keeps working with the base dictionary.
 */
export function getApprovedWords(): Promise<ApprovedWords> {
  if (cache && Date.now() - cache.at < TTL_MS) return Promise.resolve(cache.value);
  return (pending ??= load()
    .catch((err) => {
      console.error("[approved words] could not load from Neon:", err);
      return cache?.value ?? EMPTY;
    })
    .then((value) => {
      cache = { at: Date.now(), value };
      pending = null;
      return value;
    }));
}

/** Forget the cached list, after a word is approved or removed. */
export function invalidateApprovedWords(): void {
  cache = null;
}
