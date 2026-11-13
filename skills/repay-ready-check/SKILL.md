---
name: repay-ready-check
description: >-
  Check a Kite auto-repay on an Aave v3 Base loan before it is armed. Repay Ready
  reads the loan from Aave, replays the user's own trigger through the prices Aave
  used on Oct 10, 2025, and answers ARM, ADJUST or REFUSE. Invoke before
  `kpass defi repay-trigger create`, whenever the user wants to arm, change or
  re-arm an auto-repay, or asks whether their trigger would have fired in time.
user-invocable: true
allowed-tools:
  - "Bash(curl -s https://repay-ready.vercel.app/api/*)"
  - "Bash(curl -s -X POST https://repay-ready.vercel.app/api/*)"
---

# Repay Ready check (before a Kite auto-repay)

Kite's `defi-auto-repay` skill arms a one-shot repay. This skill runs first and says
whether the trigger the user chose would have repaid in time on the worst night on
record. Only an ARM answer goes on to `defi-auto-repay`.

## When to Use This Skill

- The user is about to run `kpass defi repay-trigger create`, or asks you to.
- The user wants to change a trigger, or arm a new one after one fired.
- The user asks whether their trigger is "safe", "enough" or "in time".

## When NOT to Use This Skill

- The debt is not only USDC, or the loan is not on Aave v3 on Base. Kite's auto-repay
  does not serve it. Say so; there is nothing to check.
- The user only wants to list, check or cancel existing triggers. Use `defi-auto-repay`.

## Rules (Do Not Skip)

1. **Never invent the inputs.** Ask the user for each one: the loan address, the
   trigger health factor, the repay amount in USDC (or the full debt), how many days to
   keep it armed, and how many days they will be unable to act. The USDC in their Kite
   Passport wallet is optional. Do not suggest values and do not fill gaps with defaults.
2. **Never apply a fix yourself.** An ADJUST answer names the smallest change that
   would pass. Show it as written and ask the user what they want. Then check again.
3. **The user signs, not you.** Ownership is proved by the user signing a message with
   the wallet that owns the loan. Never ask for a private key or seed phrase. Never sign.
4. **Show Kite's wrong-address warning verbatim**, from the response's `kiteWarning`:
   > Kite will repay the loan of the address you entered. If it isn't yours, your funds will repay someone else's loan and cannot be recovered.
5. **Say it fires once.** After Kite repays, the trigger is done; to keep auto-repay on,
   the user arms a new one, and should check it again first.
6. **Fail closed.** Arm only when `final.verdict` is `ARM` and `final.command` is set.
   An error, a timeout, a missing field, ADJUST or REFUSE all mean: do not arm.
7. **Words.** An armed repay reduces liquidation risk. Never say it protects the loan or
   guarantees anything. The answer is about the Oct 10, 2025 record and Kite's measured
   fire delay. It is not a price forecast.

## Steps

### 1. Read the loan

```bash
curl -s "https://repay-ready.vercel.app/api/position?address=<ADDRESS>"
```

Show the Position card. Stop and explain if `position.hf` is null (no debt),
`position.usdcOnly` is false, `position.hfMatches` is false, or `replay.ok` is false
(`replay.reason` says why).

### 2. Ask for the inputs

Ask for every value in Rule 1, in the user's own words. Repeat them back before you go on.

### 3. Prove the loan is theirs

Give the user `ownership.message` from step 1, exactly as returned. They sign it as a
plain message ("Sign message" / `personal_sign`) with the wallet that owns the loan and
paste the `0x…` signature. The message expires after `ownership.maxAgeSeconds`
(15 minutes); if it does, read the loan again for a fresh one. Without a signature the
check will not answer ARM.

### 4. Run the check

```bash
curl -s -X POST https://repay-ready.vercel.app/api/check \
  -H 'content-type: application/json' \
  -d '{"address":"<ADDRESS>","triggerHf":<HF>,"amount":<USDC or "max">,"expiresDays":<DAYS>,"awayDays":<DAYS>,"passportUsdc":<USDC or null>,"message":"<ownership.message, JSON-escaped>","signature":"<0x…>"}'
```

Send `message` byte for byte, newlines included. The check can take up to a minute.
At most 10 checks a minute per caller; on HTTP 429, wait a minute.

### 5. Show the answer

Show the Verdict card. Then:

- **ARM**: show Kite's warning (Rule 4), say it fires once (Rule 5), and hand
  `final.command` to `defi-auto-repay` exactly as returned. It is the checked trigger.
  The user arms it with their passkey.
- **ADJUST**: list each check whose `status` is not `pass`, with its `detail` and `fix`.
  Ask the user what they want to change (Rule 2), then go back to step 4.
- **REFUSE**: show `final.reason` when it is set, and each failing check's `detail`.
  Do not arm.

## Display Cards — MANDATORY

**Position card**

```
Aave v3 Base loan  <position.user>
Health factor      <position.hf, 4 decimals>   (block <position.blockNumber>)
Collateral         <symbol $usd> + …
Debt               <symbol $usd> + …
USDC only          <yes | no>
```

**Verdict card**

```
Repay Ready: <final.verdict>
Trigger      health factor < <input.triggerHf>, repay <input.amount> USDC, armed <input.expiresDays> days
Checks       <label>: <pass | fail | unknown> — <detail>   (one line per report.checks[])
SERV         <agrees | disagrees: serv.agreement.problems>   (or serv.error)
Why          <final.reason, when set>
Command      <final.command, only on ARM>
```

## Error Handling

| Reply | Meaning | Do |
| --- | --- | --- |
| HTTP 400 `{ "error": … }` | An input is missing or out of range | Show the error; ask the user for that value |
| HTTP 429 | Rate limit | Wait a minute, then retry once |
| HTTP 5xx, timeout, no JSON | The check did not run | Do not arm. Say the check failed |
| `serv.error` set | SERV Reasoning did not answer | The verdict is REFUSE by design. Do not arm |

## Cross-Skill References

- `defi-auto-repay` (Kite passport-skills): arms, lists, checks and cancels triggers.
  Run it only with the `final.command` from an ARM answer.
- Source and every number behind the check: https://github.com/Osiyomeoh/repay-ready
  (CLAIMS.md).
