// Clan-Ansicht: Mitglieder, Kriege, Clanhauptstadt, Verlauf.
import { DF, DFS, NF, fmt, fmtPct, h, load, main, parseTime, slug, state, t } from "./core.js";
import { columnChart } from "./charts.js";
import { ROLES, deltaText, emptyNote, historyCard, rankTiles, sortTable, stars, tabs, tile, warStatus } from "./ui.js";

const TABS = [["members", "Mitglieder"], ["wars", "Kriege"], ["capital", "Hauptstadt"], ["history", "Verlauf"]];
const WAR_FREQ = { always: "immer", moreThanOncePerWeek: "mehrmals pro Woche", oncePerWeek: "einmal pro Woche",
  lessThanOncePerWeek: "seltener als wöchentlich", never: "nie", unknown: "unbekannt" };

export function memberWarStats(wars, count = 10) {
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

export async function renderClan(tag, tab) {
  const { clan: c, history, wars, warlog, raids, moves, rankings } = await load(`data/c/${slug(tag)}.json`);
  const mine = new Set(state.index.players.map((p) => p.tag));

  const hero = h("section", { class: "card hero" },
    c.badgeUrls?.medium && h("img", { class: "badge", src: c.badgeUrls.medium, alt: "" }),
    h("div", { class: "hero-main" },
      h("h2", null, c.name),
      h("div", { class: "sub" },
        h("span", { class: "mono" }, c.tag),
        h("span", null, `Level ${c.clanLevel}`),
        c.location && h("span", null, c.location.name),
        c.warLeague && h("span", null, `CWL: ${t(c.warLeague.name)}`),
        c.capitalLeague && h("span", null, `Hauptstadt: ${t(c.capitalLeague.name)}`),
        c.warFrequency && h("span", null, `Kriege: ${WAR_FREQ[c.warFrequency] || c.warFrequency}`)),
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
      { label: "Gegner", value: (w) => w.opponent ?? "CWL-Saison" },
      { label: "Größe", value: (w) => w.teamSize, num: true },
      { label: "Sterne", value: (w) => w.stars[0], num: true, render: (w) => `${w.stars[0]} : ${w.stars[1]}` },
      // CWL-Einträge summieren alle Runden; ein Prozentwert ergibt dort keinen Sinn.
      { label: "Zerstörung", value: (w) => (w.opponent ? w.destruction[0] : null), num: true,
        render: (w) => (w.opponent ? `${NF.format(w.destruction[0])} % : ${NF.format(w.destruction[1])} %` : "–") },
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

  const views = {
    members: () => [tiles, members],
    wars: () => [warsCard, warlogCard].filter(Boolean),
    capital: () => [raidsCard || h("section", { class: "card" }, emptyNote("Noch keine Raid-Wochenenden erfasst."))],
    history: () => [historyBox, movesCard],
  };
  const view = views[tab] ? tab : "members";
  main.replaceChildren(hero, tabs(`c/${slug(tag)}`, TABS, view), ...views[view]());
}