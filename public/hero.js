// @ts-check
// The opening replay: Oct 10, 2025, 12:00 UTC to Oct 11 12:00 UTC, drawn from
// two files and nothing else:
//   /oct10-prices.json        every Chainlink ETH/USD and BTC/USD round Aave's
//                             Base oracle used (scripts/oct10-prices.ts)
//   /oct10-liquidations.json  every USDC liquidation on Aave v3 Base in the
//                             same window (scripts/oct10-liquidations.ts)
// Each dot is one liquidation, dropped at the second it happened and stacked
// by time. The time axis is in three pieces, and the crash (20:50 to 21:40
// UTC) is drawn wider and played slower; the caption states both factors,
// computed below. window.__heroRender(f) draws progress f (0..1) on demand,
// so scripts/clip.ts can render the clip frame by frame and scripts/og.ts
// the social image.
import { colors, dayClock, hhmm, hhmmss, onThemeChange, onWidthChange, reducedMotion, signedPct, whenSeen, whole, syncFill } from "./viz.js";

const SLOW_FROM = Date.UTC(2025, 9, 10, 20, 50) / 1000;
const SLOW_TO = Date.UTC(2025, 9, 10, 21, 40) / 1000;
const SLOW_S = 14; // playback seconds for the crash window
const FAST_S = 10; // playback seconds for the other 23 h 10 min
const FALL_S = 0.35; // a new dot drops into its stack over this much playback time
const FLASH_S = 0.9;

/** @param {HTMLElement | null} el */
const need = (el) => /** @type {HTMLElement} */ (el);

/**
 * @param {Promise<any>} pricesP /oct10-prices.json
 * @param {Promise<any>} nightP /oct10-liquidations.json
 */
export function initHero(pricesP, nightP) {
  const fig = need(document.getElementById("replay"));
  const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("replay-canvas"));
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
  const clock = need(document.getElementById("replay-clock"));
  const chip = need(document.getElementById("replay-chip"));
  const playBtn = need(document.getElementById("replay-play"));
  const scrub = /** @type {HTMLInputElement} */ (document.getElementById("replay-scrub"));
  const note = need(document.getElementById("replay-note"));
  const out = {
    eth: need(document.getElementById("rr-eth")),
    btc: need(document.getElementById("rr-btc")),
    n: need(document.getElementById("rr-n")),
    usdc: need(document.getElementById("rr-usdc")),
  };

  Promise.all([pricesP, nightP]).then(
    ([prices, night]) => run(prices, night),
    (/** @type {Error} */ err) => {
      note.textContent = `Couldn't load the record: ${err.message}`;
      note.classList.add("err");
    },
  );

  /** @param {any} prices @param {any} night */
  function run(prices, night) {
    const from = /** @type {number} */ (prices.from);
    const to = /** @type {number} */ (prices.to);
    /** @type {[number, number][]} */ const eth = prices.feeds.ETH.points;
    /** @type {[number, number][]} */ const btc = prices.feeds.BTC.points;
    const eth0 = eth[0]?.[1] ?? 1;
    const btc0 = btc[0]?.[1] ?? 1;

    // Playback clock: three linear pieces. x on screen is proportional to playback time.
    const outside = SLOW_FROM - from + (to - SLOW_TO);
    const segs = [
      { t0: from, t1: SLOW_FROM, p: (FAST_S * (SLOW_FROM - from)) / outside },
      { t0: SLOW_FROM, t1: SLOW_TO, p: SLOW_S },
      { t0: SLOW_TO, t1: to, p: (FAST_S * (to - SLOW_TO)) / outside },
    ];
    const D = segs.reduce((s, g) => s + g.p, 0);
    const P = (/** @type {number} */ t) => {
      let acc = 0;
      for (const g of segs) {
        if (t <= g.t1) return acc + (Math.max(0, t - g.t0) / (g.t1 - g.t0)) * g.p;
        acc += g.p;
      }
      return D;
    };
    const T = (/** @type {number} */ p) => {
      let acc = 0;
      for (const g of segs) {
        if (p <= acc + g.p) return g.t0 + ((p - acc) / g.p) * (g.t1 - g.t0);
        acc += g.p;
      }
      return to;
    };
    const zoom = SLOW_S / (SLOW_TO - SLOW_FROM) / (FAST_S / outside);
    const fastRate = outside / FAST_S;
    const slowRate = (SLOW_TO - SLOW_FROM) / SLOW_S;

    // Liquidations, in time order, with the running totals the readout shows.
    /** @type {{ time: number, usdc: number, user: string, p: number, x: number, y: number }[]} */
    const liqs = night.borrowers
      .flatMap((/** @type {any} */ b) => b.liquidations.map((/** @type {any} */ l) => ({ time: l.time, usdc: l.usdc, user: b.user, p: 0, x: 0, y: 0 })))
      .sort((/** @type {any} */ a, /** @type {any} */ b) => a.time - b.time);
    const seen = new Set();
    /** @type {number[]} */ const cumUsdc = [];
    /** @type {number[]} */ const cumUsers = [];
    let su = 0;
    for (const l of liqs) {
      su += l.usdc;
      seen.add(l.user.toLowerCase());
      cumUsdc.push(su);
      cumUsers.push(seen.size);
      l.p = P(l.time);
    }
    const lows = [
      { name: "ETH", pts: eth, base: eth0, key: "eth" },
      { name: "BTC", pts: btc, base: btc0, key: "btc" },
    ].map((s) => {
      let k = 0;
      s.pts.forEach((q, i) => q[1] < (s.pts[k]?.[1] ?? Infinity) && (k = i));
      const q = /** @type {[number, number]} */ (s.pts[k]);
      return { ...s, t: q[0], pct: q[1] / s.base - 1 };
    });
    const allPct = [...eth.map((q) => q[1] / eth0 - 1), ...btc.map((q) => q[1] / btc0 - 1)];
    const yMin = Math.floor((Math.min(...allPct) - 0.006) * 100) / 100;
    const yMax = Math.max(Math.max(...allPct) + 0.015, 0.02);

    note.textContent =
      `Chainlink ETH/USD (${whole(eth.length)} rounds) and BTC/USD (${whole(btc.length)} rounds) as Aave's Base oracle read them, and all ` +
      `${whole(liqs.length)} USDC liquidations on Aave v3 Base, one dot each. Plays at ${whole(fastRate)}× real time, slowing to ${whole(slowRate)}× ` +
      `for 20:50–21:40 UTC, which is drawn ${whole(zoom)}× wider.`;
    scrub.setAttribute("aria-valuetext", dayClock(from));

    // ─── Layout ────────────────────────────────────────────────────────────
    let W = 0;
    let H = 0;
    let dpr = 1;
    const pad = { l: 42, r: 12, t: 22, b: 22 };
    let L = { priceTop: 0, priceBot: 0, stripTop: 0, stripBot: 0, plotW: 0, pitch: 3 };
    let C = colors();

    const X = (/** @type {number} */ t) => pad.l + (P(t) / D) * L.plotW;
    const Y = (/** @type {number} */ pct) => L.priceTop + ((yMax - pct) / (yMax - yMin)) * (L.priceBot - L.priceTop);

    function layout() {
      dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      W = canvas.clientWidth;
      H = canvas.clientHeight;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      const inner = H - pad.t - pad.b;
      const priceBot = pad.t + inner * 0.56;
      L = { priceTop: pad.t + 6, priceBot, stripTop: priceBot + 18, stripBot: H - pad.b, plotW: W - pad.l - pad.r, pitch: 3 };
      // Stack the dots in columns one dot wide; shrink the dots until the tallest column fits.
      const stripH = L.stripBot - L.stripTop - 14;
      for (let pitch = 4.2; pitch >= 1.6; pitch -= 0.1) {
        /** @type {Map<number, number>} */ const cols = new Map();
        let tallest = 0;
        for (const l of liqs) {
          const col = Math.floor((X(l.time) - pad.l) / pitch);
          const k = cols.get(col) ?? 0;
          cols.set(col, k + 1);
          tallest = Math.max(tallest, k + 1);
          l.x = pad.l + (col + 0.5) * pitch;
          l.y = L.stripBot - (k + 0.5) * pitch;
        }
        L.pitch = pitch;
        if (tallest * pitch <= stripH) break;
      }
    }

    // ─── Drawing ───────────────────────────────────────────────────────────
    /** @param {[number, number][]} pts @param {number} base @param {number} t */
    const valueAt = (pts, base, t) => {
      let lo = 0;
      let hi = pts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (/** @type {[number, number]} */ (pts[mid])[0] <= t) lo = mid;
        else hi = mid - 1;
      }
      return /** @type {[number, number]} */ (pts[lo])[1] / base - 1;
    };
    /** Index of the last liquidation at or before t, or -1. @param {number} t */
    const doneBy = (t) => {
      let lo = -1;
      let hi = liqs.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (/** @type {any} */ (liqs[mid]).time <= t) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    };
    /** A theme colour (#rgb or #rrggbb) at opacity a. @param {string} c @param {number} a */
    const fade = (c, a) => {
      const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c);
      if (!m) return c;
      const hex = /** @type {string} */ (m[1]);
      const full = hex.length === 3 ? [...hex].map((d) => d + d).join("") : hex;
      const n = parseInt(full, 16);
      return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
    };

    /** @param {number} f progress 0..1 @param {boolean} playing */
    function render(f, playing) {
      const p = f * D;
      const t = T(p);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.font = `500 10.5px "Geist Mono", ui-monospace, monospace`;
      ctx.textBaseline = "middle";

      // The crash window, drawn wider: shaded, with its factor.
      const zx0 = X(SLOW_FROM);
      const zx1 = X(SLOW_TO);
      ctx.fillStyle = fade(C.accent, 0.07);
      ctx.fillRect(zx0, L.priceTop - 14, zx1 - zx0, L.stripBot - L.priceTop + 14);
      ctx.strokeStyle = fade(C.accent, 0.35);
      ctx.setLineDash([3, 4]);
      ctx.lineWidth = 1;
      for (const x of [zx0, zx1]) {
        ctx.beginPath();
        ctx.moveTo(Math.round(x) + 0.5, L.priceTop - 14);
        ctx.lineTo(Math.round(x) + 0.5, L.stripBot);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.fillStyle = C.accent;
      ctx.textAlign = "center";
      const zl = W < 520 ? `crash, ${whole(zoom)}× wider` : `20:50–21:40 UTC, drawn ${whole(zoom)}× wider`;
      ctx.fillText(zl, (zx0 + zx1) / 2, L.priceTop - 7);

      // y grid, every 5%. Whole steps, so the noon line is exactly 0 (adding 0.05 repeatedly drifts off it).
      ctx.textAlign = "right";
      for (let k = Math.ceil(yMin * 20 - 1e-9); k <= Math.floor(yMax * 20 + 1e-9); k++) {
        const v = k / 20;
        const y = Math.round(Y(v)) + 0.5;
        ctx.strokeStyle = v === 0 ? C.line2 : C.line;
        ctx.beginPath();
        ctx.moveTo(pad.l, y);
        ctx.lineTo(W - pad.r, y);
        ctx.stroke();
        ctx.fillStyle = C.faint;
        ctx.fillText(v === 0 ? "noon" : signedPct(v, 0), pad.l - 6, y);
      }

      // x labels, greedy so they never overlap; the last one always shows.
      const ticks = [12, 16, 20 + 50 / 60, 21, 21 + 10 / 60, 21 + 20 / 60, 21 + 30 / 60, 21 + 40 / 60, 24, 30, 36].map((hr) => from + (hr - 12) * 3600);
      ctx.fillStyle = C.faint;
      ctx.textAlign = "center";
      /** @type {{ x: number, w: number, s: string }[]} */ const placed = [];
      for (const tk of ticks) {
        const s = hhmm(tk);
        const w = ctx.measureText(s).width;
        const x = Math.min(Math.max(X(tk), pad.l + w / 2), W - pad.r - w / 2);
        const prev = placed.at(-1);
        if (prev && x - w / 2 < prev.x + prev.w / 2 + 6) {
          if (tk !== ticks.at(-1)) continue;
          placed.pop();
        }
        placed.push({ x, w, s });
      }
      for (const q of placed) ctx.fillText(q.s, q.x, H - pad.b / 2 + 2);

      // Liquidation strip: baseline and label.
      ctx.strokeStyle = C.line2;
      ctx.beginPath();
      ctx.moveTo(pad.l, Math.round(L.stripBot) + 0.5);
      ctx.lineTo(W - pad.r, Math.round(L.stripBot) + 0.5);
      ctx.stroke();
      ctx.textAlign = "left";
      ctx.fillStyle = C.faint;
      ctx.fillText("liquidations, one dot each", pad.l + 2, L.stripTop - 4);

      // Prices up to the playhead: step lines, as Aave saw them (a price holds until the next round).
      ctx.lineJoin = "round";
      for (const s of lows) {
        const color = s.key === "eth" ? C.eth : C.btc;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.shadowColor = fade(color, 0.55);
        ctx.shadowBlur = 6;
        ctx.beginPath();
        let lastY = Y(0);
        ctx.moveTo(X(from), lastY);
        for (const [pt, pv] of s.pts) {
          if (pt > t) break;
          const x = X(pt);
          ctx.lineTo(x, lastY);
          lastY = Y(pv / s.base - 1);
          ctx.lineTo(x, lastY);
        }
        ctx.lineTo(X(t), lastY);
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      // Each night's low, once the playhead has passed it.
      ctx.font = `600 10.5px "Geist Mono", ui-monospace, monospace`;
      for (const s of lows) {
        if (t < s.t) continue;
        const color = s.key === "eth" ? C.eth : C.btc;
        const x = X(s.t);
        const y = Y(s.pct);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
        // On a phone the time is dropped so the label clears the axis; the clock shows it.
        const label = W < 480 ? `${s.name} low ${signedPct(s.pct)}` : `${s.name} low ${signedPct(s.pct)}, ${hhmmss(s.t)}`;
        const w = ctx.measureText(label).width;
        const right = x + 8 + w < W - pad.r || x - 8 - w < pad.l;
        ctx.textAlign = right ? "left" : "right";
        ctx.lineWidth = 4;
        ctx.strokeStyle = C.card;
        const ly = s.key === "eth" ? y + 1 : y - 10;
        ctx.strokeText(label, right ? x + 8 : x - 8, ly);
        ctx.fillText(label, right ? x + 8 : x - 8, ly);
      }

      // Dots: settled ones, then the newest falling in and flashing.
      const last = doneBy(t);
      const r = Math.max(0.8, L.pitch * 0.42);
      ctx.fillStyle = C.dot;
      ctx.beginPath();
      for (let i = 0; i <= last; i++) {
        const l = /** @type {any} */ (liqs[i]);
        if (p - l.p < FALL_S) continue;
        ctx.moveTo(l.x + r, l.y);
        ctx.arc(l.x, l.y, r, 0, Math.PI * 2);
      }
      ctx.fill();
      for (let i = last; i >= 0; i--) {
        const l = /** @type {any} */ (liqs[i]);
        const age = p - l.p;
        if (age >= FLASH_S) break;
        const k = Math.min(1, age / FALL_S);
        const y = L.stripTop + (l.y - L.stripTop) * (1 - (1 - k) * (1 - k));
        if (age >= FALL_S) {
          const g = (age - FALL_S) / (FLASH_S - FALL_S);
          ctx.strokeStyle = fade(C.dot, 0.6 * (1 - g));
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(l.x, l.y, r + 1 + g * 7, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.fillStyle = age < FALL_S ? C.ink : C.dot;
        ctx.beginPath();
        ctx.arc(l.x, y, r * (age < FALL_S ? 1.25 : 1), 0, Math.PI * 2);
        ctx.fill();
      }

      // Playhead and the two price heads.
      if (f > 0 && f < 1) {
        const x = Math.round(X(t)) + 0.5;
        ctx.strokeStyle = fade(C.ink, 0.35);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, L.priceTop - 14);
        ctx.lineTo(x, L.stripBot);
        ctx.stroke();
        for (const s of lows) {
          const color = s.key === "eth" ? C.eth : C.btc;
          const y = Y(valueAt(s.pts, s.base, t));
          ctx.fillStyle = fade(color, 0.22);
          ctx.beginPath();
          ctx.arc(x, y, 8, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(x, y, 3.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Readouts.
      setText(clock, dayClock(t));
      setText(out.eth, signedPct(valueAt(eth, eth0, t)));
      setText(out.btc, signedPct(valueAt(btc, btc0, t)));
      setText(out.n, last < 0 ? "0" : whole(/** @type {number} */ (cumUsers[last])));
      setText(out.usdc, last < 0 ? "0" : whole(/** @type {number} */ (cumUsdc[last])));
      chip.hidden = !(playing && t >= SLOW_FROM && t < SLOW_TO);
      scrub.value = String(Math.round(f * 1000));
      scrub.setAttribute("aria-valuetext", dayClock(t));
      syncFill(scrub);
    }
    /** @param {HTMLElement} el @param {string} s */
    const setText = (el, s) => {
      if (el.textContent !== s) el.textContent = s;
    };

    // ─── Playback ──────────────────────────────────────────────────────────
    let f = 0;
    let playing = false;
    let raf = 0;
    let lastNow = 0;
    const setPlaying = (/** @type {boolean} */ on) => {
      playing = on;
      playBtn.classList.toggle("playing", on);
      playBtn.setAttribute("aria-label", on ? "Pause" : f >= 1 ? "Play the night again" : "Play the night");
      cancelAnimationFrame(raf);
      if (on) {
        lastNow = performance.now();
        raf = requestAnimationFrame(tick);
      }
      render(f, playing);
    };
    const tick = (/** @type {number} */ now) => {
      f = Math.min(1, f + (now - lastNow) / 1000 / D);
      lastNow = now;
      if (f >= 1) return setPlaying(false);
      render(f, true);
      raf = requestAnimationFrame(tick);
    };
    playBtn.addEventListener("click", () => {
      if (!playing && f >= 1) f = 0;
      setPlaying(!playing);
    });
    scrub.addEventListener("input", () => {
      f = Number(scrub.value) / 1000;
      if (playing) setPlaying(false);
      else render(f, false);
    });
    let dragging = false;
    const fromPointer = (/** @type {PointerEvent} */ e) => {
      const rect = canvas.getBoundingClientRect();
      f = Math.min(1, Math.max(0, (e.clientX - rect.left - pad.l) / L.plotW));
      render(f, false);
    };
    canvas.addEventListener("pointerdown", (e) => {
      dragging = true;
      canvas.setPointerCapture(e.pointerId);
      if (playing) setPlaying(false);
      fromPointer(e);
    });
    canvas.addEventListener("pointermove", (e) => dragging && fromPointer(e));
    const stop = () => (dragging = false);
    canvas.addEventListener("pointerup", stop);
    canvas.addEventListener("pointercancel", stop);

    layout();
    onWidthChange(() => {
      layout();
      render(f, playing);
    });
    onThemeChange(() => {
      C = colors();
      render(f, playing);
    });
    // Fonts change text widths on the canvas; draw again once they're in.
    document.fonts?.ready.then(() => render(f, playing));

    /**
     * For scripts/clip.ts and scripts/og.ts: measure the canvas again (they restyle the page) and draw
     * progress g (0..1) exactly, with no clock running. @param {number} g
     */
    const w = /** @type {any} */ (window);
    w.__heroRender = (/** @type {number} */ g) => {
      cancelAnimationFrame(raf);
      playing = false;
      layout();
      f = Math.min(1, Math.max(0, g));
      render(f, true);
    };
    w.__heroDuration = D;
    fig.classList.add("ready");

    if (reducedMotion()) {
      f = 1;
      setPlaying(false);
    } else {
      render(0, false);
      whenSeen(fig, () => !playing && f === 0 && setPlaying(true), 0.4);
    }
  }
}
