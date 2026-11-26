"use client";

import { useMemo, useState } from "react";
import { DICTIONARY_TABLE, type ApprovedWord } from "@/lib/admin/types";
import { deleteWords, errorMessage } from "./api";
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
  sortByWord,
  formatDate,
  usePaged,
  type Mutate,
  type Notify,
} from "./ui";

type Props = {
  rows: ApprovedWord[];
  loading: boolean;
  /** Search text from the page's search bar. */
  query: string;
  mutate: Mutate;
  notify: Notify;
};

/** Words in kh_dictionary_new_word, in Khmer alphabetical order, with the option to remove one. */
export function ApprovedWordsTable({ rows, loading, query, mutate, notify }: Props) {
  const [removing, setRemoving] = useState<ApprovedWord | null>(null);
  const [inFlight, setInFlight] = useState(0);

  const filtered = useMemo(() => sortByWord(filterByWord(rows, query)), [rows, query]);
  const { page, pageCount, pageRows, setPage } = usePaged(filtered, query);

  async function remove(row: ApprovedWord) {
    setInFlight((n) => n + 1);
    mutate((d) => ({ ...d, approved: d.approved.filter((a) => a.word !== row.word) }));
    try {
      await deleteWords([row.word], DICTIONARY_TABLE);
      notify("ok", `បានលុប · Removed «${row.word}» from the approved words`);
    } catch (err) {
      mutate((d) => ({ ...d, approved: [row, ...d.approved.filter((a) => a.word !== row.word)] }));
      notify("bad", `លុបមិនបាន · Could not remove «${row.word}». ${errorMessage(err)}`);
    } finally {
      setInFlight((n) => n - 1);
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-paper-2 shadow-card">
      <div className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-2.5 text-sm">
        <span className="km-ui text-ink-2">
          {query.trim() ? `${filtered.length.toLocaleString()} / ${rows.length.toLocaleString()}` : rows.length.toLocaleString()} ពាក្យបានអនុម័ត{" "}
          <span className="text-ink-3">· approved words</span>
        </span>
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
          <EmptyState km="មិនទាន់មានពាក្យដែលបានអនុម័តទេ" en="No words have been approved yet." />
        ) : (
          <EmptyState km="រកមិនឃើញពាក្យដែលត្រូវនឹងការស្វែងរក" en="No approved word matches your search." />
        )
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line text-ink-2">
              <tr>
                <th scope="col" className="py-2.5 pl-4 pr-3 font-medium">
                  <Bi km="ពាក្យ" en="Word" />
                </th>
                <th scope="col" className="px-3 py-2.5 font-medium">
                  <Bi km="អនុម័តនៅ" en="Approved at" />
                </th>
                <th scope="col" className="py-2.5 pl-3 pr-4 text-right font-medium">
                  <Bi km="សកម្មភាព" en="Actions" className="items-end" />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {pageRows.map((row) => (
                <tr key={row.word} className="hover:bg-paper">
                  <td className="py-2 pl-4 pr-3">
                    <span lang="km" className="km text-lg text-ink">
                      {row.word}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-ink-2">
                    <time dateTime={row.approved_at}>{formatDate(row.approved_at)}</time>
                  </td>
                  <td className="py-2 pl-3 pr-4 text-right">
                    <button type="button" title="Remove from approved words" className={btn.danger} onClick={() => setRemoving(row)}>
                      លុប
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && <Pager page={page} pageCount={pageCount} total={filtered.length} onPage={setPage} />}

      {removing && (
        <ConfirmDialog
          title="លុបពាក្យដែលបានអនុម័ត?"
          subtitle="Remove an approved word"
          confirmLabel="លុប · Remove"
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            const row = removing;
            setRemoving(null);
            void remove(row);
          }}
        >
          <p className="km-ui">
            ពាក្យនេះនឹងលែងត្រូវបានចាត់ទុកថាត្រឹមត្រូវ។{" "}
            <span className="text-ink-3">
              Deleted from <code>{DICTIONARY_TABLE}</code>; the checker will stop accepting it. This cannot be undone.
            </span>
          </p>
          <WordList words={[removing.word]} />
        </ConfirmDialog>
      )}
    </div>
  );
}
