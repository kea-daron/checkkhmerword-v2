"use client";

import { useCallback, useEffect, useState } from "react";
import type { AdminData } from "@/lib/admin/types";
import { AddManualWordModal } from "./AddManualWordModal";
import { AdminStatsCards } from "./AdminStatsCards";
import { ApprovedWordsTable } from "./ApprovedWordsTable";
import { VerifyQueueTable } from "./VerifyQueueTable";
import { errorMessage, fetchAdminWords } from "./api";
import { Spinner, ToastViewport, btn, inputClass, useToasts, type Mutate } from "./ui";

type Tab = "pending" | "approved";

const TABS: { key: Tab; km: string; en: string }[] = [
  { key: "pending", km: "ជួររង់ចាំ", en: "Pending queue" },
  { key: "approved", km: "ពាក្យបានអនុម័ត", en: "Approved dictionary words" },
];

/** Client shell of /admin: loads both word lists once and keeps them in sync with every action. */
export function AdminDashboard() {
  const [data, setData] = useState<AdminData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<Tab>("pending");
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const { toasts, notify, dismiss } = useToasts();

  // Initial load. State is only set from the promise callbacks, and never after unmount.
  useEffect(() => {
    let active = true;
    fetchAdminWords().then(
      ({ pending, approved }) => {
        if (active) setData({ pending, approved });
      },
      (err: unknown) => {
        if (active) setLoadError(errorMessage(err));
      },
    );
    return () => {
      active = false;
    };
  }, []);

  async function refresh() {
    setRefreshing(true);
    try {
      const { pending, approved } = await fetchAdminWords();
      setData({ pending, approved });
      setLoadError(null);
      notify("info", "បានផ្ទុកទិន្នន័យថ្មី · Data refreshed");
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setRefreshing(false);
    }
  }

  const mutate = useCallback<Mutate>((change) => setData((d) => (d ? change(d) : d)), []);

  const loading = data === null && loadError === null;
  const counts = { pending: data?.pending.length ?? 0, approved: data?.approved.length ?? 0 };

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
      <section className="flex flex-wrap items-end justify-between gap-4 pt-10 pb-6">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-accent">Admin</p>
          <h1 className="km mt-1 text-3xl font-semibold leading-tight text-ink sm:text-4xl">ផ្ទាំងគ្រប់គ្រងពាក្យ</h1>
          <p className="mt-1 text-sm text-ink-2">Word verification dashboard · review, correct and approve new Khmer words.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className={btn.ghost} onClick={refresh} disabled={refreshing || loading}>
            {refreshing ? (
              <Spinner />
            ) : (
              <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 11a8 8 0 0 0-14.3-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.5L20 16M20 20v-4h-4" />
              </svg>
            )}
            ផ្ទុកឡើងវិញ <span className="hidden text-ink-3 sm:inline">· Refresh</span>
          </button>
          <button type="button" className={btn.primary} onClick={() => setAdding(true)} disabled={data === null}>
            <span aria-hidden>+</span> បន្ថែមពាក្យ <span className="hidden opacity-80 sm:inline">· Add word</span>
          </button>
        </div>
      </section>

      {loadError && (
        <div role="alert" className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-bad/40 bg-bad-soft px-4 py-3 text-sm">
          <p className="km-ui text-ink">
            <span className="font-medium text-bad">ផ្ទុកទិន្នន័យមិនបាន · Could not load the word lists.</span> {loadError}
            {data && <span className="text-ink-2"> Showing the last loaded data.</span>}
          </p>
          <button type="button" className={btn.ghost} onClick={refresh} disabled={refreshing}>
            {refreshing && <Spinner />} ព្យាយាមម្ដងទៀត · Retry
          </button>
        </div>
      )}

      <AdminStatsCards pending={counts.pending} approved={counts.approved} loading={data === null} />

      <section className="mt-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div role="tablist" aria-label="Word lists" className="inline-flex rounded-xl border border-line bg-paper-2 p-1 shadow-card">
            {TABS.map((t) => {
              const on = t.key === tab;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  id={`tab-${t.key}`}
                  aria-selected={on}
                  aria-controls="admin-tabpanel"
                  onClick={() => setTab(t.key)}
                  className={`km-ui flex items-center gap-2.5 rounded-lg px-4 py-2 text-left text-[15px] font-medium transition ${
                    on ? "bg-accent text-accent-ink shadow-card" : "text-ink-2 hover:bg-paper-3 hover:text-ink"
                  }`}
                >
                  <span className="flex flex-col leading-tight">
                    {t.km}
                    <span className={`text-[10px] font-normal uppercase tracking-wide ${on ? "text-accent-ink/80" : "text-ink-3"}`}>{t.en}</span>
                  </span>
                  {data && (
                    <span className={`rounded-md px-1.5 py-0.5 text-xs tabular-nums ${on ? "bg-accent-ink/20" : "bg-paper-3 text-ink-2"}`}>
                      {counts[t.key].toLocaleString()}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="relative w-full sm:w-72">
            <svg aria-hidden viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              type="search"
              lang="km"
              aria-label="Search words"
              placeholder="ស្វែងរកពាក្យ · Search words"
              className={`${inputClass} km-ui pl-9`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        <div id="admin-tabpanel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
          {/* Both tables stay mounted so selections and in-flight requests survive a tab switch. */}
          <div hidden={tab !== "pending"}>
            <VerifyQueueTable rows={data?.pending ?? []} loading={loading} query={query} mutate={mutate} notify={notify} />
          </div>
          <div hidden={tab !== "approved"}>
            <ApprovedWordsTable rows={data?.approved ?? []} loading={loading} query={query} mutate={mutate} notify={notify} />
          </div>
        </div>
      </section>

      {adding && <AddManualWordModal onClose={() => setAdding(false)} mutate={mutate} notify={notify} />}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
