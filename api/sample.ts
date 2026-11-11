// A recorded real run (scripts/record-sample.ts), so a judge can see the whole
// flow with no wallet, key or RPC. Until one is recorded it answers
// { available: false } with 200, so the page logs no failed request.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { json } from "../src/http.js";

export function GET() {
  const path = join(process.cwd(), "data", "sample.json");
  if (!existsSync(path)) return json(200, { available: false });
  return new Response(readFileSync(path, "utf8"), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=300" } });
}
