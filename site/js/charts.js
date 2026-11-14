// Diagramme als SVG: Stufenlinie, Säulen und Fortschrittsring.
import { DAY, DF, DFS, DTF, TF, fmt, fmtC, h, hideTip, niceTicks, onResize, s, setAttrs, showTip } from "./core.js";

/** Stufenlinie: ein Wert gilt, bis er sich ändert. pts = [{x: Date, y: number}] */
export function lineChart(pts, { format = fmt, label = "", height = 220 } = {}) {
  const wrap = h("div", { class: "chart" });
  if (pts.length === 0) {
    wrap.append(h("p", { class: "chart-empty" }, "Noch keine Daten in diesem Zeitraum."));
    return wrap;
  }
  onResize(wrap, (W) => {
    const H = height;
    const m = { l: 48, r: 64, t: 12, b: 26 };
    const xs = pts.map((p) => +p.x);
    const x0 = xs[0];
    const x1 = Math.max(xs.at(-1), x0 + 3600e3);
    const ys = pts.map((p) => p.y);
    const ticks = niceTicks(Math.min(...ys), Math.max(...ys));
    const y0 = ticks[0], y1 = ticks.at(-1);
    const X = (v) => m.l + ((v - x0) / (x1 - x0)) * (W - m.l - m.r);
    const Y = (v) => m.t + (1 - (v - y0) / (y1 - y0)) * (H - m.t - m.b);

    const svg = s("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": label });
    for (const t of ticks) {
      svg.append(s("line", { class: t === y0 ? "base" : "grid", x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t) }));
      svg.append(s("text", { class: "tick", x: m.l - 8, y: Y(t) + 4, "text-anchor": "end" }, fmtC(t)));
    }
    const span = x1 - x0;
    const xFmt = span < 2 * DAY ? TF : span > 300 * DAY ? DF : DFS;
    const n = Math.max(2, Math.min(6, Math.floor((W - m.l - m.r) / 90)));
    for (let i = 0; i <= n; i++) {
      const t = x0 + (i * span) / n;
      const anchor = i === 0 ? "start" : i === n ? "end" : "middle";
      svg.append(s("text", { class: "tick", x: X(t), y: H - 6, "text-anchor": anchor }, xFmt.format(t)));
    }

    let d = `M${X(xs[0])},${Y(ys[0])}`;
    for (let i = 1; i < pts.length; i++) d += `H${X(xs[i])}V${Y(ys[i])}`;
    svg.append(s("path", { class: "line", d }));

    const last = pts.at(-1);
    svg.append(s("circle", { class: "dot", cx: X(+last.x), cy: Y(last.y), r: 4 }));
    svg.append(s("text", { class: "end-label", x: X(+last.x) + 10, y: Y(last.y) + 4 }, format(last.y)));

    const cross = s("line", { class: "cross", y1: m.t, y2: H - m.b, visibility: "hidden" });
    const hover = s("circle", { class: "dot", r: 5, visibility: "hidden" });
    const overlay = s("rect", { class: "overlay", x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b,
      tabindex: 0, "aria-label": `${label}: mit Pfeiltasten durch die Werte gehen` });
    svg.append(cross, hover, overlay);

    let current = pts.length - 1;
    const show = (i, cx, cy) => {
      current = i;
      const p = pts[i];
      for (const [el, a] of [[cross, { x1: X(+p.x), x2: X(+p.x) }], [hover, { cx: X(+p.x), cy: Y(p.y) }]]) {
        setAttrs(el, { ...a, visibility: "visible" });
      }
      if (cx == null) {
        const r = overlay.getBoundingClientRect();
        cx = r.left + X(+p.x) - m.l;
        cy = r.top + Y(p.y) - m.t;
      }
      showTip(cx, cy, format(p.y), p.now ? "aktuell" : DTF.format(p.x));
    };
    const hide = () => {
      cross.setAttribute("visibility", "hidden");
      hover.setAttribute("visibility", "hidden");
      hideTip();
    };
    overlay.addEventListener("pointermove", (e) => {
      const r = overlay.getBoundingClientRect();
      const v = x0 + ((e.clientX - r.left) / r.width) * (x1 - x0);
      let best = 0;
      for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - v) < Math.abs(xs[best] - v)) best = i;
      show(best, e.clientX, e.clientY);
    });
    overlay.addEventListener("pointerleave", hide);
    overlay.addEventListener("blur", hide);
    overlay.addEventListener("focus", () => show(current));
    overlay.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      show(Math.max(0, Math.min(pts.length - 1, current + (e.key === "ArrowRight" ? 1 : -1))));
    });
    wrap.replaceChildren(svg);
  });
  return wrap;
}

/** Säulen mit gemeinsamer Nulllinie. items = [{label, value}] */
export function columnChart(items, { format = fmt, label = "", height = 200 } = {}) {
  const wrap = h("div", { class: "chart" });
  if (items.length === 0) {
    wrap.append(h("p", { class: "chart-empty" }, "Noch keine Daten."));
    return wrap;
  }
  onResize(wrap, (W) => {
    const H = height;
    const m = { l: 48, r: 8, t: 20, b: 26 };
    const ticks = niceTicks(0, Math.max(...items.map((i) => i.value || 0)));
    const y1 = ticks.at(-1);
    const Y = (v) => m.t + (1 - v / y1) * (H - m.t - m.b);
    const band = (W - m.l - m.r) / items.length;
    const bw = Math.min(24, band * 0.6);
    const base = Y(0);

    const svg = s("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": label });
    for (const t of ticks) {
      svg.append(s("line", { class: t === 0 ? "base" : "grid", x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t) }));
      svg.append(s("text", { class: "tick", x: m.l - 8, y: Y(t) + 4, "text-anchor": "end" }, fmtC(t)));
    }
    const every = Math.ceil(items.length / Math.max(1, Math.floor((W - m.l - m.r) / 56)));
    items.forEach((it, i) => {
      const cx = m.l + band * (i + 0.5);
      const x = cx - bw / 2;
      const top = Y(it.value || 0);
      const r = Math.min(4, bw / 2, base - top);
      const hit = s("rect", { class: "hit", x: m.l + band * i, y: m.t, width: band, height: H - m.t - m.b,
        tabindex: 0, "aria-label": `${it.label}: ${format(it.value)}` });
      const tip = (e) => {
        const b = hit.getBoundingClientRect();
        showTip(e?.clientX ?? b.left + b.width / 2, e?.clientY ?? b.top + (top - m.t), format(it.value), it.label);
      };
      hit.addEventListener("pointermove", tip);
      hit.addEventListener("focus", () => tip());
      hit.addEventListener("pointerleave", hideTip);
      hit.addEventListener("blur", hideTip);
      svg.append(hit, s("path", { class: "bar",
        d: `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + bw - r}Q${x + bw},${top} ${x + bw},${top + r}V${base}Z` }));
      if ((items.length - 1 - i) % every === 0) {
        svg.append(s("text", { class: "tick", x: cx, y: H - 6, "text-anchor": "middle" }, it.short ?? it.label));
      }
    });
    const last = items.at(-1);
    svg.append(s("text", { class: "end-label", x: m.l + band * (items.length - 0.5), y: Y(last.value || 0) - 6,
      "text-anchor": "middle" }, format(last.value)));
    wrap.replaceChildren(svg);
  });
  return wrap;
}

/** Fortschrittsring für einen einzelnen Prozentwert. */
export function ring(pct, { size = 104, label = "" } = {}) {
  const c = size / 2, r = c - 7, len = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, pct ?? 0));
  return h("div", { class: "ring", style: `width:${size}px;height:${size}px`, role: "meter", "aria-valuenow": Math.round(v),
    "aria-valuemin": 0, "aria-valuemax": 100, "aria-label": label || "Fortschritt" },
  s("svg", { viewBox: `0 0 ${size} ${size}`, width: size, height: size },
    s("circle", { class: "ring-track", cx: c, cy: c, r }),
    v > 0 && s("circle", { class: v >= 100 ? "ring-fill full" : "ring-fill", cx: c, cy: c, r,
      "stroke-dasharray": `${(len * v) / 100} ${len}`, transform: `rotate(-90 ${c} ${c})` })),
  h("div", { class: "ring-label" }, h("strong", null, pct == null ? "–" : `${fmt(Math.floor(v))} %`), label && h("span", null, label)));
}
