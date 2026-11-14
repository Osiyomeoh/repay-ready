// Gallery stills, plus the 390 px / 1280 px check, in one run.
//
// Usage: npm run stills -- [--base http://localhost:3000] [--out ship/stills] [--theme light|dark]
//
// For each shot it opens headless Chrome (scripts/cdp.ts) at a real viewport
// (390 px is emulated as a phone), waits for the page's own state rather than
// a fixed time, clips the named elements, and saves a 2x PNG. It also fails
// if a shot logs a console error, throws, or scrolls sideways, so running it
// against the deployed URL is the deployed-demo check. Shots of the recorded
// run are taken only when /api/sample has one. Pages are shot with reduced
// motion, so each chart is in its final state rather than mid-animation.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { type Clip, launch, sleep } from "./cdp.js";

const { values } = parseArgs({
  options: {
    base: { type: "string", default: "http://localhost:3000" },
    out: { type: "string", default: "ship/stills" },
    theme: { type: "string", default: "light" },
  },
});
const base = values.base.replace(/\/$/, "");
const theme = values.theme === "dark" ? "dark" : "light";
const DEMO = "0xDA0AFe3f64bc06b2cb4Fbf8eA98Bd7c4C907185B";

interface Shot {
  name: string;
  width: number;
  path: string;
  /** JS expression that is true once the page shows what we want. */
  ready: string;
  /** Selectors whose union (full page width on phones) is the still. */
  clip: string[];
  /** Margin around the union in CSS px (default 16); 0 for full-bleed sections like the hero. */
  pad?: number;
}

const visible = (id: string) => `(() => { const e = document.getElementById(${JSON.stringify(id)}); return !!e && !e.hidden && e.offsetHeight > 0; })()`;
const heroReady = "!!document.querySelector('#replay.ready')";
const live: Shot[] = [
  { name: "00-hero", width: 1280, path: "/", ready: heroReady, clip: ["header.hero"], pad: 0 },
  { name: "00-hero-phone-390", width: 390, path: "/", ready: heroReady, clip: ["header.hero"], pad: 0 },
  { name: "01-oct10-replay", width: 1280, path: `/?address=${DEMO}`, ready: visible("step-room"), clip: ["#step-room"] },
  { name: "02-loan-read-from-aave", width: 1280, path: `/?address=${DEMO}`, ready: visible("step-room"), clip: ["#step-address", "#step-position"] },
  { name: "03-phone-390", width: 390, path: `/?address=${DEMO}`, ready: visible("step-room"), clip: ["#step-position", "#room-caption"] },
  { name: "06-real-night", width: 1280, path: "/?night", ready: visible("night-row"), clip: ["#night"] },
  { name: "07-real-night-phone-390", width: 390, path: "/?night", ready: visible("night-row"), clip: ["#night"] },
  { name: "08-why-check-first", width: 1280, path: "/", ready: heroReady, clip: ["#why"], pad: 0 },
];
const recorded: Shot[] = [
  { name: "04-verdict-recorded", width: 1280, path: "/?sample", ready: visible("result"), clip: ["#step-check"] },
  { name: "05-verdict-phone-390", width: 390, path: "/?sample", ready: visible("result"), clip: ["#verdict", "#serv"] },
];

// The endpoint answers 200 { available: false } until a run is recorded.
const hasSample = await fetch(`${base}/api/sample`)
  .then((r) => (r.ok ? r.json() : null))
  .then(
    (j: any) => !!j?.check,
    () => false,
  );
const shots = hasSample ? [...live, ...recorded] : live;

mkdirSync(values.out, { recursive: true });
const browser = await launch();
let failed = false;
try {
  for (const shot of shots) {
    // Reduced motion: every chart is drawn in its final state, and the hero shows the whole night.
    const page = await browser.page({ width: shot.width, height: 900, theme, reducedMotion: true });
    await page.goto(base + shot.path, shot.ready);
    await sleep(800); // fonts, chart paint, the smooth scroll in sample mode
    const overflow = await page.evaluate<number>("document.documentElement.scrollWidth - document.documentElement.clientWidth");
    // The sticky nav would be painted wherever the page is scrolled to; pin it to the top for the shot.
    await page.evaluate(`document.querySelector("nav.nav")?.style.setProperty("position", "relative")`);
    const clip = await page.evaluate<Clip>(`(() => {
      const rs = ${JSON.stringify(shot.clip)}.map((q) => { const e = document.querySelector(q); if (!e) throw new Error("no " + q); return e.getBoundingClientRect(); });
      const pad = ${shot.pad ?? 16}, top = Math.min(...rs.map((r) => r.top)) + scrollY - pad, bottom = Math.max(...rs.map((r) => r.bottom)) + scrollY + pad;
      const phone = innerWidth < 500, left = phone ? 0 : Math.min(...rs.map((r) => r.left)) - pad, right = phone ? innerWidth : Math.min(innerWidth, Math.max(...rs.map((r) => r.right)) + pad);
      return { x: Math.max(0, left), y: Math.max(0, top), width: right - Math.max(0, left), height: bottom - Math.max(0, top) };
    })()`);
    const file = join(values.out, `${shot.name}.png`);
    writeFileSync(file, await page.screenshot(clip));
    const errs = page.errors;
    const ok = overflow === 0 && errs.length === 0;
    if (!ok) failed = true;
    console.log(
      `${ok ? "ok  " : "FAIL"} ${shot.name} @ ${shot.width}px: overflow ${overflow}px, console errors ${errs.length}${errs.length ? `\n       ${errs.join("\n       ")}` : ""} → ${file}`,
    );
    await page.close();
  }
  if (!hasSample) console.log("No recorded run at /api/sample yet, so the verdict stills were skipped (npm run record:sample).");
} finally {
  await browser.close();
}
if (failed) process.exit(1);
