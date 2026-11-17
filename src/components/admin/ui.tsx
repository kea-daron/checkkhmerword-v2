"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { AdminData } from "@/lib/admin/types";

/* ------------------------------------------------------------------ */
/* Shared types and helpers                                            */
/* ------------------------------------------------------------------ */

/** Apply a change to the dashboard's local copy of the data (optimistic updates and rollbacks). */
export type Mutate = (change: (data: AdminData) => AdminData) => void;

export type ToastKind = "ok" | "bad" | "info";
export type Notify = (kind: ToastKind, message: string) => void;

const BTN = "inline-flex items-center justify-center gap-1.5 rounded-md text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
export const btn = {
  primary: `${BTN} km-ui bg-accent px-3 py-1.5 text-accent-ink hover:bg-accent-strong`,
  ghost: `${BTN} km-ui border border-line px-3 py-1.5 text-ink-2 hover:bg-paper-3 hover:text-ink`,
  danger: `${BTN} km-ui border border-line px-3 py-1.5 text-bad hover:border-bad hover:bg-bad-soft`,
  dangerSolid: `${BTN} km-ui bg-bad px-3 py-1.5 text-paper-2 hover:opacity-90`,
};

export const inputClass =
  "w-full rounded-md border border-line-strong bg-paper-2 px-3 py-2 text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-accent focus:ring-2 focus:ring-accent-soft";

const dateFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

export function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : dateFormat.format(date);
}

/** Search key: ignores case, Unicode composition and invisible joiners pasted along with Khmer text. */
function searchKey(s: string): string {
  return s.normalize("NFC").replace(/[​-‍﻿]/g, "").toLowerCase();
}

export function filterByWord<T extends { word: string }>(rows: T[], query: string): T[] {
  const q = searchKey(query.trim());
  return q ? rows.filter((r) => searchKey(r.word).includes(q)) : rows;
}

/* ------------------------------------------------------------------ */
/* Small pieces                                                        */
/* ------------------------------------------------------------------ */

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={`animate-spin ${className}`} fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** Khmer label with a small English caption underneath, as used across the site. */
export function Bi({ km, en, className = "" }: { km: string; en: string; className?: string }) {
  return (
    <span className={`flex flex-col leading-tight ${className}`}>
      <span className="km-ui">{km}</span>
      <span className="text-[10px] font-normal uppercase tracking-wide text-ink-3">{en}</span>
    </span>
  );
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading" className="divide-y divide-line">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex animate-pulse items-center gap-4 px-4 py-4">
          <div className="h-4 w-4 rounded bg-paper-3" />
          <div className="h-5 rounded bg-paper-3" style={{ width: `${20 + ((i * 13) % 30)}%` }} />
          <div className="ml-auto hidden h-4 w-32 rounded bg-paper-3 sm:block" />
          <div className="h-8 w-24 rounded-md bg-paper-3" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ km, en }: { km: string; en: string }) {
  return (
    <div className="px-4 py-14 text-center">
      <p className="km-ui text-base text-ink-2">{km}</p>
      <p className="mt-1 text-sm text-ink-3">{en}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pagination                                                          */
/* ------------------------------------------------------------------ */

export const PAGE_SIZE = 25;

/** Client-side paging. The page falls back to the first one whenever `resetKey` (the search text) changes. */
export function usePaged<T>(rows: T[], resetKey: string) {
  const [state, setState] = useState({ key: resetKey, page: 0 });
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(state.key === resetKey ? state.page : 0, pageCount - 1);
  return {
    page,
    pageCount,
    pageRows: rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    setPage: (next: number) => setState({ key: resetKey, page: next }),
  };
}

export function Pager({
  page,
  pageCount,
  total,
  onPage,
}: {
  page: number;
  pageCount: number;
  total: number;
  onPage: (page: number) => void;
}) {
  if (total === 0) return null;
  const from = page * PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm text-ink-2">
      <span className="tabular-nums">
        {from}–{to} / {total.toLocaleString()}
      </span>
      {pageCount > 1 && (
        <div className="flex items-center gap-2">
          <button type="button" className={btn.ghost} disabled={page === 0} onClick={() => onPage(page - 1)}>
            <span aria-hidden>‹</span> មុន
          </button>
          <span className="tabular-nums text-ink-3">
            {page + 1} / {pageCount}
          </span>
          <button type="button" className={btn.ghost} disabled={page >= pageCount - 1} onClick={() => onPage(page + 1)}>
            បន្ទាប់ <span aria-hidden>›</span>
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Modal and confirmation dialog                                       */
/* ------------------------------------------------------------------ */

export function Modal({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-4 sm:items-center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="fade-up w-full max-w-md rounded-2xl border border-line bg-paper-2 p-5 shadow-card"
      >
        <h2 id={titleId} className="km-ui text-lg font-semibold text-ink">
          {title}
        </h2>
        {subtitle && <p className="text-xs uppercase tracking-wide text-ink-3">{subtitle}</p>}
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  subtitle,
  children,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal title={title} subtitle={subtitle} onClose={onCancel}>
      <div className="text-sm text-ink-2">{children}</div>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" autoFocus className={btn.ghost} onClick={onCancel}>
          បោះបង់ · Cancel
        </button>
        <button type="button" className={btn.dangerSolid} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

/** The words a destructive action is about to touch: all of them when few, otherwise a sample and a count. */
export function WordList({ words }: { words: string[] }) {
  const shown = words.slice(0, 8);
  return (
    <p className="km mt-2 rounded-md bg-paper-3 px-3 py-2 text-base text-ink">
      {shown.join(" · ")}
      {words.length > shown.length && <span className="text-ink-3"> … +{words.length - shown.length}</span>}
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* Toasts                                                              */
/* ------------------------------------------------------------------ */

type Toast = { id: number; kind: ToastKind; message: string };

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback<Notify>(
    (kind, message) => {
      const id = ++nextId.current;
      setToasts((list) => [...list.slice(-3), { id, kind, message }]);
      window.setTimeout(() => dismiss(id), kind === "bad" ? 7000 : 4000);
    },
    [dismiss],
  );

  return { toasts, notify, dismiss };
}

const TOAST_TONE: Record<ToastKind, string> = {
  ok: "border-ok/40 bg-ok-soft",
  bad: "border-bad/40 bg-bad-soft",
  info: "border-line-strong bg-paper-2",
};

export function ToastViewport({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col items-end gap-2 sm:left-auto sm:w-96">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === "bad" ? "alert" : "status"}
          className={`fade-up pointer-events-auto flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-sm text-ink shadow-card ${TOAST_TONE[t.kind]}`}
        >
          <span aria-hidden className={`mt-0.5 font-semibold ${t.kind === "bad" ? "text-bad" : t.kind === "ok" ? "text-ok" : "text-ink-3"}`}>
            {t.kind === "bad" ? "✕" : t.kind === "ok" ? "✓" : "•"}
          </span>
          <p className="km-ui flex-1">{t.message}</p>
          <button type="button" aria-label="Dismiss" className="text-ink-3 hover:text-ink" onClick={() => onDismiss(t.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
