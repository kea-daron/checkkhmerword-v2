import type { ReactNode } from "react";

type Props = {
  pending: number;
  approved: number;
  /** Show placeholders instead of numbers while the first load is in flight. */
  loading?: boolean;
};

const ICON = {
  className: "h-5 w-5",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

function StatCard({
  km,
  en,
  value,
  loading,
  chip,
  icon,
}: {
  km: string;
  en: string;
  value: number;
  loading?: boolean;
  chip: string;
  icon: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-2xl border border-line bg-paper-2 p-5 shadow-card">
      <div className="min-w-0">
        <p className="km-ui text-sm font-medium text-ink-2">{km}</p>
        <p className="text-[11px] uppercase tracking-wide text-ink-3">{en}</p>
        {loading ? (
          <div className="mt-3 h-9 w-20 animate-pulse rounded-md bg-paper-3" role="status" aria-label="Loading" />
        ) : (
          <p className="mt-2 text-4xl font-semibold tabular-nums tracking-tight text-ink">{value.toLocaleString()}</p>
        )}
      </div>
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${chip}`}>{icon}</span>
    </div>
  );
}

/** The three KPI cards at the top of the admin dashboard. */
export function AdminStatsCards({ pending, approved, loading }: Props) {
  return (
    <section aria-label="Summary" className="grid gap-4 sm:grid-cols-3">
      <StatCard
        km="រង់ចាំផ្ទៀងផ្ទាត់"
        en="Pending verification"
        value={pending}
        loading={loading}
        chip="bg-warn-soft text-ink"
        icon={
          <svg {...ICON}>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
        }
      />
      <StatCard
        km="ពាក្យថ្មីបានអនុម័ត"
        en="Approved new words"
        value={approved}
        loading={loading}
        chip="bg-ok-soft text-ok"
        icon={
          <svg {...ICON}>
            <circle cx="12" cy="12" r="9" />
            <path d="m8 12.5 2.5 2.5L16 9.5" />
          </svg>
        }
      />
      <StatCard
        km="ពាក្យបន្ថែមសរុប"
        en="Total custom words"
        value={pending + approved}
        loading={loading}
        chip="bg-accent-soft text-accent"
        icon={
          <svg {...ICON}>
            <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" />
            <path d="M5 17a3 3 0 0 1 3-3h11M9 8h6" />
          </svg>
        }
      />
    </section>
  );
}
