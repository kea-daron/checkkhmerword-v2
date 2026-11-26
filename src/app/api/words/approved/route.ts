import { NextResponse, connection } from "next/server";
import { getStore } from "@/lib/dict/store";
import { getApprovedWords } from "@/lib/words/approved";

export type ApprovedWordsResponse = {
  ok: true;
  /** Approved words that are not already in the base dictionary. */
  words: string[];
  count: number;
  /** Entries in the base (Chuon Nath) dictionary. */
  baseCount: number;
  /** Base entries plus approved words: what the spell checker accepts. */
  total: number;
};

/** Approved words from Neon (`kh_dictionary_new_word`) that the spell checker accepts. */
export async function GET() {
  // Always answer from the live list, never from a prerendered response.
  await connection();
  const { words } = await getApprovedWords();
  const baseCount = getStore().meta.entries;
  const body: ApprovedWordsResponse = { ok: true, words, count: words.length, baseCount, total: baseCount + words.length };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
