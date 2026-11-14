// @ts-check
// Repay Ready page. Every number shown comes from /api/* (a live read or a
// recorded real run) or from the two Oct 10 record files in public/. About the
// loan itself the page computes only what follows from Aave's own health
// factor: the debt-to-limit ratio (1 / HF), the limit (debt × HF), the fall
// that reaches 1.00 (1 − 1 / HF), and the recorded HF path scaled to a trigger.
import { FAMILY } from "./families.js";
import { initHero } from "./hero.js";
import { initNight, isAddress, lookUpNight, nightRowFor, totals } from "./night.js";
import { drawIn, dur, fmt, h, hhmm, hhmmss, onThemeChange, onWidthChange, reducedMotion, reveal, svg, syncFill, themeChanged, usd, widthOf } from "./viz.js";

/** @param {string} id */
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
/** @param {string} id */
const $in = (id) => /** @type {HTMLInputElement} */ (document.getElementById(id));

/** @type {any} */ let view = null;
/** @type {{ message: string, signature: string } | null} */ let signed = null;
let viewLoadedAt = 0;
let recordedMode = false;

/** @param {HTMLElement} el @param {string} text @param {"" | "err" | "warn"} [kind] */
function say(el, text, kind = "") {
  el.textContent = text;
  el.className = `msg ${kind}`.trim();
}

/** @param {string} url @param {RequestInit} [init] */
async function api(url, init) {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({ error: `Unexpected reply (${res.status}).` }));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status}).`);
  return body;
}

/** @param {HTMLButtonElement} btn @param {string} busy @param {() => Promise<void>} fn */
async function busyWhile(btn, busy, fn) {
  const kids = [...btn.childNodes];
  btn.disabled = true;
  btn.textContent = busy;
  try {
    await fn();
  } finally {
    btn.disabled = false;
    btn.replaceChildren(...kids);
  }
}

const easeOut = (/** @type {number} */ k) => 1 - Math.pow(1 - k, 3);

// ─── Records and the hero ───────────────────────────────────────────────────

/** @param {string} url @param {string} what */
const getJson = (url, what) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`Couldn't load ${what} (${r.status}).`);
    return r.json();
  });
const pricesP = getJson("/oct10-prices.json", "the Oct 10 prices");
const nightP = getJson("/oct10-liquidations.json", "the Oct 10 record");
pricesP.catch(() => {});
nightP.catch(() => {});
initHero(pricesP, nightP);
initNight(nightP);

// ─── Theme ──────────────────────────────────────────────────────────────────

const root = document.documentElement;
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
const isDark = () => (root.dataset.theme ? root.dataset.theme === "dark" : darkQuery.matches);
const themeBtn = $("theme-toggle");
const syncThemeBtn = () => themeBtn.setAttribute("aria-label", isDark() ? "Switch to light theme" : "Switch to dark theme");
syncThemeBtn();
onThemeChange(syncThemeBtn);
themeBtn.addEventListener("click", () => {
  const next = isDark() ? "light" : "dark";
  root.dataset.theme = next;
  try {
    localStorage.setItem("theme", next);
  } catch {}
  themeChanged();
});

// ─── 1. Loan ────────────────────────────────────────────────────────────────

$("address-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const address = $in("address").value.trim();
  if (!isAddress(address)) return say($("address-msg"), "Enter a 0x… address: 42 characters.", "err");
  void busyWhile(/** @type {HTMLButtonElement} */ ($("address-go")), "Reading Aave…", async () => {
    say($("address-msg"), "");
    try {
      const v = await api(`/api/position?address=${address}`);
      setRecorded(null);
      showView(v);
      $("result").hidden = true;
      $("step-position").scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
    } catch (err) {
      say($("address-msg"), /** @type {Error} */ (err).message, "err");
    }
  });
});

/** @param {any} v */
function showView(v) {
  view = v;
  viewLoadedAt = Date.now();
  signed = null;
  const p = v.position;
  $in("address").value = p.user;
  const stats = $("pos-stats");
  stats.replaceChildren();
  const stat = (/** @type {string} */ k, /** @type {string} */ val) =>
    stats.append(h("div", { class: "stat" }, [h("div", { class: "k" }, [k]), h("div", { class: "v" }, [val])]));
  // The health factor itself is on the gauge above these tiles.
  stat("Collateral", p.collateral.length ? p.collateral.map((/** @type {any} */ c) => `${c.symbol} ${usd(c.usd)}`).join(" + ") : "none");
  stat("Debt", p.debt.length ? p.debt.map((/** @type {any} */ d) => `${d.symbol} ${usd(d.usd)}`).join(" + ") : "none");
  stat("USDC borrow rate", `${fmt(p.usdcBorrowApr * 100)}% a year`);
  // Aave's liquidation bonus, read from the same config as the threshold. The
  // borrower pays it: Aave's app calls it the liquidation penalty.
  const pct = (/** @type {number} */ bps) => `${fmt(bps / 100).replace(/\.00$/, "")}%`;
  /** @type {{symbol: string, bonusBps: number}[]} */
  const legs = p.collateral;
  const bonuses = [...new Set(legs.map((c) => c.bonusBps))];
  const [only] = bonuses.length === 1 ? bonuses : [];
  if (legs.length) stat("Liquidation penalty", only !== undefined ? pct(only) : legs.map((c) => `${c.symbol} ${pct(c.bonusBps)}`).join(" + "));
  const [leg0] = legs.length === 1 ? legs : [];
  const penalty =
    leg0 && leg0.bonusBps > 0
      ? ` If it is liquidated, the liquidator takes ${usd(100 * (1 + leg0.bonusBps / 10000)).replace(/\.00$/, "")} of your ${leg0.symbol} for every $100 of debt they repay.`
      : "";
  $("pos-fine").textContent = p.hfMatches
    ? `Block ${Number(p.blockNumber).toLocaleString("en-US")}. Our rebuilt health factor matches Aave's own${p.hfRelErr === null ? "" : p.hfRelErr === 0 ? " exactly" : ` (relative gap ${p.hfRelErr.toExponential(1)})`}.${p.eMode ? ` E-mode: ${p.eMode.label}.` : ""}${penalty}`
    : `Block ${p.blockNumber}. Our rebuilt health factor does not match Aave's, so we will not judge this loan.`;
  const warn =
    p.hf === null
      ? "This address owes nothing on Aave Base, so there is nothing for Kite to repay."
      : !p.usdcOnly
        ? `Kite's auto-repay needs USDC to be the only debt. This loan owes ${p.debt.map((/** @type {any} */ d) => d.symbol).join(" + ")}.`
        : !v.replay.ok
          ? `We can't replay this loan: ${v.replay.reason}${v.replay.legs.length ? ` (${v.replay.legs.join(", ")})` : ""}.`
          : "";
  $("pos-warn").hidden = !warn;
  $("pos-warn").textContent = warn;
  showLimit(p);
  showDrop(v);
  $("step-position").hidden = false;
  drawGauge(true);
  noteNight(p.user);

  const canRun = p.hf !== null && p.usdcOnly && v.replay.ok && v.rooms.length > 0;
  $("step-room").hidden = !canRun;
  $("step-plan").hidden = !canRun;
  $("step-sign").hidden = !canRun;
  $("step-check").hidden = !canRun;
  $("step-address").classList.add("done");
  syncSteps();
  if (!canRun) return;
  setupRoom();
  $("sign-message").textContent = v.ownership.message;
  $("kite-warning-1").textContent = v.kiteWarning;
  $("kite-warning-2").textContent = v.kiteWarning;
  $in("sign-paste").value = "";
  say($("sign-msg"), "");
  syncHfNote();
}

/** Debt against Aave's liquidation limit: debt ÷ (collateral × threshold) is 1 / HF. @param {any} p */
function showLimit(p) {
  const debt = p.debt.reduce((/** @type {number} */ s, /** @type {any} */ d) => s + d.usd, 0);
  const show = p.hf !== null && p.hf > 0 && debt > 0;
  $("limit").hidden = !show;
  if (!show) return;
  const used = 1 / p.hf;
  const w = Math.min(100, used * 100);
  $("limit-pct").textContent = `${fmt(used * 100, 1)}%`;
  $("limit-debt").textContent = `Debt ${usd(debt)}`;
  $("limit-cap").textContent = `Liquidation limit ${usd(debt * p.hf)}`;
  const fill = $("limit-fill");
  fill.style.setProperty("--full", `${(100 / Math.max(w, 0.5)) * 100}%`);
  fill.style.width = "0";
  requestAnimationFrame(() => requestAnimationFrame(() => (fill.style.width = `${w}%`)));
}

/** @param {(Node | string)[]} kids */
const b = (...kids) => h("b", {}, kids);

/** The fall to liquidatable, and what Oct 10 did to a loan like this one. @param {any} v */
function showDrop(v) {
  const p = v.position;
  const el = $("pos-drop");
  /** @type {(Node | string)[]} */
  const parts = [];
  const fams = [...new Set(p.collateral.map((/** @type {any} */ c) => c.family ?? FAMILY[c.symbol] ?? "OTHER"))];
  const fam = fams.length === 1 ? fams[0] : null;
  // With one price family as collateral and USDC as the only debt, HF moves in
  // proportion to that family's price against USDC.
  if (p.hf !== null && p.hf > 1 && p.usdcOnly && (fam === "ETH" || fam === "BTC"))
    parts.push(`${fam} would have to fall `, b(`${fmt((1 - 1 / p.hf) * 100, 1)}%`), " against USDC from now for this loan to become liquidatable. ");
  if (p.hf !== null && v.fromHigh) {
    const d = v.fromHigh.drawdown;
    const low = v.fromHigh.lowestHf;
    parts.push(
      "On Oct 10, 2025, a loan like this one lost ",
      b(`${fmt(d.fraction * 100, 1)}%`),
      ` of its health factor, from ${hhmm(d.peakAt)} to ${hhmm(d.troughAt)} UTC: starting from today's ${fmt(p.hf, 4)}, it would have fallen to `,
      b(fmt(low, 4)),
      low < 1 ? ", below 1.00, where it can be liquidated." : ".",
    );
  }
  el.replaceChildren(...parts);
  el.hidden = !parts.length;
}

// ─── The health factor gauge ────────────────────────────────────────────────

const G = { cx: 120, cy: 122, r: 94, lo: 0.9, hi: 2.1 };
const gFrac = (/** @type {number} */ v) => (Math.min(G.hi, Math.max(G.lo, v)) - G.lo) / (G.hi - G.lo);
/** @param {number} v @param {number} [r] @returns {[number, number]} */
const gPt = (v, r = G.r) => {
  const a = Math.PI * (1 - gFrac(v));
  return [G.cx + r * Math.cos(a), G.cy - r * Math.sin(a)];
};
/** @param {number} v1 @param {number} v2 */
const gArc = (v1, v2) => {
  const [x1, y1] = gPt(v1);
  const [x2, y2] = gPt(v2);
  return `M${x1.toFixed(2)},${y1.toFixed(2)}A${G.r},${G.r} 0 0 1 ${x2.toFixed(2)},${y2.toFixed(2)}`;
};
let gaugeRun = 0;

/** The trigger the person typed, if it is a number. */
const typedTrigger = () => {
  const n = Number($in("f-hf").value.trim());
  return $in("f-hf").value.trim() && Number.isFinite(n) && n > 0 ? n : null;
};

/** @param {boolean} animate */
function drawGauge(animate) {
  const box = $("gauge");
  const title = $("gauge-title");
  const hf = view?.position.hf ?? null;
  const T = typedTrigger();
  title.textContent =
    hf === null
      ? "Health factor: no debt"
      : `Health factor ${fmt(hf, 4)}, on a dial from ${G.lo} to ${G.hi}; below 1.00 the loan can be liquidated${T ? `. Your trigger: ${fmt(T)}` : ""}.`;
  const kids = [svg("path", { d: gArc(G.lo, G.hi), class: "track" }), svg("path", { d: gArc(G.lo, 1), class: "zone" })];
  for (const v of [1, 1.5, 2]) {
    const [x1, y1] = gPt(v, G.r + 9);
    const [x2, y2] = gPt(v, G.r + 14);
    const [tx, ty] = gPt(v, G.r + 18);
    // Anchor each label on the side away from the dial, so side labels never sit on the arc.
    const anchor = tx < G.cx - 20 ? "end" : tx > G.cx + 20 ? "start" : "middle";
    kids.push(svg("line", { x1, y1, x2, y2, class: "tick" }));
    kids.push(svg("text", { x: tx, y: anchor === "middle" ? ty - 2 : ty + 3.5, "text-anchor": anchor, class: v === 1 ? "liq-t" : "" }, [fmt(v)]));
  }
  const val = svg("path", { d: gArc(1, G.hi), class: "val", pathLength: 100 });
  if (hf !== null) kids.push(val);
  if (T !== null && T >= G.lo && T <= G.hi) {
    const [x1, y1] = gPt(T, G.r - 11);
    const [x2, y2] = gPt(T, G.r + 11);
    kids.push(svg("line", { x1, y1, x2, y2, class: "trig" }));
    kids.push(svg("text", { x: 228, y: 146, "text-anchor": "end", class: "trig-t" }, [`trigger ${fmt(T)}`]));
  }
  kids.push(svg("text", { x: 12, y: 146, "text-anchor": "start", class: "liq-t" }, ["liquidatable"]));
  const knob = svg("g", { class: "needle" }, [svg("circle", { cx: G.cx - G.r, cy: G.cy, r: 9, class: "knob" })]);
  const num = svg("text", { x: G.cx, y: G.cy - 14, "text-anchor": "middle", class: "g-v" }, [hf === null ? "–" : fmt(hf, 4)]);
  kids.push(num, svg("text", { x: G.cx, y: G.cy + 6, "text-anchor": "middle", class: "g-k" }, [hf === null ? "no debt" : "health factor"]));
  if (hf !== null) kids.push(knob);
  box.replaceChildren(title, ...kids);
  if (hf === null) return;

  const run = ++gaugeRun;
  const set = (/** @type {number} */ v) => {
    const f = gFrac(v);
    knob.setAttribute("transform", `rotate(${(f * 180).toFixed(2)} ${G.cx} ${G.cy})`);
    const shown = Math.max(0, gFrac(Math.max(1, v)) - gFrac(1)) * 100;
    val.setAttribute("stroke-dasharray", `${shown.toFixed(2)} 100`);
    val.style.opacity = shown > 0 ? "1" : "0";
  };
  if (!animate || reducedMotion()) {
    set(hf);
    return;
  }
  const t0 = performance.now();
  const ms = 1300;
  const to = Math.min(hf, G.hi + 0.05);
  const step = (/** @type {number} */ now) => {
    if (run !== gaugeRun) return;
    const k = Math.min(1, (now - t0) / ms);
    const v = G.lo + (to - G.lo) * easeOut(k);
    set(v);
    num.textContent = k < 1 ? fmt(Math.min(v, hf), 4) : fmt(hf, 4);
    if (k < 1) requestAnimationFrame(step);
  };
  set(G.lo);
  num.textContent = fmt(G.lo, 4);
  requestAnimationFrame(step);
}

// ─── 2. Oct 10 room ─────────────────────────────────────────────────────────

const SHOW_T = [1.02, 1.05, 1.08, 1.1, 1.15, 1.2, 1.25, 1.3, 1.4, 1.5];

function setupRoom() {
  const range = $in("room-range");
  range.max = String(view.rooms.length - 1);
  const i105 = view.rooms.findIndex((/** @type {any} */ r) => r.triggerHf === 1.05);
  range.value = String(i105 >= 0 ? i105 : 0);
  const fam = view.replay.families.filter((/** @type {string} */ f) => f !== "USDC").join(" and ") || "USDC";
  $("room-intro").textContent =
    `We replay all ${view.replay.updates} Chainlink updates Aave used for your ${fam} collateral and USDC debt, ${view.record.fromIso.slice(0, 16).replace("T", " ")} to ${view.record.toIso.slice(0, 16).replace("T", " ")} UTC. ` +
    "Each update is treated as the moment your health factor sits exactly at your trigger. We keep the worst one: the fastest fall to 1.00, when the loan can be liquidated.";
  const table = /** @type {HTMLTableElement} */ ($("room-table"));
  table.querySelectorAll("tr").forEach((r) => r.remove());
  table.append(h("tr", {}, [h("th", {}, ["Trigger"]), h("th", {}, ["Worst-case time to liquidatable (bar length on a log scale)"])]));
  const rows = view.rooms.filter((/** @type {any} */ r) => SHOW_T.includes(r.triggerHf));
  /** @type {number[]} */
  const secs = rows.map((/** @type {any} */ r) => r.seconds).filter((/** @type {number | null} */ s) => s !== null);
  const lo = Math.log10(Math.max(1, Math.min(...secs, 60)) / 2);
  const hi = Math.log10(Math.max(...secs, 3600));
  for (const r of rows) {
    const w = r.seconds === null ? 100 : Math.max(3, ((Math.log10(Math.max(1, r.seconds)) - lo) / (hi - lo)) * 100);
    const bar = h("span", { class: `bar${r.seconds === null ? " never" : ""}`, style: `width:0%` });
    const tr = h("tr", { "data-t": String(r.triggerHf), tabindex: "0" }, [
      h("td", {}, [fmt(r.triggerHf)]),
      h("td", {}, [
        h("span", { class: "bar-cell" }, [
          h("span", { class: "bar-track" }, [bar]),
          h("span", { class: "bar-label" }, [r.seconds === null ? "never liquidatable" : dur(r.seconds)]),
        ]),
      ]),
    ]);
    const pick = () => {
      const i = view.rooms.findIndex((/** @type {any} */ x) => x.triggerHf === r.triggerHf);
      if (i < 0) return;
      $in("room-range").value = String(i);
      drawRoom(true);
    };
    tr.addEventListener("click", pick);
    tr.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        pick();
      }
    });
    table.append(tr);
    requestAnimationFrame(() => requestAnimationFrame(() => (bar.style.width = `${w}%`)));
  }
  drawRoom(true);
}

$in("room-range").addEventListener("input", () => drawRoom(false));
onWidthChange(() => view && !$("step-room").hidden && drawRoom(false));
onWidthChange(() => view && drawGauge(false));

/** @type {{ t: number[], hf: number[], from: number, to: number, X: (v: number) => number, Y: (v: number) => number, T: number, top: number, bottom: number } | null} */
let fall = null;
let playRun = 0;

/** @param {boolean} animate */
function drawRoom(animate) {
  stopFall();
  const row = view.rooms[Number($in("room-range").value)];
  const T = row.triggerHf;
  const range = $in("room-range");
  syncFill(range);
  range.setAttribute("aria-valuetext", `Trigger ${fmt(T)}`);
  /** @type {HTMLOutputElement} */ ($("room-t")).value = fmt(T);
  $("room-table")
    .querySelectorAll("tr[data-t]")
    .forEach((tr) => tr.classList.toggle("sel", Number(tr.getAttribute("data-t")) === T));
  const d = view.fireDelay;
  const head = $("room-headline");
  head.replaceChildren();
  if (row.seconds === null) {
    head.append("Never liquidatable on that night from ", h("span", { class: "num" }, [fmt(T)]), ".");
  } else {
    head.append(h("span", { class: "num" }, [dur(row.seconds)]), ` from ${fmt(T)} to liquidatable, worst case.`);
  }
  const t = /** @type {number[]} */ (view.replay.t);
  const x = /** @type {number[]} */ (view.replay.x);
  const ti = (/** @type {number} */ k) => /** @type {number} */ (t[k]);
  const xi = (/** @type {number} */ k) => /** @type {number} */ (x[k]);
  let s, e, w0, w1;
  if (row.seconds !== null) {
    s = t.indexOf(row.start);
    e = t.indexOf(row.liquidatableAt);
    const span = Math.max(row.liquidatableAt - row.start, 300);
    w0 = row.start - Math.max(span * 0.6, 600);
    w1 = row.liquidatableAt + Math.max(span * 0.3, 300);
  } else {
    // Never liquidatable: show the night's biggest fall, starting at the trigger at its high.
    let peak = 0;
    let best = { dd: 0, p: 0, q: 0 };
    for (let k = 0; k < x.length; k++) {
      if (xi(k) > xi(peak)) peak = k;
      const dd = 1 - xi(k) / xi(peak);
      if (dd > best.dd) best = { dd, p: peak, q: k };
    }
    s = best.p;
    e = best.q;
    w0 = ti(s) - 1800;
    w1 = ti(e) + 1800;
  }
  const hfAt = (/** @type {number} */ k) => (T * xi(k)) / xi(s);
  const box = /** @type {SVGSVGElement & HTMLElement} */ (/** @type {unknown} */ ($("room-chart")));
  const W = Math.max(280, widthOf(box, 600));
  const H = Math.round(Math.min(300, Math.max(210, W * 0.42)));
  box.setAttribute("viewBox", `0 0 ${W} ${H}`);
  box.setAttribute("height", String(H));
  const pad = { l: 40, r: 10, t: 18, b: 26 };
  // Points in the window: the one in force at w0, then every update up to w1.
  let k0 = 0;
  while (k0 + 1 < t.length && ti(k0 + 1) <= w0) k0++;
  const pts = [];
  for (let k = k0; k < t.length && ti(k) <= w1; k++) pts.push({ t: Math.max(ti(k), w0), hf: hfAt(k) });
  const lo = Math.min(0.97, ...pts.map((p) => p.hf)) - 0.01;
  const hi = Math.max(T + 0.03, ...pts.map((p) => p.hf)) + 0.01;
  const X = (/** @type {number} */ v) => pad.l + ((v - w0) / (w1 - w0)) * (W - pad.l - pad.r);
  const Y = (/** @type {number} */ v) => pad.t + ((hi - v) / (hi - lo)) * (H - pad.t - pad.b);
  const title = $("room-chart-title");
  const kids = [];
  // Liquidatable zone below 1.00.
  kids.push(svg("rect", { x: pad.l, y: Y(1), width: W - pad.l - pad.r, height: Math.max(0, H - pad.b - Y(1)), class: "liq-zone" }));
  const step = hi - lo > 0.4 ? 0.1 : 0.05;
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    kids.push(svg("line", { x1: pad.l, x2: W - pad.r, y1: Y(v), y2: Y(v), stroke: "var(--line)" }));
    kids.push(svg("text", { x: pad.l - 6, y: Y(v) + 4, "text-anchor": "end" }, [fmt(v)]));
  }
  const ticks = W < 420 ? 3 : 5;
  for (let i = 0; i <= ticks; i++) {
    const v = w0 + ((w1 - w0) * i) / ticks;
    kids.push(svg("text", { x: X(v), y: H - 6, "text-anchor": i === 0 ? "start" : i === ticks ? "end" : "middle" }, [hhmm(v)]));
  }
  /** @type {SVGElement[]} */
  const labels = [];
  const hline = (/** @type {number} */ v, /** @type {string} */ color, /** @type {string} */ label) => {
    kids.push(svg("line", { x1: pad.l, x2: W - pad.r, y1: Y(v), y2: Y(v), stroke: color, "stroke-width": 1.5, "stroke-dasharray": "5 4" }));
    // Left edge, just under the line: before the fall the trace is still above it.
    labels.push(svg("text", { x: pad.l + 4, y: Y(v) + 14, "text-anchor": "start", class: "halo", style: `fill:${color};font-weight:600` }, [label]));
  };
  hline(T, "var(--chart-t)", `Kite fires below ${fmt(T)}`);
  hline(1, "var(--chart-liq)", "Liquidatable below 1.00");
  const [p0, ...rest] = pts;
  if (!p0) return void box.replaceChildren(title);
  // The HF path is a step function: Aave's price only moves on oracle updates.
  let dpath = `M${X(p0.t)},${Y(p0.hf)}`;
  for (const p of rest) dpath += `H${X(p.t)}V${Y(p.hf)}`;
  dpath += `H${X(w1)}`;
  const trace = /** @type {SVGPathElement} */ (svg("path", { d: dpath, class: "hf-trace" }));
  kids.push(trace);
  const vline = (/** @type {number} */ at, /** @type {string} */ color, /** @type {string} */ label, /** @type {"start" | "end"} */ anchor) => {
    kids.push(svg("line", { x1: X(at), x2: X(at), y1: pad.t, y2: H - pad.b, stroke: color, "stroke-width": 1 }));
    labels.push(svg("text", { x: X(at) + (anchor === "start" ? 4 : -4), y: pad.t + 2, "text-anchor": anchor, class: "halo", style: `fill:${color}` }, [label]));
  };
  if (row.seconds !== null) {
    vline(row.start, "var(--chart-t)", hhmmss(row.start), "end");
    vline(row.liquidatableAt, "var(--chart-liq)", hhmmss(row.liquidatableAt), "start");
    if (d) vline(row.start + d.seconds, "var(--chart-line)", "repay lands", "start");
  }
  // The "Play the fall" marker, hidden until played.
  const marker = svg("g", { class: "fall-mark", visibility: "hidden" }, [
    svg("line", { x1: 0, x2: 0, y1: pad.t, y2: H - pad.b, class: "fall-now" }),
    svg("circle", { cx: 0, cy: 0, r: 5.5, class: "fall-dot" }),
  ]);
  box.replaceChildren(title, ...kids, marker, ...labels);
  if (animate) drawIn(trace);
  title.textContent = `Health factor on Oct 10, 2025, starting at ${fmt(T)}`;
  $("room-caption").textContent =
    row.seconds !== null
      ? `Your loan, at ${fmt(T)} at ${hhmmss(row.start)} UTC on Oct 10, 2025, falls below 1.00 at ${hhmmss(row.liquidatableAt)}. ` +
        (d
          ? `Kite's measured fire delay is ${dur(d.seconds)}; the check needs at least ${view.policy.roomFactor}× that.`
          : "Kite's fire delay hasn't been measured yet, so the check can't say Kite would land in time.")
      : `Starting at ${fmt(T)} at the night's high (${hhmmss(ti(s))} UTC), the lowest point was ${fmt(hfAt(e), 4)} at ${hhmmss(ti(e))}.`;
  // The fall from the trigger to liquidatable (or the night's biggest fall), for "Play the fall".
  const ft = [];
  const fh = [];
  for (let k = s; k <= e; k++) {
    ft.push(ti(k));
    fh.push(hfAt(k));
  }
  fall = { t: ft, hf: fh, from: ti(s), to: ti(e), X, Y, T, top: pad.t, bottom: H - pad.b };
  const live = $("room-live");
  live.replaceChildren();
  $("room-play").hidden = !(e > s);
}

function stopFall() {
  playRun++;
  $("room-play").classList.remove("playing");
}

$("room-play").addEventListener("click", () => {
  if (!fall || fall.to <= fall.from) return;
  const f = fall;
  const run = ++playRun;
  const box = $("room-chart");
  const mark = /** @type {SVGGElement} */ (box.querySelector(".fall-mark"));
  const dot = /** @type {SVGCircleElement} */ (mark.querySelector("circle"));
  const live = $("room-live");
  const btn = $("room-play");
  btn.classList.add("playing");
  live.setAttribute("aria-live", "off");
  mark.setAttribute("visibility", "visible");
  // Playback length: about 6 s, whatever the real span; the real elapsed time is printed.
  const ms = reducedMotion() ? 0 : 6000;
  const t0 = performance.now();
  let k = 0;
  const frame = (/** @type {number} */ now) => {
    if (run !== playRun) return;
    const p = ms ? Math.min(1, (now - t0) / ms) : 1;
    const at = f.from + (f.to - f.from) * p;
    while (k + 1 < f.t.length && /** @type {number} */ (f.t[k + 1]) <= at) k++;
    const hf = /** @type {number} */ (f.hf[k]);
    mark.setAttribute("transform", `translate(${f.X(at).toFixed(1)},0)`);
    dot.setAttribute("cy", f.Y(hf).toFixed(1));
    dot.classList.toggle("below", hf < 1);
    const since = Math.round(at - f.from);
    live.replaceChildren(h("b", {}, [hhmmss(at)]), " UTC · HF ", h("b", {}, [fmt(hf, 4)]), ` · ${dur(since)} after ${fmt(f.T)}`);
    if (p < 1) return void requestAnimationFrame(frame);
    btn.classList.remove("playing");
    live.setAttribute("aria-live", "polite");
    const end = /** @type {number} */ (f.hf[f.hf.length - 1]);
    live.replaceChildren(
      end < 1
        ? `Liquidatable at ${hhmmss(f.to)} UTC, ${dur(f.to - f.from)} after the health factor reached ${fmt(f.T)}.`
        : `Lowest point ${fmt(end, 4)} at ${hhmmss(f.to)} UTC, ${dur(f.to - f.from)} after the night's high.`,
    );
  };
  requestAnimationFrame(frame);
});

// ─── 3. Plan ────────────────────────────────────────────────────────────────

$("plan-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = /** @type {HTMLTextAreaElement} */ ($("plan-text")).value.trim();
  if (!text) return say($("plan-msg"), "Write your plan first, or fill the fields below yourself.", "err");
  void busyWhile(/** @type {HTMLButtonElement} */ ($("plan-go")), "SERV is reading…", async () => {
    try {
      const r = await api("/api/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
      showPlan(r);
    } catch (err) {
      say($("plan-msg"), /** @type {Error} */ (err).message, "err");
    }
  });
});

/** @param {any} r */
function showPlan(r) {
  if (!r.ok)
    return say(
      $("plan-msg"),
      `${r.refused ? "SERV declined to read this text" : "SERV couldn't read this plan"}. Fill the fields yourself. (${r.error})`,
      "warn",
    );
  const f = r.fields;
  /** @type {string[]} */ const filled = [];
  /** @type {string[]} */ const missing = [];
  const put = (/** @type {string} */ id, /** @type {number | null} */ v, /** @type {string} */ name) => {
    if (v === null) return void missing.push(name);
    $in(id).value = String(v);
    flash($in(id));
    filled.push(name);
  };
  put("f-hf", f.trigger_hf, "trigger");
  if (f.amount_is_max) {
    $in("f-max").checked = true;
    syncMax();
    filled.push("amount (full debt)");
  } else put("f-amount", f.amount_usdc, "amount");
  put("f-expires", f.expires_days, "how long to arm");
  put("f-away", f.away_days, "days away");
  put("f-passport", f.passport_usdc, "Passport USDC");
  syncSlider();
  const parts = [filled.length ? `SERV filled: ${filled.join(", ")}.` : "SERV found no values in your text."];
  if (missing.length) parts.push(`Not stated, so left for you: ${missing.join(", ")}.`);
  if (f.out_of_scope) parts.push(`Outside this check: ${f.out_of_scope}`);
  parts.push("Check each field before you run the check.");
  say($("plan-msg"), parts.join(" "), missing.length ? "warn" : "");
}

/** Briefly marks a field SERV filled. @param {HTMLElement} el */
function flash(el) {
  el.classList.remove("filled");
  void el.offsetWidth;
  el.classList.add("filled");
}

function syncMax() {
  const max = $in("f-max").checked;
  $in("f-amount").disabled = max;
  if (max) $in("f-amount").value = "";
  syncSteps();
}
$in("f-max").addEventListener("change", syncMax);

/** Typing a trigger moves the Oct 10 view to it (never the other way round). */
function syncSlider() {
  syncHfNote();
  if (view) drawGauge(false);
  if (!view?.rooms?.length) return;
  const T = Math.round(Number($in("f-hf").value) * 100) / 100;
  const i = view.rooms.findIndex((/** @type {any} */ r) => r.triggerHf === T);
  if (i >= 0) {
    $in("room-range").value = String(i);
    drawRoom(false);
  }
}
$in("f-hf").addEventListener("change", syncSlider);
$in("f-hf").addEventListener("input", () => {
  syncHfNote();
  if (view) drawGauge(false);
});

/** What the record says about the typed trigger. Information only: it never changes a field. */
function syncHfNote() {
  const note = $("f-hf-note");
  note.replaceChildren();
  const T = typedTrigger();
  if (!view || T === null) return;
  const hf = view.position.hf;
  if (hf !== null && T >= hf) return void note.append(`Your health factor is ${fmt(hf, 4)} now, at or below this trigger.`);
  const T2 = Math.round(T * 100) / 100;
  const row = view.rooms.find((/** @type {any} */ r) => r.triggerHf === T2);
  if (!row) {
    const first = view.rooms[0];
    const last = view.rooms[view.rooms.length - 1];
    if (first && last) note.append(`The Oct 10 table covers ${fmt(first.triggerHf)} to ${fmt(last.triggerHf)} for this loan.`);
    return;
  }
  note.append(
    `Oct 10, 2025, from ${fmt(T2)}: `,
    row.seconds === null ? b("never liquidatable") : b(dur(row.seconds)),
    row.seconds === null ? "." : " to liquidatable, worst case.",
  );
}

// ─── 4. Sign ────────────────────────────────────────────────────────────────

/** @returns {any} */
const eth = () => /** @type {any} */ (window).ethereum;

$("sign-go").addEventListener("click", () => {
  void busyWhile(/** @type {HTMLButtonElement} */ ($("sign-go")), "Waiting for wallet…", async () => {
    const provider = eth();
    if (!provider) return say($("sign-msg"), "No browser wallet found. Sign the message in your wallet app and paste the signature instead.", "warn");
    try {
      // The message expires after 15 minutes; refresh it if this page has been open a while.
      if (Date.now() - viewLoadedAt > 12 * 60_000 && !recordedMode) showView(await api(`/api/position?address=${view.position.user}`));
      const [account] = await provider.request({ method: "eth_requestAccounts" });
      if (!account || account.toLowerCase() !== view.position.user.toLowerCase())
        return say(
          $("sign-msg"),
          `Your wallet is on ${account ?? "no account"}, not the loan's address ${view.position.user}. Switch accounts and try again.`,
          "err",
        );
      const message = view.ownership.message;
      const hex = "0x" + Array.from(new TextEncoder().encode(message), (b) => b.toString(16).padStart(2, "0")).join("");
      const signature = await provider.request({ method: "personal_sign", params: [hex, account] });
      signed = { message, signature };
      say($("sign-msg"), "Signed. The check will verify it on Base.");
      syncSteps();
    } catch (err) {
      say($("sign-msg"), `Not signed: ${/** @type {Error} */ (err).message}`, "warn");
    }
  });
});

$in("sign-paste").addEventListener("input", () => {
  const v = $in("sign-paste").value.trim();
  signed = /^0x[0-9a-fA-F]+$/.test(v) ? { message: view.ownership.message, signature: v } : null;
  say(
    $("sign-msg"),
    signed ? "Signature added. The check will verify it on Base." : v ? "That doesn't look like a 0x… signature." : "",
    signed || !v ? "" : "err",
  );
  syncSteps();
});

// ─── Step marks ─────────────────────────────────────────────────────────────

const REQUIRED = ["f-hf", "f-expires", "f-away"];
function syncSteps() {
  const planDone = REQUIRED.every((id) => $in(id).value.trim()) && ($in("f-max").checked || !!$in("f-amount").value.trim());
  $("step-room").classList.toggle("done", !!view && !$("step-room").hidden);
  $("step-plan").classList.toggle("done", planDone);
  $("step-sign").classList.toggle("done", !!signed);
  $("step-check").classList.toggle("done", !$("result").hidden);
}
for (const id of [...REQUIRED, "f-amount", "f-passport"]) $in(id).addEventListener("input", syncSteps);

// ─── 5. Check ───────────────────────────────────────────────────────────────

$("check-go").addEventListener("click", () => {
  const amountMax = $in("f-max").checked;
  const need = [
    ["f-hf", "the trigger"],
    ...(amountMax ? [] : [["f-amount", "the repay amount"]]),
    ["f-expires", "how long to arm it"],
    ["f-away", "how long you'll be away"],
  ].filter(([id]) => !$in(/** @type {string} */ (id)).value.trim());
  if (need.length) return say($("check-msg"), `Fill in ${need.map(([, n]) => n).join(", ")}.`, "err");
  const body = {
    address: view.position.user,
    triggerHf: $in("f-hf").value.trim(),
    amount: amountMax ? "max" : $in("f-amount").value.trim(),
    expiresDays: $in("f-expires").value.trim(),
    awayDays: $in("f-away").value.trim(),
    passportUsdc: $in("f-passport").value.trim() || null,
    ...(signed ?? {}),
  };
  void busyWhile(/** @type {HTMLButtonElement} */ ($("check-go")), "Checking…", async () => {
    // SERV's verdict took 5.7 to 41.9 s in our runs (CLAIMS.md), so show that the wait is expected.
    const t0 = Date.now();
    const tick = () =>
      say(
        $("check-msg"),
        `Reading Aave and replaying Oct 10, then SERV Reasoning drafts a verdict and its Shadow Agent validates it. That has taken up to 42 s in our tests. ${Math.round((Date.now() - t0) / 1000)} s so far.`,
      );
    $("result").hidden = true;
    $("keys").hidden = false;
    tick();
    const timer = setInterval(tick, 1000);
    try {
      const r = await api("/api/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      say($("check-msg"), "");
      setRecorded(null);
      showResult(r);
    } catch (err) {
      say($("check-msg"), /** @type {Error} */ (err).message, "err");
    } finally {
      clearInterval(timer);
      $("keys").hidden = true;
    }
  });
});

const VERDICT_TEXT = {
  ARM: "Arm it. Every check passed, and SERV Reasoning agrees.",
  ADJUST: "Adjust first. Nothing is armed until every check passes.",
  REFUSE: "Don't arm this. It would not reliably reduce your liquidation risk.",
};
/** Icon paths, drawn in a 24 × 24 box. */
const ICON = {
  pass: "M5 12.5l4.5 4.5L19 7.5",
  fail: "M7 7l10 10M17 7L7 17",
  unknown: "M12 7v6M12 17v.01",
  ARM: "M5 12.5l4.5 4.5L19 7.5",
  ADJUST: "M4 8h9M17 8h3M4 16h3M11 16h9M15 5.5v5M9 13.5v5",
  REFUSE: "M7 7l10 10M17 7L7 17",
};
/** @param {keyof typeof ICON} k */
const icon = (k) => svg("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" }, [svg("path", { d: ICON[k] })]);
const STATUS_WORD = { pass: "pass", fail: "fail", unknown: "unknown" };

/** @param {any} r */
function showResult(r) {
  const f = r.final;
  const verdict = /** @type {"ARM" | "ADJUST" | "REFUSE"} */ (f.verdict);
  const v = $("verdict");
  v.className = `verdict v-${verdict}`;
  const servOk = !("error" in r.serv) && r.serv.agreement.agrees;
  v.replaceChildren(
    h("div", { class: "ic" }, [icon(verdict)]),
    h("div", { class: "w" }, [verdict]),
    h("p", {}, [f.reason ?? (servOk ? r.serv.verdict.message : VERDICT_TEXT[verdict])]),
  );

  const s = $("serv");
  if ("error" in r.serv) {
    s.replaceChildren(h("div", { class: "t" }, ["SERV Reasoning: no answer"]), h("div", { class: "meta" }, [r.serv.error]));
  } else {
    const c = r.serv.call;
    s.replaceChildren(
      h("div", { class: "t" }, [
        `SERV Reasoning said ${r.serv.verdict.verdict}. ${r.serv.agreement.agrees ? "It agrees with the checks." : "It disagrees with the checks."}`,
      ]),
      ...(r.serv.agreement.agrees ? [] : [h("div", {}, [r.serv.agreement.problems.join("; ")])]),
      h("div", { class: "meta" }, [
        `${c.model} with Shadow Agent validation · ${fmt(c.ms / 1000, 1)} s${c.usage ? ` · ${c.usage.total_tokens.toLocaleString("en-US")} tokens` : ""}`,
      ]),
    );
  }

  const list = $("checks");
  list.replaceChildren();
  /** @type {any[]} */ (r.report.checks).forEach((c, i) => {
    const status = /** @type {"pass" | "fail" | "unknown"} */ (c.status);
    const tag = status === "pass" ? "" : c.onFail ? `${STATUS_WORD[status]} → ${c.onFail}` : STATUS_WORD[status];
    const li = h("li", { style: `--i:${i}` }, [
      h("span", { class: `s s-${status}` }, [icon(status), h("span", { class: "sr" }, [STATUS_WORD[status]])]),
      h("span", { class: "l" }, [c.label, ...(tag ? [h("small", { class: `t-${status}` }, [tag])] : [])]),
      h("span", { class: "d" }, [c.detail]),
    ]);
    const fix = status !== "pass" && c.fix ? fixRow(c.fix) : null;
    if (fix) li.append(fix);
    list.append(li);
  });

  $("arm").hidden = !f.command;
  if (f.command) {
    $("cmd").textContent = f.command;
    $("kite-warning-2").textContent = r.kiteWarning;
  }
  $("result").hidden = false;
  syncSteps();
  $("result").scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
}

/** A fix is shown, and applied only if the person clicks it. @param {any} fix */
function fixRow(fix) {
  const row = h("div", { class: "fix" });
  /** @param {string} label @param {() => void} fn */
  const btn = (label, fn) => {
    const el = /** @type {HTMLButtonElement} */ (h("button", { type: "button", class: "ghost small" }, [label]));
    el.addEventListener("click", () => {
      fn();
      syncSteps();
      say($("check-msg"), "Field updated. Run the check again.");
    });
    row.append(el);
  };
  if (fix.triggerHf !== undefined) btn(`Use trigger ${fmt(fix.triggerHf)}`, () => (($in("f-hf").value = String(fix.triggerHf)), syncSlider()));
  if (fix.amount !== undefined)
    btn(fix.amount === "max" ? "Repay the full debt" : `Repay ${fix.amount} USDC`, () => {
      $in("f-max").checked = fix.amount === "max";
      syncMax();
      if (fix.amount !== "max") $in("f-amount").value = String(fix.amount);
    });
  if (fix.expiresDays !== undefined) btn(`Arm for ${fix.expiresDays} days`, () => ($in("f-expires").value = String(fix.expiresDays)));
  if (fix.passportUsdc !== undefined) row.append(`Top up your Passport wallet to at least ${fmt(fix.passportUsdc)} USDC, then update the balance above.`);
  if (fix.action) row.append(fix.action);
  return row.childNodes.length ? row : null;
}

$("cmd-copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("cmd").textContent ?? "");
    $("cmd-copy").textContent = "Copied";
  } catch {
    $("cmd-copy").textContent = "Select and copy";
  }
  setTimeout(() => ($("cmd-copy").textContent = "Copy"), 1500);
});

// ─── The night, from the loan card ──────────────────────────────────────────

/** After "Read loan": say so on the loan card if this address was liquidated that night. @param {string} user */
function noteNight(user) {
  const el = $("pos-night");
  el.hidden = true;
  nightRowFor(user)
    .then((row) => {
      if (!row || view?.position.user !== user) return;
      const { n, usdc, bonus } = totals(row);
      el.textContent = `This address was liquidated on Oct 10, 2025: ${n === 1 ? "once" : `${n} times`}, ${fmt(usdc)} USDC repaid by liquidators${bonus === null ? "" : `, ${fmt(bonus)} USDC of liquidation bonus paid`}. The record is below, under "The real night".`;
      el.hidden = false;
      lookUpNight(user);
    })
    .catch(() => {});
}

// ─── How it decides ─────────────────────────────────────────────────────────

function drawPipe() {
  const box = /** @type {SVGSVGElement & HTMLElement} */ (/** @type {unknown} */ ($("pipe")));
  const title = /** @type {Element} */ (box.querySelector("title"));
  const vertical = widthOf(box, 960) < 640;
  /** @typedef {{ id: string, x: number, y: number, w: number, h: number, t: string, sub: string, cls?: string }} Node */
  /** @type {Node[]} */
  const nodes = vertical
    ? [
        { id: "loan", x: 20, y: 10, w: 320, h: 58, t: "Your loan", sub: "read from Aave at one block" },
        { id: "replay", x: 20, y: 100, w: 320, h: 58, t: "Oct 10, 2025 replay", sub: "every Chainlink update Aave used" },
        { id: "code", x: 20, y: 190, w: 152, h: 70, t: "Nine checks", sub: "in code" },
        { id: "serv", x: 188, y: 190, w: 152, h: 70, t: "SERV Reasoning", sub: "+ Shadow Agent" },
        { id: "arm", x: 20, y: 300, w: 152, h: 70, t: "ARM", sub: "both agree: the Kite command", cls: "arm" },
        { id: "no", x: 188, y: 300, w: 152, h: 70, t: "ADJUST or REFUSE", sub: "anything else: nothing armed", cls: "refuse" },
      ]
    : [
        { id: "loan", x: 10, y: 96, w: 170, h: 68, t: "Your loan", sub: "read from Aave at one block" },
        { id: "replay", x: 230, y: 96, w: 190, h: 68, t: "Oct 10, 2025 replay", sub: "every Chainlink update" },
        { id: "code", x: 480, y: 22, w: 190, h: 68, t: "Nine checks", sub: "in code" },
        { id: "serv", x: 480, y: 170, w: 190, h: 68, t: "SERV Reasoning", sub: "+ its Shadow Agent" },
        { id: "arm", x: 740, y: 22, w: 210, h: 68, t: "ARM", sub: "both agree: the Kite command", cls: "arm" },
        { id: "no", x: 740, y: 170, w: 210, h: 68, t: "ADJUST or REFUSE", sub: "anything else: nothing armed", cls: "refuse" },
      ];
  const W = vertical ? 360 : 960;
  const H = vertical ? 380 : 260;
  box.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const at = Object.fromEntries(nodes.map((n) => [n.id, n]));
  /** @param {string} id @param {"l" | "r" | "t" | "b"} side @returns {[number, number]} */
  const port = (id, side) => {
    const n = at[id];
    if (!n) throw new Error(`No pipe node ${id}`);
    return side === "l" ? [n.x, n.y + n.h / 2] : side === "r" ? [n.x + n.w, n.y + n.h / 2] : side === "t" ? [n.x + n.w / 2, n.y] : [n.x + n.w / 2, n.y + n.h];
  };
  /** @param {[number, number]} a @param {[number, number]} b @param {boolean} vert */
  const curve = (a, b, vert) => {
    const [x1, y1] = a;
    const [x2, y2] = b;
    if (vert) {
      const my = (y1 + y2) / 2;
      return `M${x1},${y1}C${x1},${my} ${x2},${my} ${x2},${y2}`;
    }
    const mx = (x1 + x2) / 2;
    return `M${x1},${y1}C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
  };
  /** @type {[string, string, boolean?][]} */
  const links = [
    ["loan", "replay"],
    ["replay", "code"],
    ["replay", "serv"],
    ["code", "arm"],
    ["serv", "arm"],
    ["code", "no", true],
    ["serv", "no", true],
  ];
  const kids = [];
  for (const [a, c, bad] of links) {
    const d = vertical ? curve(port(a, "b"), port(c, "t"), true) : curve(port(a, "r"), port(c, "l"), false);
    kids.push(svg("path", { d, class: `flowline${bad ? " bad" : ""}` }));
  }
  for (const n of nodes) {
    kids.push(
      svg("g", { class: `node${n.cls ? ` ${n.cls}` : ""}` }, [
        svg("rect", { x: n.x, y: n.y, width: n.w, height: n.h, rx: 14 }),
        svg("text", { x: n.x + n.w / 2, y: n.y + n.h / 2 - 4, "text-anchor": "middle" }, [n.t]),
        svg("text", { x: n.x + n.w / 2, y: n.y + n.h / 2 + 15, "text-anchor": "middle", class: "sub" }, [n.sub]),
      ]),
    );
  }
  box.replaceChildren(title, ...kids);
}
drawPipe();
onWidthChange(drawPipe);

reveal(document.querySelectorAll(".panel, .how-list li, .pipe, #night-stats"));

// ─── Recorded run ───────────────────────────────────────────────────────────

/** @param {any} sample */
function setRecorded(sample) {
  recordedMode = !!sample;
  const el = $("recorded");
  el.hidden = !sample;
  if (sample)
    el.textContent = `Recorded run from ${sample.recordedAt.slice(0, 16).replace("T", " ")} UTC, Aave block ${Number(sample.check.position.blockNumber).toLocaleString("en-US")}. Real data and a real SERV answer, saved so you can see the flow without a wallet. Press "Read loan" to run it live.`;
}

// Links for the README and the submission: ?address=0x… reads that loan live;
// ?sample opens the recorded run; ?night=0x… looks an address up in the Oct 10
// record, and ?night alone shows the fastest real loan.
const link = new URLSearchParams(location.search);
if (link.has("night")) {
  const a = link.get("night") ?? "";
  if (isAddress(a)) lookUpNight(a);
  else $("night-example").click();
  $("night").scrollIntoView();
}
const linked = link.get("address");
if (linked && isAddress(linked)) {
  $in("address").value = linked;
  /** @type {HTMLFormElement} */ ($("address-form")).requestSubmit();
}

/** @type {any} */ let sample = null;
api("/api/sample")
  .then((s) => {
    if (s.available === false) return;
    sample = s;
    $("sample-hint").hidden = false;
    if (link.has("sample")) $("sample-go").click();
  })
  .catch(() => {});

$("sample-go").addEventListener("click", () => {
  if (!sample) return;
  showView(sample.view);
  setRecorded(sample);
  if (sample.plan) {
    /** @type {HTMLTextAreaElement} */ ($("plan-text")).value = sample.plan.text;
    showPlan(sample.plan);
  }
  const i = sample.check.input;
  $in("f-hf").value = String(i.triggerHf);
  $in("f-max").checked = i.amount === "max";
  syncMax();
  if (i.amount !== "max") $in("f-amount").value = String(i.amount);
  $in("f-expires").value = String(i.expiresDays);
  $in("f-away").value = String(i.awayDays);
  $in("f-passport").value = i.passportUsdc === null ? "" : String(i.passportUsdc);
  syncSlider();
  showResult(sample.check);
});
