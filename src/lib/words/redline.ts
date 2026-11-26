import "server-only";
import { checkText } from "@/lib/dict/check";
import { getApprovedWords } from "./approved";

/** Strip the invisible characters and quotes a word picks up on its way through n8n. */
export function cleanWord(value: unknown): string {
  return typeof value === "string"
    ? value.replace(/[​-‍﻿"'\r\n]/g, "").trim().normalize("NFC")
    : "";
}

/**
 * Whether the editor would underline `word` in red: the spell checker cannot
 * explain it, neither as a headword, an approved word nor a run of headwords.
 * Only such words belong in the `kh_verify_word` review queue, so the n8n
 * workflow and the editor agree on what counts as an unknown word.
 */
export async function isRedLine(word: string): Promise<boolean> {
  const { keys } = await getApprovedWords();
  return checkText(word, keys).tokens.some((t) => t.kind === "word" && t.status === "unknown");
}
