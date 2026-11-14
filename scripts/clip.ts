// The hero replay as video: ship/clips/oct10-replay-1080p.mp4 (1920x1080) and
// ship/clips/oct10-replay-square.mp4 (1080x1080), rendered frame by frame.
//
// Usage: npm run clip -- [--base http://localhost:3000] [--out ship/clips] [--theme light|dark] [--fps 30]
//
// Each frame is the page's own drawing: the script loads the site in headless
// Chrome (scripts/cdp.ts), hides everything but the replay figure, then calls
// window.__heroRender(f) for each frame and pipes the screenshots to ffmpeg.
// No clock runs, so no frame is dropped or doubled, and the clip plays at the
// same speed as the page (the factors are in the figure's caption, which the
// clip keeps). It holds 1 s on the start and 3 s on the whole night. It fails
// on any console error.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { launch } from "./cdp.js";

const { values } = parseArgs({
  options: {
    base: { type: "string", default: "http://localhost:3000" },
    out: { type: "string", default: "ship/clips" },
    theme: { type: "string", default: "light" },
    fps: { type: "string", default: "30" },
  },
});
const base = values.base.replace(/\/$/, "");
const theme = values.theme === "dark" ? "dark" : "light";
const FPS = Number(values.fps);
if (!Number.isInteger(FPS) || FPS < 1 || FPS > 60) throw new Error(`--fps must be a whole number from 1 to 60, not ${values.fps}`);
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
const SITE = "repay-ready.vercel.app";
const HOLD_START_S = 1;
const HOLD_END_S = 3;
const SCALE = 1.5; // CSS pixels to video pixels

const variants = [
  { name: "oct10-replay-1080p", width: 1280, height: 720 },
  { name: "oct10-replay-square", width: 720, height: 720 },
];

const css = (h: number) => `
  nav.nav, main, footer, .skip, .hero-copy, .replay-bar { display: none !important; }
  html, body { overflow: hidden !important; background: var(--bg); }
  .hero { height: ${h}px; border: 0; }
  .hero-in { max-width: none; height: ${h}px; box-sizing: border-box; padding: 22px 28px 24px; display: flex; flex-direction: column; gap: 14px; }
  .clip-top { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
  .clip-top .brand { pointer-events: none; }
  .clip-url { font: 600 0.9rem "Geist Mono", ui-monospace, monospace; color: var(--accent); }
  .replay { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .replay-stage { flex: 1; min-height: 0; }
  #replay-canvas { height: 100%; }
  .replay-note { margin-bottom: 0; }
`;

mkdirSync(values.out, { recursive: true });
const browser = await launch();
try {
  for (const v of variants) {
    // Reduced motion freezes the page's CSS animations, so each frame depends only on f.
    const page = await browser.page({ width: v.width, height: v.height, scale: SCALE, theme, reducedMotion: true });
    await page.goto(`${base}/`, "!!document.querySelector('#replay.ready')");
    await page.evaluate("document.fonts.ready.then(() => true)");
    await page.evaluate(`(() => {
      const style = document.createElement("style");
      style.textContent = ${JSON.stringify(css(v.height))};
      document.head.append(style);
      const inner = document.querySelector(".hero-in");
      const brand = document.querySelector("nav .brand");
      if (!inner || !brand) throw new Error("hero markup changed: .hero-in or nav .brand is missing");
      const top = document.createElement("div");
      top.className = "clip-top";
      const url = document.createElement("span");
      url.className = "clip-url";
      url.textContent = ${JSON.stringify(SITE)};
      top.append(brand.cloneNode(true), url);
      inner.prepend(top);
      return true;
    })()`);
    const D = await page.evaluate<number>("window.__heroDuration");
    const canvasH = await page.evaluate<number>("document.getElementById('replay-canvas').clientHeight");
    const bottom = await page.evaluate<number>("document.getElementById('replay').getBoundingClientRect().bottom");
    if (canvasH < 200 || bottom > v.height)
      throw new Error(`${v.name}: the figure doesn't fit (canvas ${canvasH}px, figure bottom ${bottom}px of ${v.height}px)`);

    const file = join(values.out, `${v.name}.mp4`);
    const ff = spawn(
      FFMPEG,
      ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-i", "-"].concat([
        "-c:v",
        "libx264",
        "-preset",
        "slow",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        file,
      ]),
      { stdio: ["pipe", "inherit", "inherit"] },
    );
    const done = once(ff, "exit");
    const put = async (png: Buffer, times = 1) => {
      for (let i = 0; i < times; i++) if (!ff.stdin.write(png)) await once(ff.stdin, "drain");
    };
    const shot = { x: 0, y: 0, width: v.width, height: v.height };
    const n = Math.round(D * FPS);
    const started = Date.now();
    for (let i = 0; i <= n; i++) {
      await page.evaluate(`(window.__heroRender(${i / n}), true)`);
      const png = await page.screenshot(shot);
      await put(png, i === 0 ? HOLD_START_S * FPS : i === n ? HOLD_END_S * FPS : 1);
      if (i % (FPS * 4) === 0) process.stdout.write(`\r${v.name}: frame ${i}/${n}`);
    }
    ff.stdin.end();
    const [code] = await done;
    if (code !== 0) throw new Error(`${v.name}: ffmpeg exited ${code}`);
    if (page.errors.length) throw new Error(`${v.name}: console errors:\n  ${page.errors.join("\n  ")}`);
    await page.close();
    const seconds = (n - 1 + (HOLD_START_S + HOLD_END_S) * FPS) / FPS;
    const mb = statSync(file).size / 1e6;
    console.log(
      `\rok   ${file}: ${v.width * SCALE}x${v.height * SCALE}, ${seconds.toFixed(1)} s at ${FPS} fps, ${mb.toFixed(1)} MB (rendered in ${((Date.now() - started) / 1000).toFixed(0)} s)`,
    );
  }
} finally {
  await browser.close();
}
