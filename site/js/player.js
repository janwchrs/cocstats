// Spieler-Ansicht: Übersicht, Upgrades, Helden & Ausrüstung, Verlauf, Erfolge.
import { DAY, DF, DFS, fmt, fmtC, fmtDur, fmtPct, h, load, main, parseTime, slug, state, t } from "./core.js";
import { columnChart, ring } from "./charts.js";
import { CATS, RANGES, ROLES, card, costView, deltaText, emptyNote, historyCard, meter, rankTiles, seg, sortTable, stars,
  tabs, thBadge, tile } from "./ui.js";

const TABS = [["overview", "Übersicht"], ["upgrades", "Upgrades"], ["heroes", "Helden & Ausrüstung"],
  ["history", "Verlauf"], ["achievements", "Erfolge"]];
const CAT_ORDER = Object.keys(CATS);
const QUEUES = [["lab", "Labor", ["troops", "siege", "spells"]], ["heroes", "Helden", ["heroes"]],
  ["pets", "Haustierhaus", ["pets"]]];
const RARITY = { Epic: "Episch", Common: "Gewöhnlich" };
// Erfolge, die als fortlaufende Zähler etwas über die Aktivität aussagen.
const ACTIVITY = {
  "Gold Grab": "Gold geplündert", "Elixir Escapade": "Elixier geplündert", "Heroic Heist": "Dunkles Elixier geplündert",
  "Conqueror": "Angriffe gewonnen", "Unbreakable": "Verteidigungen gewonnen", "Friend in Need": "Truppen gespendet",
  "Sharing is caring": "Zauber gespendet", "Siege Sharer": "Belagerungsmaschinen gespendet",
  "Games Champion": "Clanspiele-Punkte", "Well Seasoned": "Saison-Herausforderungen", "War Hero": "Kriegssterne",
  "War League Legend": "CWL-Sterne", "Wall Buster": "Mauern zerstört", "Humiliator": "Rathäuser zerstört",
  "Union Buster": "Bauhütten zerstört", "Aggressive Capitalism": "Hauptstadtgold geplündert",
  "Most Valuable Clanmate": "Hauptstadtgold beigetragen", "Superb Work": "Supertruppen aktiviert",
};

const isOpen = (u) => u.cap != null && u.l < u.cap;
const isRush = (u) => u.prev != null && u.l < u.prev;
const levelText = (u) => (u.cap == null ? `${u.l} / ?` : `${u.l} / ${u.cap}`);
const rushPill = (u) => isRush(u) && h("span", { class: "pill warn", title: "Unter dem Maximum des vorigen Rathauses" }, "Rückstand");

export async function renderPlayer(tag, tab) {
  const data = await load(`data/p/${slug(tag)}.json`);
  const views = { overview, upgrades, heroes, history, achievements };
  const view = views[tab] ? tab : "overview";
  main.replaceChildren(header(data.player), tabs(`p/${slug(tag)}`, TABS, view), ...[views[view](data)].flat());
}

function header(p) {
  const league = p.leagueTier || p.league;
  const ownClan = p.clan && state.index.clans.some((c) => c.tag === p.clan.tag);
  return h("section", { class: "card hero" },
    thBadge(p.townHallLevel, true),
    h("div", { class: "hero-main" },
      h("h2", null, p.name),
      h("div", { class: "sub" },
        h("span", { class: "mono" }, p.tag),
        h("span", null, `Level ${p.expLevel}`),
        p.clan && (ownClan ? h("a", { href: `#c/${slug(p.clan.tag)}` }, p.clan.name) : h("span", null, p.clan.name)),
        p.role && h("span", null, ROLES[p.role] || p.role),
        p.warPreference && h("span", null, p.warPreference === "in" ? "Krieg: dabei" : "Krieg: pausiert"))),
    h("div", { class: "hero-side" },
      league && h("div", { class: "league" }, league.iconUrls?.small && h("img", { src: league.iconUrls.small, alt: "" }),
        h("div", null, h("strong", null, fmt(p.trophies)), h("span", null, t(league.name)))),
      p.labels?.length > 0 && h("div", { class: "labels" }, p.labels.map((l) =>
        h("img", { src: l.iconUrls.small, alt: l.name, title: l.name })))));
}

// ---------- Übersicht ----------

function overview({ player: p, plan, history, rankings }) {
  const d = (get) => deltaText(history, get);
  const ls = p.legendStatistics;
  return [
    h("section", { class: "tiles" },
      tile("Trophäen", fmt(p.trophies), d((r) => r.trophies)),
      tile("Rekord", fmt(p.bestTrophies)),
      tile("Kriegssterne", fmt(p.warStars), d((r) => r.warStars)),
      tile("Spenden (Saison)", fmt(p.donations), `${fmt(p.donationsReceived)} erhalten`),
      tile("Builder Base", fmt(p.builderBaseTrophies), p.builderBaseLeague && t(p.builderBaseLeague.name)),
      tile("Hauptstadt-Beitrag", fmtC(p.clanCapitalContributions), d((r) => r.capital)),
      ls?.bestSeason && tile(`Legenden: beste Saison`, fmt(ls.bestSeason.trophies), ls.bestSeason.rank && `Platz ${fmt(ls.bestSeason.rank)}`),
      rankTiles(rankings)),
    h("div", { class: "grid-2" }, progressCard(plan), remainingCard(plan)),
    nextCard(plan),
  ];
}

function progressCard(plan) {
  const s = plan.summary;
  const home = CAT_ORDER.filter((c) => c !== "builder" && s[c]);
  const units = home.reduce((a, c) => a + s[c].units, 0), maxed = home.reduce((a, c) => a + s[c].maxed, 0);
  return card(`Rathaus ${plan.th}`, "gemessen am Maximum für dein Rathaus",
    h("div", { class: "progress-head" },
      ring(plan.overall, { label: "geschafft" }),
      h("div", { class: "progress-facts" },
        h("p", null, h("strong", null, `${maxed} von ${units}`), " Einheiten auf Maximum"),
        plan.rush ? h("p", { class: "warn-text" }, `⚠ ${plan.rush} Upgrades noch aus Rathaus ${plan.th - 1} offen`)
          : h("p", { class: "up" }, `✓ Alles aus Rathaus ${plan.th - 1} erledigt`))),
    h("div", { class: "cat-rows" }, CAT_ORDER.filter((c) => s[c]).map((c) => {
      const x = s[c];
      const pct = x.total ? (100 * x.done) / x.total : 100;
      return h("a", { class: "cat-row", href: `#p/${slug(state.current)}/upgrades`, onclick: () => (state.upgradeCat = c) },
        h("span", { class: "cat-name" }, CATS[c], c === "builder" && h("small", null, " Spielmaximum")),
        meter(x.done, x.total, CATS[c]),
        h("span", { class: "num" }, fmtPct(Math.floor(pct * 10) / 10)),
        h("span", { class: "cat-meta" }, `${x.maxed}/${x.units} max`, x.rush > 0 && h("span", { class: "pill warn" }, `${x.rush} Rückstand`)));
    })));
}

function remainingCard(plan) {
  const totals = {};
  for (const [c, x] of Object.entries(plan.summary)) {
    if (c === "builder") continue;
    for (const [res, v] of Object.entries(x.cost)) {
      totals[res] = Array.isArray(v) ? (totals[res] || [0, 0, 0]).map((a, i) => a + v[i]) : (totals[res] || 0) + v;
    }
  }
  const rows = ["Elixir", "Dark Elixir"].filter((r) => totals[r]).map((r) =>
    h("div", { class: "kv" }, h("span", null, r === "Elixir" ? "Elixier" : "Dunkles Elixier"), costView(totals[r], r)));
  if (totals.Ore?.some((v) => v)) rows.push(h("div", { class: "kv" }, h("span", null, "Erz (Ausrüstung)"), costView(totals.Ore)));
  const queues = QUEUES.filter(([q]) => plan.queues[q]).map(([q, label]) =>
    h("div", { class: "kv" }, h("span", null, label), h("strong", null, fmtDur(plan.queues[q]))));
  return card("Bis zum Rathaus-Maximum", "ohne Gebäude und Mauern",
    rows.length || queues.length ? [
      h("h3", { class: "sub-head" }, "Kosten"), rows.length ? rows : emptyNote("Keine Kosten mehr offen."),
      h("h3", { class: "sub-head" }, "Bauzeit"), queues,
      h("p", { class: "footnote" }, "Bauzeit ohne Boosts und Bauarbeiter-Beschleunigung. Helden laufen parallel, wenn genug Bauarbeiter frei sind."),
    ] : h("p", { class: "up big-ok" }, "✓ Alles maximiert"),
    h("p", { class: "footnote" }, `Spieldaten: Stand ${DF.format(new Date(plan.stand))}. Gebäude, Fallen und Mauern liefert die API nicht.`));
}

function nextCard(plan) {
  const cols = QUEUES.map(([q, label, cats]) => {
    const list = plan.units.filter((u) => cats.includes(u.c) && isOpen(u) && u.nextTime != null)
      .sort((a, b) => isRush(b) - isRush(a) || a.nextTime - b.nextTime).slice(0, 5);
    return h("div", { class: "next-col" }, h("h3", null, label), list.length ? h("ul", { class: "next-list" }, list.map((u) =>
      h("li", null,
        h("div", null, h("strong", null, t(u.n)), " ", h("span", { class: "muted-inline" }, `${u.l} → ${u.l + 1}`), " ", rushPill(u)),
        h("div", { class: "next-meta" }, costView(u.nextCost, u.res), u.nextTime > 0 && h("span", null, fmtDur(u.nextTime))))))
      : h("p", { class: "muted" }, "✓ Nichts offen"));
  });
  return card("Als Nächstes", "Rückstände zuerst, dann die kürzesten Upgrades", h("div", { class: "next-grid" }, cols));
}

// ---------- Upgrades ----------

function upgrades({ plan }) {
  let mode = "open", cat = state.upgradeCat || "all";
  state.upgradeCat = null;
  const box = h("div");
  const count = h("span", { class: "hint" });
  const render = () => {
    const rows = plan.units.filter((u) => (cat === "all" || u.c === cat) && (
      mode === "all" || (mode === "open" && isOpen(u)) || (mode === "rush" && isRush(u)) || (mode === "done" && !isOpen(u) && u.cap != null)));
    count.textContent = `${rows.length} Einheiten`;
    box.replaceChildren(rows.length ? sortTable([
      { label: "Einheit", value: (u) => t(u.n), render: (u) => [t(u.n), " ", rushPill(u), !u.known && h("span", { class: "pill" }, "keine Daten")] },
      { label: "Bereich", value: (u) => CAT_ORDER.indexOf(u.c), render: (u) => CATS[u.c] },
      { label: "Level", value: (u) => (u.cap ? u.l / u.cap : null), num: true,
        render: (u) => h("span", { class: "lvl" }, u.cap && meter(u.l, u.cap, t(u.n)), levelText(u)) },
      { label: "Nächstes", value: (u) => u.nextTime, num: true,
        render: (u) => (u.nextCost != null ? h("span", { class: "stack" }, costView(u.nextCost, u.res), u.nextTime > 0 && fmtDur(u.nextTime)) : "–") },
      { label: "Bis Maximum", value: (u) => (Array.isArray(u.cost) ? u.cost[0] : u.cost), num: true, render: (u) => costView(u.cost, u.res) },
      { label: "Restzeit", value: (u) => u.time || null, num: true, render: (u) => fmtDur(u.time) },
    ], rows, { sortBy: 1, desc: false, rowAttrs: (u) => ({ class: isRush(u) ? "rush" : null }) })
      : emptyNote(mode === "rush" ? "✓ Kein Rückstand in diesem Bereich." : "Keine Einheiten in dieser Auswahl."));
  };
  const catSelect = h("select", { "aria-label": "Bereich", onchange: (e) => { cat = e.target.value; render(); } },
    h("option", { value: "all" }, "Alle Bereiche"),
    CAT_ORDER.filter((c) => plan.summary[c]).map((c) => h("option", { value: c, selected: c === cat }, CATS[c])));
  render();
  return h("section", { class: "card" },
    h("div", { class: "card-head" }, h("h2", null, "Upgrades"), count,
      h("div", { class: "controls" }, catSelect,
        seg([["Offen", "open"], ["Rückstand", "rush"], ["Fertig", "done"], ["Alle", "all"]], mode, (v) => { mode = v; render(); }))),
    box);
}

// ---------- Helden & Ausrüstung ----------

function heroes({ plan }) {
  const heroList = plan.units.filter((u) => u.c === "heroes");
  const equipment = plan.units.filter((u) => u.c === "equipment");
  const pets = plan.units.filter((u) => u.c === "pets");
  const heroCards = h("div", { class: "hero-grid" }, heroList.map((u) => {
    const worn = equipment.filter((e) => e.eq && e.hero === u.n);
    return h("div", { class: "hero-card" },
      h("div", { class: "hero-card-head" }, h("strong", null, t(u.n)), rushPill(u)),
      h("div", { class: "lvl-line" }, meter(u.l, u.cap ?? u.max, t(u.n)), h("span", { class: "num" }, levelText(u))),
      isOpen(u) && h("div", { class: "next-meta" }, "bis Max: ", costView(u.cost, u.res), u.time > 0 && h("span", null, fmtDur(u.time))),
      h("div", { class: "chips" }, worn.length ? worn.map((e) => h("span", { class: "chip" }, t(e.n), h("b", null, levelText(e))))
        : h("span", { class: "muted" }, "keine Ausrüstung angelegt")));
  }));

  const equipTable = sortTable([
    { label: "Ausrüstung", value: (u) => t(u.n), render: (u) => [t(u.n), u.eq && h("span", { class: "pill on" }, "angelegt")] },
    { label: "Held", value: (u) => t(u.hero) || "–" },
    { label: "Seltenheit", value: (u) => RARITY[u.rarity] || u.rarity || "–" },
    { label: "Level", value: (u) => (u.cap ? u.l / u.cap : null), num: true,
      render: (u) => h("span", { class: "lvl" }, u.cap && meter(u.l, u.cap, t(u.n)), levelText(u)) },
    { label: "Erz bis Maximum", value: (u) => u.cost?.[0], num: true, render: (u) => costView(u.cost) },
  ], equipment, { sortBy: 1, desc: false, rowAttrs: (u) => ({ class: u.eq ? "mine" : null }) });

  return [
    card("Helden", "mit angelegter Ausrüstung", heroCards),
    card("Ausrüstung", `${equipment.filter((e) => e.cap && e.l >= e.cap).length} von ${equipment.length} auf Maximum`, equipTable),
    pets.length > 0 && card("Haustiere", null, sortTable([
      { label: "Haustier", value: (u) => t(u.n), render: (u) => [t(u.n), " ", rushPill(u)] },
      { label: "Level", value: (u) => (u.cap ? u.l / u.cap : null), num: true,
        render: (u) => h("span", { class: "lvl" }, u.cap && meter(u.l, u.cap, t(u.n)), levelText(u)) },
      { label: "Bis Maximum", value: (u) => u.cost, num: true, render: (u) => costView(u.cost, u.res) },
      { label: "Restzeit", value: (u) => u.time || null, num: true, render: (u) => fmtDur(u.time) },
    ], pets, { sortBy: 1, desc: false })),
  ].filter(Boolean);
}

// ---------- Verlauf ----------

function history({ history: rows, activity, upgrades: log }) {
  return [
    historyCard("Verlauf", rows, [
      ["trophies", "Trophäen", (r) => r.trophies],
      ["warStars", "Kriegssterne", (r) => r.warStars],
      ["donations", "Spenden (Saison)", (r) => r.donations],
      ["attackWins", "Angriffssiege (Saison)", (r) => r.attackWins],
      ["bbTrophies", "Builder-Trophäen", (r) => r.bbTrophies],
      ["capital", "Hauptstadt-Beitrag", (r) => r.capital],
      ["xp", "Erfahrungslevel", (r) => r.xp],
    ]),
    activityCard(activity),
    upgradeLog(log),
  ];
}

/** Tageszuwachs der Erfolgszähler (Beute, Spenden, Clanspiele …). */
function activityCard(act) {
  const head = (extra) => h("div", { class: "card-head" }, h("h2", null, "Aktivität pro Tag"), extra);
  if (!act || act.days.length < 2) {
    return h("section", { class: "card" }, head(),
      emptyNote("Ab dem zweiten Tag der Aufzeichnung siehst du hier, wie viel du pro Tag geplündert, gespendet und erreicht hast."));
  }
  const names = Object.keys(act.values);
  const known = Object.keys(ACTIVITY).filter((n) => names.includes(n));
  const rest = names.filter((n) => !ACTIVITY[n]).sort((a, b) => t(a).localeCompare(t(b), "de"));
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
    box.replaceChildren(columnChart(items, { label: ACTIVITY[key] || t(key) }));
  };
  const select = h("select", { "aria-label": "Zähler", onchange: (e) => { key = e.target.value; render(); } },
    h("optgroup", { label: "Aktivität" }, known.map((n) => h("option", { value: n }, ACTIVITY[n]))),
    rest.length && h("optgroup", { label: "Weitere Erfolge" }, rest.map((n) => h("option", { value: n }, t(n)))));
  render();
  return h("section", { class: "card" },
    head([hint, h("div", { class: "controls" }, select, seg(RANGES.slice(0, 4), range, (v) => { range = v; render(); }))]),
    box);
}

function upgradeLog(list) {
  const unitName = (u) => (u.startsWith("BB ") ? `${t(u.slice(3))} (Builder)` : t(u));
  return card("Erledigte Upgrades", list.length ? `${list.length} seit Beginn der Aufzeichnung` : null,
    list.length ? sortTable([
      { label: "Datum", value: (u) => u.t, render: (u) => DF.format(parseTime(u.t)) },
      { label: "Einheit", value: (u) => unitName(u.unit) },
      { label: "Level", value: (u) => u.to, num: true, render: (u) => (u.from == null ? `neu · ${u.to}` : `${u.from} → ${u.to}`) },
    ], list, { tall: true }) : emptyNote("Sobald du etwas upgradest, taucht es hier mit Datum auf."));
}

// ---------- Erfolge ----------

function achievements({ player: p }) {
  const list = p.achievements;
  const village = (a) => (a.village === "home" ? "Heimatdorf" : a.village === "builderBase" ? "Builder Base" : "Hauptstadt");
  return card("Erfolge", `${list.filter((a) => a.stars === 3).length} von ${list.length} abgeschlossen`,
    sortTable([
      { label: "Erfolg", value: (a) => t(a.name), render: (a) => h("span", { title: a.info }, t(a.name)) },
      { label: "Sterne", value: (a) => a.stars, num: true, render: (a) => stars(a.stars) },
      { label: "Fortschritt", value: (a) => (a.target ? Math.min(1, a.value / a.target) : 1), num: true,
        render: (a) => h("span", { class: "lvl" }, meter(Math.min(a.value, a.target), a.target, t(a.name)), `${fmtC(a.value)} / ${fmtC(a.target)}`) },
      { label: "Bereich", value: village },
    ], list, { sortBy: 1, desc: false }));
}
