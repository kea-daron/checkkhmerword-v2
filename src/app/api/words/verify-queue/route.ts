import { cleanWord, enqueueWord, readQueue } from "@/lib/words/csv";
import { BAD_WORD, readBody } from "../body";

/** POST {"word": "…", "status"?: "pending"} -> {"ok": true, "word", "queued": boolean} */
export async function POST(req: Request) {
  const body = await readBody(req);
  const word = cleanWord(body.word);
  if (!word) return Response.json(BAD_WORD, { status: 400 });

  const status = typeof body.status === "string" && /^[\w-]{1,30}$/.test(body.status) ? body.status : "pending";
  const queued = await enqueueWord(word, status);
  return Response.json({ ok: true, word, queued });
}

/** GET -> {"words": [{"word", "status"}]}: the words still awaiting review. */
export async function GET() {
  return Response.json({ words: await readQueue() });
}
