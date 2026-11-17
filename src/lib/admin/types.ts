/** Shapes shared by /api/admin/words and the admin dashboard components. */

export const VERIFY_TABLE = "kh_verify_word";
export const DICTIONARY_TABLE = "kh_dictionary_new_word";

export type WordTable = typeof VERIFY_TABLE | typeof DICTIONARY_TABLE;

/** A row of kh_verify_word. Timestamps are ISO strings once they cross the API. */
export type PendingWord = { word: string; status: string; created_at: string };

/** A row of kh_dictionary_new_word. */
export type ApprovedWord = { word: string; approved_at: string };

export type AdminData = { pending: PendingWord[]; approved: ApprovedWord[] };

export type AdminWordsResponse = AdminData & {
  ok: true;
  counts: { pending: number; approved: number; total: number };
};

export const MAX_WORD_LENGTH = 100;
