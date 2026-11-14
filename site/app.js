// CoC Stats Dashboard: liest die vorbereiteten Dateien aus data/ und rendert Spieler- und Clan-Ansichten.

const NF = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });
const NFC = new Intl.NumberFormat("de-DE", { notation: "compact", maximumFractionDigits: 1 });
const DF = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
const DFS = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit" });
const DTF = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });
const TF = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });
const DAY = 864e5;

const fmt = (v) => (v == null ? "–" : NF.format(v));
const fmtC = (v) => (v == null ? "–" : Math.abs(v) >= 10000 ? NFC.format(v) : NF.format(v));
const fmtPct = (v) => (v == null ? "–" : `${NF.format(v)} %`);
const slug = (tag) => tag.replace("#", "");

const ROLES = { leader: "Anführer", coLeader: "Vize", admin: "Ältester", member: "Mitglied" };
const CATEGORIES = { troops: "Truppen", pets: "Haustiere", spells: "Zauber", heroes: "Helden",
  equipment: "Ausrüstung", builder: "Builder Base" };
const RANGES = [["7 T", 7], ["30 T", 30], ["90 T", 90], ["1 J", 365], ["Alles", 0]];
const RANK_KINDS = { players: "Spieler", "players-builder-base": "Builder Base", clans: "Clan",
  "clans-builder-base": "Clan Builder Base", capitals: "Hauptstadt" };
// Erfolge, die als fortlaufende Zähler etwas über die Aktivität aussagen.
const ACTIVITY = {
  "Gold Grab": "Gold geplündert", "Elixir Escapade": "Elixier geplündert", "Heroic Heist": "Dunkles Elixier geplündert",
  "Conqueror": "Angriffe gewonnen", "Unbreakable": "Verteidigungen gewonnen", "Friend in Need": "Truppen gespendet",
  "Sharing is caring": "Zauber gespendet", "Siege Sharer": "Belagerungsmaschinen gespendet",
  "Games Champion": "Clanspiele-Punkte", "Well Seasoned": "Saison-Herausforderungen", "War Hero": "Kriegssterne",
  "War League Legend": "CWL-Sterne", "Wall Buster": "Mauern zerstört", "Humiliator": "Rathäuser zerstört",
  "Union Buster": "Bauhütten zerstört", "Aggressive Capitalism": "Hauptstadtgold geplündert",
  "Most Valuable Clanmate": "Hauptstadtgold beigetragen", "Superb Work": "Supertruppen aktiviert",
  "Un-Build It": "Builder Base: Bauhütten zerstört", "Champion Builder": "Builder Base: Trophäen-Rekord",
};

const main = document.getElementById("main");
const tipEl = document.getElementById("tip");
let index = null;

// ---------- Helfer ----------

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  setAttrs(el, attrs);
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}

function s(tag, attrs, ...kids) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  setAttrs(el, attrs);
  for (const k of kids.flat()) if (k != null) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}

function setAttrs(el, attrs) {
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.setAttribute("class", v);
    else el.setAttribute(k, v === true ? "" : v);
  }
}

function parseTime(v) {
  if (!v) return null;
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/.exec(v);
  return m ? new Date(Date.UTC(m[1], m[2] - 1, m[3], m[4], m[5], m[6])) : new Date(v);
}

const cache = new Map();
function load(path) {
  if (!cache.has(path)) {
    cache.set(path, fetch(path, { cache: "no-cache" }).then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${path}`);
      return r.json();
    }));
  }
  return cache.get(path);
}

function showTip(x, y, value, label) {
  tipEl.replaceChildren(h("strong", null, value), h("span", null, label));
  tipEl.hidden = false;
  const r = tipEl.getBoundingClientRect();
  const left = Math.min(Math.max(8, x + 14), innerWidth - r.width - 8);
  const top = y - r.height - 12 < 8 ? y + 16 : y - r.height - 12;
  tipEl.style.left = `${left}px`;
  tipEl.style.top = `${top}px`;
}
const hideTip = () => (tipEl.hidden = true);

function niceTicks(min, max, count = 4) {
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

function onResize(el, draw) {
  let last = 0;
  new ResizeObserver(([entry]) => {
    const w = Math.round(entry.contentRect.width);
    if (w && w !== last) {
      last = w;
      draw(w);
    }
  }).observe(el);
}

// ---------- Diagramme ----------

/** Stufenlinie: ein Wert gilt, bis er sich ändert. pts = [{x: Date, y: number}] */
function lineChart(pts, { format = fmt, label = "", height = 220 } = {}) {
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
function columnChart(items, { format = fmt, label = "", height = 200 } = {}) {
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

// ---------- Bausteine ----------

function seg(options, value, onChange) {
  const el = h("div", { class: "seg", role: "group" });
  const render = () => el.replaceChildren(...options.map(([label, v]) => h("button", { type: "button",
    "aria-pressed": String(v === value), onclick: () => { value = v; render(); onChange(v); } }, label)));
  render();
  return el;
}

function tile(label, value, delta) {
  return h("div", { class: "tile" }, h("div", { class: "label" }, label), h("div", { class: "value" }, value),
    delta && h("div", { class: "delta" }, delta));
}

/** Veränderung eines Werts gegenüber dem Stand vor `days` Tagen. */
function deltaText(history, get, days = 7) {
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
function historyCard(title, history, metrics) {
  let range = 90, key = metrics[0][0];
  const chartBox = h("div");
  const render = () => {
    const [, label, get, format] = metrics.find((m) => m[0] === key);
    const from = range ? Date.now() - range * DAY : -Infinity;
    const all = history.map((r) => ({ x: parseTime(r.t), y: get(r) })).filter((p) => p.y != null);
    let pts = all.filter((p) => +p.x >= from);
    const before = all.filter((p) => +p.x < from).at(-1);
    if (before) pts.unshift({ x: new Date(from), y: before.y });
    if (pts.length) pts.push({ x: new Date(), y: pts.at(-1).y, now: true });
    chartBox.replaceChildren(lineChart(pts, { label, format }));
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
function sortTable(cols, rows, { sortBy = 0, desc = true, rowAttrs, tall = false } = {}) {
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

const stars = (n) => h("span", { class: "stars", "aria-label": `${n} Sterne` }, "★".repeat(n) + "☆".repeat(3 - n));

function rankTiles(rankings) {
  if (!rankings) return [];
  return Object.entries(RANK_KINDS).flatMap(([kind, label]) =>
    Object.entries(rankings[kind] || {}).map(([loc, rank]) => tile(`Rang ${label} · ${loc}`, `#${fmt(rank)}`)));
}

function warStatus(w) {
  if (w.result === "win") return h("span", { class: "status win" }, "✓ Sieg");
  if (w.result === "lose") return h("span", { class: "status lose" }, "✕ Niederlage");
  if (w.result === "tie") return h("span", { class: "status tie" }, "= Unentschieden");
  return h("span", { class: "status live" }, w.state === "preparation" ? "◷ Vorbereitung" : "● Läuft");
}

// ---------- Spieler ----------

async function renderPlayer(tag) {
  const data = await load(`data/p/${slug(tag)}.json`);
  const { player: p, units, history } = data;
  const league = p.leagueTier || p.league;
  const ownClan = p.clan && index.clans.some((c) => c.tag === p.clan.tag);

  const hero = h("section", { class: "card hero" },
    league?.iconUrls?.medium && h("img", { src: league.iconUrls.medium, alt: "" }),
    h("div", null,
      h("h2", null, p.name),
      h("div", { class: "sub" },
        h("span", { class: "mono" }, p.tag),
        h("span", null, `Rathaus ${p.townHallLevel}${p.townHallWeaponLevel ? ` (Waffe ${p.townHallWeaponLevel})` : ""}`),
        h("span", null, `Level ${p.expLevel}`),
        league && h("span", null, league.name),
        p.clan && (ownClan ? h("a", { href: `#c/${slug(p.clan.tag)}` }, p.clan.name) : h("span", null, p.clan.name)),
        p.role && h("span", null, ROLES[p.role] || p.role),
        p.builderBaseLeague && h("span", null, `Builder: ${p.builderBaseLeague.name}`),
        p.warPreference && h("span", null, p.warPreference === "in" ? "Krieg: dabei" : "Krieg: nicht dabei"))));

  const d = (get) => deltaText(history, get);
  const tiles = h("section", { class: "tiles" },
    tile("Trophäen", fmt(p.trophies), d((r) => r.trophies)),
    tile("Rekord", fmt(p.bestTrophies)),
    tile("Kriegssterne", fmt(p.warStars), d((r) => r.warStars)),
    tile("Angriffssiege (Saison)", fmt(p.attackWins)),
    tile("Spenden (Saison)", fmt(p.donations), h("span", null, `${fmt(p.donationsReceived)} erhalten`)),
    tile("Builder-Trophäen", fmt(p.builderBaseTrophies), d((r) => r.bbTrophies)),
    tile("Hauptstadt-Beitrag", fmtC(p.clanCapitalContributions), d((r) => r.capital)),
    legendTiles(p.legendStatistics),
    rankTiles(data.rankings));

  const history_ = historyCard("Verlauf", history, [
    ["trophies", "Trophäen", (r) => r.trophies],
    ["warStars", "Kriegssterne", (r) => r.warStars],
    ["donations", "Spenden (Saison)", (r) => r.donations],
    ["attackWins", "Angriffssiege (Saison)", (r) => r.attackWins],
    ["bbTrophies", "Builder-Trophäen", (r) => r.bbTrophies],
    ["capital", "Hauptstadt-Beitrag", (r) => r.capital],
    ["xp", "Erfahrungslevel", (r) => r.xp],
    ...Object.entries(CATEGORIES).map(([k, label]) => [`progress.${k}`, `Fortschritt ${label}`,
      (r) => r.progress?.[k], fmtPct]),
  ]);

  const progress = h("section", { class: "card" },
    h("div", { class: "card-head" }, h("h2", null, "Fortschritt"),
      h("span", { class: "hint" }, "Level im Verhältnis zum Maximum im Spiel")),
    h("div", { class: "meters" }, Object.entries(CATEGORIES).filter(([k]) => units[k]?.length).map(([k, label]) => {
      const list = units[k];
      const sum = list.reduce((a, u) => a + u[1], 0), max = list.reduce((a, u) => a + u[2], 0);
      const pct = (100 * sum) / max;
      const maxed = list.filter((u) => u[1] >= u[2]).length;
      return h("div", null,
        h("div", { class: "meter-row" }, h("span", null, label),
          h("div", { class: "meter", role: "meter", "aria-valuenow": pct.toFixed(1), "aria-valuemin": 0,
            "aria-valuemax": 100, "aria-label": label }, h("i", { style: `width:${pct}%` })),
          h("span", { class: "num" }, fmtPct(Math.round(pct * 10) / 10))),
        h("details", { class: "units" },
          h("summary", null, `${list.length} Einheiten, ${maxed} auf Maximum`),
          h("div", { class: "unit-grid" }, [...list].sort((a, b) => a[1] / a[2] - b[1] / b[2]).map(([name, lvl, mx]) =>
            h("div", { class: "unit" },
              h("div", { class: "row" }, h("span", null, name),
                h("span", { class: lvl >= mx ? "maxed" : null }, lvl >= mx ? `✓ ${lvl}` : `${lvl} / ${mx}`)),
              h("div", { class: "meter" }, h("i", { style: `width:${(100 * lvl) / mx}%` })))))));
    })));

  const achievements = h("section", { class: "card" },
    h("div", { class: "card-head" }, h("h2", null, "Erfolge"),
      h("span", { class: "hint" }, `${p.achievements.filter((a) => a.stars === 3).length} von ${p.achievements.length} abgeschlossen`)),
    sortTable([
      { label: "Erfolg", value: (a) => a.name },
      { label: "Sterne", value: (a) => a.stars, num: true, render: (a) => stars(a.stars) },
      { label: "Wert", value: (a) => a.value, num: true, render: (a) => fmt(a.value) },
      { label: "Ziel", value: (a) => a.target, num: true, render: (a) => fmt(a.target) },
      { label: "Dorf", value: (a) => (a.village === "home" ? "Heimat" : a.village === "builderBase" ? "Builder" : "Hauptstadt") },
    ], p.achievements, { sortBy: 1, desc: false }));

  main.replaceChildren(hero, tiles, history_, activityCard(data.activity),
    h("div", { class: "grid-2" }, progress, upgradesCard(data.upgrades)), achievements);
}

function legendTiles(ls) {
  if (!ls) return [];
  const season = (s) => s && `${fmt(s.trophies)} Trophäen${s.rank ? ` · Platz ${fmt(s.rank)}` : ""}`;
  return [
    ls.legendTrophies != null && tile("Legenden-Trophäen", fmt(ls.legendTrophies)),
    ls.currentSeason && tile("Legenden: aktuelle Saison", fmt(ls.currentSeason.trophies), ls.currentSeason.rank && `Platz ${fmt(ls.currentSeason.rank)}`),
    ls.previousSeason && tile(`Legenden: Saison ${ls.previousSeason.id}`, fmt(ls.previousSeason.trophies), season(ls.previousSeason)),
    ls.bestSeason && tile(`Legenden: beste Saison (${ls.bestSeason.id})`, fmt(ls.bestSeason.trophies), ls.bestSeason.rank && `Platz ${fmt(ls.bestSeason.rank)}`),
  ];
}

/** Tageszuwachs der Erfolgszähler (Beute, Spenden, Clanspiele …). */
function activityCard(act) {
  const head = (extra) => h("div", { class: "card-head" }, h("h2", null, "Aktivität pro Tag"), extra);
  if (!act || act.days.length < 2) {
    return h("section", { class: "card" }, head(),
      h("p", { class: "chart-empty" }, "Ab dem zweiten Tag der Aufzeichnung siehst du hier, wie viel du pro Tag geplündert, gespendet und erreicht hast."));
  }
  const names = Object.keys(act.values);
  const known = Object.keys(ACTIVITY).filter((n) => names.includes(n));
  const rest = names.filter((n) => !ACTIVITY[n]).sort((a, b) => a.localeCompare(b));
  let key = known[0] || names[0], range = 30;
  const hint = h("span", { class: "hint" });
  const box = h("div");
  const render = () => {
    const vals = act.values[key];
    const from = range ? Date.now() - range * DAY : -Infinity;
    const items = [];
    for (let i = 1; i < act.days.length; i++) {
      const day = new Date(`${act.days[i]}T00:00:00Z`);
      if (+day < from || vals[i] == null || vals[i - 1] == null) continue;
      items.push({ label: DF.format(day), short: DFS.format(day), value: Math.max(0, vals[i] - vals[i - 1]) });
    }
    const sum = items.reduce((a, i) => a + i.value, 0);
    hint.textContent = items.length ? `Summe ${fmt(sum)} · Ø ${fmt(Math.round(sum / items.length))} pro Tag` : "";
    box.replaceChildren(columnChart(items, { label: ACTIVITY[key] || key }));
  };
  const select = h("select", { "aria-label": "Zähler", onchange: (e) => { key = e.target.value; render(); } },
    h("optgroup", { label: "Aktivität" }, known.map((n) => h("option", { value: n }, ACTIVITY[n]))),
    rest.length && h("optgroup", { label: "Weitere Erfolge" }, rest.map((n) => h("option", { value: n }, n))));
  render();
  return h("section", { class: "card" },
    head([hint, h("div", { class: "controls" }, select, seg(RANGES.slice(0, 4), range, (v) => { range = v; render(); }))]),
    box);
}

function upgradesCard(list) {
  const unitName = (u) => (u.startsWith("BB ") ? `${u.slice(3)} (Builder)` : u);
  return h("section", { class: "card" },
    h("div", { class: "card-head" }, h("h2", null, "Upgrades"),
      h("span", { class: "hint" }, list.length ? `${list.length} seit Beginn der Aufzeichnung` : "")),
    list.length ? sortTable([
      { label: "Datum", value: (u) => u.t, render: (u) => DF.format(parseTime(u.t)) },
      { label: "Einheit", value: (u) => unitName(u.unit) },
      { label: "Level", value: (u) => u.to, num: true, render: (u) => (u.from == null ? `neu · ${u.to}` : `${u.from} → ${u.to}`) },
    ], list, { tall: true }) : h("p", { class: "chart-empty" }, "Noch keine Upgrades seit Beginn der Aufzeichnung."));
}

// ---------- Clan ----------

function memberWarStats(wars, count = 10) {
  const stats = new Map();
  for (const w of wars.filter((w) => w.state === "warEnded").slice(0, count)) {
    for (const m of w.members) {
      const st = stats.get(m.tag) || { used: 0, possible: 0, stars: 0, destruction: 0 };
      st.possible += w.attacksPerMember;
      st.used += m.attacks.length;
      for (const a of m.attacks) {
        st.stars += a.s;
        st.destruction += a.d;
      }
      stats.set(m.tag, st);
    }
  }
  return stats;
}

async function renderClan(tag) {
  const { clan: c, history, wars, warlog, raids, moves, rankings } = await load(`data/c/${slug(tag)}.json`);
  const mine = new Set(index.players.map((p) => p.tag));

  const hero = h("section", { class: "card hero" },
    c.badgeUrls?.medium && h("img", { src: c.badgeUrls.medium, alt: "" }),
    h("div", null,
      h("h2", null, c.name),
      h("div", { class: "sub" },
        h("span", { class: "mono" }, c.tag),
        h("span", null, `Level ${c.clanLevel}`),
        c.location && h("span", null, c.location.name),
        c.warLeague && h("span", null, c.warLeague.name),
        c.capitalLeague && h("span", null, c.capitalLeague.name),
        c.warFrequency && h("span", null, `Krieg: ${c.warFrequency}`)),
      c.description && h("p", { class: "desc" }, c.description)));

  const d = (get) => deltaText(history, get);
  const tiles = h("section", { class: "tiles" },
    tile("Mitglieder", `${c.members} / 50`),
    tile("Clanpunkte", fmt(c.clanPoints), d((r) => r.points)),
    tile("Kriegsbilanz", `${fmt(c.warWins)} S · ${fmt(c.warLosses ?? 0)} N`, c.warTies != null && `${fmt(c.warTies)} unentschieden`),
    tile("Siegesserie", fmt(c.warWinStreak)),
    tile("Hauptstadt-Punkte", fmt(c.clanCapitalPoints), d((r) => r.capitalPoints)),
    c.clanCapital?.capitalHallLevel && tile("Hauptstadt-Halle", `Level ${c.clanCapital.capitalHallLevel}`),
    c.requiredTrophies != null && tile("Mindest-Trophäen", fmt(c.requiredTrophies)),
    rankTiles(rankings));

  // Mitglieder mit Kriegs- und Raid-Werten
  const warStats = memberWarStats(wars);
  const lastRaid = raids[0];
  const raidLoot = new Map((lastRaid?.members || []).map((m) => [m.tag, m]));
  const ratio = (m) => (m.donationsReceived ? m.donations / m.donationsReceived : m.donations ? Infinity : null);
  const members = h("section", { class: "card" },
    h("div", { class: "card-head" }, h("h2", null, "Mitglieder"),
      h("span", { class: "hint" }, "Krieg: letzte 10 beendete Kriege inkl. CWL · Raid: letztes Wochenende")),
    sortTable([
      { label: "Name", value: (m) => m.name, render: (m) => [m.name, mine.has(m.tag) && " ", mine.has(m.tag) && h("span", { class: "pill" }, "Du")] },
      { label: "Rolle", value: (m) => ROLES[m.role] || m.role },
      { label: "RH", value: (m) => m.townHallLevel, num: true },
      { label: "Trophäen", value: (m) => m.trophies, num: true, render: (m) => fmt(m.trophies) },
      { label: "Spenden", value: (m) => m.donations, num: true, render: (m) => fmt(m.donations) },
      { label: "Erhalten", value: (m) => m.donationsReceived, num: true, render: (m) => fmt(m.donationsReceived) },
      { label: "Verhältnis", value: ratio, num: true, render: (m) => { const r = ratio(m); return r == null ? "–" : r === Infinity ? "∞" : NF.format(r); } },
      { label: "Angriffe", value: (m) => warStats.get(m.tag)?.used, num: true,
        render: (m) => { const st = warStats.get(m.tag); return st ? `${st.used} / ${st.possible}` : "–"; } },
      { label: "Ø Sterne", value: (m) => { const st = warStats.get(m.tag); return st?.used ? st.stars / st.used : null; }, num: true,
        render: (m) => { const st = warStats.get(m.tag); return st?.used ? NF.format(st.stars / st.used) : "–"; } },
      { label: "Raid-Beute", value: (m) => raidLoot.get(m.tag)?.loot, num: true,
        render: (m) => { const r = raidLoot.get(m.tag); return r ? `${fmt(r.loot)} (${r.attacks}/${r.limit})` : "–"; } },
    ], c.memberList, { sortBy: 3, rowAttrs: (m) => ({ class: mine.has(m.tag) ? "mine" : null }) }));

  // Kriege
  const warList = h("div", { class: "wars" }, wars.slice(0, 20).map((w) => {
    const start = parseTime(w.start);
    return h("details", { class: "war" },
      h("summary", null,
        h("span", { class: "date" }, DF.format(start)),
        h("span", { class: "opp" }, w.them.badge && h("img", { src: w.them.badge, alt: "" }),
          h("b", null, w.them.name), w.type === "cwl" && h("span", { class: "pill" }, "CWL"),
          h("span", { class: "date" }, `${w.teamSize} vs ${w.teamSize}`)),
        h("span", { class: "score" }, `★ ${w.us.stars} : ${w.them.stars}`,
          h("small", null, `${NF.format(w.us.destruction)} % : ${NF.format(w.them.destruction)} %`)),
        warStatus(w)),
      h("div", { class: "body" }, sortTable([
        { label: "#", value: (m) => m.pos, num: true },
        { label: "Name", value: (m) => m.name, render: (m) => [m.name, mine.has(m.tag) && " ", mine.has(m.tag) && h("span", { class: "pill" }, "Du")] },
        { label: "RH", value: (m) => m.th, num: true },
        ...Array.from({ length: w.attacksPerMember }, (_, i) => ({
          label: `Angriff ${i + 1}`, value: (m) => m.attacks[i] ? m.attacks[i].s * 1000 + m.attacks[i].d : -1,
          render: (m) => { const a = m.attacks[i]; return a ? [stars(a.s), ` ${a.d} % `, h("span", { class: "date" }, `→ #${a.pos} RH${a.th}`)] : h("span", { class: "down" }, "✕ fehlt"); },
        })),
        { label: "Sterne", value: (m) => m.attacks.reduce((a, x) => a + x.s, 0), num: true },
      ], w.members, { sortBy: 0, desc: false, rowAttrs: (m) => ({ class: mine.has(m.tag) ? "mine" : null }) })));
  }));
  const warsCard = h("section", { class: "card" },
    h("div", { class: "card-head" }, h("h2", null, "Kriege"),
      h("span", { class: "hint" }, wars.length ? "Antippen für alle Angriffe" : c.isWarLogPublic ? "" : "Kriegslog ist privat")),
    wars.length ? warList : h("p", { class: "chart-empty" }, "Noch keine Kriege erfasst."));

  const logged = warlog.filter((w) => w.result);
  const wins = logged.filter((w) => w.result === "win").length;
  const warlogCard = warlog.length > 0 && h("section", { class: "card" },
    h("div", { class: "card-head" }, h("h2", null, "Kriegslog"),
      h("span", { class: "hint" }, `${logged.length} Kriege · Siegquote ${fmtPct(Math.round((1000 * wins) / (logged.length || 1)) / 10)}`)),
    sortTable([
      { label: "Ende", value: (w) => w.end, render: (w) => DF.format(parseTime(w.end)) },
      { label: "Gegner", value: (w) => w.opponent ?? "CWL" },
      { label: "Größe", value: (w) => w.teamSize, num: true },
      { label: "Sterne", value: (w) => w.stars[0], num: true, render: (w) => `${w.stars[0]} : ${w.stars[1]}` },
      { label: "Zerstörung", value: (w) => w.destruction[0], num: true, render: (w) => `${NF.format(w.destruction[0])} % : ${NF.format(w.destruction[1])} %` },
      { label: "Ergebnis", value: (w) => w.result ?? "", render: (w) => (w.result ? warStatus(w) : "–") },
    ], warlog, { tall: true }));

  // Clanhauptstadt
  const raidsCard = raids.length > 0 && h("section", { class: "card" },
    h("div", { class: "card-head" }, h("h2", null, "Raid-Wochenenden"), h("span", { class: "hint" }, "Erbeutetes Hauptstadtgold")),
    columnChart([...raids].reverse().map((r) => ({ label: `${DF.format(parseTime(r.start))}${r.state === "ongoing" ? " (läuft)" : ""}`,
      short: DFS.format(parseTime(r.start)), value: r.loot })), { label: "Hauptstadtgold pro Wochenende" }),
    h("h3", { style: "margin:16px 0 8px" }, `Wochenende ab ${DF.format(parseTime(lastRaid.start))}`,
      lastRaid.state === "ongoing" ? " (läuft)" : ""),
    sortTable([
      { label: "Name", value: (m) => m.name },
      { label: "Angriffe", value: (m) => m.attacks, num: true, render: (m) => `${m.attacks} / ${m.limit}` },
      { label: "Beute", value: (m) => m.loot, num: true, render: (m) => fmt(m.loot) },
    ], lastRaid.members, { sortBy: 2, rowAttrs: (m) => ({ class: mine.has(m.tag) ? "mine" : null }) }));

  const historyBox = historyCard("Clan-Verlauf", history, [
    ["points", "Clanpunkte", (r) => r.points],
    ["capitalPoints", "Hauptstadt-Punkte", (r) => r.capitalPoints],
    ["bbPoints", "Builder-Punkte", (r) => r.bbPoints],
    ["members", "Mitglieder", (r) => r.members],
    ["warWins", "Kriegssiege", (r) => r.warWins],
    ["level", "Clan-Level", (r) => r.level],
  ]);

  const movesCard = h("section", { class: "card" },
    h("div", { class: "card-head" }, h("h2", null, "Mitgliederbewegungen"),
      h("span", { class: "hint" }, "aus dem täglichen Abgleich der Mitgliederliste")),
    moves.length ? sortTable([
      { label: "Datum", value: (m) => m.d, render: (m) => DF.format(new Date(`${m.d}T00:00:00Z`)) },
      { label: "Name", value: (m) => m.name },
      { label: "", value: (m) => m.type, render: (m) => (m.type === "join"
        ? h("span", { class: "status win" }, "→ beigetreten") : h("span", { class: "status lose" }, "← verlassen")) },
    ], moves, { tall: true }) : h("p", { class: "chart-empty" }, "Noch keine Beitritte oder Austritte erfasst."));

  main.replaceChildren(hero, tiles, members, warsCard, h("div", { class: "grid-2" }, raidsCard, historyBox),
    h("div", { class: "grid-2" }, warlogCard, movesCard));
}

// ---------- Navigation ----------

function renderNav(active) {
  const link = (kind, item, label, icon) => h("a", { href: `#${kind}/${slug(item.tag)}`,
    "aria-current": active === `${kind}/${slug(item.tag)}` ? "page" : null }, icon, label);
  document.getElementById("nav").replaceChildren(
    ...index.players.map((p) => link("p", p, p.name, h("span", { class: "pill" }, `RH${p.th}`))),
    index.clans.length && index.players.length ? h("span", { class: "sep" }) : "",
    ...index.clans.map((c) => link("c", c, c.name, c.badge && h("img", { src: c.badge, alt: "" }))));
}

async function route() {
  let [kind, tag] = location.hash.slice(1).split("/");
  if (!tag) {
    const first = index.players[0] ? ["p", index.players[0]] : index.clans[0] ? ["c", index.clans[0]] : null;
    if (!first) {
      main.replaceChildren(h("p", { class: "empty" }, "Noch keine Spieler oder Clans erfasst."));
      return;
    }
    location.replace(`#${first[0]}/${slug(first[1].tag)}`);
    return;
  }
  renderNav(`${kind}/${tag}`);
  hideTip();
  main.style.opacity = "0.5";
  try {
    await (kind === "c" ? renderClan(`#${tag}`) : renderPlayer(`#${tag}`));
    scrollTo(0, 0);
  } catch (e) {
    console.error(e);
    main.replaceChildren(h("p", { class: "empty" }, `Konnte die Daten nicht laden (${e.message}).`));
  }
  main.style.opacity = "";
}

async function init() {
  try {
    index = await load("data/index.json");
  } catch {
    main.replaceChildren(h("p", { class: "empty" }, "Noch keine Daten vorhanden. Der erste Abruf läuft über GitHub Actions."));
    return;
  }
  const upd = parseTime(index.updated);
  const gp = index.goldpass && parseTime(index.goldpass.endTime);
  document.getElementById("updated").textContent = [upd && `Stand ${DTF.format(upd)}`,
    gp && `Saisonende ${DFS.format(gp)}`].filter(Boolean).join(" · ");
  addEventListener("hashchange", route);
  route();
}

init();
