// CoC Stats: Einstieg, Navigation und automatische Aktualisierung.
import { DFS, DTF, cache, h, hideTip, load, main, parseTime, slug, state } from "./js/core.js";
import { renderClan } from "./js/clan.js";
import { renderHome } from "./js/home.js";
import { renderPlayer } from "./js/player.js";
import { renderSettings } from "./js/settings.js";
import { thBadge } from "./js/ui.js";

function renderNav(active) {
  const link = (href, key, ...label) => h("a", { href, "aria-current": active === key ? "page" : null }, label);
  const { players, clans } = state.index;
  document.getElementById("nav").replaceChildren(
    link("#home", "home", "Übersicht"),
    players.length > 0 && h("span", { class: "sep" }),
    ...players.map((p) => link(`#p/${slug(p.tag)}`, `p/${slug(p.tag)}`, thBadge(p.th), p.name)),
    clans.length > 0 && h("span", { class: "sep" }),
    ...clans.map((c) => link(`#c/${slug(c.tag)}`, `c/${slug(c.tag)}`, c.badge && h("img", { src: c.badge, alt: "" }), c.name)),
    h("a", { href: "#settings", class: "nav-settings", "aria-current": active === "settings" ? "page" : null }, "⚙ Verwalten"));
  document.querySelector('#nav [aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

async function route({ keepScroll = false } = {}) {
  const [kind, tag, tab] = location.hash.slice(1).split("/");
  hideTip();
  if (!kind) {
    const empty = !state.index.players.length && !state.index.clans.length;
    location.replace(empty ? "#settings" : "#home");
    return;
  }
  const y = scrollY;
  const key = tag ? `${kind}/${tag}` : kind;
  const sameEntity = state.current === `#${tag}`;
  renderNav(key);
  state.current = tag ? `#${tag}` : null;
  main.classList.add("loading");
  try {
    if (kind === "settings") renderSettings();
    else if (kind === "c" && tag) await renderClan(`#${tag}`, tab);
    else if (kind === "p" && tag) await renderPlayer(`#${tag}`, tab);
    else renderHome();
    // Beim Wechsel zwischen Reitern desselben Accounts die Position halten.
    scrollTo(0, keepScroll || sameEntity ? y : 0);
  } catch (e) {
    console.error(e);
    main.replaceChildren(h("p", { class: "empty" }, `Konnte die Daten nicht laden (${e.message}).`));
  }
  main.classList.remove("loading");
}

function renderHeader() {
  const upd = parseTime(state.index.updated);
  const gp = state.index.goldpass && parseTime(state.index.goldpass.endTime);
  document.getElementById("updated").textContent = [upd && `Stand ${DTF.format(upd)}`,
    gp && `Saisonende ${DFS.format(gp)}`].filter(Boolean).join(" · ");
}

// Neue Daten kommen alle 30 Minuten per GitHub Actions. Die offene Seite schaut regelmäßig nach
// und zeichnet sich neu, sobald es einen neueren Stand gibt.
const REFRESH_MS = 5 * 60e3;
let lastCheck = Date.now();

async function checkForUpdates() {
  lastCheck = Date.now();
  let next;
  try {
    next = await fetch("data/index.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null));
  } catch {
    return;
  }
  if (!next || next.updated === state.index.updated) return;
  state.index = next;
  cache.clear();
  cache.set("data/index.json", Promise.resolve(next));
  renderHeader();
  // Auf der Verwaltungsseite nicht neu zeichnen, damit keine Eingabe verloren geht.
  if (location.hash.startsWith("#settings")) renderNav("settings");
  else route({ keepScroll: true });
}

async function init() {
  try {
    state.index = await load("data/index.json");
  } catch {
    /* noch keine Daten: leerer Startzustand */
  }
  renderHeader();
  addEventListener("hashchange", () => route());
  setInterval(() => document.visibilityState === "visible" && checkForUpdates(), REFRESH_MS);
  // Wer die Seite nach längerer Zeit wieder in den Vordergrund holt (z. B. am Handy), bekommt sofort den neuen Stand.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - lastCheck > 60e3) checkForUpdates();
  });
  route();
}

init();
