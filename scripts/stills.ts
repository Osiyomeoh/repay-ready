// Gallery stills, plus the 390 px / 1280 px check, in one run.
//
// Usage: npm run stills -- [--base http://localhost:3000] [--out ship/stills] [--theme dark|light]
//
// Drives headless Chrome over the DevTools protocol (Node's built-in WebSocket,
// no extra packages). For each shot it sets a real viewport (390 px is
// emulated as a phone), waits for the page's own state rather than a fixed
// time, clips the named elements, and saves a 2x PNG. It also fails if a shot
// logs a console error, throws, or scrolls sideways, so running it against
// the deployed URL is the deployed-demo check. Shots of the recorded run are
// taken only when /api/sample has one.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    base: { type: "string", default: "http://localhost:3000" },
    out: { type: "string", default: "ship/stills" },
    theme: { type: "string", default: "dark" },
  },
});
const base = values.base.replace(/\/$/, "");
const DEMO = "0xDA0AFe3f64bc06b2cb4Fbf8eA98Bd7c4C907185B";
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

interface Shot {
  name: string;
  width: number;
  path: string;
  /** JS expression that is true once the page shows what we want. */
  ready: string;
  /** Selectors whose union (full page width on phones) is the still. */
  clip: string[];
}

const visible = (id: string) => `(() => { const e = document.getElementById(${JSON.stringify(id)}); return !!e && !e.hidden && e.offsetHeight > 0; })()`;
const live: Shot[] = [
  { name: "01-oct10-3-minutes", width: 1280, path: `/?address=${DEMO}`, ready: visible("step-room"), clip: ["#step-room"] },
  { name: "02-loan-read-from-aave", width: 1280, path: `/?address=${DEMO}`, ready: visible("step-room"), clip: ["header.top", "#step-position"] },
  { name: "03-phone-390", width: 390, path: `/?address=${DEMO}`, ready: visible("step-room"), clip: ["#step-position", "#room-caption"] },
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

const profile = mkdtempSync(join(tmpdir(), "stills-"));
const chrome = spawn(
  CHROME,
  ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"],
  {
    stdio: ["ignore", "ignore", "pipe"],
  },
);
const wsUrl = await new Promise<string>((resolve, reject) => {
  let buf = "";
  chrome.stderr.on("data", (d: Buffer) => {
    buf += d.toString();
    const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
    if (m?.[1]) resolve(m[1]);
  });
  chrome.on("exit", (code) => reject(new Error(`Chrome exited (${code}) before DevTools was ready. Set CHROME to its path.`)));
});

const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let nextId = 0;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
const problems = new Map<string, string[]>();
ws.addEventListener("message", (e) => {
  const msg = JSON.parse(String(e.data));
  if (msg.id !== undefined) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) p?.reject(new Error(msg.error.message));
    else p?.resolve(msg.result);
    return;
  }
  const list = msg.sessionId ? problems.get(msg.sessionId) : undefined;
  if (!list) return;
  if (msg.method === "Runtime.exceptionThrown")
    list.push(`exception: ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
  if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error")
    list.push(`console.error: ${msg.params.args.map((a: any) => a.value ?? a.description).join(" ")}`);
  if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") list.push(`log: ${msg.params.entry.text} ${msg.params.entry.url ?? ""}`);
});
const send = (method: string, params: object = {}, sessionId?: string): Promise<any> =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

mkdirSync(values.out, { recursive: true });
let failed = false;
try {
  for (const shot of shots) {
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const s = (m: string, p: object = {}) => send(m, p, sessionId);
    const evaluate = async (expression: string) => (await s("Runtime.evaluate", { expression, returnByValue: true })).result.value;
    const errs: string[] = [];
    problems.set(sessionId, errs);
    await Promise.all([s("Runtime.enable"), s("Log.enable"), s("Page.enable")]);
    await s("Emulation.setDeviceMetricsOverride", { width: shot.width, height: 900, deviceScaleFactor: 2, mobile: shot.width < 500 });
    await s("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: values.theme }] });
    await s("Page.navigate", { url: base + shot.path });
    const deadline = Date.now() + 60_000;
    while (!(await evaluate(shot.ready))) {
      if (Date.now() > deadline) throw new Error(`${shot.name}: page never became ready (${shot.ready})`);
      await sleep(250);
    }
    await sleep(800); // fonts, chart paint, the smooth scroll in sample mode
    const overflow: number = await evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth");
    const clip = await evaluate(`(() => {
      const rs = ${JSON.stringify(shot.clip)}.map((q) => { const e = document.querySelector(q); if (!e) throw new Error("no " + q); return e.getBoundingClientRect(); });
      const pad = 16, top = Math.min(...rs.map((r) => r.top)) + scrollY - pad, bottom = Math.max(...rs.map((r) => r.bottom)) + scrollY + pad;
      const phone = innerWidth < 500, left = phone ? 0 : Math.min(...rs.map((r) => r.left)) - pad, right = phone ? innerWidth : Math.max(...rs.map((r) => r.right)) + pad;
      return { x: Math.max(0, left), y: Math.max(0, top), width: right - Math.max(0, left), height: bottom - Math.max(0, top), scale: 1 };
    })()`);
    const { data } = await s("Page.captureScreenshot", { format: "png", clip, captureBeyondViewport: true });
    const file = join(values.out, `${shot.name}.png`);
    writeFileSync(file, Buffer.from(data, "base64"));
    const ok = overflow === 0 && errs.length === 0;
    if (!ok) failed = true;
    console.log(
      `${ok ? "ok  " : "FAIL"} ${shot.name} @ ${shot.width}px: overflow ${overflow}px, console errors ${errs.length}${errs.length ? `\n       ${errs.join("\n       ")}` : ""} → ${file}`,
    );
    await send("Target.closeTarget", { targetId });
  }
  if (!hasSample) console.log("No recorded run at /api/sample yet, so the verdict stills were skipped (npm run record:sample).");
} finally {
  ws.close();
  chrome.kill();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}
if (failed) process.exit(1);
