# CHECKLIST

Status is **done**, **todo**, or **blocked (who)**. Update it in the same commit as the work.

## Build requirements (Phase 5)

| Item | Status | Evidence |
|---|---|---|
| Sponsor spike: Aave and Chainlink reads, no keys | done | `scripts/spike-*.ts` |
| Sponsor spike: one real SERV call | done Nov 11: fields read, blanks left null, injection refused, verdict agreed with the code | `runs/2026-11-11-spike-serv.txt` |
| Sponsor spike: Kite kill test (fire delay) | blocked (Samuel: kpass login, funds); the measuring tool is done: `npm run fire-delay` (7 tests; 397 s on a real third-party repay as a smoke test) | runbook in SHIP.md §2 → `src/kite-delay.ts` |
| PLAN.md, CLAIMS.md, CHECKLIST.md | done | this folder |
| Real tests | done (63 pass, some against live Base; none call SERV) | `npm test`; CI in `.github/workflows/ci.yml` runs typecheck, format check and tests on push; first GitHub run passed Nov 12 |
| Typecheck clean | done | `npm run typecheck` |
| Build clean | done Nov 11: Vercel build completed with no errors; Node pinned to 24.x (as local and CI), which cleared the only warnings | `npx vercel inspect <deployment> --logs` |
| Sample mode (a recorded real run) | code done; record after the kill test (now it would only show the unmeasured-delay REFUSE) | `npm run record:sample`, `GET /api/sample` |
| Deployed demo | done Nov 11; SERV key on Vercel since Nov 12, and a live check there got SERV's REFUSE, agreeing with the checks (`runs/2026-11-12-live-check.txt`) | https://repay-ready.vercel.app; `.env`, private notes and source files return 404 |
| 390 px: 0 console errors, 0 overflow | done on the deployed URL (Nov 11, 2026): loan read, Oct 10 room, and a full check run to its verdict | `npm run stills -- --base <url>` fails on any console error or overflow |
| 1280 px: 0 console errors, 0 overflow | done on the deployed URL (Nov 11, 2026), same flows; the five loan stats lay out 3 + 2 | same |
| Fail closed on SERV error, 502 or disagreement | done | `test/service.test.ts`, `finalize` |
| Never pick trigger inputs for the user | done | `src/serv.ts` prompt; form needs every field |
| Kite warning shown verbatim | done (sign step and arm step) | `KITE_WARNING`, `public/index.html` |
| No "protects" or "guarantees" | done | `recheck`; `grep -ri "protect\|guarantee" public` finds none |
| Commits in small steps, authored by Samuel, no co-author | done Nov 11, local only (Samuel pushes) | `git log` |

## Ship kit (Phase 6)

| Item | Status |
|---|---|
| README opening with "do X, see Y" | done; it opens on the live deep link; deep links, a "Who pays" section and the fire-delay script added |
| Gallery stills, strongest first | 3 of 6 done (`ship/stills/01–03`); 04–05 come after `record:sample`, 3rd is your fire-delay terminal shot. Order in SHIP.md §8 |
| Video script (person ≤10 s, sponsor ≤30 s, one number, safe failure, no third-party music or logos) | done (SHIP.md §3); N and the cost are [FILL] until the kill test and the console |
| Submission text (first 2 lines: person, problem, number) | done (SHIP.md §4); X post (278 of 280 characters) in §5 |
| Typeform field checklist | done (SHIP.md §6); logo at `ship/logo.png` |
| Samuel's manual steps, in order | done (SHIP.md §1, kill-test runbook §2); SERV feedback draft §7 |
| HANDOFF.md row | done (Nov 11) |
