/**
 * n8n production webhook that receives the text a visitor submits for review.
 * NEXT_PUBLIC_* values are inlined at build time, so changing the variable
 * in Vercel needs a redeploy to take effect.
 */
export const N8N_WEBHOOK_URL =
  process.env.NEXT_PUBLIC_N8N_WEBHOOK_URL ||
  "https://automation.ams.com.kh/webhook/906d5d99-d50d-410c-9eff-e1f07c7d1fc3";

/** How long to wait for n8n before the submission counts as failed. */
const TIMEOUT_MS = 60_000;

/**
 * Send `text` to the n8n workflow as `GET ?text=…` (what the Webhook node
 * expects). Rejects on a network error, a timeout or a non-2xx reply, so the
 * caller can tell the visitor whether the text arrived.
 */
export async function submitToN8n(text: string): Promise<void> {
  const sep = N8N_WEBHOOK_URL.includes("?") ? "&" : "?";
  const res = await fetch(`${N8N_WEBHOOK_URL}${sep}text=${encodeURIComponent(text.trim())}`, {
    method: "GET",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}
