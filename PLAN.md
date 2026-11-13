# PLAN: Repay Ready

**One line:** Kite can repay your Aave loan once, automatically, when your health factor drops. Before you arm it with your passkey, Repay Ready replays your exact loan and trigger through Aave's own prices on Oct 10, 2025 and tells you whether the repay would have landed in time.

**Headline number:** on Oct 10, 2025, a 1.05 trigger had **3.5 minutes** from firing to liquidatable for ETH collateral, and 4 for BTC (CLAIMS.md). Until Nov 13, 2026 this said 3 minutes, from a record that used the wrong feeds (see CLAIMS.md, Correction).

## Flow

```
address ──► readPosition (Aave v3 Base, one block, HF rebuilt and matched to Aave)
        ──► buildIndex (Oct 10 Chainlink rounds, Aave's own feeds)
plan text ─► SERV readSituation (Prompt Guard, strict schema; copies stated values only)
        ──► the person confirms the fields (we never pick them: a Kite rule)
signature ─► verifyOwnership (EOA, ERC-1271, ERC-6492)
        ──► evaluate: 9 checks → ARM / ADJUST / REFUSE (deterministic)
        ──► SERV servVerdict (Multipath policy, Shadow Agent validation)
        ──► recheck: SERV and the code must agree on the verdict, the deciding checks
            and every number; no promises
        ──► final: ARM only if both say ARM. Any SERV error, 502, timeout or
            disagreement gives REFUSE. The kpass command is shown only on ARM.
```

## Checks (`src/checks.ts`)

| id | Question | Fails to |
|---|---|---|
| model | Does our HF match Aave's to 1e-6? | REFUSE |
| eligible | Is USDC the only debt? | REFUSE |
| replay | Is every collateral on a recorded feed? | REFUSE |
| ownership | Did this wallet sign? | ADJUST (sign) / REFUSE (bad signature) |
| kite_rule | 1 < trigger < current HF | ADJUST |
| room | Worst-case room ≥ 2× Kite's measured delay | ADJUST (higher trigger) / REFUSE (none works, or delay unmeasured) |
| size | Replayed HF after the repay ≥ 1.05 | ADJUST (amount) |
| funding | Passport USDC ≥ debt at expiry | ADJUST |
| coverage | Expiry ≥ days away, ≤ 30 | ADJUST / REFUSE (away > 30) |

## Surfaces

- `GET /api/position?address=`: position, the Oct 10 replay from the high, and the room table.
- `POST /api/plan`: `{text}` → SERV-read fields for the person to confirm.
- `POST /api/check`: `{address, input, message?, signature?}` → checks, SERV verdict, recheck, final verdict, command.
- `GET /api/sample`: a recorded real run (`data/sample.json`), so judges need no wallet, key or RPC.
- `public/`: one page. Address → position card → Oct 10 chart → plan → sign → verdict → the exact `kpass` command and Kite's warning, verbatim.
- `npm run check -- <address> …`: the same check from the terminal.

## Blocked on Samuel (in order)

1. `SERV_API_KEY` in `.env`, and data collection turned on.
2. Install `kpass`, then log in.
3. The kill test, which measures Kite's fire delay → `src/kite-delay.ts`.
4. ~~Vercel login, so I can deploy.~~ Done Nov 11: https://repay-ready.vercel.app. SERV key on Vercel since Nov 12.

## Cut list (first to last)

1. x402 seller endpoint (the price stays in the write-up).
2. The lookalike-address check.
3. Free-text plan reading (the form fields stay).

**Never cut:** the ownership signature; room against the measured delay; the SERV verdict with recheck; fail closed.

## Built in the window

All code in this repo, from Nov 11, 2026. Prior work, declared:
- Loan Shield (MIT, Morpho): the repay-to-target idea only. No code is reused.
