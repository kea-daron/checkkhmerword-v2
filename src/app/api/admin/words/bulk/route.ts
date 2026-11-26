import { NextResponse } from "next/server";
import { readBody } from "@/app/api/words/body";
import { HttpError, db, respond, wordList } from "@/lib/admin/server";
import { MAX_BULK_WORDS, type BulkWordsResponse } from "@/lib/admin/types";
import { invalidateApprovedWords } from "@/lib/words/approved";

/**
 * Bulk review of the pending queue: `{ action: "approve" | "reject", words: [...] }`.
 *
 * Each action is a single SQL statement, so it is atomic: either every selected
 * word is processed or none is. Words that are no longer in `kh_verify_word`
 * (already handled in another tab) are skipped; `words` in the reply lists the
 * ones that were actually processed.
 */
export function POST(req: Request) {
  return respond(async () => {
    const body = await readBody(req);
    const action = body.action;
    if (action !== "approve" && action !== "reject") {
      throw new HttpError(400, '"action" must be "approve" or "reject".');
    }
    const words = wordList(body.words, MAX_BULK_WORDS);
    const sql = db();

    const rows =
      action === "approve"
        ? await sql`
            WITH picked AS (
              DELETE FROM kh_verify_word WHERE word = ANY(${words}::text[])
              RETURNING word
            ), ins AS (
              INSERT INTO kh_dictionary_new_word (word)
              SELECT word FROM picked
              ON CONFLICT (word) DO NOTHING
            )
            SELECT word FROM picked
          `
        : await sql`DELETE FROM kh_verify_word WHERE word = ANY(${words}::text[]) RETURNING word`;

    if (action === "approve" && rows.length > 0) invalidateApprovedWords();
    const reply: BulkWordsResponse = { ok: true, action, words: rows.map((r) => r.word as string) };
    return NextResponse.json(reply);
  });
}
