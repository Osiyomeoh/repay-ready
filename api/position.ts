import { json, limited, respond } from "../src/http.js";
import { positionView } from "../src/service.js";

export const maxDuration = 30;

export function GET(req: Request) {
  if (limited(req, "position", 30)) return json(429, { error: "Too many lookups; wait a minute." });
  return respond(() => positionView(new URL(req.url).searchParams.get("address")));
}
