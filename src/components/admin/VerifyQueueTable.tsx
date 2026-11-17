"use client";

import { useMemo, useState } from "react";
import { DICTIONARY_TABLE, MAX_WORD_LENGTH, VERIFY_TABLE, type PendingWord } from "@/lib/admin/types";
import { approveWord, deleteWords, errorMessage, inBatches, renamePendingWord } from "./api";
import {
  Bi,
  ConfirmDialog,
  EmptyState,
  Pager,
  Spinner,
  TableSkeleton,
  WordList,
  btn,
  filterByWord,
  formatDate,
  inputClass,
  usePaged,
  type Mutate,
  type Notify,
} from "./ui";

type Props = {
  rows: PendingWord[];
  loading: boolean;
  /** Search text from the page's search bar. */
  query: string;
  mutate: Mutate;
  notify: Notify;
};

const byNewest = (a: PendingWord, b: PendingWord) => b.created_at.localeCompare(a.created_at);

function countLabel(words: string[]): string {
  return words.length === 1 ? `«${words[0]}»` : `${words.length} ពាក្យ / words`;
}

/** The kh_verify_word review queue: search, select, fix spelling, approve or reject. */
export function VerifyQueueTable({ rows, loading, query, mutate, notify }: Props) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<{ word: string; draft: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [inFlight, setInFlight] = useState(0);
  const [rejecting, setRejecting] = useState<string[] | null>(null);

  const filtered = useMemo(() => filterByWord(rows, query), [rows, query]);
  const { page, pageCount, pageRows, setPage } = usePaged(filtered, query);

  // Bulk actions only ever touch rows that match the current search.
  const selectedWords = useMemo(() => filtered.filter((r) => selected.has(r.word)).map((r) => r.word), [filtered, selected]);
  const pageSelected = pageRows.filter((r) => selected.has(r.word)).length;
  const allOnPage = pageRows.length > 0 && pageSelected === pageRows.length;

  function toggle(word: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(word)) next.add(word);
      return next;
    });
  }

  function togglePage() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of pageRows) {
        if (allOnPage) next.delete(r.word);
        else next.add(r.word);
      }
      return next;
    });
  }

  function forget(words: ReadonlySet<string>) {
    setSelected((prev) => new Set([...prev].filter((w) => !words.has(w))));
    setEditing((e) => (e && words.has(e.word) ? null : e));
  }

  /** Optimistic: the rows move to the approved list at once and come back if the request fails. */
  async function approve(words: string[]) {
    const set = new Set(words);
    const moved = rows.filter((r) => set.has(r.word));
    if (moved.length === 0) return;

    const now = new Date().toISOString();
    forget(set);
    setInFlight((n) => n + moved.length);
    mutate((d) => ({
      pending: d.pending.filter((p) => !set.has(p.word)),
      approved: [...moved.map((m) => ({ word: m.word, approved_at: now })), ...d.approved.filter((a) => !set.has(a.word))],
    }));

    const failed: PendingWord[] = [];
    let reason = "";
    await inBatches(moved, 5, async (row) => {
      try {
        await approveWord(row.word);
      } catch (err) {
        failed.push(row);
        reason = errorMessage(err);
      } finally {
        setInFlight((n) => n - 1);
      }
    });

    if (failed.length > 0) {
      const back = new Set(failed.map((f) => f.word));
      mutate((d) => ({
        pending: [...failed, ...d.pending.filter((p) => !back.has(p.word))].sort(byNewest),
        approved: d.approved.filter((a) => !back.has(a.word)),
      }));
      notify("bad", `អនុម័តមិនបាន · Could not approve ${countLabel(failed.map((f) => f.word))}. ${reason}`);
    }
    const done = moved.filter((m) => !failed.includes(m)).map((m) => m.word);
    if (done.length > 0) notify("ok", `បានអនុម័ត · Approved ${countLabel(done)}`);
  }

  async function reject(words: string[]) {
    const set = new Set(words);
    const removed = rows.filter((r) => set.has(r.word));
    if (removed.length === 0) return;

    forget(set);
    setInFlight((n) => n + 1);
    mutate((d) => ({ ...d, pending: d.pending.filter((p) => !set.has(p.word)) }));
    try {
      await deleteWords(words, VERIFY_TABLE);
      notify("ok", `បានបដិសេធ · Rejected ${countLabel(words)}`);
    } catch (err) {
      mutate((d) => ({ ...d, pending: [...removed, ...d.pending.filter((p) => !set.has(p.word))].sort(byNewest) }));
      notify("bad", `បដិសេធមិនបាន · Could not reject ${countLabel(words)}. ${errorMessage(err)}`);
    } finally {
      setInFlight((n) => n - 1);
    }
  }

  async function saveEdit() {
    if (!editing || saving) return;
    const { word: oldWord } = editing;
    const next = editing.draft.trim();
    if (!next || next === oldWord) {
      setEditing(null);
      return;
    }
    setSaving(true);
    try {
      const { row } = await renamePendingWord(oldWord, next);
      mutate((d) => ({ ...d, pending: d.pending.map((p) => (p.word === oldWord ? row : p)) }));
      setSelected((prev) => {
        if (!prev.has(oldWord)) return prev;
        const copy = new Set(prev);
        copy.delete(oldWord);
        copy.add(row.word);
        return copy;
      });
      setEditing(null);
      notify("ok", `បានកែ · Corrected «${oldWord}» → «${row.word}»`);
    } catch (err) {
      notify("bad", `កែមិនបាន · Could not save the correction. ${errorMessage(err)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-paper-2 shadow-card">
      <div className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-2.5 text-sm">
        {selectedWords.length > 0 ? (
          <>
            <span className="km-ui font-medium text-ink">
              បានជ្រើស {selectedWords.length} <span className="text-ink-3">· selected</span>
            </span>
            <button type="button" className={btn.primary} onClick={() => approve(selectedWords)}>
              អនុម័តទាំងអស់ · Approve
            </button>
            <button type="button" className={btn.danger} onClick={() => setRejecting(selectedWords)}>
              បដិសេធ · Reject
            </button>
            <button type="button" className="km-ui text-ink-3 underline-offset-4 hover:text-ink hover:underline" onClick={() => setSelected(new Set())}>
              សម្អាត · Clear
            </button>
          </>
        ) : (
          <span className="km-ui text-ink-2">
            {query.trim() ? `${filtered.length.toLocaleString()} / ${rows.length.toLocaleString()}` : rows.length.toLocaleString()} ពាក្យរង់ចាំ{" "}
            <span className="text-ink-3">· pending words</span>
          </span>
        )}
        {inFlight > 0 && (
          <span role="status" className="km-ui ml-auto inline-flex items-center gap-2 text-ink-2">
            <Spinner /> កំពុងរក្សាទុក… <span className="text-ink-3">Saving</span>
          </span>
        )}
      </div>

      {loading ? (
        <TableSkeleton />
      ) : filtered.length === 0 ? (
        rows.length === 0 ? (
          <EmptyState km="គ្មានពាក្យរង់ចាំផ្ទៀងផ្ទាត់ទេ" en="The verification queue is empty." />
        ) : (
          <EmptyState km="រកមិនឃើញពាក្យដែលត្រូវនឹងការស្វែងរក" en="No pending word matches your search." />
        )
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line text-ink-2">
              <tr>
                <th scope="col" className="w-10 py-2.5 pl-4">
                  <input
                    type="checkbox"
                    aria-label="Select all words on this page"
                    className="h-4 w-4 accent-[var(--accent)]"
                    checked={allOnPage}
                    ref={(el) => {
                      if (el) el.indeterminate = pageSelected > 0 && !allOnPage;
                    }}
                    onChange={togglePage}
                  />
                </th>
                <th scope="col" className="px-3 py-2.5 font-medium">
                  <Bi km="ពាក្យ" en="Word" />
                </th>
                <th scope="col" className="hidden px-3 py-2.5 font-medium md:table-cell">
                  <Bi km="ស្ថានភាព" en="Status" />
                </th>
                <th scope="col" className="hidden px-3 py-2.5 font-medium sm:table-cell">
                  <Bi km="បានបញ្ជូន" en="Submitted" />
                </th>
                <th scope="col" className="py-2.5 pl-3 pr-4 text-right font-medium">
                  <Bi km="សកម្មភាព" en="Actions" className="items-end" />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {pageRows.map((row) => {
                const isEditing = editing?.word === row.word;
                const checked = selected.has(row.word);
                return (
                  <tr key={row.word} className={checked ? "bg-accent-soft/40" : "hover:bg-paper"}>
                    <td className="py-2 pl-4">
                      <input
                        type="checkbox"
                        aria-label={`Select ${row.word}`}
                        className="h-4 w-4 accent-[var(--accent)]"
                        checked={checked}
                        onChange={() => toggle(row.word)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      {isEditing ? (
                        <form
                          className="flex items-center gap-2"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void saveEdit();
                          }}
                        >
                          <input
                            autoFocus
                            lang="km"
                            aria-label={`Corrected spelling for ${row.word}`}
                            className={`${inputClass} km min-w-40 max-w-xs py-1 text-lg`}
                            value={editing.draft}
                            maxLength={MAX_WORD_LENGTH}
                            disabled={saving}
                            onChange={(e) => setEditing({ word: row.word, draft: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === "Escape") setEditing(null);
                            }}
                          />
                          <button type="submit" className={btn.primary} disabled={saving || !editing.draft.trim()}>
                            {saving && <Spinner />} រក្សាទុក
                          </button>
                          <button type="button" className={btn.ghost} disabled={saving} onClick={() => setEditing(null)}>
                            បោះបង់
                          </button>
                        </form>
                      ) : (
                        <span lang="km" className="km text-lg text-ink">
                          {row.word}
                        </span>
                      )}
                    </td>
                    <td className="hidden px-3 py-2 md:table-cell">
                      <span className="rounded-md bg-warn-soft px-2 py-0.5 text-xs font-medium text-ink">{row.status}</span>
                    </td>
                    <td className="hidden whitespace-nowrap px-3 py-2 tabular-nums text-ink-2 sm:table-cell">
                      <time dateTime={row.created_at}>{formatDate(row.created_at)}</time>
                    </td>
                    <td className="py-2 pl-3 pr-4">
                      {!isEditing && (
                        <div className="flex justify-end gap-1.5">
                          <button type="button" title="Approve" className={btn.primary} onClick={() => approve([row.word])}>
                            អនុម័ត
                          </button>
                          <button
                            type="button"
                            title="Edit spelling"
                            className={btn.ghost}
                            onClick={() => setEditing({ word: row.word, draft: row.word })}
                          >
                            កែ
                          </button>
                          <button type="button" title="Reject" className={btn.danger} onClick={() => setRejecting([row.word])}>
                            បដិសេធ
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && <Pager page={page} pageCount={pageCount} total={filtered.length} onPage={setPage} />}

      {rejecting && (
        <ConfirmDialog
          title="បដិសេធពាក្យនេះ?"
          subtitle="Reject and delete from the queue"
          confirmLabel={`បដិសេធ · Reject${rejecting.length > 1 ? ` (${rejecting.length})` : ""}`}
          onCancel={() => setRejecting(null)}
          onConfirm={() => {
            const words = rejecting;
            setRejecting(null);
            void reject(words);
          }}
        >
          <p className="km-ui">
            ពាក្យនឹងត្រូវលុបចេញពីជួររង់ចាំ ហើយមិនអាចយកមកវិញបានទេ។{" "}
            <span className="text-ink-3">
              Removed from <code>{VERIFY_TABLE}</code>, not added to <code>{DICTIONARY_TABLE}</code>. This cannot be undone.
            </span>
          </p>
          <WordList words={rejecting} />
        </ConfirmDialog>
      )}
    </div>
  );
}
