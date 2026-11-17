"use client";

import { useState } from "react";
import { hasKhmer } from "@/lib/khmer/normalize";
import {
  DICTIONARY_TABLE,
  MAX_WORD_LENGTH,
  VERIFY_TABLE,
  type ApprovedWord,
  type PendingWord,
  type WordTable,
} from "@/lib/admin/types";
import { addWord, errorMessage } from "./api";
import { Modal, Spinner, btn, inputClass, type Mutate, type Notify } from "./ui";

type Props = {
  onClose: () => void;
  mutate: Mutate;
  notify: Notify;
};

const DESTINATIONS: { table: WordTable; km: string; en: string }[] = [
  { table: DICTIONARY_TABLE, km: "អនុម័តភ្លាម", en: "Add straight to the approved words" },
  { table: VERIFY_TABLE, km: "ដាក់ក្នុងជួររង់ចាំ", en: "Add to the verification queue" },
];

/** Add a word by hand, either straight into kh_dictionary_new_word or into the kh_verify_word queue. */
export function AddManualWordModal({ onClose, mutate, notify }: Props) {
  const [word, setWord] = useState("");
  const [table, setTable] = useState<WordTable>(DICTIONARY_TABLE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clean = word.trim();

  async function submit() {
    if (saving) return;
    if (!clean) return setError("សូមបញ្ចូលពាក្យ · Enter a word.");
    if (!hasKhmer(clean)) return setError("ពាក្យត្រូវមានអក្សរខ្មែរ · The word must contain Khmer characters.");

    setSaving(true);
    setError(null);
    try {
      const { row } = await addWord(clean, table);
      if (table === DICTIONARY_TABLE) {
        const added = row as ApprovedWord;
        // The server also drops the word from the queue when it was waiting there.
        mutate((d) => ({
          pending: d.pending.filter((p) => p.word !== added.word),
          approved: [added, ...d.approved.filter((a) => a.word !== added.word)],
        }));
        notify("ok", `បានបន្ថែម · Added «${added.word}» to the approved words`);
      } else {
        const added = row as PendingWord;
        mutate((d) => ({ ...d, pending: [added, ...d.pending.filter((p) => p.word !== added.word)] }));
        notify("ok", `បានបន្ថែម · Added «${added.word}» to the verification queue`);
      }
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Modal title="បន្ថែមពាក្យថ្មី" subtitle="Add a word manually" onClose={saving ? () => {} : onClose}>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label htmlFor="manual-word" className="km-ui text-sm font-medium text-ink">
          ពាក្យខ្មែរ <span className="font-normal text-ink-3">· Khmer word</span>
        </label>
        <input
          id="manual-word"
          autoFocus
          lang="km"
          autoComplete="off"
          spellCheck={false}
          className={`${inputClass} km mt-1 text-xl`}
          placeholder="ឧ. បច្ចេកវិទ្យា"
          value={word}
          maxLength={MAX_WORD_LENGTH}
          disabled={saving}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "manual-word-error" : undefined}
          onChange={(e) => {
            setWord(e.target.value);
            setError(null);
          }}
        />
        {error && (
          <p id="manual-word-error" role="alert" className="km-ui mt-1.5 text-sm text-bad">
            {error}
          </p>
        )}

        <fieldset className="mt-4" disabled={saving}>
          <legend className="km-ui text-sm font-medium text-ink">
            ទិសដៅ <span className="font-normal text-ink-3">· Destination</span>
          </legend>
          <div className="mt-1.5 grid gap-2">
            {DESTINATIONS.map((d) => (
              <label
                key={d.table}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 transition-colors ${
                  table === d.table ? "border-accent bg-accent-soft/50" : "border-line hover:bg-paper"
                }`}
              >
                <input
                  type="radio"
                  name="destination"
                  className="mt-1.5 accent-[var(--accent)]"
                  checked={table === d.table}
                  onChange={() => setTable(d.table)}
                />
                <span>
                  <span className="km-ui block font-medium text-ink">{d.km}</span>
                  <span className="block text-xs text-ink-2">
                    {d.en} (<code>{d.table}</code>)
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className={btn.ghost} disabled={saving} onClick={onClose}>
            បោះបង់ · Cancel
          </button>
          <button type="submit" className={btn.primary} disabled={saving || !clean}>
            {saving && <Spinner />} បន្ថែម · Add word
          </button>
        </div>
      </form>
    </Modal>
  );
}
