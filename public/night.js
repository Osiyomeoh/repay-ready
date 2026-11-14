// @ts-check
// "The real night, loan by loan": public/oct10-liquidations.json, written by
// scripts/oct10-liquidations.ts. Every borrower whose USDC debt Aave
// liquidated on Base from Oct 10, 2025 12:00 UTC to Oct 11 12:00 UTC. The page
// only draws and looks up rows; every number is in the file.
import { FAMILY } from "./families.js";
import { countUp, drawIn, dur, fmt, h, hhmm, hhmmss, onThemeChange, onWidthChange, reducedMotion, svg, whenSeen, whole, widthOf, usd } from "./viz.js";

const DEFI_SAVER_MIN = "https://help.defisaver.com/automations/requirements-for-using-automation";
const CRASH_FROM = Date.UTC(2025, 9, 10, 20, 50) / 1000;
const CRASH_TO = Date.UTC(2025, 9, 10, 21, 40) / 1000;

/** @param {string} id */
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
/** @param {string} id */
const $in = (id) => /** @type {HTMLInputElement} */ (document.getElementById(id));
/** @param {HTMLElement} el @param {string} text @param {"" | "err" | "warn"} [kind] */
function say(el, text, kind = "") {
  el.textContent = text;
  el.className = `msg ${kind}`.trim();
}
const utc = (/** @type {number} */ t) => `${new Date(t * 1000).toISOString().slice(0, 19).replace("T", " ")} UTC`;
// Three significant digits, as stored: a "within" bound must not round below the real error.
const pctOf = (/** @type {number} */ x) => `${(x * 100).toPrecision(3)}%`;
export const isAddress = (/** @type {string} */ a) => /^0x[0-9a-fA-F]{40}$/.test(a);
const short = (/** @type {string} */ a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const outLink = (/** @type {string} */ href, /** @type {string} */ text) => h("a", { href, target: "_blank", rel: "noopener" }, [text]);
/** @param {HTMLElement} box @param {string} k @param {number} v @param {(n: number) => string} format @param {string} [suffix] */
const tile = (box, k, v, format, suffix = "") => {
  const val = h("span", {}, []);
  box.append(h("div", { class: "stat" }, [h("div", { class: "k" }, [k]), h("div", { class: "v" }, [val, suffix])]));
  countUp(val, v, format);
};
/** @param {any} row */
export const totals = (row) => {
  /** @type {any[]} */
  const ls = row.liquidations;
  const usdc = ls.reduce((s, l) => s + l.usdc, 0);
  const bonus = ls.some((l) => l.bonusUsdc === null) ? null : ls.reduce((s, l) => s + l.bonusUsdc, 0);
  return { n: ls.length, usdc, bonus };
};
const familyOf = (/** @type {string} */ symbol) => {
  const f = FAMILY[symbol];
  return f === "ETH" ? "eth" : f === "BTC" ? "btc" : "other";
};

/** @type {Promise<any>} */
let night = Promise.reject(new Error("not loaded"));
night.catch(() => {});

/** The row for an address, or null. @param {string} address */
export const nightRowFor = (address) =>
  night.then((file) => file.borrowers.find((/** @type {any} */ b) => b.user.toLowerCase() === address.toLowerCase()) ?? null);

/** @param {Promise<any>} nightP */
export function initNight(nightP) {
  night = nightP;
  night.then(
    (file) => {
      showSummary(file);
      const swarm = initSwarm(file);
      initHist(file);
      selectDots = swarm.select;
    },
    (/** @type {Error} */ err) => say($("night-intro"), err.message, "err"),
  );

  $("night-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const address = $in("night-address").value.trim();
    if (!isAddress(address)) return say($("night-msg"), "Enter a 0x… address: 42 characters.", "err");
    lookUpNight(address);
  });
  $("night-example").addEventListener("click", () => {
    night.then((file) => lookUpNight(file.summary.triggers.find((/** @type {any} */ t) => t.level === "1.05").fastest, true)).catch(() => {});
  });
}

/** @param {any} file */
function showSummary(file) {
  const s = file.summary;
  const t105 = s.triggers.find((/** @type {any} */ t) => t.level === "1.05");
  $("night-intro").textContent =
    `From Oct 10, 2025 12:00 UTC to Oct 11 12:00 UTC, liquidators repaid USDC debt for ${whole(s.borrowers)} borrowers on Aave v3 Base. ` +
    "Every row is read from Aave's own LiquidationCall events and from each loan's position on-chain.";
  const box = $("night-stats");
  box.replaceChildren();
  tile(box, "Borrowers liquidated", s.borrowers, whole);
  tile(box, "USDC repaid by liquidators", s.usdcRepaid, whole);
  tile(box, "Liquidation bonus they paid (USDC)", s.bonusUsdc.total, whole);
  tile(box, "Liquidated in the block they became liquidatable", s.liquidatedInFirstBlock, whole, ` of ${whole(s.borrowers)}`);
  if (t105?.minSeconds != null) {
    const v = h("span", {}, [dur(t105.minSeconds)]);
    box.append(
      h("div", { class: "stat hot" }, [h("div", { class: "k" }, ["Fastest real loan from health factor 1.05 to liquidatable"]), h("div", { class: "v" }, [v])]),
    );
  }
  $("night-fine").replaceChildren(
    `For the ${whole(s.samePosition)} USDC-only loans that kept the same collateral and debt from noon until their liquidation, our replay matched Aave's own health factor one block before the liquidation to within ${pctOf(s.replayErr.max)}. `,
    t105?.crossed
      ? `${whole(t105.crossed)} of them crossed 1.05 after noon. From 1.05 to liquidatable took ${dur(t105.medianSeconds)} at the median, and under 5 minutes for ${whole(t105.underFiveMinutes)} of them. `
      : "",
    `Of all ${whole(s.borrowers)} borrowers, ${whole(s.preDebtUsd.underDefiSaverMin)} owed under $500, below `,
    outLink(DEFI_SAVER_MIN, "DeFi Saver's minimum for automation on Aave Base"),
    ".",
    s.bonusUsdc.legsMissing ? ` The bonus total leaves out ${whole(s.bonusUsdc.legsMissing)} borrowers whose collateral leg we could not price.` : "",
  );
  $("night-example-hint").hidden = !t105?.fastest;
}

// ─── Every liquidation, by time and size ────────────────────────────────────

/** @type {(user: string | null) => void} */
let selectDots = () => {};

/** @param {any} file */
function initSwarm(file) {
  const box = /** @type {SVGSVGElement & HTMLElement} */ (/** @type {unknown} */ ($("swarm")));
  const fig = /** @type {HTMLElement} */ (box.parentElement);
  const tip = $("swarm-tip");
  const title = /** @type {Element} */ (box.querySelector("title"));
  const from = Date.parse(file.window.fromIso) / 1000;
  const to = Date.parse(file.window.toIso) / 1000;
  /** @type {{ time: number, usdc: number, user: string, collateral: string, fam: string, el: SVGCircleElement | null }[]} */
  const dots = file.borrowers
    .flatMap((/** @type {any} */ b) =>
      b.liquidations.map((/** @type {any} */ l) => ({
        time: l.time,
        usdc: l.usdc,
        user: b.user,
        collateral: l.collateral,
        fam: familyOf(l.collateral),
        el: null,
      })),
    )
    .sort((/** @type {any} */ a, /** @type {any} */ b) => a.time - b.time);
  const FLOOR = 0.01;
  const CEIL = 1e6;
  const underFloor = dots.filter((d) => d.usdc < FLOOR).length;
  const overCeil = dots.filter((d) => d.usdc > CEIL).length;
  const inCrash = dots.filter((d) => d.time >= CRASH_FROM && d.time < CRASH_TO).length;
  const count = (/** @type {string} */ fam) => dots.filter((d) => d.fam === fam).length;
  const symbolsOf = (/** @type {string} */ fam) => [...new Set(dots.filter((d) => d.fam === fam).map((d) => d.collateral))].join(", ");
  const legend = h("span", { class: "legend" }, [
    h("span", {}, [h("i", { class: "sw sw-dot fam-eth" }), `ETH collateral (${symbolsOf("eth")}): ${whole(count("eth"))}`]),
    h("span", {}, [h("i", { class: "sw sw-dot fam-btc" }), `BTC collateral (${symbolsOf("btc")}): ${whole(count("btc"))}`]),
    h("span", {}, [h("i", { class: "sw sw-dot fam-other" }), `Other (${symbolsOf("other")}): ${whole(count("other"))}`]),
  ]);
  /** @type {"day" | "hour"} */ let range = "day";
  let selected = /** @type {string | null} */ (null);
  let shown = false;

  const note = () => {
    $("swarm-note").replaceChildren(
      legend,
      h("span", { class: "note-t" }, [
        `Each dot is one of the ${whole(dots.length)} liquidations; its height is the USDC the liquidator repaid, on a log scale` +
          (underFloor ? `, and ${whole(underFloor)} under 1¢ ${underFloor === 1 ? "is" : "are"} drawn on the bottom edge` : "") +
          (overCeil ? `, and ${whole(overCeil)} over $1M on the top edge` : "") +
          `. ${whole(inCrash)} of them fall between 20:50 and 21:40 UTC. Pick a dot to see that loan.`,
      ]),
    );
  };

  function draw() {
    const W = widthOf(box, 800);
    const phone = W < 560;
    const H = phone ? 280 : 320;
    const pad = { l: 44, r: 14, t: 14, b: 26 };
    box.setAttribute("viewBox", `0 0 ${W} ${H}`);
    box.setAttribute("height", String(H));
    const [x0, x1] = range === "day" ? [from, to] : [CRASH_FROM, CRASH_TO];
    const X = (/** @type {number} */ t) => pad.l + ((t - x0) / (x1 - x0)) * (W - pad.l - pad.r);
    const Y = (/** @type {number} */ v) => {
      const c = Math.min(CEIL, Math.max(FLOOR, v));
      return pad.t + ((Math.log10(CEIL) - Math.log10(c)) / (Math.log10(CEIL) - Math.log10(FLOOR))) * (H - pad.t - pad.b);
    };
    const keep = [title, ...box.querySelectorAll("circle.liq")];
    box.replaceChildren(...keep);
    const axis = svg("g", { class: "axis" });
    for (const [v, label] of /** @type {[number, string][]} */ ([
      [0.01, "1¢"],
      [1, "$1"],
      [100, "$100"],
      [1e4, "$10K"],
      [1e6, "$1M"],
    ])) {
      axis.append(svg("line", { x1: pad.l, x2: W - pad.r, y1: Y(v), y2: Y(v), stroke: "var(--line)" }));
      axis.append(svg("text", { x: pad.l - 6, y: Y(v) + 4, "text-anchor": "end" }, [label]));
    }
    const stepH = range === "day" ? (phone ? 6 : 3) : phone ? 1 / 3 : 1 / 6;
    for (let t = x0; t <= x1 + 1; t += stepH * 3600) {
      const anchor = t === x0 ? "start" : t >= x1 - 1 ? "end" : "middle";
      axis.append(svg("line", { x1: X(t), x2: X(t), y1: H - pad.b, y2: H - pad.b + 4, stroke: "var(--line-2)" }));
      axis.append(svg("text", { x: X(t), y: H - 6, "text-anchor": anchor }, [hhmm(t)]));
    }
    if (range === "day") {
      axis.append(svg("rect", { x: X(CRASH_FROM), y: pad.t, width: Math.max(2, X(CRASH_TO) - X(CRASH_FROM)), height: H - pad.t - pad.b, class: "crash-band" }));
    }
    box.insertBefore(axis, box.querySelector("circle.liq"));
    const r = phone ? 2.8 : 3.4;
    dots.forEach((d, i) => {
      if (!d.el) {
        d.el = /** @type {SVGCircleElement} */ (svg("circle", { class: `liq fam-${d.fam}`, cx: 0, cy: 0 }));
        d.el.dataset.i = String(i);
        box.append(d.el);
      }
      const out = d.time < x0 || d.time > x1;
      d.el.setAttribute("r", String(r));
      d.el.classList.toggle("out", out);
      d.el.classList.toggle("sel", selected !== null && d.user.toLowerCase() === selected);
      const tx = X(Math.min(x1, Math.max(x0, d.time)));
      const ty = shown ? Y(d.usdc) : H - pad.b;
      d.el.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px)`;
    });
    // Selected dots on top.
    for (const d of dots) if (d.el?.classList.contains("sel")) box.append(d.el);
  }

  draw();
  note();
  whenSeen(box, () => {
    shown = true;
    box.classList.add("shown");
    if (!reducedMotion()) dots.forEach((d, i) => d.el?.style.setProperty("transition-delay", `${Math.round(i * 2.5)}ms`));
    requestAnimationFrame(() => {
      draw();
      setTimeout(() => dots.forEach((d) => d.el?.style.removeProperty("transition-delay")), 3000);
    });
  });
  onWidthChange(draw);
  onThemeChange(draw);

  for (const b of fig.querySelectorAll("button[data-range]")) {
    b.addEventListener("click", () => {
      range = /** @type {"day" | "hour"} */ (b.getAttribute("data-range"));
      for (const o of fig.querySelectorAll("button[data-range]")) {
        o.classList.toggle("on", o === b);
        o.setAttribute("aria-pressed", String(o === b));
      }
      draw();
    });
  }

  const showTip = (/** @type {Event} */ e) => {
    const c = /** @type {Element} */ (e.target);
    if (!(c instanceof SVGCircleElement) || c.classList.contains("out")) return void (tip.hidden = true);
    const d = dots[Number(c.dataset.i)];
    if (!d) return;
    tip.replaceChildren(h("b", {}, [`${fmt(d.usdc)} USDC repaid`]), h("br"), `${d.collateral} taken · ${hhmmss(d.time)} UTC`, h("br"), short(d.user));
    tip.hidden = false;
    const fr = fig.getBoundingClientRect();
    const cr = c.getBoundingClientRect();
    const tw = tip.offsetWidth;
    const left = Math.min(Math.max(8, cr.left - fr.left + cr.width / 2 - tw / 2), fr.width - tw - 8);
    const top = cr.top - fr.top - tip.offsetHeight - 10;
    tip.style.left = `${left}px`;
    tip.style.top = `${top < 0 ? cr.bottom - fr.top + 10 : top}px`;
  };
  box.addEventListener("pointerover", showTip);
  box.addEventListener("pointerleave", () => (tip.hidden = true));
  box.addEventListener("click", (e) => {
    const c = /** @type {Element} */ (e.target);
    if (!(c instanceof SVGCircleElement) || c.classList.contains("out")) return;
    const d = dots[Number(c.dataset.i)];
    if (!d) return;
    lookUpNight(d.user, true);
  });

  return {
    /** @param {string | null} user */
    select(user) {
      selected = user && user.toLowerCase();
      draw();
    },
  };
}

// ─── From 1.05 to liquidatable ──────────────────────────────────────────────

/** @param {any} file */
function initHist(file) {
  const box = /** @type {SVGSVGElement & HTMLElement} */ (/** @type {unknown} */ ($("hist")));
  /** @type {number[]} */
  const secs = file.borrowers.filter((/** @type {any} */ b) => b.room["1.05"]).map((/** @type {any} */ b) => b.room["1.05"].to - b.room["1.05"].from);
  if (!secs.length) return;
  const sorted = [...secs].sort((a, b) => a - b);
  const BIN = 300;
  const NBINS = 12; // 0–60 min in 5-minute bins, then "1 h or more"
  const counts = Array.from({ length: NBINS + 1 }, () => 0);
  for (const s of secs) {
    const k = Math.min(NBINS, Math.floor(s / BIN));
    counts[k] = (counts[k] ?? 0) + 1;
  }
  const t105 = file.summary.triggers.find((/** @type {any} */ t) => t.level === "1.05");
  $("hist-title").textContent = `From health factor 1.05 to liquidatable: the ${whole(secs.length)} real loans that crossed 1.05 after noon`;

  function draw() {
    const W = widthOf(box, 800);
    const phone = W < 560;
    const H = phone ? 220 : 240;
    const pad = { l: 12, r: 12, t: 54, b: 40 };
    box.setAttribute("viewBox", `0 0 ${W} ${H}`);
    box.setAttribute("height", String(H));
    const gap = phone ? 3 : 6;
    const bw = (W - pad.l - pad.r - gap * NBINS) / (NBINS + 1);
    const max = Math.max(...counts);
    const Y = (/** @type {number} */ n) => pad.t + (1 - n / max) * (H - pad.t - pad.b);
    const kids = [];
    counts.forEach((n, i) => {
      const x = pad.l + i * (bw + gap);
      const hot = i === 0;
      const g = svg("g", { class: `hb${hot ? " hot" : ""}${i === NBINS ? " over" : ""}`, style: `--i:${i}` });
      if (n > 0) {
        g.append(svg("rect", { x, y: Y(n), width: bw, height: H - pad.b - Y(n), rx: Math.min(6, bw / 3) }));
        g.append(svg("text", { x: x + bw / 2, y: Y(n) - 6, "text-anchor": "middle", class: "cnt" }, [whole(n)]));
      }
      const label = i === NBINS ? "1 h+" : phone && i % 2 ? "" : String(i * 5);
      if (label) g.append(svg("text", { x: i === NBINS ? x + bw / 2 : x, y: H - pad.b + 16, "text-anchor": "middle" }, [label]));
      kids.push(g);
    });
    kids.push(svg("text", { x: pad.l + (NBINS * (bw + gap)) / 2, y: H - 6, "text-anchor": "middle", class: "ax" }, ["minutes from 1.05 to liquidatable"]));
    // Median marker, placed inside its 5-minute bin by its exact value.
    const med = t105?.medianSeconds ?? sorted[Math.floor(sorted.length / 2)];
    if (med !== undefined && med < NBINS * BIN) {
      const k = med / BIN;
      const mx = pad.l + Math.floor(k) * (bw + gap) + (k % 1) * bw;
      kids.push(svg("line", { x1: mx, x2: mx, y1: 22, y2: H - pad.b, class: "med" }));
      kids.push(svg("text", { x: mx + 5, y: 32, class: "med-t" }, [`median ${dur(med)}`]));
    }
    const first = counts[0] ?? 0;
    if (first) {
      kids.push(svg("text", { x: pad.l, y: 14, class: "hot-t" }, [phone ? `${whole(first)} under 5 min` : `${whole(first)} loans: under 5 minutes`]));
    }
    box.replaceChildren(...kids);
  }
  draw();
  whenSeen(box, () => box.classList.add("go"), 0.3);
  onWidthChange(draw);
}

// ─── One loan's night ───────────────────────────────────────────────────────

/** @param {any} row */
function storyStops(row) {
  /** @type {{ t: number, top: string, main: string, sub: string, kind: string }[]} */
  const stops = [];
  const noon = Date.UTC(2025, 9, 10, 12) / 1000;
  stops.push({ t: noon, top: "12:00:00", main: row.noonHf === null ? "no debt" : `HF ${fmt(row.noonHf, 4)}`, sub: "read from Aave", kind: "noon" });
  const replayed = !row.notReplayable && row.samePosition;
  if (replayed) {
    for (const l of ["1.1", "1.05"]) {
      const r = row.room[l];
      if (r) stops.push({ t: r.from, top: hhmmss(r.from), main: `HF ${l}`, sub: "replayed", kind: l === "1.05" ? "t105" : "t11" });
    }
    if (row.replayLiquidatableAt)
      stops.push({ t: row.replayLiquidatableAt, top: hhmmss(row.replayLiquidatableAt), main: "HF below 1", sub: "liquidatable", kind: "liq" });
  }
  const [first, ...more] = row.liquidations;
  if (first)
    stops.push({
      t: first.time,
      top: hhmmss(first.time),
      main: `${fmt(first.usdc)} USDC`,
      sub: more.length ? `liquidated, then ${more.length} more` : "liquidated",
      kind: "hit",
    });
  // Times come from the record; sort as a guard (a stable sort keeps "liquidatable" before "liquidated" on a tie).
  return stops.sort((a, b) => a.t - b.t);
}

/** @param {any} row */
function drawStory(row) {
  const box = /** @type {SVGSVGElement & HTMLElement} */ (/** @type {unknown} */ ($("story")));
  const stops = storyStops(row);
  const W = widthOf(box, 700);
  const vertical = W < 560;
  const title = svg("title", { id: "story-title" }, [`The night of ${row.user}, step by step`]);
  /** @type {SVGElement[]} */
  const kids = [];
  if (!vertical) {
    const H = 118;
    box.setAttribute("viewBox", `0 0 ${W} ${H}`);
    box.setAttribute("height", String(H));
    const x0 = 56;
    const x1 = W - 56;
    const X = (/** @type {number} */ i) => (stops.length === 1 ? (x0 + x1) / 2 : x0 + ((x1 - x0) * i) / (stops.length - 1));
    const y = 50;
    stops.forEach((s, i) => {
      const next = stops[i + 1];
      if (next) {
        const line = svg("path", { d: `M${X(i) + 9},${y}H${X(i + 1) - 9}`, class: `st-link k-${next.kind}` });
        kids.push(line);
        kids.push(svg("text", { x: (X(i) + X(i + 1)) / 2, y: y - 9, "text-anchor": "middle", class: `st-dur k-${next.kind}` }, [dur(next.t - s.t)]));
      }
    });
    stops.forEach((s, i) => {
      kids.push(svg("circle", { cx: X(i), cy: y, r: 7, class: `st-node k-${s.kind}`, style: `--i:${i}` }));
      kids.push(svg("text", { x: X(i), y: 18, "text-anchor": "middle", class: "st-top" }, [s.top]));
      kids.push(svg("text", { x: X(i), y: y + 28, "text-anchor": "middle", class: "st-main" }, [s.main]));
      kids.push(svg("text", { x: X(i), y: y + 45, "text-anchor": "middle", class: "st-sub" }, [s.sub]));
    });
  } else {
    const rowH = 64;
    const H = 20 + rowH * (stops.length - 1) + 40;
    box.setAttribute("viewBox", `0 0 ${W} ${H}`);
    box.setAttribute("height", String(H));
    const x = 18;
    const Y = (/** @type {number} */ i) => 22 + rowH * i;
    stops.forEach((s, i) => {
      const next = stops[i + 1];
      if (next) {
        kids.push(svg("path", { d: `M${x},${Y(i) + 9}V${Y(i + 1) - 9}`, class: `st-link k-${next.kind}` }));
        kids.push(svg("text", { x: x + 16, y: (Y(i) + Y(i + 1)) / 2 + 12, class: `st-dur k-${next.kind}` }, [`${dur(next.t - s.t)} later`]));
      }
    });
    stops.forEach((s, i) => {
      kids.push(svg("circle", { cx: x, cy: Y(i), r: 7, class: `st-node k-${s.kind}`, style: `--i:${i}` }));
      kids.push(svg("text", { x: x + 16, y: Y(i) - 4, class: "st-main" }, [s.main]));
      kids.push(svg("text", { x: x + 16, y: Y(i) + 12, class: "st-sub" }, [`${s.top} UTC · ${s.sub}`]));
    });
  }
  box.replaceChildren(title, ...kids);
  box.querySelectorAll("path.st-link").forEach((p) => drawIn(/** @type {SVGPathElement} */ (p)));
}

/** @param {any} row */
function showNightRow(row) {
  const { n, usdc, bonus } = totals(row);
  const box = $("night-row-stats");
  box.replaceChildren();
  const stat = (/** @type {string} */ k, /** @type {string} */ v) =>
    box.append(h("div", { class: "stat" }, [h("div", { class: "k" }, [k]), h("div", { class: "v" }, [v])]));
  stat("Liquidations", whole(n));
  stat("USDC repaid by liquidators", fmt(usdc));
  stat("Liquidation bonus paid (USDC)", bonus === null ? "unknown" : fmt(bonus));
  const notes = $("night-row-notes");
  const line = (/** @type {(Node | string)[]} */ kids) => notes.append(h("p", { class: "fine" }, kids));
  notes.replaceChildren();
  line([
    h("code", {}, [row.user]),
    `: health factor ${row.noonHf === null ? "none (no debt)" : fmt(row.noonHf, 4)} at 12:00 UTC; ${usd(row.preDebtUsd)} of debt one block before its first liquidation. `,
    row.usdcOnly
      ? "USDC was its only debt: the kind of loan Kite's auto-repay serves."
      : "It owed more than USDC; Kite's auto-repay needs USDC to be the only debt.",
  ]);
  if (row.notReplayable) line([`No replay: ${row.notReplayable}.`]);
  else if (!row.samePosition) line(["Its collateral or debt changed between noon and the liquidation, so a replay of its noon loan is not its real path."]);
  else {
    const spans = ["1.1", "1.05"]
      .filter((l) => row.room[l])
      .map((l) => {
        const r = row.room[l];
        return `from ${l} at ${hhmmss(r.from)} to liquidatable at ${hhmmss(r.to)} UTC, ${dur(r.to - r.from)}`;
      });
    line([
      `Replayed from its noon loan, within ${pctOf(row.replayErr)} of Aave's health factor one block before the liquidation. `,
      spans.length ? `Its health factor went ${spans.join("; and ")}.` : "It was already below 1.05 at noon.",
    ]);
  }
  if (row.preHf !== null && row.preHf >= 1)
    line([`Aave's health factor was still ${fmt(row.preHf, 4)} one block before: it was liquidated in the block that made it liquidatable.`]);
  for (const l of row.liquidations)
    line([`${utc(l.time)}: ${fmt(l.usdc)} USDC repaid, ${l.collateral} taken. `, outLink(`https://basescan.org/tx/${l.tx}`, "Transaction")]);
  $("night-row").hidden = false;
  drawStory(row);
  current = row;
}
/** @type {any} */ let current = null;
onWidthChange(() => current && !$("night-row").hidden && drawStory(current));

/** @param {string} address @param {boolean} [scroll] */
export function lookUpNight(address, scroll = false) {
  $in("night-address").value = address;
  nightRowFor(address).then(
    (row) => {
      $("night-row").hidden = true;
      selectDots(row ? row.user : null);
      if (!row) return say($("night-msg"), "Not liquidated on USDC debt on Aave v3 Base from Oct 10, 2025 12:00 UTC to Oct 11 12:00 UTC.");
      say($("night-msg"), "");
      showNightRow(row);
      if (scroll) $("night-row").scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "nearest" });
    },
    (/** @type {Error} */ err) => say($("night-msg"), err.message, "err"),
  );
}
