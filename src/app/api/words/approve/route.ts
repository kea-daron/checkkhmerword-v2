import { approveWord, cleanWord } from "@/lib/words/csv";
import { BAD_WORD, readBody } from "../body";

/** POST {"word": "…"} -> {"ok": true, "approved", "wasPending": boolean, "added": boolean} */
export async function POST(req: Request) {
  const word = cleanWord((await readBody(req)).word);
  if (!word) return Response.json(BAD_WORD, { status: 400 });

  return Response.json({ ok: true, approved: word, ...(await approveWord(word)) });
}
