# SHIP: Repay Ready, SERV Hackathon Edition 02, Kite track

**Deadline:** "Submit by November 15, 2026 at 23:59 UTC" (Nov 16, 00:59 in Lagos). Source: [hackathon page](https://www.openserv.ai/hackathon-2), re-checked Nov 14, 2026 (unchanged since Nov 11).
- Judged on "creativity, user readiness and revenue potential".
- Prizes: "$5,000 awarded across tracks · breakdown announced at kickoff"; track winner × 2, best overall build and special mention are all still "TBA".
- The page names no judges and no video length limit.
- It requires no account tag or hashtag on the X post.

**Required:**
- a public repo;
- a demo link or video;
- a short write-up: what it does, how it uses SERV Reasoning, and which track;
- an X post, linked in the Typeform.

**The one thing that decides how strong this is: the kill test (step 2).** Until Kite's fire delay is measured, every verdict is REFUSE, the video has no Kite moment, and the sample run can only show "unmeasured". Everything after step 2 is a short task for me.

---

## 1. Your steps, in order

| # | When | You do | Then I do |
|---|---|---|---|
| 1 | Read Nov 14 | Still yours:<br>(b) find data collection: it may be on API Keys, which I don't open because it can show the key, or ask OpenServ;<br>(c) top up or redeem the $5 before judging if the live check should keep working. | I read your signed-in console in Chrome (your "do 1-4"):<br>(a) **Cost:** 7 verdict calls billed $0.01 to $0.03 each, about $0.015 on average; plan readings $0.001 to $0.004. Now in CLAIMS, README and §3.<br>(b) **Data collection: not found.** Organization settings has only Name, Require 2FA, Members and Delete. Account, Billing and Integration don't have it either. OpenServ's docs don't mention it (searched in full Nov 14).<br>(c) **Credits:** $0.89 left of one $1 grant ("Credit grant", Serv Team, Nov 11). The $5 hasn't arrived; Billing has a "Redeem a code" button. At about $0.015 a check that is roughly 55 to 60 more checks, and every public check spends them. |
| 1d | Done Nov 14 | You chose $0.05 per check. | In CLAIMS (Revenue row), README "Who pays", the write-up (§4) and the video's closing line (§3). About 3× the average SERV cost; more than the dearest check so far ($0.03 verdict plus $0.004 plan reading). Nothing is charged until the x402 endpoint exists. |
| 2 | Nov 12 (≈ 1 h, a few dollars on Base) | **The kill test.** Follow the runbook in §2 and screen-record it. | Run `npm run fire-delay`, set `KITE_FIRE_DELAY` in `src/kite-delay.ts`, rerun the tests, record the sample, then run `npm run stills` for the verdict stills. |
| 3 | Done Nov 12 | You chose that I add the key. | Piped from `.env` into `vercel env add --sensitive`, never printed; redeployed. A live check on production: SERV said REFUSE and agreed with the checks (11.9 s); through the page at 390 px, 0 console errors and 0 overflow (`runs/2026-11-12-live-check.txt`). Public checks now spend your SERV credits (about 10 a minute per visitor). |
| 4 | Done Nov 11 | You said "go". | Small local commits on `main`, authored by you, with no co-author trailer; not pushed. WIN-DECISION.md, GITHUB-CRAWL.md and every `.env` file stay out of the repo and out of the deploy (`.gitignore`, `.vercelignore`). |
| 5 | Done Nov 14 | You said "do 1-4". | Made https://github.com/Osiyomeoh/repay-ready public; it opens without signing in. Before that I checked the history: the only env file ever committed is `.env.example`, with empty keys. Created private on Nov 12 and pushed `main`; the first CI run passed (typecheck, format check, 63 tests). |
| 6 | Nov 13–14 | Record the video (§3), using the kill-test recording from step 2 (Plan A), or Plan B if the kill test isn't done by then. | Check every spoken number against CLAIMS. |
| 7 | **Nov 15, 12:00 UTC** | **Feature freeze.** From here, fixes only. | |
| 8 | Nov 15 | Post on X (§5) with the video and still 01. | |
| 9 | Nov 15, before 23:59 UTC | Fill in the Typeform (§6) and submit. | |
| 10 | After 23:59 UTC | Don't push to the repo. | |

---

## 2. Kill-test runbook (measures Kite's fire delay)

Commands come from [passport-skills `defi-auto-repay/references/commands.md`](https://github.com/gokite-ai/passport-skills/blob/main/defi-auto-repay/references/commands.md). Every value is your choice. The rules below are Kite's own, plus what keeps the measurement clean.

**Before you start** (from Kite's [GETTING_STARTED](https://github.com/gokite-ai/passport-skills/blob/main/GETTING_STARTED.md), [authenticate-user](https://github.com/gokite-ai/passport-skills/blob/main/authenticate-user/SKILL.md) and [defi-auto-repay](https://github.com/gokite-ai/passport-skills/blob/main/defi-auto-repay/SKILL.md), read Nov 12, 2026 at commit `0a95e9c`; re-checked Nov 14 at `efabd88`, the latest: since `0a95e9c` only `wallet-send` changed, so these steps still match Kite's files)
1. **Install `kpass` 6.8.9 or later**, outside this project folder:
   ```sh
   cd ~ && git clone https://github.com/gokite-ai/passport-skills && bash passport-skills/scripts/setup.sh
   kpass --version
   ```
   Kite's `setup.sh` keeps a `kpass` that is new enough. Otherwise it runs `curl -fsSL https://cli.gokite.ai/install.sh | bash` (it accepts only `cli.gokite.ai` as the installer host).
2. **Sign in.** `kpass me --output json` shows whether you are. If not, `kpass login` opens the browser to approve, and `kpass signup` creates a new account (Passport emails a magic link). Every `kpass defi` command needs a login, or it exits 3, "Not logged in".
3. **One-time dashboard setup** (GETTING_STARTED step 3): register a passkey (you approve the trigger with it) and fund the wallet.
4. **Passport EVM wallet.** If `kpass defi position` returns `wallet_not_found`, Kite's meaning is "The user has no Passport EVM wallet to pay from yet". Set it up in the Passport dashboard; the skill files don't name a command for it.
5. **Your own wallet** holds a little ETH on Base for gas.

**Real money:** Kite's skill says production runs "on Base mainnet with Circle USDC — a repay spends real funds". Keep the loan and the repay small.

**Steps**
1. **Open a small loan on Aave v3 Base** from your wallet: supply some collateral (WETH or cbBTC), then borrow a few USDC. USDC must be the loan's only debt; otherwise Kite returns `aave_position_unsupported_debt`.
2. **Check that Kite sees it:**
   ```sh
   kpass defi position --address <LOAN> --output json
   ```
   Note `supported`, `health_factor` (call it H), `wallet.address` (your Passport wallet), `wallet.usdc` and `wallet.eth`.
3. **Fund the Passport wallet** (`wallet.address` from step 2) with more USDC on Base than the repay amount you'll choose. If it holds less, Kite warns "Top it up before the trigger fires".
4. **Choose your trigger T and amount A.** Kite requires 1.0 < T < H.
   - Put T a little below H. Then one small extra borrow crosses it, and the loan stays far from 1.0.
   - A is any USDC amount up to your Passport balance, or `max`.
5. **Start the screen recording.** This becomes the video's Kite moment.
6. **Create the trigger:**
   ```sh
   kpass defi repay-trigger create --address <LOAN> --hf <T> --amount <A> --expires 24h --output json
   ```
   - Read the `warning` out loud. It is Kite's: "…your funds will repay someone else's loan and cannot be recovered."
   - Open `approval_url` and approve with your passkey before `approval_expires_at`. That is only minutes away; if it lapses, the trigger expires and you create a new one.
7. **Wait for it to arm:**
   ```sh
   kpass defi repay-trigger get --id <trigger_id> --wait --output json
   ```
   `trigger_status` should be `"armed"`.
8. **Cross the trigger once.** In the Aave app, borrow a little more USDC in **one transaction**, so the HF Aave previews is below T and still well above 1.0.
   - Don't supply, withdraw or repay anything else until it fires.
   - One crossing keeps the measurement unambiguous. The script refuses to report a number if HF went back above T before the repay.
9. **Wait for Kite to fire:**
   ```sh
   kpass defi repay-trigger get --id <trigger_id> --wait --timeout 3600 --output json
   ```
   - When `trigger_status` is `"fired"`, copy `trigger.repay_tx_hash` and `trigger.repaid_amount`.
   - If it comes back `failed` or `expired`, send me the whole JSON. That is a finding too.
10. **Send me:** LOAN, T, `trigger_id`, `repay_tx_hash`, and the JSON from step 9. I run:
    ```sh
    npm run fire-delay -- <LOAN> --hf <T> --repay-tx <repay_tx_hash> --trigger-id <trigger_id>
    ```
    It reads Aave's HF block by block from chain data alone. It prints the crossing block, the repay block and the delay in seconds, plus the line for `src/kite-delay.ts`. Anyone can rerun it.
11. **Afterwards:** repay and withdraw on Aave whenever you like. The trigger has fired once and is spent.

**Costs:** Base gas for the supply, borrow and repay [FILL: actual]. Kite's fee, if any: [FILL]; the skill files don't state one (re-checked Nov 14 at `efabd88`, including `passport-overview`, Kite's page on what Passport costs). Kite's repay uses your Passport's USDC to pay down your own loan.

---

## 3. Video script (no limit is stated; aim for ≤ 2:30)

Rules this script keeps:
- the person in the first 10 s;
- the sponsor moment by 0:30;
- one headline number ("3.5 minutes");
- a safe failure;
- no third-party music or logos (use no music; record our own screens only, no BaseScan or Aave branding in frame).

Kite wording rules:
- say "reduces liquidation risk", never "protects";
- say it "fires once";
- show Kite's warning verbatim.

**Footage that is ready now:**
- `ship/clips/oct10-replay-1080p.mp4` (1920×1080, 28 s, no sound). Its clock reads 20:50:04 UTC at 0:04.8 and 21:20:25 (the ETH low) at 0:13.3, checked frame by frame. Cut it; don't speed it up, since its caption states the playback speed.
- The "Why check first" drawings: record them on the page, where they move (still: `ship/stills/08-why-check-first.png`).
- Keep the replay between the quote and the drawings. The drawn person is "you", not bruce235 or any real borrower, and must not read as them.

**Plan A: the kill test is done.**

| Time | On screen | You say |
|---|---|---|
| 0:00–0:10 | Black card, white text: "I lost all my life savings." · bruce235, Aave governance forum, Oct 17, 2025. Then: "Oct 10, 2025: more than $250M of Aave loans liquidated." | "On October 10, 2025, Aave liquidated more than 250 million dollars of loans. A week later, one borrower wrote: 'I lost all my life savings.'" |
| 0:10–0:20 | The replay clip, 0:05 to 0:15: from 20:50 UTC through the ETH low at 21:20:25. | "That night, a loan at health factor 1.05 had **3.5 minutes** before it could be liquidated." |
| 0:20–0:30 | Scroll the three "Why check first" drawings, left to right. | "Kite can now repay your Aave loan automatically. It fires once, when your health factor drops below your trigger, even while you sleep. Its repay has to land inside that window." |
| 0:30–0:40 | The recorded run (`?sample`): the verdict card and the line "SERV Reasoning said … It agrees with the checks." | "Repay Ready replays your exact loan and trigger through that night, and SERV Reasoning has to agree with the code before it ever says ARM." |
| 0:40–1:05 | The checks list: room against Kite's measured delay, repay size, Passport funds, expiry. The ADJUST button with the suggested amount. | "Nine checks. Is there room for Kite's measured speed? Is the repay big enough to clear the loan? Is your Passport funded until expiry? If a fix exists, it shows the fix. You press it; it never picks for you." |
| 1:05–1:35 | Your kill-test recording: `create` → passkey approval → `armed` → one borrow → `fired` → the `npm run fire-delay` output with its seconds. | "We measured Kite on a real loan. HF crossed the trigger at block X; Kite's repay landed N seconds later. That number is what every check is held to, at twice the margin." |
| 1:35–1:55 | **Safe failure.** Sign for the demo loan with a wallet that doesn't own it → REFUSE, no command. Kite's warning on screen. | "If the loan isn't yours, it refuses, and there's no command to copy. Kite says it plainly: …" (read the warning). |
| 1:55–2:15 | Your own loan, signed: ARM, the exact `kpass defi repay-trigger create` command, the warning. | "On my own loan it says ARM and gives me Kite's exact command. I still arm it myself, with my passkey. It fires once. It reduces liquidation risk. It doesn't remove it." |
| 2:15–2:30 | The README "Who pays" lines and the repo URL. | "A check costs SERV about a cent and a half; we'll charge five cents. Next, the Passport that funds the repay can pay for each check over x402, inside a limit you set. Repay Ready: the repo is open." |

Fill N and X from the kill-test run before recording. Every spoken number must be in CLAIMS.md.

**Plan B: you record before the kill test is done.** While `KITE_FIRE_DELAY` is `null`, every check ends REFUSE, with the room check reading "Kite's fire delay has not been measured yet, so we cannot say Kite acts in time." (`src/checks.ts`). Keep 0:00–0:30 and 1:35–1:55 from Plan A and swap these rows:

| Time | On screen | You say |
|---|---|---|
| 0:30–0:40 | A check on the demo loan (`?address=`), or the recorded run if you've recorded it: SERV's line, then REFUSE. | "Repay Ready replays your exact loan and trigger through that night. SERV Reasoning has to agree with the code before it ever says ARM, and today it says REFUSE." |
| 0:40–1:05 | The checks list, stopping on the room check's line above. | "Nine checks. The one that decides it: Kite's speed hasn't been measured on a real trigger yet. So it won't guess. Every check is held to that number, at twice the margin, once it's measured." |
| 1:05–1:35 | "The real night, loan by loan": press "show the fastest one" and hold on its timeline. The tiles above it show 322 and $345,765; if you decide not to use those figures, start the shot at the lookup, below them. | "This is a real loan from that night. From health factor 1.05 to liquidatable took four minutes. A repay that lands after that is too late." |
| 1:55–2:15 | Your own loan, signed: REFUSE, no command; read the deciding check off the screen. | "On my own loan it still says REFUSE and gives no command. Once Kite's speed is measured, this is where it can say ARM, and I'd still arm it myself, with my passkey. It fires once. It reduces liquidation risk. It doesn't remove it." |
| 2:15–2:30 | As Plan A. | "A check costs SERV about a cent and a half; we'll charge five cents. Next, the Passport that funds the repay can pay for each check over x402, inside a limit you set. Repay Ready: the repo is open." |

Plan B's "four minutes" is the fastest of the 157 real loans that crossed 1.05 (240 s, CLAIMS "Real liquidations"); "3.5 minutes" stays the one headline number.

---

## 4. Submission write-up (Typeform "description"; also the repo's top)

> On Oct 10, 2025, Aave liquidated more than $250M of loans, and one borrower wrote "I lost all my life savings." That night, a loan at health factor 1.05 had 3.5 minutes before it could be liquidated.
> Repay Ready checks your Kite auto-repay against that night before you arm it with your passkey, and SERV Reasoning and the code must agree before it says ARM.

**What it does.** You paste an Aave v3 Base loan and type your Kite trigger (health factor, amount, expiry). Repay Ready then:
- rebuilds your health factor from Aave at one block and matches it to Aave's own number;
- replays all of Aave's Chainlink price updates from Oct 10–11, 2025 against your loan;
- returns ARM, ADJUST (with the fix) or REFUSE, with every check shown.

On ARM it gives the exact `kpass defi repay-trigger create` command and Kite's warning, verbatim.

**Who it is for.** Borrowers who arm Kite's one-shot auto-repay. That repay reduces liquidation risk only if two things hold:
- it lands before the loan is liquidatable;
- it is big enough to clear it.

**How it uses SERV Reasoning:**
- `gpt-5.4-mini` with `serv_prompt_guard` and a strict JSON schema reads a plan in plain words. Unstated values stay empty; SERV never picks a trigger.
- `gpt-5.4-mini-serv-multipath` with `serv_shadow_agent` drafts and validates the verdict from the check results.
- The code then rechecks SERV's answer: same verdict, real deciding checks, no new numbers, no promises.
- Any SERV error, refusal, timeout or disagreement gives REFUSE.

**Track: Kite.**
- Built on `kpass defi repay-trigger`.
- Every check is held to Kite's fire delay, measured on a real trigger ([FILL: N s, tx]).
- Kite's warning is shown verbatim.
- You still arm it yourself, with your passkey.
- Revenue fits Kite too: Passport pays for HTTP APIs over x402 from a session with a budget and a per-call cap, so a check can be paid by the same Passport that funds the repay. The price is $0.05 a check, against about $0.015 of SERV cost; the paid endpoint isn't built yet.

**Built during the hackathon:** all of Repay Ready's code (Nov 11–15, 2026). That covers:
- the Aave reader and the integer HF;
- the Oct 10 replay;
- the nine checks and the SERV layer;
- the page, the API and the CLI;
- the fire-delay tool;
- the real-night backtest over all 322 borrowers liquidated on USDC debt that night, and the agent skill;
- 73 tests.

Prior work, declared: Loan Shield (my MIT repo, Morpho) gave the repay-to-target idea. The Aave version is new code.

**Links:** demo https://repay-ready.vercel.app · repo https://github.com/Osiyomeoh/repay-ready · Kite fire tx [FILL] · every number with its source: CLAIMS.md.

---

## 5. X post (280 of 280 characters, with one link counted as 23)

```
Oct 10, 2025: an Aave loan at health factor 1.05 had 3.5 minutes before it could be liquidated.

Repay Ready replays your loan and Kite auto-repay through that night. SERV Reasoning and code must agree before it says ARM.

@openservai hackathon, Kite track
https://repay-ready.vercel.app
```

Attach the video and still 01. Tagging Kite: its official X account is **@GoKiteAI** (the X link in the footer of [gokite.ai](https://gokite.ai), checked Nov 14). The post is at 280 of 280, so adding "@GoKiteAI " (10 characters) means cutting 10 elsewhere; whether to tag is your call.

---

## 6. Typeform: every field

| Field | Answer | Status |
|---|---|---|
| Name | Samuel Aleonomoh | todo (you) |
| Email | yours | todo (you) |
| New to OpenServ? | your answer | todo (you) |
| Track | Kite | ready |
| New or existing project | New (Repay Ready is new code; Loan Shield declared in the description) | ready |
| Project name | Repay Ready | ready |
| Description: what, who, problem, how | §4 | ready except [FILL]s |
| Project URL | https://repay-ready.vercel.app | ready |
| X post URL | after step 8 | blocked: post |
| One additional URL | https://github.com/Osiyomeoh/repay-ready | ready (public since Nov 14) |
| Logo upload | `ship/logo.png` (512×512, the page's mark) | ready |
| "Is data collection enabled for your project?" | [FILL]: the setting isn't on the console pages I could open (step 1b); answer once you've found it or asked OpenServ | todo (you) |
| Team type | Solo | todo (confirm) |
| Experience building AI agents | your answer | todo (you) |
| Country | Nigeria | todo (confirm) |
| Company or school | your answer | todo (you) |
| Current role | your answer | todo (you) |
| Profile URL | e.g. github.com/Osiyomeoh | todo (you) |
| SERV feedback | §7 | ready to edit |
| Permission to quote it | your call | todo (you) |
| Updates opt-in | your call | todo (you) |

---

## 7. SERV feedback (draft, edit freely)

> Built Repay Ready on SERV Reasoning. It uses Prompt Guard with a strict schema to read a plan, and Multipath with Shadow Agent for a verdict that code then rechecks.
>
> What worked:
> - The OpenAI-compatible endpoint and strict `json_schema` were drop-in.
> - Prompt Guard's refusal arrives in `message.refusal`, so failing closed was one line.
>
> What would help:
> 1. **Latency guidance.** The Shadow Agent verdict took 30.0 s on Nov 11, then 11.9 s, 7.9 s and 19.5 s on Nov 12 and 41.9 s then 5.7 s on Nov 13, for 1.1k to 1.6k tokens per call; plain calls took 3.5 s. A documented p50/p95 per feature would help us set timeouts (we started at 45 s and raised it to 55 s after the 41.9 s run).
> 2. **Cost in the response.** `usage` leaves out Prompt Guard and Shadow Agent, so we couldn't compute cost per call from the API. The console billed each verdict $0.01 to $0.03, against $0.0014 to $0.0020 for its tokens at list price, with no breakdown. A cost field, or a breakdown with more than cent precision, would make pricing a product on SERV much easier.
> 3. **Credits.** The page says pre-registered participants get $5; my console shows one $1 credit grant (Nov 11) and nothing since. Is the $5 still coming, or is it a code to redeem?

---

## 8. Gallery stills, strongest first

| # | File | Shows | Status |
|---|---|---|---|
| 0 | `ship/stills/00-hero.png` | The front page: the headline and the whole night replayed (ETH, BTC, every liquidation) | done Nov 14 (also `00-hero-phone-390.png`) |
| 1 | `ship/stills/01-oct10-replay.png` | The Oct 10 replay: "4 min from 1.05 to liquidatable" on the cbBTC demo loan, the chart and the room table | done (re-recorded Nov 13 on the corrected record) |
| 2 | `ship/stills/04-verdict-recorded.png` | Verdict, SERV agreeing with the checks, every check spelled out | after the kill test + `record:sample` (`npm run stills` makes it) |
| 3 | your terminal: `npm run fire-delay` output | Kite's measured fire delay, block by block | after the kill test (you screenshot it; our own output, no third-party logos) |
| 4 | `ship/stills/02-loan-read-from-aave.png` | The loan read from Aave, matched to Aave's HF, 4% penalty | done |
| 5 | `ship/stills/03-phone-390.png` | The same on a phone | done |
| 6 | `ship/stills/05-verdict-phone-390.png` | The verdict on a phone | after `record:sample` |
| 7 | `ship/stills/06-real-night.png` | The real night: 322 borrowers, $5,124,812 repaid by liquidators, $345,765 of bonus, and the fastest real loan from 1.05 to liquidatable (4 min, liquidated in the same block) | done Nov 13 |
| 8 | `ship/stills/07-real-night-phone-390.png` | The same on a phone | done Nov 13 |
| 9 | `ship/stills/08-why-check-first.png` | Why check first: three drawn scenes (arm a trigger in the evening, the Oct 10 crash at night, check before arming), with the ETH low and the liquidation count from the record | done Nov 14 |

Regenerate all of them with `npm run stills` (local) or `npm run stills -- --base <deployed url>`. The run also fails on any console error or sideways scroll, so it doubles as the 390/1280 check.

**Clips and the social card.** `npm run clip` renders the hero replay frame by frame to `ship/clips/oct10-replay-1080p.mp4` (1920×1080) and `ship/clips/oct10-replay-square.mp4` (1080×1080, for X): 28 s at 30 fps, about 1 MB each, no audio, our own screen only. The clip keeps the figure's caption, so the sources and the speed-up factors are in frame. `npm run og` renders `public/og.png` (1200×630, the link preview on X) and `public/apple-touch-icon.png` from the live hero. `ship/` is in `.vercelignore`, so the clips are not deployed; whether to commit them is your call.
