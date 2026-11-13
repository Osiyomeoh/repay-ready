// SERV Reasoning is the second key on the gate. It reads the person's own
// words into trigger inputs (never inventing any), and it reaches its own
// ARM / ADJUST / REFUSE from the check results under a branching policy
// (Multipath), with Shadow Agent validating the draft. Our code then compares
// SERV's verdict and numbers with the deterministic gate; any disagreement,
// error or timeout is a REFUSE.
import type { Report, Verdict } from "./checks.js";

const BASE_URL = process.env.SERV_BASE_URL ?? "https://inference-api.openserv.ai/v1";
const BASE_MODEL = process.env.SERV_MODEL ?? "gpt-5.4-mini";

export class ServError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /** True when SERV declined the request (Prompt Guard), not a fault. */
    readonly refused = false,
  ) {
    super(message);
  }
}

interface ChatResponse {
  id: string;
  model: string;
  choices: { message: { content: string | null; refusal?: string | null }; finish_reason: string }[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export interface ServCall<T> {
  value: T;
  id: string;
  model: string;
  ms: number;
  usage: ChatResponse["usage"] | null;
}

async function chat<T>(body: Record<string, unknown>, timeoutMs: number): Promise<ServCall<T>> {
  const key = process.env.SERV_API_KEY;
  if (!key) throw new ServError("SERV_API_KEY is not set");
  const t0 = Date.now();
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  }).catch((e: Error) => {
    throw new ServError(`SERV request failed: ${e.message}`);
  });
  const text = await res.text();
  if (!res.ok) throw new ServError(`SERV ${res.status}: ${text.slice(0, 300)}`, res.status);
  let json: ChatResponse;
  try {
    json = JSON.parse(text) as ChatResponse;
  } catch {
    throw new ServError("SERV response was not JSON", res.status);
  }
  const choice = json.choices?.[0];
  if (choice?.message.refusal) throw new ServError(`SERV refused: ${choice.message.refusal.slice(0, 200)}`, res.status, true);
  if (!choice || choice.finish_reason !== "stop" || !choice.message.content) {
    throw new ServError(`SERV returned no usable answer (finish_reason ${choice?.finish_reason ?? "none"})`);
  }
  let value: T;
  try {
    value = JSON.parse(choice.message.content) as T;
  } catch {
    // Prompt Guard answers with an endpoint-shaped refusal in plain text.
    throw new ServError(`SERV did not return the requested JSON: ${choice.message.content.slice(0, 200)}`, res.status, true);
  }
  return { value, id: json.id, model: json.model, ms: Date.now() - t0, usage: json.usage ?? null };
}

const nullable = (type: "number" | "string" | "integer") => ({ type: [type, "null"] });

// ─── 1. The person's words → trigger inputs ─────────────────────────────────

export interface Situation {
  trigger_hf: number | null;
  amount_usdc: number | null;
  amount_is_max: boolean;
  expires_days: number | null;
  away_days: number | null;
  passport_usdc: number | null;
  /** Anything the person asked for that this check cannot do. */
  out_of_scope: string | null;
}

const SITUATION_PROMPT = `You turn one person's description of their Aave loan plans into the inputs of a Kite auto-repay trigger.
Rules:
- Copy only values the person stated. If a value is not stated, return null. Never pick a value for them: Kite's rules forbid choosing these inputs for the user.
- trigger_hf: the health factor at which they want the repay to fire (for example "if it drops to 1.1" → 1.1).
- amount_usdc: the USDC amount they want repaid. amount_is_max is true only if they said the whole or full debt, all of it, or max.
- expires_days: how long they want it armed, in days (a week = 7). away_days: how long they will be unable to act (travel, sleep, hospital), in days. Round partial days up.
- passport_usdc: USDC they say is in their Kite Passport wallet.
- out_of_scope: a short note if they ask for something else (another chain, a non-USDC debt, a guarantee), else null.`;

export async function readSituation(text: string): Promise<ServCall<Situation>> {
  return chat<Situation>(
    {
      model: BASE_MODEL,
      messages: [
        { role: "system", content: SITUATION_PROMPT },
        { role: "user", content: text.slice(0, 2000) },
      ],
      tools: [{ type: "function", function: { name: "serv_prompt_guard" } }],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "situation",
          strict: true,
          schema: {
            type: "object",
            properties: {
              trigger_hf: nullable("number"),
              amount_usdc: nullable("number"),
              amount_is_max: { type: "boolean" },
              expires_days: nullable("integer"),
              away_days: nullable("integer"),
              passport_usdc: nullable("number"),
              out_of_scope: nullable("string"),
            },
            required: ["trigger_hf", "amount_usdc", "amount_is_max", "expires_days", "away_days", "passport_usdc", "out_of_scope"],
            additionalProperties: false,
          },
        },
      },
    },
    25_000,
  );
}

// ─── 2. SERV's own verdict over the check results ───────────────────────────

export interface ServVerdict {
  verdict: Verdict;
  /** IDs of the checks that decided the verdict. */
  deciding_checks: string[];
  /** Up to four plain sentences for the borrower, naming every fix. */
  message: string;
}

export const VERDICT_POLICY = `You decide whether a borrower should arm a one-shot Kite auto-repay on their Aave v3 loan on Base, from check results computed by code. You do not compute anything yourself; you apply this policy to the results exactly.

Each check has status pass, fail or unknown, and on_fail REFUSE or ADJUST.
- If every check is pass → ARM.
- Else if any check that is not pass has on_fail REFUSE → REFUSE. Deciding checks: every non-pass check with on_fail REFUSE, all of them.
- Else → ADJUST. Deciding checks: every non-pass check.
- For ARM, deciding checks is an empty list.

Message rules:
- At most four short sentences a non-expert can act on. Start with the verdict word.
- For REFUSE, first say plainly why arming now would not reliably help.
- For ADJUST and REFUSE, then name every fix given on any non-pass check, whatever its on_fail, so the borrower sees everything to change in one message. Use each fix's own value: triggerHf is a new trigger, amount a new repay in USDC ("max" is the full debt), expiresDays a new expiry in days, passportUsdc the USDC to hold in the Passport wallet, and an action is said as written.
- Use only numbers that appear in the check results. Never promise protection or a guarantee: say "reduces liquidation risk" if needed.`;

const VERDICT_HINT =
  "The verdict must follow the policy from the check statuses and on_fail values exactly. The message must start with the verdict word, name every fix given on a non-pass check, and contain no number absent from the check results.";

export async function servVerdict(report: Report): Promise<ServCall<ServVerdict>> {
  const facts = report.checks.map((c) => ({ id: c.id, status: c.status, on_fail: c.onFail, detail: c.detail, fix: c.fix ?? null }));
  return chat<ServVerdict>(
    {
      model: `${BASE_MODEL}-serv-multipath`,
      messages: [
        { role: "system", content: VERDICT_POLICY },
        { role: "user", content: JSON.stringify({ checks: facts }) },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "serv_shadow_agent",
            parameters: {
              type: "object",
              properties: { hint: { type: "string", default: VERDICT_HINT }, max_iterations: { type: "integer", default: 3 } },
            },
          },
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "verdict",
          strict: true,
          schema: {
            type: "object",
            properties: {
              verdict: { type: "string", enum: ["ARM", "ADJUST", "REFUSE"] },
              deciding_checks: { type: "array", items: { type: "string", enum: report.checks.map((c) => c.id) } },
              message: { type: "string" },
            },
            required: ["verdict", "deciding_checks", "message"],
            additionalProperties: false,
          },
        },
      },
    },
    // Slowest verdict so far: 41.9 s (CLAIMS.md). api/check.ts allows 60 s in all.
    55_000,
  );
}

// ─── 3. The recheck: SERV and the code must agree ───────────────────────────

/** Numbers as they appear in text: 1.05, 1,250.00, 30. */
const numbersIn = (s: string) => (s.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => Number(n.replace(/,/g, "")));

export interface Agreement {
  agrees: boolean;
  problems: string[];
}

export function recheck(report: Report, serv: ServVerdict): Agreement {
  const problems: string[] = [];
  if (serv.verdict !== report.verdict) problems.push(`SERV said ${serv.verdict}; the checks say ${report.verdict}`);
  if (!serv.message.trim().toUpperCase().startsWith(serv.verdict)) problems.push("message does not start with the verdict");
  const allowed = new Set(numbersIn(JSON.stringify(report.checks)));
  const stray = numbersIn(serv.message).filter((n) => !allowed.has(n));
  if (stray.length) problems.push(`message uses numbers not in the checks: ${stray.join(", ")}`);
  if (/\bguarantee|\bprotects?\b|\bsafe from\b/i.test(serv.message)) problems.push("message promises protection");
  const failing = new Set(report.checks.filter((c) => c.status !== "pass").map((c) => c.id));
  const unknown = serv.deciding_checks.filter((id) => !failing.has(id as never));
  if (unknown.length) problems.push(`deciding checks that passed: ${unknown.join(", ")}`);
  return { agrees: problems.length === 0, problems };
}
