import type { NextRequest } from "next/server";
import { checkText } from "@/lib/dict/check";
import { getApprovedWords } from "@/lib/words/approved";

const MAX = 5000;

async function respond(text: unknown) {
  if (typeof text !== "string" || !text.trim()) {
    return Response.json({ error: "Provide a non-empty `text` string." }, { status: 400 });
  }
  if (text.length > MAX) {
    return Response.json({ error: `Text too long (max ${MAX} characters).` }, { status: 413 });
  }
  const { byKey } = await getApprovedWords();
  return Response.json(checkText(text, byKey));
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON: {\"text\": \"…\"}" }, { status: 400 });
  }
  return respond((body as { text?: unknown })?.text);
}

export async function GET(req: NextRequest) {
  return respond(req.nextUrl.searchParams.get("text") ?? "");
}
