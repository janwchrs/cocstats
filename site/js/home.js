// Startseite: alle Accounts und Clans auf einen Blick.
import { fmt, fmtDur, h, main, slug, state, t } from "./core.js";
import { ring } from "./charts.js";
import { ROLES, meter, thBadge } from "./ui.js";

export function renderHome() {
  const { players, clans } = state.index;
  if (!players.length && !clans.length) {
    main.replaceChildren(h("section", { class: "card welcome" },
      h("h2", null, "Willkommen"),
      h("p", { class: "text" }, "Trag unter „Verwalten“ deine Spieler-Tags ein. Ein bis zwei Minuten später sind deine Accounts hier."),
      h("a", { class: "btn primary", href: "#settings" }, "Accounts eintragen")));
    return;
  }
  main.replaceChildren(
    players.length > 0 && h("h2", { class: "section-title" }, "Meine Accounts"),
    h("div", { class: "account-grid" }, players.map(accountCard)),
    clans.length > 0 && h("h2", { class: "section-title" }, "Clans"),
    h("div", { class: "clan-grid" }, clans.map(clanCard)));
}

function accountCard(p) {
  const queues = [["lab", "Labor"], ["heroes", "Helden"], ["pets", "Haustiere"]].filter(([q]) => p.queues?.[q]);
  return h("a", { class: "card account", href: `#p/${slug(p.tag)}` },
    h("div", { class: "account-head" },
      thBadge(p.th),
      h("div", { class: "account-name" }, h("strong", null, p.name),
        h("span", null, [p.clanName, p.role && ROLES[p.role]].filter(Boolean).join(" · ") || p.tag)),
      p.leagueIcon && h("img", { class: "league-icon", src: p.leagueIcon, alt: "" })),
    h("div", { class: "account-body" },
      ring(p.progress, { size: 88, label: `RH ${p.th}` }),
      h("div", { class: "account-facts" },
        h("div", { class: "kv" }, h("span", null, "Trophäen"), h("strong", null, fmt(p.trophies))),
        h("div", { class: "kv" }, h("span", null, "Liga"), h("span", null, t(p.league) || "–")),
        h("div", { class: "kv" }, h("span", null, "Kriegssterne"), h("strong", null, fmt(p.warStars))),
        p.rush > 0 ? h("p", { class: "warn-text" }, `⚠ ${p.rush} Upgrades aus RH ${p.th - 1} offen`)
          : h("p", { class: "up" }, "✓ Kein Rückstand"))),
    p.heroes?.length > 0 && h("div", { class: "mini-heroes" }, p.heroes.filter((x) => x[2]).map(([name, lvl, cap]) =>
      h("div", { class: "mini-hero" }, h("span", null, t(name)), meter(lvl, cap, t(name)), h("span", { class: "num" }, `${lvl}/${cap}`)))),
    queues.length > 0 && h("div", { class: "account-foot" }, "Bis Maximum: ",
      queues.map(([q, label], i) => [i > 0 && " · ", `${label} ${fmtDur(p.queues[q])}`])));
}

function clanCard(c) {
  return h("a", { class: "card clan", href: `#c/${slug(c.tag)}` },
    c.badge && h("img", { src: c.badge, alt: "" }),
    h("div", null, h("strong", null, c.name), h("span", null, `Level ${c.level} · ${c.members} Mitglieder`)));
}
