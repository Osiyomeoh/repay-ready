# Repay Ready

Check a Kite auto-repay on your Aave loan against the worst night on record, before you arm it.

## Quick start

**Paste a loan, see how long Kite would have had on Oct 10, 2025.**

Open https://repay-ready.vercel.app/?address=0xDA0AFe3f64bc06b2cb4Fbf8eA98Bd7c4C907185B (a real cbBTC / USDC loan on Aave Base; the link reads it on open, or paste any address and press **Read loan**). You will see:
- the loan's health factor rebuilt from Aave and matched to Aave's own number;
- the liquidation penalty from Aave's config: on this loan, a liquidator who repays $100 of debt takes $104 of cbBTC;
- the Oct 10, 2025 replay: **"4 min from 1.05 to liquidatable, worst case"** (3.5 min for ETH collateral).

Fill the trigger fields, press **Run the check**, and you get ARM, ADJUST or REFUSE with every check spelled out. A recorded run, with a real SERV answer, will be one click from the first screen (or `/?sample`) once `data/sample.json` is recorded.

**Locally, and from the terminal:**

```sh
npm install
npm run dev                      # http://localhost:3000, same deep links
npm run check -- 0xDA0AFe3f64bc06b2cb4Fbf8eA98Bd7c4C907185B --hf 1.05 --amount 50 --expires 14 --away 10 --passport 80
```

The check prints each result and the final verdict. On Nov 13, 2026, on the corrected Oct 10 record, this input gave REFUSE: a 50 USDC repay left the replayed HF at 0.9959, and the check suggested 75 USDC instead ([run](runs/2026-11-13-oct10-feeds.txt)). The loan is live, so your numbers will drift.

## Who it is for

On Oct 10, 2025, Aave liquidated more than $250M of loans ([Aave](https://aave.com/blog/historical-liquidations)). One borrower wrote on the Aave forum a week later: "I lost all my life savings." ([thread](https://governance.aave.com/t/chaos-labs-risk-report-insights-from-recent-market-events-10-11-25/23248)).

Kite's `kpass defi` now lets a borrower arm a one-shot auto-repay: when the health factor drops below a trigger, Kite repays USDC from the borrower's Passport wallet. That reduces liquidation risk only if two things hold:
- the repay lands before the loan becomes liquidatable;
- the repay is big enough to lift the loan clear.

Nobody tells the borrower whether their trigger and amount meet both. Repay Ready does, before they arm it with their passkey.

## The real night, loan by loan

From Oct 10, 2025 12:00 UTC to Oct 11 12:00 UTC, liquidators repaid $5,124,812.26 of USDC debt for 322 borrowers on Aave v3 Base, and those borrowers paid $345,765.39 of liquidation bonus. For 139 of them, Aave's health factor was still at or above 1.00 one block before the liquidation: they were liquidated in the block that made them liquidatable, so a repay has to land before 1.00, not after.

278 of the 322 had USDC as their only debt, the loans Kite's auto-repay serves. 173 of those kept the same collateral and debt from noon until they were liquidated. Replaying each one through the record matched Aave's own health factor one block before its liquidation to within 9.25e-5. On those real paths, 157 crossed 1.05 after noon, and from 1.05 to liquidatable took 20.5 minutes at the median, under 5 minutes for 31, and 4 minutes for the fastest. 87 of the 322 owed under $500, below [DeFi Saver's minimum for automation](https://help.defisaver.com/automations/requirements-for-using-automation) on Aave Base.

Look an address up with `/?night=0x…`, or open `/?night` for the fastest loan. Rerun it with `npx tsx scripts/oct10-liquidations.ts`; every number is in [CLAIMS.md](CLAIMS.md). The backtest also caught a bug in the check, now fixed: the health-factor rebuild used Aave's pre-v3.5 formula and refused loans with mixed collateral ([CLAIMS](CLAIMS.md)).

## How the check decides

1. **Your loan, exactly.** It reads every balance, price, liquidation threshold and e-mode from Aave v3 on Base at one block and rebuilds the health factor in integer math. If the result doesn't match Aave's `getUserAccountData`, it stops. On the demo loan the relative gap was 1.35e-11 (Nov 11, 2026).
2. **The worst night on record.** It replays every Chainlink update Aave used from Oct 10 12:00 to Oct 11 12:00 UTC, 2025. Each update is tried as the moment the loan sits exactly at the trigger, and the fastest fall to 1.00 is kept.
3. **Kite's real speed.** The time to liquidatable must be at least 2× Kite's measured fire delay. Until that delay is measured, the room check is UNKNOWN and the verdict is REFUSE.
4. **The repay is big enough.** It replays the repay landing and requires the lowest health factor afterwards to stay at or above 1.05.
5. **The rest of the plan.**
   - Kite accepts the trigger: above 1.00 and below the current health factor.
   - The Passport wallet holds enough USDC for the repay. For a full-debt repay, that includes interest up to expiry.
   - The trigger stays armed while you're away: 30 days at most.
   - You signed a message proving the loan is yours.

| Check outcome | Verdict |
|---|---|
| Every check passes | ARM, and the `kpass` command is shown |
| A check fails that you can fix by changing an input | ADJUST, with the change shown as a button you choose to press |
| A check fails that no input fixes (no time, not your address, debt that isn't USDC) | REFUSE |

The policy numbers are choices, not facts, and are listed as [POLICY] in [CLAIMS.md](CLAIMS.md).

## Where SERV Reasoning comes in

Repay Ready uses [SERV Reasoning](https://docs.openserv.ai/serv-reasoning/api/chat-completions.md) twice:

- **Reading the plan.** "I'm away 10 days, repay 60 USDC if it hits 1.1…" goes to `gpt-5.4-mini` with `serv_prompt_guard` and a strict JSON schema.
  - Anything not stated comes back as `null`, and the form leaves that field for you.
  - SERV never picks a trigger value; Kite's own guidance says the user must choose them.
- **A second key on the verdict.** The check results go to `gpt-5.4-mini-serv-multipath` with `serv_shadow_agent`, which drafts a verdict and validates it before answering. The code then rechecks SERV's answer:
  - the same verdict;
  - the deciding checks it names really failed;
  - no number that isn't in the checks;
  - no promise of protection.

**It fails closed.** If SERV errors, refuses, times out or disagrees, the final answer is REFUSE and no command is shown.

## Who pays for a check

- **What is at stake.** The page reads each loan's liquidation penalty from Aave's own config. On the demo loan (e-mode "cbBTC Stablecoins") it is 4%: a liquidator who repays $100 of the debt takes $104 of the cbBTC. That penalty, on every dollar liquidated, is what a late or undersized repay costs.
- **What a check costs.** One plan reading plus one verdict comes to about $0.0025 to $0.0030 of SERV tokens at the listed prices, over the measured runs ([CLAIMS](CLAIMS.md)). That is a floor: Prompt Guard and Shadow Agent are billed on top, so the full cost is [FILL: console]. The Aave and Chainlink reads use public Base RPCs.
- **How it gets paid, inside Kite.** Kite Passport already makes paid HTTP calls over x402 in USDC, from a session the user approves with a total budget and a per-call cap ([`x402-execute`](https://github.com/gokite-ai/passport-skills/tree/main/x402-execute)). It also lists paid services in a catalog ([`kite-discovery`](https://github.com/gokite-ai/passport-skills/tree/main/kite-discovery)). So the Passport that will fund the repay can also pay for the check before arming, within a limit the user set.
  - Not built yet: the paid x402 endpoint.
  - The price is [POLICY: FILL].
- **Built to be embedded.** `POST /api/check` and `npm run check -- … --json` return the same verdict, so a wallet or an agent can run the check right before `kpass defi repay-trigger create`. [`skills/repay-ready-check/SKILL.md`](skills/repay-ready-check/SKILL.md) is that step as an agent skill, in the style of Kite's passport-skills: it runs before `defi-auto-repay` and hands over the command only on ARM.

## What it never does

- It never holds keys or funds, and it can't arm anything. You arm with Kite, with your passkey.
- It never says a trigger "protects" you. A Kite trigger reduces liquidation risk, and it fires once.
- It shows Kite's own warning verbatim, twice: "Kite will repay the loan of the address you entered. If it isn't yours, your funds will repay someone else's loan and cannot be recovered."

## Run it

| | |
|---|---|
| `npm run dev` | page and API on http://localhost:3000 |
| `npm run check -- <address> --hf --amount --expires --away [--passport] [--json]` | the check from the terminal |
| `npm test` | 73 tests; some read live Base, so they need network |
| `npm run typecheck` | strict TypeScript over `src`, `api`, `scripts`, `test` and `public/app.js` |
| `npx tsx scripts/oct10-table.ts` | the room table in CLAIMS.md |
| `npx tsx scripts/oct10-liquidations.ts` | the real-night backtest: every USDC loan Aave liquidated on Base that night, to `public/oct10-liquidations.json` (needs archive RPCs) |
| `npm run spike:serv` | one real SERV call of each kind (needs `SERV_API_KEY`) |
| `npm run record:sample -- <address> --hf …` | saves a real run to `data/sample.json` for the recorded-run button |
| `npm run fire-delay -- <address> --hf <trigger> --repay-tx <hash>` | measures Kite's fire delay from a fired trigger, using chain data only |
| `npm run stills` | the gallery stills to `ship/stills/`, from the running page in headless Chrome; fails on any console error or sideways scroll |
| `npm run og` | `public/og.png` (the 1200×630 social card) and `public/apple-touch-icon.png`, rendered from the running page |
| `npm run clip` | the hero replay as video to `ship/clips/` (1920×1080 and 1080×1080 MP4, frame by frame; needs ffmpeg) |

Deep links: `/?address=0x…` reads that loan on open, `/?sample` opens the recorded run, `/?night=0x…` looks an address up in the Oct 10 liquidation record, and `/?night` shows the fastest real loan.

Environment variables (all optional; without the key every check ends in REFUSE):

| Variable | Use |
|---|---|
| `SERV_API_KEY` | SERV Reasoning |
| `BASE_RPC_URL` | a Base RPC (defaults to public endpoints) |
| `SERV_MODEL` | the base model, default `gpt-5.4-mini` |

Deploys to Vercel as static files from `public/` with the functions in `api/`.

## Limits

- Debt must be USDC only. That is Kite's rule as well.
- Collateral must be priced from Aave's ETH, BTC or USDC Chainlink feeds on Base. Anything else is refused with the asset named.
- Oct 10, 2025 is one night. A worse one can happen.
- Kite's fire delay is not measured yet ([FILL]), so every trigger is currently REFUSE. It is measured from one real fired trigger with `npm run fire-delay`:
  - it starts from the first block where Aave's health factor is below the trigger;
  - it ends at the block holding Kite's repay;
  - it refuses to report a number if the crossing is ambiguous.

Every number in this README, the page and the video is listed with its source in [CLAIMS.md](CLAIMS.md).

## License

MIT
