// Verwaltung: Accounts und Clans pflegen. Die Seite hat kein eigenes Backend, Änderungen werden über die
// GitHub-API als Commit in config.json geschrieben. Jeder Commit startet den Workflow, der die Daten abruft.
import { DTF, h, main, parseTime, state } from "./core.js";
import { card } from "./ui.js";

const TAG_RE = /^#[0289PYLQGRJCUV]{3,12}$/;
const normTag = (t) => {
  t = t.trim().toUpperCase().replace(/O/g, "0");
  return t.startsWith("#") ? t : `#${t}`;
};

const store = {
  get(k) { try { return localStorage.getItem(k) || ""; } catch { return ""; } },
  set(k, v) { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* privates Fenster */ } },
};

function repoName() {
  if (state.index.repo) return state.index.repo;
  const m = /^([^.]+)\.github\.io$/.exec(location.hostname);
  const first = location.pathname.split("/").filter(Boolean)[0];
  return m && first ? `${m[1]}/${first}` : store.get("gh-repo");
}

async function gh(path, { method = "GET", body } = {}) {
  const r = await fetch(`https://api.github.com/repos/${repoName()}${path}`, {
    method, body: body && JSON.stringify(body), cache: "no-store",
    headers: { Authorization: `Bearer ${store.get("gh-token")}`, Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28" },
  });
  if (!r.ok) {
    let msg = "";
    try { msg = (await r.json()).message; } catch { /* kein JSON */ }
    if (r.status === 401) throw new Error("Der GitHub-Token ist ungültig oder abgelaufen.");
    if (r.status === 403 || r.status === 404) throw new Error(`Kein Zugriff auf ${repoName()} (${msg || r.status}). Prüfe Repo und Berechtigungen des Tokens.`);
    const err = new Error(`GitHub: ${r.status} ${msg}`);
    err.status = r.status;
    throw err;
  }
  return r.status === 204 ? null : r.json();
}

const b64decode = (v) => new TextDecoder().decode(Uint8Array.from(atob(v.replace(/\s/g, "")), (c) => c.charCodeAt(0)));
const b64encode = (v) => {
  let bin = "";
  for (const b of new TextEncoder().encode(v)) bin += String.fromCharCode(b);
  return btoa(bin);
};

async function loadConfig() {
  const file = await gh("/contents/config.json");
  return { sha: file.sha, cfg: JSON.parse(b64decode(file.content)) };
}

async function saveConfig(cfg, sha, message) {
  const res = await gh("/contents/config.json", { method: "PUT",
    body: { message, sha, content: b64encode(`${JSON.stringify(cfg, null, 2)}\n`) } });
  return res.content.sha;
}

export function renderSettings() {
  const repo = repoName();
  const token = store.get("gh-token");
  const known = new Map([...state.index.players, ...state.index.clans].map((x) => [x.tag, x.name]));
  const status = h("p", { class: "status-line", role: "status" });
  const say = (text, kind = "") => {
    status.className = `status-line ${kind}`;
    status.textContent = text;
  };

  // Anmeldung
  let login;
  if (token && repo) {
    login = card("Anmeldung", null, h("div", { class: "row" },
      h("span", null, "Angemeldet für ", h("b", null, repo)),
      h("button", { class: "btn", type: "button", onclick: () => { store.set("gh-token", ""); renderSettings(); } }, "Abmelden")));
  } else {
    const tokenInput = h("input", { type: "password", autocomplete: "off", spellcheck: "false", required: true,
      placeholder: "github_pat_…", "aria-label": "GitHub-Token" });
    const repoInput = !repo && h("input", { type: "text", required: true, placeholder: "besitzer/repo", "aria-label": "Repository" });
    login = card("Anmeldung", "einmalig pro Browser",
      h("p", { class: "text" }, "Änderungen speichert diese Seite direkt in deinem GitHub-Repo. Dafür braucht sie einen persönlichen Token, der nur in diesem Browser gespeichert wird."),
      h("ol", { class: "steps" },
        h("li", null, "Öffne ", h("a", { href: "https://github.com/settings/personal-access-tokens/new", target: "_blank", rel: "noopener" }, "GitHub → Fine-grained token erstellen"), "."),
        h("li", null, "Repository access: ", h("b", null, "Only select repositories"), ` → ${repo || "dein Repo"}.`),
        h("li", null, "Permissions: ", h("b", null, "Contents"), " und ", h("b", null, "Actions"), " jeweils auf „Read and write“."),
        h("li", null, "Token erzeugen und hier einfügen.")),
      h("form", { class: "row", onsubmit: (e) => {
        e.preventDefault();
        if (repoInput) store.set("gh-repo", repoInput.value.trim());
        store.set("gh-token", tokenInput.value.trim());
        renderSettings();
      } }, repoInput, tokenInput, h("button", { class: "btn primary", type: "submit" }, "Anmelden")));
  }

  // Accounts & Clans
  const accounts = card("Accounts & Clans", null);
  const listView = (cfg, edit) => {
    const section = (key, title, empty) => h("div", { class: "list-block" }, h("h3", null, title),
      cfg[key].length ? h("ul", { class: "list" }, cfg[key].map((tag) => h("li", null,
        h("span", null, known.get(tag) || h("span", { class: "muted" }, "wartet auf ersten Abruf")),
        h("span", { class: "mono" }, tag),
        edit && h("button", { class: "btn small", type: "button", onclick: () => edit.remove(key, tag) }, "Entfernen"))))
        : h("p", { class: "muted" }, empty));
    return [section("players", "Meine Spieler-Accounts", "Noch keine Accounts eingetragen."),
      section("clans", "Zusätzliche Clans", "Keine. Die Clans deiner Accounts werden automatisch erfasst, wenn das unten aktiviert ist.")];
  };

  if (!token || !repo) {
    accounts.append(...listView(state.index.configured || { players: [], clans: [] }),
      h("p", { class: "muted" }, "Melde dich oben an, um Accounts hinzuzufügen oder zu entfernen."));
  } else {
    accounts.append(h("p", { class: "muted" }, "Lädt …"));
    (async () => {
      let sha, cfg;
      try {
        ({ sha, cfg } = await loadConfig());
      } catch (e) {
        accounts.lastChild.replaceWith(h("p", { class: "down" }, e.message));
        return;
      }
      const commit = async (next, message) => {
        accounts.querySelectorAll("button, input, select").forEach((el) => (el.disabled = true));
        say("Speichert …");
        try {
          sha = await saveConfig(next, sha, message);
          cfg = next;
          tagInput.value = "";
          draw();
          say("Gespeichert. Der Abruf läuft jetzt, in 1–2 Minuten ist alles im Dashboard.", "up");
        } catch (e) {
          if (e.status === 409) ({ sha, cfg } = await loadConfig());
          draw();
          say(e.status === 409 ? "Die Konfiguration wurde inzwischen geändert und neu geladen. Bitte noch einmal versuchen." : e.message, "down");
        }
      };
      const edit = {
        remove: (key, tag) => commit({ ...cfg, [key]: cfg[key].filter((t) => t !== tag) }, `${tag} entfernt`),
      };
      const tagInput = h("input", { type: "text", required: true, placeholder: "#2PP…", "aria-label": "Tag", autocapitalize: "characters", spellcheck: "false" });
      const kind = h("select", { "aria-label": "Art" }, h("option", { value: "players" }, "Spieler"), h("option", { value: "clans" }, "Clan"));
      const form = h("form", { class: "row", onsubmit: (e) => {
        e.preventDefault();
        const tag = normTag(tagInput.value);
        if (!TAG_RE.test(tag)) return say(`„${tagInput.value}“ ist kein gültiger Tag. Tags bestehen nur aus 0 2 8 9 P Y L Q G R J C U V.`, "down");
        if (cfg[kind.value].includes(tag)) return say(`${tag} ist schon eingetragen.`, "down");
        commit({ ...cfg, [kind.value]: [...cfg[kind.value], tag] }, `${tag} hinzugefügt`);
      } }, kind, tagInput, h("button", { class: "btn primary", type: "submit" }, "Hinzufügen"));
      const auto = h("label", { class: "check" },
        h("input", { type: "checkbox", checked: cfg.includePlayerClans !== false, onchange: (e) =>
          commit({ ...cfg, includePlayerClans: e.target.checked }, `Clans der Accounts ${e.target.checked ? "an" : "aus"}`) }),
        "Clans meiner Accounts automatisch erfassen");
      const draw = () => {
        accounts.replaceChildren(accounts.firstChild, ...listView(cfg, edit),
          h("p", { class: "muted" }, "Den Spieler-Tag findest du im Spiel im Profil direkt unter dem Namen."), form, auto, status);
        accounts.querySelectorAll("button, input, select").forEach((el) => (el.disabled = false));
        auto.firstChild.checked = cfg.includePlayerClans !== false;
      };
      draw();
    })();
  }

  // Abruf
  const refresh = card("Abruf", "automatisch alle 30 Minuten",
    state.index.updated && h("p", { class: "text" }, `Letzte Änderung der Daten: ${DTF.format(parseTime(state.index.updated))}`),
    state.index.errors?.length && h("div", { class: "problems" }, h("h3", null, "Probleme beim letzten Abruf"),
      h("ul", null, state.index.errors.map((e) => h("li", null, e)))),
    h("div", { class: "row" },
      token && repo && h("button", { class: "btn", type: "button", onclick: async (e) => {
        e.target.disabled = true;
        try {
          await gh("/actions/workflows/update.yml/dispatches", { method: "POST", body: { ref: "main" } });
          e.target.textContent = "Gestartet ✓";
        } catch (err) {
          e.target.disabled = false;
          alertRow.textContent = err.message;
        }
      } }, "Jetzt aktualisieren"),
      repo && h("a", { href: `https://github.com/${repo}/actions`, target: "_blank", rel: "noopener" }, "Läufe auf GitHub ansehen")));
  const alertRow = h("p", { class: "down" });
  refresh.append(alertRow);

  main.replaceChildren(h("h2", { class: "page-title" }, "Verwalten"), login, accounts, refresh);
}
