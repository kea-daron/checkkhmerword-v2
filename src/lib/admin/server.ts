import "server-only";
import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { MAX_WORD_LENGTH } from "@/lib/admin/types";

/** Helpers shared by the /api/admin/words route handlers. */

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function db() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new HttpError(503, "DATABASE_URL is not configured.");
  return neon(url);
}

/** Run a handler, turning thrown errors into a JSON `{ ok: false, error }` response. */
export async function respond(handler: () => Promise<NextResponse>): Promise<NextResponse> {
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
export function cleanWord(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const word = input.trim();
  if (!word || word.length > MAX_WORD_LENGTH || /[\r\n]/.test(word)) return null;
  return word;
}

/** De-duplicated usable words of a request's `words` array; rejects an empty or oversized list. */
export function wordList(input: unknown, max: number): string[] {
  const words = [...new Set((Array.isArray(input) ? input : []).map(cleanWord).filter((w): w is string => w !== null))];
  if (words.length === 0) throw new HttpError(400, 'Body must include a non-empty "words" array.');
  if (words.length > max) throw new HttpError(400, `At most ${max} words per request.`);
  return words;
}
