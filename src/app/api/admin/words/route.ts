import { NextResponse, connection } from "next/server";
import { neon } from "@neondatabase/serverless";
import { readBody } from "@/app/api/words/body";
import { hasKhmer } from "@/lib/khmer/normalize";
import {
  DICTIONARY_TABLE,
  MAX_WORD_LENGTH,
  VERIFY_TABLE,
  type AdminWordsResponse,
  type ApprovedWord,
  type PendingWord,
  type WordTable,
} from "@/lib/admin/types";

const MAX_BULK = 500;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function db() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new HttpError(503, "DATABASE_URL is not configured.");
  return neon(url);
}

/** Run a handler, turning thrown errors into a JSON `{ ok: false, error }` response. */
async function respond(handler: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await handler();
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    }
    console.error("[api/admin/words]", err);
    return NextResponse.json({ ok: false, error: "Database request failed." }, { status: 500 });
  }
}

/** Trimmed word, or null when it is not a usable single-line string. */
function cleanWord(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const word = input.trim();
  if (!word || word.length > MAX_WORD_LENGTH || /[\r\n]/.test(word)) return null;
  return word;
}

/** A word an admin is typing in (add / edit): must also contain Khmer script. */
function newWord(input: unknown, field: string): string {
  const word = cleanWord(input);
  if (!word) throw new HttpError(400, `"${field}" must be a non-empty word of at most ${MAX_WORD_LENGTH} characters.`);
  if (!hasKhmer(word)) throw new HttpError(400, `"${field}" must contain Khmer characters.`);
  return word;
}

function tableOf(input: unknown): WordTable {
  if (input === VERIFY_TABLE || input === DICTIONARY_TABLE) return input;
  throw new HttpError(400, `"table" must be "${VERIFY_TABLE}" or "${DICTIONARY_TABLE}".`);
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "23505";
}

/** Pending queue, approved words and summary counts. */
export function GET() {
  return respond(async () => {
    // Always answer from the live database, never from a prerendered response.
    await connection();
    const sql = db();
    const [pending, approved] = (await Promise.all([
      sql`SELECT word, status, created_at FROM kh_verify_word ORDER BY created_at DESC, word`,
      sql`SELECT word, approved_at FROM kh_dictionary_new_word ORDER BY approved_at DESC, word`,
    ])) as unknown as [PendingWord[], ApprovedWord[]];

    const body: AdminWordsResponse = {
      ok: true,
      pending,
      approved,
      counts: { pending: pending.length, approved: approved.length, total: pending.length + approved.length },
    };
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  });
}

/** Manually add a word: `{ word, table }`. */
export function POST(req: Request) {
  return respond(async () => {
    const body = await readBody(req);
    const word = newWord(body.word, "word");
    const table = tableOf(body.table ?? DICTIONARY_TABLE);
    const sql = db();

    if (table === DICTIONARY_TABLE) {
      // One statement, so the word never ends up both approved and still queued.
      const rows = await sql`
        WITH ins AS (
          INSERT INTO kh_dictionary_new_word (word) VALUES (${word})
          ON CONFLICT (word) DO NOTHING
          RETURNING word, approved_at
        ), del AS (
          DELETE FROM kh_verify_word WHERE word = ${word} AND EXISTS (SELECT 1 FROM ins)
        )
        SELECT word, approved_at FROM ins
      `;
      if (rows.length === 0) throw new HttpError(409, "This word is already in the approved list.");
      return NextResponse.json({ ok: true, table, row: rows[0] }, { status: 201 });
    }

    const rows = await sql`
      INSERT INTO kh_verify_word (word, status)
      SELECT ${word}, 'pending'
      WHERE NOT EXISTS (SELECT 1 FROM kh_dictionary_new_word WHERE word = ${word})
      ON CONFLICT (word) DO NOTHING
      RETURNING word, status, created_at
    `;
    if (rows.length === 0) throw new HttpError(409, "This word is already queued or already approved.");
    return NextResponse.json({ ok: true, table, row: rows[0] }, { status: 201 });
  });
}

/** Reject / remove: `{ word, table }`, or `{ words: [...], table }` for a bulk action. */
export function DELETE(req: Request) {
  return respond(async () => {
    const body = await readBody(req);
    const table = tableOf(body.table);
    const input = Array.isArray(body.words) ? body.words : [body.word];
    const words = [...new Set(input.map(cleanWord).filter((w): w is string => w !== null))];
    if (words.length === 0) throw new HttpError(400, 'Body must include "word" or a non-empty "words" array.');
    if (words.length > MAX_BULK) throw new HttpError(400, `At most ${MAX_BULK} words per request.`);

    const sql = db();
    const rows =
      table === VERIFY_TABLE
        ? await sql`DELETE FROM kh_verify_word WHERE word = ANY(${words}::text[]) RETURNING word`
        : await sql`DELETE FROM kh_dictionary_new_word WHERE word = ANY(${words}::text[]) RETURNING word`;

    return NextResponse.json({ ok: true, table, deleted: rows.map((r) => r.word as string) });
  });
}

/** Fix the spelling of a pending word before approval: `{ oldWord, newWord }`. */
export function PATCH(req: Request) {
  return respond(async () => {
    const body = await readBody(req);
    const oldWord = cleanWord(body.oldWord);
    if (!oldWord) throw new HttpError(400, '"oldWord" is required.');
    const next = newWord(body.newWord, "newWord");
    if (next === oldWord) throw new HttpError(400, "The new spelling is the same as the old one.");

    const sql = db();
    const approved = await sql`SELECT 1 FROM kh_dictionary_new_word WHERE word = ${next} LIMIT 1`;
    if (approved.length > 0) throw new HttpError(409, "The corrected word is already in the approved list.");

    let rows;
    try {
      rows = await sql`
        UPDATE kh_verify_word SET word = ${next}
        WHERE word = ${oldWord}
        RETURNING word, status, created_at
      `;
    } catch (err) {
      if (isUniqueViolation(err)) throw new HttpError(409, "The corrected word is already in the queue.");
      throw err;
    }
    if (rows.length === 0) throw new HttpError(404, "That word is no longer in the queue.");
    return NextResponse.json({ ok: true, row: rows[0] });
  });
}
