"use client";

import { useEffect, useState } from "react";

/**
 * Word count shown in the page header: the base dictionary's entries, raised
 * to include the approved words (Neon) once /api/words/approved answers.
 */
export function DictionaryCount({ base }: { base: number }) {
  const [total, setTotal] = useState(base);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/words/approved")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { total?: unknown } | null) => {
        if (!cancelled && typeof data?.total === "number") setTotal(data.total);
      })
      .catch(() => {
        /* keep the base count */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return <>{total.toLocaleString("en-US")}</>;
}
