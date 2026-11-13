// @ts-check
// Repay Ready page. Every number shown comes from /api/* (a live read or a
// recorded real run); the page computes nothing about the loan itself beyond
// scaling the recorded HF path for the chart.

/** @param {string} id */
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
/** @param {string} id */
const $in = (id) => /** @type {HTMLInputElement} */ (document.getElementById(id));

/** @type {any} */ let view = null;
/** @type {{ message: string, signature: string } | null} */ let signed = null;
let viewLoadedAt = 0;
let recordedMode = false;

const fmt = (/** @type {number} */ n, d = 2) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const usd = (/** @type {number} */ n) => `$${fmt(n)}`;
/** Seconds as "28 s", "3 min", "8.5 min" or "6.4 h" (a trailing ".0" is dropped). */
const dur = (/** @type {number} */ s) => {
  const one = (/** @type {number} */ v) => fmt(v, 1).replace(/\.0$/, "");
  return s < 120 ? `${s} s` : s < 3 * 3600 ? `${one(s / 60)} min` : `${one(s / 3600)} h`;
};
const hhmm = (/** @type {number} */ t) => new Date(t * 1000).toISOString().slice(11, 16);
const hhmmss = (/** @type {number} */ t) => new Date(t * 1000).toISOString().slice(11, 19);

/** @param {HTMLElement} el @param {string} text @param {"" | "err" | "warn"} [kind] */
function say(el, text, kind = "") {
  el.textContent = text;
  el.className = `msg ${kind}`.trim();
}

/** @param {string} tag @param {Record<string, string>} [attrs] @param {(Node | string)[]} [kids] */
function h(tag, attrs = {}, kids = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const k of kids) el.append(k);
  return el;
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
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = busy;
  try {
    await fn();
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

// ─── 1. Loan ────────────────────────────────────────────────────────────────

$("address-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const address = $in("address").value.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return say($("address-msg"), "Enter a 0x… address: 42 characters.", "err");
  void busyWhile(/** @type {HTMLButtonElement} */ ($("address-go")), "Reading Aave…", async () => {
    say($("address-msg"), "");
    try {
      const v = await api(`/api/position?address=${address}`);
      setRecorded(null);
      showView(v);
      $("result").hidden = true;
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
  stat("Health factor", p.hf === null ? "no debt" : fmt(p.hf, 4));
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
    ? `Block ${Number(p.blockNumber).toLocaleString("en-US")}. Our rebuilt health factor matches Aave's own${p.hfRelErr === null ? "" : ` (relative gap ${p.hfRelErr.toExponential(1)})`}.${p.eMode ? ` E-mode: ${p.eMode.label}.` : ""}${penalty}`
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
  noteNight(p.user);
  $("step-position").hidden = false;

  const canRun = p.hf !== null && p.usdcOnly && v.replay.ok && v.rooms.length > 0;
  $("step-room").hidden = !canRun;
  $("step-plan").hidden = !canRun;
  $("step-sign").hidden = !canRun;
  $("step-check").hidden = !canRun;
  if (!canRun) return;
  setupRoom();
  $("sign-message").textContent = v.ownership.message;
  $("kite-warning-1").textContent = v.kiteWarning;
  $("kite-warning-2").textContent = v.kiteWarning;
  $in("sign-paste").value = "";
  say($("sign-msg"), "");
}

// ─── Oct 10 room ────────────────────────────────────────────────────────────

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
  table.append(h("tr", {}, [h("th", {}, ["Trigger"]), h("th", {}, ["Worst-case time to liquidatable"])]));
  const show = [1.02, 1.05, 1.08, 1.1, 1.15, 1.2, 1.25, 1.3, 1.4, 1.5];
  for (const r of view.rooms) {
    if (!show.includes(r.triggerHf)) continue;
    table.append(
      h("tr", { "data-t": String(r.triggerHf) }, [h("td", {}, [fmt(r.triggerHf)]), h("td", {}, [r.seconds === null ? "never liquidatable" : dur(r.seconds)])]),
    );
  }
  drawRoom();
}

$in("room-range").addEventListener("input", () => drawRoom());
let resizeTimer = 0;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => view && !$("step-room").hidden && drawRoom(), 120);
});

function drawRoom() {
  const row = view.rooms[Number($in("room-range").value)];
  const T = row.triggerHf;
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
  const svg = /** @type {SVGSVGElement & HTMLElement} */ (/** @type {unknown} */ ($("room-chart")));
  const W = Math.max(280, svg.clientWidth || svg.parentElement?.clientWidth || 600);
  const H = Math.round(Math.min(280, Math.max(200, W * 0.45)));
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("height", String(H));
  const pad = { l: 40, r: 10, t: 16, b: 26 };
  // Points in the window: the one in force at w0, then every update up to w1.
  let k0 = 0;
  while (k0 + 1 < t.length && ti(k0 + 1) <= w0) k0++;
  const pts = [];
  for (let k = k0; k < t.length && ti(k) <= w1; k++) pts.push({ t: Math.max(ti(k), w0), hf: hfAt(k) });
  const lo = Math.min(0.97, ...pts.map((p) => p.hf)) - 0.01;
  const hi = Math.max(T + 0.03, ...pts.map((p) => p.hf)) + 0.01;
  const X = (/** @type {number} */ v) => pad.l + ((v - w0) / (w1 - w0)) * (W - pad.l - pad.r);
  const Y = (/** @type {number} */ v) => pad.t + ((hi - v) / (hi - lo)) * (H - pad.t - pad.b);
  const ns = "http://www.w3.org/2000/svg";
  const el = (/** @type {string} */ tag, /** @type {Record<string, string | number>} */ a, /** @type {string} */ text = "") => {
    const n = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(a)) n.setAttribute(k, String(v));
    if (text) n.textContent = text;
    return n;
  };
  const title = $("room-chart-title");
  svg.replaceChildren(title);
  // y grid
  const step = hi - lo > 0.4 ? 0.1 : 0.05;
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    svg.append(el("line", { x1: pad.l, x2: W - pad.r, y1: Y(v), y2: Y(v), stroke: "var(--line)" }));
    svg.append(el("text", { x: pad.l - 6, y: Y(v) + 4, "text-anchor": "end" }, fmt(v)));
  }
  // x ticks
  const ticks = W < 420 ? 3 : 5;
  for (let i = 0; i <= ticks; i++) {
    const v = w0 + ((w1 - w0) * i) / ticks;
    svg.append(el("text", { x: X(v), y: H - 6, "text-anchor": i === 0 ? "start" : i === ticks ? "end" : "middle" }, hhmm(v)));
  }
  // trigger and liquidation lines
  const hline = (/** @type {number} */ v, /** @type {string} */ color, /** @type {string} */ label) => {
    svg.append(el("line", { x1: pad.l, x2: W - pad.r, y1: Y(v), y2: Y(v), stroke: color, "stroke-width": 1.5, "stroke-dasharray": "5 4" }));
    // Left edge, just under the line: before the fall the trace is still above it.
    svg.append(el("text", { x: pad.l + 4, y: Y(v) + 14, "text-anchor": "start", class: "halo", style: `fill:${color};font-weight:600` }, label));
  };
  hline(T, "var(--chart-t)", `Kite fires below ${fmt(T)}`);
  hline(1, "var(--chart-liq)", "Liquidatable below 1.00");
  // the HF path (a step function: Aave's price only moves on oracle updates)
  const [p0, ...rest] = pts;
  if (!p0) return;
  let dpath = `M${X(p0.t)},${Y(p0.hf)}`;
  for (const p of rest) dpath += `H${X(p.t)}V${Y(p.hf)}`;
  dpath += `H${X(w1)}`;
  svg.append(el("path", { d: dpath, fill: "none", stroke: "var(--chart-line)", "stroke-width": 2.25 }));
  const vline = (/** @type {number} */ at, /** @type {string} */ color, /** @type {string} */ label, /** @type {"start" | "end"} */ anchor) => {
    svg.append(el("line", { x1: X(at), x2: X(at), y1: pad.t, y2: H - pad.b, stroke: color, "stroke-width": 1 }));
    svg.append(el("text", { x: X(at) + (anchor === "start" ? 4 : -4), y: pad.t + 2, "text-anchor": anchor, class: "halo", style: `fill:${color}` }, label));
  };
  if (row.seconds !== null) {
    vline(row.start, "var(--chart-t)", hhmmss(row.start), "end");
    vline(row.liquidatableAt, "var(--chart-liq)", hhmmss(row.liquidatableAt), "start");
    if (d) vline(row.start + d.seconds, "var(--chart-line)", "repay lands", "start");
  }
  svg.querySelectorAll("text.halo").forEach((n) => svg.append(n)); // labels on top of the trace
  title.textContent = `Health factor on Oct 10, 2025, starting at ${fmt(T)}`;
  $("room-caption").textContent =
    row.seconds !== null
      ? `Your loan, at ${fmt(T)} at ${hhmmss(row.start)} UTC on Oct 10, 2025, falls below 1.00 at ${hhmmss(row.liquidatableAt)}. ` +
        (d
          ? `Kite's measured fire delay is ${dur(d.seconds)}; the check needs at least ${view.policy.roomFactor}× that.`
          : "Kite's fire delay hasn't been measured yet, so the check can't say Kite would land in time.")
      : `Starting at ${fmt(T)} at the night's high (${hhmmss(ti(s))} UTC), the lowest point was ${fmt(hfAt(e), 4)} at ${hhmmss(ti(e))}.`;
}

// ─── 2. Plan ────────────────────────────────────────────────────────────────

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

function syncMax() {
  const max = $in("f-max").checked;
  $in("f-amount").disabled = max;
  if (max) $in("f-amount").value = "";
}
$in("f-max").addEventListener("change", syncMax);

/** Typing a trigger moves the Oct 10 view to it (never the other way round). */
function syncSlider() {
  if (!view?.rooms?.length) return;
  const T = Math.round(Number($in("f-hf").value) * 100) / 100;
  const i = view.rooms.findIndex((/** @type {any} */ r) => r.triggerHf === T);
  if (i >= 0) {
    $in("room-range").value = String(i);
    drawRoom();
  }
}
$in("f-hf").addEventListener("change", syncSlider);

// ─── 3. Sign ────────────────────────────────────────────────────────────────

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
});

// ─── 4. Check ───────────────────────────────────────────────────────────────

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
    tick();
    const timer = setInterval(tick, 1000);
    try {
      const r = await api("/api/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      clearInterval(timer);
      say($("check-msg"), "");
      setRecorded(null);
      showResult(r);
    } catch (err) {
      clearInterval(timer);
      say($("check-msg"), /** @type {Error} */ (err).message, "err");
    }
  });
});

const VERDICT_TEXT = {
  ARM: "Arm it. Every check passed, and SERV Reasoning agrees.",
  ADJUST: "Adjust first. Nothing is armed until every check passes.",
  REFUSE: "Don't arm this. It would not reliably reduce your liquidation risk.",
};

/** @param {any} r */
function showResult(r) {
  const f = r.final;
  const v = $("verdict");
  v.className = `verdict v-${f.verdict}`;
  const servOk = !("error" in r.serv) && r.serv.agreement.agrees;
  v.replaceChildren(
    h("div", { class: "w" }, [f.verdict]),
    h("p", {}, [f.reason ?? (servOk ? r.serv.verdict.message : VERDICT_TEXT[/** @type {"ARM"} */ (f.verdict)])]),
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
  for (const c of r.report.checks) {
    const li = h("li", {}, [h("span", { class: `s s-${c.status}` }, [c.status]), h("span", { class: "l" }, [c.label]), h("span", { class: "d" }, [c.detail])]);
    const fix = c.status !== "pass" && c.fix ? fixRow(c.fix) : null;
    if (fix) li.append(fix);
    list.append(li);
  }

  $("arm").hidden = !f.command;
  if (f.command) {
    $("cmd").textContent = f.command;
    $("kite-warning-2").textContent = r.kiteWarning;
  }
  $("result").hidden = false;
  $("result").scrollIntoView({ behavior: "smooth", block: "start" });
}

/** A fix is shown, and applied only if the person clicks it. @param {any} fix */
function fixRow(fix) {
  const row = h("div", { class: "fix" });
  /** @param {string} label @param {() => void} fn */
  const btn = (label, fn) => {
    const b = /** @type {HTMLButtonElement} */ (h("button", { type: "button", class: "ghost small" }, [label]));
    b.addEventListener("click", () => {
      fn();
      say($("check-msg"), "Field updated. Run the check again.");
    });
    row.append(b);
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

// ─── The real night, loan by loan ───────────────────────────────────────────
// public/oct10-liquidations.json, written by scripts/oct10-liquidations.ts: every
// borrower whose USDC debt Aave liquidated on Base from Oct 10, 2025 12:00 UTC to
// Oct 11 12:00 UTC. The page only looks rows up; every number is in the file.

const DEFI_SAVER_MIN = "https://help.defisaver.com/automations/requirements-for-using-automation";
/** @type {Promise<any>} */
const night = fetch("/oct10-liquidations.json").then((r) => {
  if (!r.ok) throw new Error(`Couldn't load the Oct 10 record (${r.status}).`);
  return r.json();
});
const whole = (/** @type {number} */ n) => fmt(n, 0);
const utc = (/** @type {number} */ t) => `${new Date(t * 1000).toISOString().slice(0, 19).replace("T", " ")} UTC`;
// Three significant digits, as stored: a "within" bound must not round below the real error.
const pctOf = (/** @type {number} */ x) => `${(x * 100).toPrecision(3)}%`;
const isAddress = (/** @type {string} */ a) => /^0x[0-9a-fA-F]{40}$/.test(a);
/** @param {any} file @param {string} address */
const findRow = (file, address) => file.borrowers.find((/** @type {any} */ b) => b.user.toLowerCase() === address.toLowerCase()) ?? null;
/** @param {any} row */
const totals = (row) => {
  /** @type {any[]} */
  const ls = row.liquidations;
  const usdc = ls.reduce((s, l) => s + l.usdc, 0);
  const bonus = ls.some((l) => l.bonusUsdc === null) ? null : ls.reduce((s, l) => s + l.bonusUsdc, 0);
  return { n: ls.length, usdc, bonus };
};
/** @param {HTMLElement} box @param {string} k @param {string} v */
const tile = (box, k, v) => box.append(h("div", { class: "stat" }, [h("div", { class: "k" }, [k]), h("div", { class: "v" }, [v])]));
const outLink = (/** @type {string} */ href, /** @type {string} */ text) => h("a", { href, target: "_blank", rel: "noopener" }, [text]);

night.then(
  (file) => {
    const s = file.summary;
    const t105 = s.triggers.find((/** @type {any} */ t) => t.level === "1.05");
    $("night-intro").textContent =
      `From Oct 10, 2025 12:00 UTC to Oct 11 12:00 UTC, liquidators repaid USDC debt for ${whole(s.borrowers)} borrowers on Aave v3 Base. ` +
      "Every row is read from Aave's own LiquidationCall events and from each loan's position on-chain.";
    const box = $("night-stats");
    tile(box, "Borrowers liquidated", whole(s.borrowers));
    tile(box, "USDC repaid by liquidators", whole(s.usdcRepaid));
    tile(box, "Liquidation bonus they paid (USDC)", whole(s.bonusUsdc.total));
    tile(box, "Liquidated in the block they became liquidatable", `${whole(s.liquidatedInFirstBlock)} of ${whole(s.borrowers)}`);
    if (t105?.minSeconds != null) tile(box, "Fastest real loan from health factor 1.05 to liquidatable", dur(t105.minSeconds));
    const fine = $("night-fine");
    fine.replaceChildren(
      `For the ${whole(s.samePosition)} USDC-only loans that kept the same collateral and debt from noon until their liquidation, our replay matched Aave's own health factor one block before the liquidation to within ${pctOf(s.replayErr.max)}. `,
      t105?.crossed
        ? `${whole(t105.crossed)} of them crossed 1.05 after noon. From 1.05 to liquidatable took ${dur(t105.medianSeconds)} at the median, and under 5 minutes for ${whole(t105.underFiveMinutes)}. `
        : "",
      `${whole(s.preDebtUsd.underDefiSaverMin)} of the ${whole(s.borrowers)} owed under $500, below `,
      outLink(DEFI_SAVER_MIN, "DeFi Saver's minimum for automation on Aave Base"),
      ".",
      s.bonusUsdc.legsMissing ? ` The bonus total leaves out ${whole(s.bonusUsdc.legsMissing)} borrowers whose collateral leg we could not price.` : "",
    );
    $("night-example-hint").hidden = !t105?.fastest;
  },
  (/** @type {Error} */ err) => say($("night-intro"), err.message, "err"),
);

/** @param {any} row */
function showNightRow(row) {
  const { n, usdc, bonus } = totals(row);
  const box = $("night-row-stats");
  box.replaceChildren();
  tile(box, "Liquidations", whole(n));
  tile(box, "USDC repaid by liquidators", fmt(usdc));
  tile(box, "Liquidation bonus paid (USDC)", bonus === null ? "unknown" : fmt(bonus));
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
}

/** @param {string} address */
function lookUpNight(address) {
  $in("night-address").value = address;
  night.then(
    (file) => {
      const row = findRow(file, address);
      $("night-row").hidden = true;
      if (!row) return say($("night-msg"), "Not liquidated on USDC debt on Aave v3 Base from Oct 10, 2025 12:00 UTC to Oct 11 12:00 UTC.");
      say($("night-msg"), "");
      showNightRow(row);
    },
    (/** @type {Error} */ err) => say($("night-msg"), err.message, "err"),
  );
}

$("night-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const address = $in("night-address").value.trim();
  if (!isAddress(address)) return say($("night-msg"), "Enter a 0x… address: 42 characters.", "err");
  lookUpNight(address);
});
$("night-example").addEventListener("click", () => {
  night.then((file) => lookUpNight(file.summary.triggers.find((/** @type {any} */ t) => t.level === "1.05").fastest)).catch(() => {});
});

/** After "Read loan": say so on the loan card if this address was liquidated that night. @param {string} user */
function noteNight(user) {
  const el = $("pos-night");
  el.hidden = true;
  night
    .then((file) => {
      const row = findRow(file, user);
      if (!row || view?.position.user !== user) return;
      const { n, usdc, bonus } = totals(row);
      el.textContent = `This address was liquidated on Oct 10, 2025: ${n === 1 ? "once" : `${n} times`}, ${fmt(usdc)} USDC repaid by liquidators${bonus === null ? "" : `, ${fmt(bonus)} USDC of liquidation bonus paid`}. The record is below, under "The real night".`;
      el.hidden = false;
      lookUpNight(user);
    })
    .catch(() => {});
}

// ─── Recorded run ───────────────────────────────────────────────────────────

/** @param {any} sample */
function setRecorded(sample) {
  recordedMode = !!sample;
  const b = $("recorded");
  b.hidden = !sample;
  if (sample)
    b.textContent = `Recorded run from ${sample.recordedAt.slice(0, 16).replace("T", " ")} UTC, Aave block ${Number(sample.check.position.blockNumber).toLocaleString("en-US")}. Real data and a real SERV answer, saved so you can see the flow without a wallet. Press "Read loan" to run it live.`;
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
if (linked && /^0x[0-9a-fA-F]{40}$/.test(linked)) {
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
