// @ts-check
// Small shared helpers for the page's charts: formatting, SVG building, the
// theme's colours, motion preferences, count-ups and scroll reveal. Nothing
// here computes a number about a loan; it only draws numbers it is given.

export const NS = "http://www.w3.org/2000/svg";

export const fmt = (/** @type {number} */ n, d = 2) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
export const whole = (/** @type {number} */ n) => fmt(n, 0);
export const usd = (/** @type {number} */ n) => `$${fmt(n)}`;
/** Signed percent with a real minus sign, e.g. "−19.12%". */
export const signedPct = (/** @type {number} */ f, d = 2) => `${f < 0 ? "−" : f > 0 ? "+" : ""}${fmt(Math.abs(f) * 100, d)}%`;
/** Seconds as "28 s", "3 min", "8.5 min" or "6.4 h" (a trailing ".0" is dropped). */
export const dur = (/** @type {number} */ s) => {
  const one = (/** @type {number} */ v) => fmt(v, 1).replace(/\.0$/, "");
  return s < 120 ? `${s} s` : s < 3 * 3600 ? `${one(s / 60)} min` : `${one(s / 3600)} h`;
};
export const hhmm = (/** @type {number} */ t) => new Date(t * 1000).toISOString().slice(11, 16);
export const hhmmss = (/** @type {number} */ t) => new Date(t * 1000).toISOString().slice(11, 19);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Oct 10 · 21:20:25 UTC" */
export const dayClock = (/** @type {number} */ t) => {
  const d = new Date(t * 1000);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} · ${hhmmss(t)} UTC`;
};

/** @param {string} tag @param {Record<string, string | number>} [attrs] @param {(Node | string)[]} [kids] */
export function svg(tag, attrs = {}, kids = []) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  for (const k of kids) n.append(k);
  return n;
}

/** @param {string} tag @param {Record<string, string>} [attrs] @param {(Node | string)[]} [kids] */
export function h(tag, attrs = {}, kids = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const k of kids) el.append(k);
  return el;
}

/** Width an SVG should draw at: its own box, else its parent's. @param {Element} el @param {number} fallback */
export const widthOf = (el, fallback) => Math.round(el.getBoundingClientRect().width || el.parentElement?.getBoundingClientRect().width || fallback);

const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
export const reducedMotion = () => motionQuery.matches;

/** The theme's colour tokens, read from CSS so canvas and SVG match the page. */
export function colors() {
  const cs = getComputedStyle(document.documentElement);
  const v = (/** @type {string} */ name) => cs.getPropertyValue(name).trim();
  return {
    bg: v("--bg"),
    card: v("--card"),
    card2: v("--card-2"),
    ink: v("--ink"),
    muted: v("--muted"),
    faint: v("--faint"),
    line: v("--line"),
    line2: v("--line-2"),
    accent: v("--accent"),
    accentSoft: v("--accent-soft"),
    t: v("--chart-t"),
    liq: v("--chart-liq"),
    eth: v("--eth"),
    btc: v("--btc"),
    dot: v("--dot"),
  };
}

/** Calls fn whenever the theme changes (the toggle). @param {() => void} fn */
export function onThemeChange(fn) {
  themeListeners.push(fn);
}
/** @type {(() => void)[]} */
const themeListeners = [];
export const themeChanged = () => themeListeners.forEach((f) => f());

/** Debounced resize, only when the width changes (phones fire resize on scroll). @param {() => void} fn */
export function onWidthChange(fn) {
  let w = window.innerWidth;
  let timer = 0;
  window.addEventListener("resize", () => {
    if (window.innerWidth === w) return;
    w = window.innerWidth;
    clearTimeout(timer);
    timer = window.setTimeout(fn, 120);
  });
}

/**
 * Counts an element's text up to its final value once it is on screen. The
 * final text is set exactly as given, so what stays on the page is the real
 * number, formatted once. @param {HTMLElement} el @param {number} value @param {(n: number) => string} format
 */
export function countUp(el, value, format) {
  el.textContent = format(value);
  if (reducedMotion() || !Number.isFinite(value) || value === 0) return;
  el.textContent = format(0);
  whenSeen(el, () => {
    const t0 = performance.now();
    const ms = 1100;
    const step = (/** @type {number} */ now) => {
      const k = Math.min(1, (now - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      el.textContent = k < 1 ? format(Math.round(value * e)) : format(value);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

/** Runs fn once, the first time el is at least partly on screen. @param {Element} el @param {() => void} fn */
export function whenSeen(el, fn, threshold = 0.15) {
  if (reducedMotion() || !("IntersectionObserver" in window)) return void fn();
  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        fn();
      }
    },
    { threshold },
  );
  io.observe(el);
}

/** Fades and lifts elements in as they scroll into view. @param {Iterable<Element>} els */
export function reveal(els) {
  for (const el of els) {
    if (reducedMotion()) continue;
    el.classList.add("reveal");
    whenSeen(el, () => el.classList.add("in"), 0.08);
  }
}

/** Sets an animated stroke to draw itself. @param {SVGPathElement | SVGPolylineElement} path */
export function drawIn(path) {
  if (reducedMotion()) return;
  const len = Math.ceil(path.getTotalLength());
  path.style.setProperty("--len", String(len));
  path.classList.remove("draw");
  void path.getBoundingClientRect();
  path.classList.add("draw");
}

/** Keeps a range input's filled track in step with its value. @param {HTMLInputElement} input */
export function syncFill(input) {
  const min = Number(input.min) || 0;
  const max = Number(input.max) || 1;
  const pct = max > min ? ((Number(input.value) - min) / (max - min)) * 100 : 0;
  input.style.setProperty("--fill", `${pct}%`);
}
