import { NextResponse } from "next/server";
import { readBody } from "@/app/api/words/body";
import { HttpError, db, respond } from "@/lib/admin/server";
import { MAX_WORD_LENGTH } from "@/lib/admin/types";
import { checkText } from "@/lib/dict/check";
import { getApprovedWords } from "@/lib/words/approved";
import { cleanWord } from "@/lib/words/redline";

const MAX_TEXT = 5000;

/**
 * Queue the red-underlined words of a submitted text for review: `{ text }`.
 *
 * Called by the editor's "បញ្ជូនទៅពិនិត្យ" button. The words are worked out
 * here, from a check of the whole text, so they are exactly the ones the editor
 * underlines (a verdict depends on a word's neighbours) and a caller cannot
 * queue anything else. They are written straight to `kh_verify_word`; words
 * already queued or already approved are skipped.
 */
export function POST(req: Request) {
  return respond(async () => {
    const { text } = await readBody(req);
    if (typeof text !== "string" || !text.trim()) throw new HttpError(400, 'Body must include a non-empty "text" string.');
    if (text.length > MAX_TEXT) throw new HttpError(413, `Text too long (max ${MAX_TEXT} characters).`);

    const { byKey } = await getApprovedWords();
    const words = [
      ...new Set(
        checkText(text, byKey)
          .tokens.filter((t) => t.kind === "word" && t.status === "unknown")
          .map((t) => cleanWord(t.text))
          .filter((w) => w && w.length <= MAX_WORD_LENGTH),
      ),
    ];
    if (words.length === 0) return NextResponse.json({ ok: true, words, queued: [] });

    const rows = await db()`
      INSERT INTO kh_verify_word (word, status)
      SELECT w, 'pending' FROM unnest(${words}::text[]) AS w
      WHERE NOT EXISTS (SELECT 1 FROM kh_dictionary_new_word d WHERE d.word = w)
      ON CONFLICT (word) DO NOTHING
      RETURNING word
    `;
    return NextResponse.json({ ok: true, words, queued: rows.map((r) => r.word as string) });
  });
}
