// Headless Chrome over the DevTools protocol, using Node's built-in WebSocket
// (no extra packages). Shared by scripts/stills.ts, scripts/og.ts and
// scripts/clip.ts. Each page records console errors, uncaught exceptions and
// failed loads, so a script can fail on them.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface PageOptions {
  width: number;
  height: number;
  /** Device pixel ratio of the capture. */
  scale?: number;
  mobile?: boolean;
  theme?: "dark" | "light";
  /** Emulate prefers-reduced-motion, so charts are drawn in their final state. */
  reducedMotion?: boolean;
}

export interface Clip {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Page {
  /** Console errors, exceptions and failed loads seen so far. */
  errors: string[];
  send(method: string, params?: object): Promise<any>;
  /** Evaluates an expression in the page (awaiting a promise) and returns its JSON value. */
  evaluate<T = unknown>(expression: string): Promise<T>;
  /** Navigates and waits until `ready` (a JS expression) is true. */
  goto(url: string, ready: string, timeoutMs?: number): Promise<void>;
  resize(width: number, height: number): Promise<void>;
  screenshot(clip?: Clip): Promise<Buffer>;
  close(): Promise<void>;
}

export interface Browser {
  page(options: PageOptions): Promise<Page>;
  close(): Promise<void>;
}

export async function launch(): Promise<Browser> {
  const profile = mkdtempSync(join(tmpdir(), "repay-ready-chrome-"));
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-color-profile=srgb",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
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
  const errorsBySession = new Map<string, string[]>();
  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(String(e.data));
    if (msg.id !== undefined) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p?.reject(new Error(msg.error.message));
      else p?.resolve(msg.result);
      return;
    }
    const list = msg.sessionId ? errorsBySession.get(msg.sessionId) : undefined;
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

  async function page(o: PageOptions): Promise<Page> {
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const s = (m: string, p: object = {}) => send(m, p, sessionId);
    const errors: string[] = [];
    errorsBySession.set(sessionId, errors);
    await Promise.all([s("Runtime.enable"), s("Log.enable"), s("Page.enable")]);
    const metrics = (width: number, height: number) =>
      s("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: o.scale ?? 2, mobile: o.mobile ?? width < 500 });
    await metrics(o.width, o.height);
    await s("Emulation.setEmulatedMedia", {
      features: [
        { name: "prefers-color-scheme", value: o.theme ?? "dark" },
        { name: "prefers-reduced-motion", value: o.reducedMotion ? "reduce" : "no-preference" },
      ],
    });
    const evaluate = async <T>(expression: string): Promise<T> => {
      const r = await s("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value as T;
    };
    return {
      errors,
      send: s,
      evaluate,
      async goto(url, ready, timeoutMs = 60_000) {
        await s("Page.navigate", { url });
        const deadline = Date.now() + timeoutMs;
        while (!(await evaluate<boolean>(ready).catch(() => false))) {
          if (Date.now() > deadline) throw new Error(`${url}: page never became ready (${ready})`);
          await sleep(250);
        }
      },
      resize: (width, height) => metrics(width, height),
      async screenshot(clip) {
        const { data } = await s("Page.captureScreenshot", { format: "png", captureBeyondViewport: !!clip, ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
        return Buffer.from(data, "base64");
      },
      async close() {
        errorsBySession.delete(sessionId);
        await send("Target.closeTarget", { targetId });
      },
    };
  }

  return {
    page,
    async close() {
      ws.close();
      chrome.kill();
      await sleep(300);
      rmSync(profile, { recursive: true, force: true });
    },
  };
}
