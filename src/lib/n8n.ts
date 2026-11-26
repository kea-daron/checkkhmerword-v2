/**
 * n8n production webhook that receives the text a visitor checked.
 * NEXT_PUBLIC_* values are inlined at build time, so changing the variable
 * in Vercel needs a redeploy to take effect.
 */
export const N8N_WEBHOOK_URL =
  process.env.NEXT_PUBLIC_N8N_WEBHOOK_URL ||
  "https://automation.ams.com.kh/webhook/906d5d99-d50d-410c-9eff-e1f07c7d1fc3";

/**
 * Fire-and-forget: the checker never waits for n8n and never surfaces its
 * failures. `keepalive` lets the request finish if the visitor leaves the page.
 */
export function notifyN8n(text: string): void {
  if (!N8N_WEBHOOK_URL) return;
  try {
    void fetch(N8N_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Malformed URL or fetch unavailable: the spell check itself is unaffected.
  }
}
