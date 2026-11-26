import type { AdminWordsResponse, ApprovedWord, BulkAction, BulkWordsResponse, PendingWord, WordTable } from "@/lib/admin/types";

/** Browser-side calls to the admin and word APIs. Every failure throws an Error with a readable message. */

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      cache: "no-store",
      headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    });
  } catch {
    throw new Error("Network error. Check your connection and try again.");
  }
  const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (!res.ok || body?.ok === false) {
    throw new Error(body?.error ?? `Request failed (${res.status}).`);
  }
  return body as T;
}

const json = (method: string, payload: unknown): RequestInit => ({ method, body: JSON.stringify(payload) });

export function fetchAdminWords() {
  return request<AdminWordsResponse>("/api/admin/words");
}

/** Move a word from the queue into the approved list (existing n8n-compatible endpoint). */
export function approveWord(word: string) {
  return request<{ ok: true; approved: string }>("/api/words/approve", json("POST", { word }));
}

export function deleteWords(words: string[], table: WordTable) {
  return request<{ ok: true; deleted: string[] }>("/api/admin/words", json("DELETE", { words, table }));
}

/** Approve or reject many pending words in one atomic request. */
export function bulkPendingWords(action: BulkAction, words: string[]) {
  return request<BulkWordsResponse>("/api/admin/words/bulk", json("POST", { action, words }));
}

export function renamePendingWord(oldWord: string, newWord: string) {
  return request<{ ok: true; row: PendingWord }>("/api/admin/words", json("PATCH", { oldWord, newWord }));
}

export function addWord(word: string, table: WordTable) {
  return request<{ ok: true; table: WordTable; row: PendingWord | ApprovedWord }>(
    "/api/admin/words",
    json("POST", { word, table }),
  );
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong.";
}
