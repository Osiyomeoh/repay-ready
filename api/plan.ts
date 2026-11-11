import { body, json, limited, respond } from "../src/http.js";
import { readPlan } from "../src/service.js";

export const maxDuration = 30;

export function POST(req: Request) {
  if (limited(req, "plan", 10)) return json(429, { error: "Too many requests; wait a minute." });
  return respond(async () => readPlan(((await body(req)) as { text?: unknown } | null)?.text));
}
