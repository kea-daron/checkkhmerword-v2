import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { getStore } from "@/lib/dict/store";
import { cleanWord, isRedLine } from "@/lib/words/redline";

/**
 * Called by the n8n review workflow for every word it segments out of a
 * submitted text. `exists` is true unless the editor would underline the word
 * in red, so only red-line words reach `kh_verify_word`.
 */
export async function POST(req: Request) {
  try {
    const { word } = await req.json();
    const clean = cleanWord(word);
    if (!clean) {
      return NextResponse.json({ exists: false, word: "" });
    }

    const dictSize = getStore().entries.length;

    // First the approved words (`kh_dictionary_new_word`), asked directly: the cached list can be a few seconds old.
    const sql = neon(process.env.DATABASE_URL!);
    const rows = await sql`
      SELECT 1 FROM kh_dictionary_new_word WHERE word = ${clean} LIMIT 1
    `;
    if (rows.length > 0) {
      return NextResponse.json({ exists: true, word: clean, dictSize, source: "new_dictionary" });
    }

    // Then the base dictionary (khmer-dictionary.sqlite), the way the editor checks it.
    const known = !(await isRedLine(clean));
    return NextResponse.json({ exists: known, word: clean, dictSize, source: known ? "dictionary" : "unknown" });
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : "Check failed";
    return NextResponse.json({ exists: false, error: message }, { status: 500 });
  }
}
