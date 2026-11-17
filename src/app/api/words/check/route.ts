import { cleanWord, findWord } from "@/lib/words/csv";
import { readBody } from "../body";

/** POST {"word": "…"} -> {"exists": boolean, "word", "source"} */
export async function POST(req: Request) {
  const word = cleanWord((await readBody(req)).word);
  if (!word) return Response.json({ exists: false });

  const source = await findWord(word);
  return Response.json({ exists: source !== null, word, source });
}
