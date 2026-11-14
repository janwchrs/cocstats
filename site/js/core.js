// Gemeinsame Helfer: Formatierung, DOM-Bau, Daten laden, Tooltip.

export const NF = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });
export const NFC = new Intl.NumberFormat("de-DE", { notation: "compact", maximumFractionDigits: 1 });
export const DF = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
export const DFS = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit" });
export const DTF = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });
export const TF = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });
export const DAY = 864e5;

export const fmt = (v) => (v == null ? "–" : NF.format(v));
export const fmtC = (v) => (v == null ? "–" : Math.abs(v) >= 10000 ? NFC.format(v) : NF.format(v));
export const fmtPct = (v) => (v == null ? "–" : `${NF.format(v)} %`);
export const slug = (tag) => tag.replace("#", "");

export const state = { index: { players: [], clans: [], names: {} } };
export const main = document.getElementById("main");
const tipEl = document.getElementById("tip");

/** Deutscher Name für Einheiten, Erfolge und Ligen, die die API nur auf Englisch liefert. */
export const t = (name) => (name && state.index.names?.[name]) || name;

/** Dauer in Sekunden, z. B. "4,5 Tage" oder "6 Std.". */
export function fmtDur(sec) {
  if (!sec) return "–";
  const days = sec / 86400;
  if (days >= 10) return `${NF.format(Math.round(days))} Tage`;
  if (days >= 1) {
    const d = Math.round(days * 10) / 10;
    return `${NF.format(d)} ${d === 1 ? "Tag" : "Tage"}`;
  }
  return `${Math.max(1, Math.round(sec / 3600))} Std.`;
}

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  setAttrs(el, attrs);
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}

export function s(tag, attrs, ...kids) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  setAttrs(el, attrs);
  for (const k of kids.flat()) if (k != null) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}

export function setAttrs(el, attrs) {
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.setAttribute("class", v);
    else el.setAttribute(k, v === true ? "" : v);
  }
}

export function parseTime(v) {
  if (!v) return null;
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/.exec(v);
  return m ? new Date(Date.UTC(m[1], m[2] - 1, m[3], m[4], m[5], m[6])) : new Date(v);
}

export const cache = new Map();
export function load(path) {
  if (!cache.has(path)) {
    cache.set(path, fetch(path, { cache: "no-cache" }).then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${path}`);
      return r.json();
    }));
  }
  return cache.get(path);
}

export function showTip(x, y, value, label) {
  tipEl.replaceChildren(h("strong", null, value), h("span", null, label));
  tipEl.hidden = false;
  const r = tipEl.getBoundingClientRect();
  const left = Math.min(Math.max(8, x + 14), innerWidth - r.width - 8);
  const top = y - r.height - 12 < 8 ? y + 16 : y - r.height - 12;
  tipEl.style.left = `${left}px`;
  tipEl.style.top = `${top}px`;
}
export const hideTip = () => (tipEl.hidden = true);

export function niceTicks(min, max, count = 4) {
  if (min === max) {
    const pad = Math.max(1, Math.abs(min) * 0.05);
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((v) => v >= raw);
  const ticks = [];
  for (let v = Math.floor(min / step) * step; v <= Math.ceil(max / step) * step + step / 2; v += step) {
    ticks.push(+v.toFixed(10));
  }
  return ticks;
}

export function onResize(el, draw) {
  let last = 0;
  new ResizeObserver(([entry]) => {
    const w = Math.round(entry.contentRect.width);
    if (w && w !== last) {
      last = w;
      draw(w);
    }
  }).observe(el);
}
