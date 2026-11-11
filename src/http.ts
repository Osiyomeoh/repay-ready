// Web-standard handlers (Vercel Functions and scripts/serve.ts run the same code).
import { InputError, toJson } from "./service.js";

export const json = (status: number, body: unknown) =>
  new Response(toJson(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

/** Per-instance, best-effort limit on calls that spend SERV credits or RPC quota. */
const hits = new Map<string, number[]>();
export function limited(req: Request, bucket: string, max: number, windowMs = 60_000): boolean {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > max;
}

export async function respond(fn: () => Promise<unknown>): Promise<Response> {
  try {
    return json(200, await fn());
  } catch (e) {
    if (e instanceof InputError) return json(400, { error: e.message });
    console.error(e);
    return json(502, { error: "Could not read Base or Aave right now. Nothing was checked or armed; try again in a minute." });
  }
}

export async function body(req: Request): Promise<unknown> {
  const text = await req.text();
  if (text.length > 20_000) throw new InputError("Request too large.");
  try {
    return JSON.parse(text);
  } catch {
    throw new InputError("Send JSON.");
  }
}
