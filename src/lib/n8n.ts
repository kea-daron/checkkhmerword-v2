/**
 * n8n production webhook that receives the unknown words of a text a visitor submits for review.
 * NEXT_PUBLIC_* values are inlined at build time, so changing the variable
 * in Vercel needs a redeploy to take effect.
 */
export const N8N_WEBHOOK_URL =
  process.env.NEXT_PUBLIC_N8N_WEBHOOK_URL ||
  "https://automation.ams.com.kh/webhook/906d5d99-d50d-410c-9eff-e1f07c7d1fc3";

/** How long to wait for n8n before the submission counts as failed. */
const TIMEOUT_MS = 60_000;

/**
 * Send the words the editor underlines in red to the n8n workflow as `POST`
 * with a JSON body `{ text, words }`: `words` is the list, `text` the same
 * words separated by spaces, which is what the Webhook node reads
 * (`body.text`). Only these words can end up in `kh_verify_word`. Rejects on a
 * network error, a timeout or a non-2xx reply, so the caller can tell the
 * visitor whether the words arrived.
 */
export async function submitToN8n(words: string[]): Promise<void> {
  const res = await fetch(N8N_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: words.join(" "), words }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}
