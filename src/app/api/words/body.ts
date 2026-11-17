/** JSON object body of a request, or an empty object when it is missing or malformed. */
export async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export const BAD_WORD = { ok: false, error: 'Body must be JSON: {"word": "…"}' };
