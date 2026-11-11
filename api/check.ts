import { body, json, limited, respond } from "../src/http.js";
import { runCheck } from "../src/service.js";

export const maxDuration = 60;

export function POST(req: Request) {
  if (limited(req, "check", 10)) return json(429, { error: "Too many checks; wait a minute." });
  return respond(async () => runCheck(await body(req)));
}
