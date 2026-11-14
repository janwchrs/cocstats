// Wiederverwendbare Bausteine: Karten, Kacheln, Tabellen, Reiter, Symbole.
import { DAY, DFS, fmt, fmtC, h, parseTime, s } from "./core.js";
import { lineChart } from "./charts.js";

export const ROLES = { leader: "Anführer", coLeader: "Vize", admin: "Ältester", member: "Mitglied" };
export const RANGES = [["7 T", 7], ["30 T", 30], ["90 T", 90], ["1 J", 365], ["Alles", 0]];
export const RANK_KINDS = { players: "Spieler", "players-builder-base": "Builder Base", clans: "Clan",
  "clans-builder-base": "Clan Builder Base", capitals: "Hauptstadt" };
export const CATS = { heroes: "Helden", equipment: "Ausrüstung", pets: "Haustiere", troops: "Truppen",
  siege: "Belagerung", spells: "Zauber", builder: "Builder Base" };

// Ressourcen tragen ihre Farbe nur im Symbol; Zahlen bleiben in Textfarbe.
const RES = {
  Elixir: ["Elixier", "#d14fd6"],
  "Dark Elixir": ["Dunkles Elixier", "#6b4f8a"],
  "Builder Elixir": ["Builder-Elixier", "#b84fd6"],
  Gold: ["Gold", "#e3b31f"],
  shiny: ["Glänzendes Erz", "#4f9fe0"],
  glowy: ["Leuchtendes Erz", "#a35be0"],
  starry: ["Sternenerz", "#e9b520"],
};
const ORES = ["shiny", "glowy", "starry"];

export function resIcon(res) {
  const [label, color] = RES[res] || [res, "var(--muted)"];
  const ore = ORES.includes(res);
  return s("svg", { class: "res", viewBox: "0 0 12 12", width: 12, height: 12, role: "img", "aria-label": label },
    s("path", { fill: color, d: ore ? "M6 .5 11 5 6 11.5 1 5Z" : "M6 .5C6 .5 1.5 5.6 1.5 7.8a4.5 4.5 0 0 0 9 0C10.5 5.6 6 .5 6 .5Z" }));
}

/** Kosten: Zahl mit Ressourcen-Symbol; Erz als bis zu drei Teile. */
export function costView(cost, res) {
  if (cost == null) return "–";
  if (Array.isArray(cost)) {
    const parts = cost.map((v, i) => v > 0 && h("span", { class: "cost" }, resIcon(ORES[i]), fmtC(v))).filter(Boolean);
    return parts.length ? h("span", { class: "costs" }, parts) : "–";
  }
  return cost > 0 ? h("span", { class: "cost" }, resIcon(res), fmtC(cost)) : "–";
}

export function thBadge(th, big = false) {
  return h("span", { class: big ? "th big" : "th", title: `Rathaus ${th}`, "aria-label": `Rathaus ${th}` }, th);
}

export function meter(value, total, label) {
  const pct = total ? Math.min(100, (100 * value) / total) : 0;
  return h("div", { class: pct >= 100 ? "meter full" : "meter", role: "meter", "aria-valuenow": Math.round(pct),
    "aria-valuemin": 0, "aria-valuemax": 100, "aria-label": label }, h("i", { style: `width:${pct}%` }));
}

export function card(title, hint, ...body) {
  return h("section", { class: "card" },
    h("div", { class: "card-head" }, h("h2", null, title), hint && h("span", { class: "hint" }, hint)), body);
}

export function emptyNote(text) {
  return h("p", { class: "chart-empty" }, text);
}

/** Reiter als Links, damit jeder Reiter eine eigene Adresse hat (#p/TAG/upgrades). */
export function tabs(base, items, active) {
  return h("nav", { class: "tabs", "aria-label": "Bereiche" }, items.map(([key, label]) =>
    h("a", { href: `#${base}/${key}`, "aria-current": key === active ? "page" : null }, label)));
}

export function seg(options, value, onChange) {
  const el = h("div", { class: "seg", role: "group" });
  const render = () => el.replaceChildren(...options.map(([label, v]) => h("button", { type: "button",
    "aria-pressed": String(v === value), onclick: () => { value = v; render(); onChange(v); } }, label)));
  render();
  return el;
}

export function tile(label, value, delta) {
  return h("div", { class: "tile" }, h("div", { class: "label" }, label), h("div", { class: "value" }, value),
    delta && h("div", { class: "delta" }, delta));
}

/** Veränderung eines Werts gegenüber dem Stand vor `days` Tagen. */
export function deltaText(history, get, days = 7) {
  if (history.length < 2) return null;
  const cutoff = Date.now() - days * DAY;
  let ref = history[0];
  for (const r of history) if (parseTime(r.t) <= cutoff) ref = r;
  const a = get(ref), b = get(history.at(-1));
  if (a == null || b == null) return null;
  const since = parseTime(ref.t) <= cutoff ? `${days} Tage` : `seit ${DFS.format(parseTime(ref.t))}`;
  const diff = b - a;
  if (diff === 0) return h("span", null, `± 0 (${since})`);
  return h("span", null, h("span", { class: diff > 0 ? "up" : "down" }, `${diff > 0 ? "▲ +" : "▼ "}${fmt(diff)}`),
    ` (${since})`);
}

/** Verlaufskarte mit Zeitraum- und Kennzahlauswahl. */
export function historyCard(title, history, metrics) {
  let range = 90, key = metrics[0][0];
  const chartBox = h("div");
  const render = () => {
    const [, label, get, format] = metrics.find((m) => m[0] === key);
    const from = range ? Date.now() - range * DAY : -Infinity;
    const all = history.map((r) => ({ x: parseTime(r.t), y: get(r) })).filter((p) => p.y != null);
    const pts = all.filter((p) => +p.x >= from);
    const before = all.filter((p) => +p.x < from).at(-1);
    if (before) pts.unshift({ x: new Date(from), y: before.y });
    if (pts.length) pts.push({ x: new Date(), y: pts.at(-1).y, now: true });
    chartBox.replaceChildren(pts.length > 2 ? lineChart(pts, { label, format })
      : emptyNote("Der Verlauf füllt sich mit jedem Abruf. Nach ein paar Tagen siehst du hier, wie sich der Wert entwickelt."));
  };
  const select = h("select", { "aria-label": "Kennzahl", onchange: (e) => { key = e.target.value; render(); } },
    metrics.map(([k, label]) => h("option", { value: k }, label)));
  render();
  return h("section", { class: "card" },
    h("div", { class: "card-head" }, h("h2", null, title),
      h("div", { class: "controls" }, select, seg(RANGES, range, (v) => { range = v; render(); }))),
    chartBox);
}

/** Sortierbare Tabelle. cols = [{label, value: r => sortWert, render?: r => Inhalt, num?: bool}] */
export function sortTable(cols, rows, { sortBy = 0, desc = true, rowAttrs, tall = false } = {}) {
  const thead = h("thead");
  const tbody = h("tbody");
  const render = () => {
    const col = cols[sortBy];
    const sorted = [...rows].sort((a, b) => {
      const x = col.value(a), y = col.value(b);
      const c = x == null ? 1 : y == null ? -1 : typeof x === "string" ? x.localeCompare(y, "de") : x - y;
      return desc ? -c : c;
    });
    thead.replaceChildren(h("tr", null, cols.map((c, i) => h("th", { class: c.num ? "num" : null,
      "aria-sort": i === sortBy ? (desc ? "descending" : "ascending") : null },
    h("button", { type: "button", onclick: () => {
      desc = i === sortBy ? !desc : !!c.num;
      sortBy = i;
      render();
    } }, c.label)))));
    tbody.replaceChildren(...sorted.map((r) => h("tr", rowAttrs?.(r),
      cols.map((c) => h("td", { class: c.num ? "num" : null }, c.render ? c.render(r) : c.value(r) ?? "–")))));
  };
  render();
  return h("div", { class: tall ? "table-wrap tall" : "table-wrap" }, h("table", null, thead, tbody));
}

export const stars = (n) => h("span", { class: "stars", "aria-label": `${n} Sterne` }, "★".repeat(n) + "☆".repeat(3 - n));

export function rankTiles(rankings) {
  if (!rankings) return [];
  return Object.entries(RANK_KINDS).flatMap(([kind, label]) =>
    Object.entries(rankings[kind] || {}).map(([loc, rank]) => tile(`Rang ${label} · ${loc}`, `#${fmt(rank)}`)));
}

export function warStatus(w) {
  if (w.result === "win") return h("span", { class: "status win" }, "✓ Sieg");
  if (w.result === "lose") return h("span", { class: "status lose" }, "✕ Niederlage");
  if (w.result === "tie") return h("span", { class: "status tie" }, "= Unentschieden");
  return h("span", { class: "status live" }, w.state === "preparation" ? "◷ Vorbereitung" : "● Läuft");
}
