// The social card (public/og.png, 1200x630) and the phone home-screen icon
// (public/apple-touch-icon.png, 180x180), both rendered from the running app.
//
// Usage: npm run og -- [--base http://localhost:3000] [--theme dark|light]
//
// The card is the live hero, not a mock-up: the page loads the same two data
// files as the site, draws the whole night (reduced motion), and this script
// only hides the page around the hero, shortens the lede to its first two
// sentences and adds the name and address. It renders at 2x and ffmpeg
// downscales it, so canvas text stays sharp. It fails on any console error.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { launch, sleep } from "./cdp.js";

const { values } = parseArgs({
  options: {
    base: { type: "string", default: "http://localhost:3000" },
    theme: { type: "string", default: "dark" },
  },
});
const base = values.base.replace(/\/$/, "");
const theme = values.theme === "light" ? "light" : "dark";
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
const SITE = "repay-ready.vercel.app";
const W = 1200;
const H = 630;

const CARD_CSS = `
  nav.nav, main, footer, .skip, .cta, .replay-bar, .replay-note, .replay-chip { display: none !important; }
  html, body { overflow: hidden !important; background: var(--bg); }
  .hero { height: ${H}px; border: 0; }
  .hero-in { max-width: none; height: ${H}px; box-sizing: border-box; padding: 0 52px; grid-template-columns: minmax(0, 0.84fr) minmax(0, 1.16fr); gap: 40px; }
  .og-brand { margin: 0 0 34px; font-size: 1.3rem; pointer-events: none; }
  .og-brand .mark { width: 38px; height: 38px; }
  .eyebrow { font-size: 0.86rem; }
  h1 { font-size: 3.15rem; margin-bottom: 20px; }
  .lede { font-size: 1.2rem; line-height: 1.5; }
  .og-url { margin: 30px 0 0; font: 600 1rem "Geist Mono", ui-monospace, monospace; color: var(--accent); letter-spacing: 0.01em; }
  .replay { padding: 18px; }
  #replay-canvas { height: 350px; }
`;

const browser = await launch();
const out = mkdtempSync(join(tmpdir(), "repay-ready-og-"));
try {
  const page = await browser.page({ width: W, height: H, scale: 2, theme, reducedMotion: true });
  await page.goto(`${base}/`, "!!document.querySelector('#replay.ready')");
  await page.evaluate("document.fonts.ready.then(() => true)");
  await page.evaluate(`(() => {
    const style = document.createElement("style");
    style.textContent = ${JSON.stringify(CARD_CSS)};
    document.head.append(style);
    const copy = document.querySelector(".hero-copy");
    const brand = document.querySelector("nav .brand");
    const lede = document.querySelector(".hero .lede");
    if (!copy || !brand || !lede?.lastChild) throw new Error("hero markup changed: .hero-copy, nav .brand or .lede is missing");
    const tag = brand.cloneNode(true);
    tag.classList.add("og-brand");
    copy.prepend(tag);
    // Keep the lede's first two sentences, word for word.
    const tail = lede.lastChild, text = (tail.textContent ?? "").replace(/\\s+/g, " "), end = text.indexOf("window.");
    if (end < 0) throw new Error("lede changed: its second sentence no longer ends in 'window.'");
    tail.textContent = text.slice(0, end + "window.".length);
    const url = document.createElement("p");
    url.className = "og-url";
    url.textContent = ${JSON.stringify(SITE)};
    copy.append(url);
    window.__heroRender(1);
    return true;
  })()`);
  await sleep(400);
  const fit = await page.evaluate<{ hero: number; copy: number; fig: number }>(`(() => ({
    hero: document.querySelector(".hero").getBoundingClientRect().height,
    copy: document.querySelector(".hero-copy").getBoundingClientRect().height,
    fig: document.querySelector("#replay").getBoundingClientRect().height,
  }))()`);
  if (fit.copy > H - 24 || fit.fig > H - 24) throw new Error(`card content doesn't fit ${H}px: copy ${fit.copy}px, figure ${fit.fig}px`);
  const big = join(out, "og@2x.png");
  writeFileSync(big, await page.screenshot({ x: 0, y: 0, width: W, height: H }));
  execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-i", big, "-vf", `scale=${W}:${H}:flags=lanczos`, "-compression_level", "100", "public/og.png"]);
  if (page.errors.length) throw new Error(`console errors:\n  ${page.errors.join("\n  ")}`);
  await page.close();
  console.log(`ok   public/og.png ${W}x${H}, ${(readFileSync("public/og.png").length / 1024).toFixed(0)} KB (copy ${fit.copy}px, figure ${fit.fig}px)`);

  // The home-screen icon: the same mark, full bleed (iOS rounds the corners itself).
  const mark = readFileSync("public/mark.svg", "utf8").replace(/ rx="9"/, "");
  const icon = await browser.page({ width: 180, height: 180, scale: 1, theme });
  await icon.goto(
    `data:text/html,${encodeURIComponent(`<!doctype html><style>html,body{margin:0}svg{display:block;width:180px;height:180px}</style>${mark}`)}`,
    "document.readyState === 'complete'",
  );
  writeFileSync("public/apple-touch-icon.png", await icon.screenshot({ x: 0, y: 0, width: 180, height: 180 }));
  await icon.close();
  console.log(`ok   public/apple-touch-icon.png 180x180, ${(readFileSync("public/apple-touch-icon.png").length / 1024).toFixed(1)} KB`);
} finally {
  await browser.close();
  rmSync(out, { recursive: true, force: true });
}
