// Kontakte („Mini-CRM“): Makler, Bank, Behörden … mit Verlauf (Gesprächsnotizen), Geburtstagen und To-dos.
// „Notiz einsprechen“: Robert diktiert, die KI schlägt vor (wer, was, Termine, Geburtstag), gespeichert wird erst nach „Speichern“.
// Der Verlauf gibt es auch für Mietparteien (in der Akte); dort kann die Notiz zusätzlich als PDF in die Ablage.
import * as db from "./daten.js";
import { datumDE, mieterName } from "./dokumente.js";
import { $, $$, esc, melde, dialogFormular, frage, heuteISO, zustand, objektVon, wohnungVon } from "./helfer.js";
import { ICON_MIKRO, geheZu, kurz, mieterListe, mikroKnopf, norm, verbindeDiktat, wartehinweis } from "./ui.js";
import * as ablage from "./ablage.js";
import * as start from "./start.js";

const inhalt = () => $("#inhalt");
export const ROLLEN = ["Makler", "Bank", "Behörde", "Steuerberater", "Notar", "Versicherung", "Hausverwaltung", "Gutachter", "Sonstiges"];
export const ARTEN = { telefonat: "Telefonat", treffen: "Treffen", email: "E-Mail", notiz: "Notiz" };
const MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const ICON_PLUS = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>`;
const ICON_TORTE = `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M12 6a2 2 0 0 0 2-2c0-.38-.1-.73-.29-1.03L12 0l-1.71 2.97A1.97 1.97 0 0 0 12 6zm4.6 9.99-1.07-1.07-1.08 1.07c-1.3 1.3-3.58 1.31-4.89 0l-1.07-1.07-1.09 1.07A3.4 3.4 0 0 1 5 17v4a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4a3.4 3.4 0 0 1-2.4-1.01zM18 9h-5V7h-2v2H6a3 3 0 0 0-3 3v1.54c0 1.08.88 1.96 1.96 1.96.52 0 1.02-.2 1.38-.57l2.14-2.13 2.13 2.13c.74.74 2.03.74 2.77 0l2.14-2.13 2.13 2.13c.37.37.86.57 1.38.57 1.08 0 1.96-.88 1.96-1.96V12A3 3 0 0 0 18 9z"/></svg>`;

// --- Namen und Datum ------------------------------------------------------------
export const kontaktName = (k) => [k?.vorname, k?.nachname].filter(Boolean).join(" ") || k?.firma || "Kontakt";
const initialen = (k) => (kontaktName(k).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("") || "?").toUpperCase();
const pad = (n) => String(n).padStart(2, "0");
const tageBis = (iso, heute = heuteISO()) => Math.round((new Date(iso + "T12:00:00") - new Date(heute + "T12:00:00")) / 86400000);

/** Geburtstag im Jahr j (29.02. in Nicht-Schaltjahren → 28.02.) */
function geburtstagIm(k, j) {
  const max = new Date(j, k.geburtstag_monat, 0).getDate();
  return `${j}-${pad(k.geburtstag_monat)}-${pad(Math.min(k.geburtstag_tag, max))}`;
}
/** Nächster Geburtstag (heute oder später) mit Abstand in Tagen und Alter, falls das Jahr bekannt ist */
export function naechsterGeburtstag(k, heute = heuteISO()) {
  if (!k?.geburtstag_tag || !k?.geburtstag_monat) return null;
  const j = Number(heute.slice(0, 4));
  let datum = geburtstagIm(k, j);
  if (datum < heute) datum = geburtstagIm(k, j + 1);
  const jahr = Number(datum.slice(0, 4));
  return { datum, jahr, tage: tageBis(datum, heute), alter: k.geburtsjahr ? jahr - k.geburtsjahr : null };
}
export const geburtstagText = (k) => (k?.geburtstag_tag ? `${k.geburtstag_tag}. ${MONATE[k.geburtstag_monat - 1]}${k.geburtsjahr ? ` ${k.geburtsjahr}` : ""}` : "");
const wannGeburtstag = (t) => (t === 0 ? "heute" : t === 1 ? "morgen" : t === -1 ? "gestern" : t < 0 ? `vor ${-t} Tagen` : `in ${t} Tagen`);

/**
 * Geburtstage für „Zu erledigen“: ab 7 Tagen vorher bis 2 Tage danach, solange nicht abgehakt.
 * Liefert Einträge im Format von sammle() in start.js.
 */
export function geburtstagTodos(kontakte, heute = heuteISO()) {
  const liste = [];
  const j = Number(heute.slice(0, 4));
  for (const k of kontakte || []) {
    if (!k.geburtstag_tag) continue;
    // dieses Jahr (auch kurz danach) oder nächstes Jahr (Jahreswechsel)
    for (const jahr of [j, j + 1]) {
      const datum = geburtstagIm(k, jahr);
      const t = tageBis(datum, heute);
      if (t < -2 || t > 7 || Number(k.geburtstag_erledigt) === jahr) continue;
      const alter = k.geburtsjahr ? jahr - k.geburtsjahr : null;
      liste.push({
        art: "Geburtstag", stufe: t <= 0 ? 0 : t <= 2 ? 1 : 2, datum, href: `#/kontakt/${k.id}`,
        titel: `${kontaktName(k)}${alter ? ` wird ${alter}` : ""}`,
        unter: [k.firma, k.rolle].filter(Boolean).join(" · "), marken: "",
        wann: wannGeburtstag(t), wannNot: t === 0,
        geburtstag: { id: k.id, jahr },
      });
    }
  }
  return liste;
}

/** Kontakte für Auswahlfelder (zwischengespeichert) */
export async function kontakteListe(neu = false) {
  if (!zustand.kontakte || neu) zustand.kontakte = await db.ladeKontakte().catch(() => []);
  return zustand.kontakte;
}
export const kontaktVon = (id) => (id ? (zustand.kontakte || []).find((k) => k.id === id) || null : null);

// --- Reiter über den Listen: Mieter | Kontakte | Handwerker -------------------------
export function reiterHtml(aktiv) {
  const r = (ziel, text, key) => `<a class="reiter__knopf" href="${ziel}" ${aktiv === key ? `aria-current="page"` : ""}>${text}</a>`;
  return `<nav class="reiter reiter--seiten" aria-label="Bereiche">${r("#/mieter", "Mieter", "mieter")}${r("#/kontakte", "Kontakte", "kontakte")}${r("#/handwerker", "Handwerker", "handwerker")}</nav>`;
}

// ---------------------------------------------------------------------------
// Liste aller Kontakte
// ---------------------------------------------------------------------------
export async function zeigeKontakte() {
  const [kontakte, letzte] = await Promise.all([kontakteListe(true), db.ladeLetzteKontakte().catch(() => [])]);
  const zuletzt = new Map();
  for (const v of letzte) if (!zuletzt.has(v.kontakt_id)) zuletzt.set(v.kontakt_id, v.datum);
  const bald = kontakte.map((k) => ({ k, g: naechsterGeburtstag(k) })).filter((x) => x.g && x.g.tage <= 30).sort((a, b) => a.g.tage - b.g.tage);
  const sortiert = [...kontakte].sort((a, b) => norm(a.nachname || a.firma).localeCompare(norm(b.nachname || b.firma), "de"));

  inhalt().innerHTML = `
    ${reiterHtml("kontakte")}
    <div class="kopf">
      <div><h1>Kontakte</h1><p>${kontakte.length} Kontakte: Makler, Banken, Behörden und alle, die keine Mieter sind</p>
        <p class="knopfreihe">
          <button type="button" class="knopf knopf--primaer" id="einsprechen">${ICON_MIKRO} Notiz einsprechen</button>
          <button type="button" class="knopf" id="kontakt-neu">${ICON_PLUS} Neuer Kontakt</button></p></div>
      <label class="feld suchfeld"><span>Suchen</span><input type="search" id="suche" placeholder="Name, Firma oder Rolle"></label>
    </div>
    ${bald.length ? `
    <section class="flaeche geburtstage">
      <div class="flaeche__kopf"><h2>${ICON_TORTE} Geburtstage in den nächsten 30 Tagen</h2></div>
      <div class="zeilen">${bald.map(({ k, g }) => `
        <a class="geburtstag" href="#/kontakt/${esc(k.id)}">
          <span class="geburtstag__name">${esc(kontaktName(k))}${g.alter ? ` <span class="leise">wird ${g.alter}</span>` : ""}</span>
          <span class="geburtstag__wann ${g.tage <= 1 ? "geburtstag__wann--bald" : ""}">${esc(wannGeburtstag(g.tage))} · ${esc(datumDE(g.datum).slice(0, 6))}</span>
        </a>`).join("")}</div>
    </section>` : ""}
    <section class="flaeche">
      ${sortiert.length ? `<div class="kontaktliste">${sortiert.map((k) => {
        const g = naechsterGeburtstag(k);
        return `
        <a class="kontaktzeile" href="#/kontakt/${esc(k.id)}" data-suche="${esc(norm([kontaktName(k), k.firma, k.rolle, k.notiz].join(" ")))}">
          <span class="kontaktzeile__bild" aria-hidden="true">${esc(initialen(k))}</span>
          <span class="kontaktzeile__text">
            <span class="kontaktzeile__name">${esc(kontaktName(k))}</span>
            <span class="leise">${esc([k.vorname || k.nachname ? k.firma : "", k.rolle].filter(Boolean).join(" · ") || "–")}</span>
          </span>
          <span class="kontaktzeile__rechts">
            ${g && g.tage <= 14 ? `<span class="marker marker--messing">${ICON_TORTE} ${esc(wannGeburtstag(g.tage))}</span>` : ""}
            ${zuletzt.has(k.id) ? `<span class="leise">zuletzt ${esc(datumDE(zuletzt.get(k.id)))}</span>` : ""}
          </span>
        </a>`;
      }).join("")}</div>
      <div class="leer" id="keintreffer" hidden>Kein Kontakt gefunden.</div>`
      : `<div class="leer">Noch keine Kontakte. Mit „Notiz einsprechen“ einfach erzählen, mit wem Sie gesprochen haben, oder „Neuer Kontakt“ wählen.</div>`}
    </section>`;

  $("#einsprechen").addEventListener("click", () => notizEinsprechen());
  $("#kontakt-neu").addEventListener("click", () => kontaktDialog(null, { nachher: (k) => geheZu(`#/kontakt/${k.id}`) }));
  $("#suche").addEventListener("input", (e) => {
    const q = norm(e.target.value.trim());
    let treffer = 0;
    for (const z of $$(".kontaktzeile")) {
      z.hidden = q && !z.dataset.suche.includes(q);
      if (!z.hidden) treffer++;
    }
    if ($("#keintreffer")) $("#keintreffer").hidden = treffer > 0;
  });
}

// ---------------------------------------------------------------------------
// Seite eines Kontakts: Kontaktdaten, Verlauf, To-dos
// ---------------------------------------------------------------------------
export async function zeigeKontakt(id) {
  const [k, verlauf, aufgaben] = await Promise.all([
    db.ladeKontakt(id).catch(() => null),
    db.ladeVerlauf({ kontaktId: id }).catch(() => []),
    db.ladeAufgaben({ kontaktId: id }).catch(() => []),
    kontakteListe(),
  ]);
  if (!k) throw new Error("Diesen Kontakt gibt es nicht (mehr).");
  const g = naechsterGeburtstag(k);
  const neuLaden = () => zeigeKontakt(id);
  const tel = String(k.telefon || "").replace(/[^\d+]/g, "");

  inhalt().innerHTML = `
    <a class="zurueck" href="#/kontakte">Alle Kontakte</a>
    <div class="kopf">
      <div class="kontaktkopf">
        <span class="kontaktzeile__bild kontaktzeile__bild--gross" aria-hidden="true">${esc(initialen(k))}</span>
        <div><h1>${esc(kontaktName(k))}</h1>
          <p>${esc([k.vorname || k.nachname ? k.firma : "", k.rolle].filter(Boolean).join(" · "))}</p></div>
      </div>
      <div class="knopfreihe">
        <button type="button" class="knopf knopf--primaer" id="einsprechen">${ICON_MIKRO} Notiz einsprechen</button>
        <button type="button" class="knopf" id="eintrag-neu">${ICON_PLUS} Eintrag</button>
        <a class="knopf" href="#/schreiben/k-${esc(k.id)}">Schreiben</a>
        <button type="button" class="knopf" id="bearbeiten">Bearbeiten</button>
      </div>
    </div>
    <div class="akte">
      <div class="stapel">
        <section class="flaeche" id="verlauf">
          <div class="flaeche__kopf"><h2>Verlauf</h2><span class="leise">${verlauf.length === 1 ? "1 Eintrag" : verlauf.length ? `${verlauf.length} Einträge` : ""}</span></div>
          ${verlaufHtml(verlauf, { leer: "Noch keine Einträge. Nach dem nächsten Gespräch einfach „Notiz einsprechen“." })}
        </section>
      </div>
      <div class="stapel">
        <section class="flaeche">
          <div class="flaeche__kopf"><h2>Kontaktdaten</h2></div>
          <div class="flaeche__inhalt">
            <dl class="datenliste">
              ${k.firma && (k.vorname || k.nachname) ? `<dt>Firma</dt><dd>${esc(k.firma)}</dd>` : ""}
              <dt>Telefon</dt><dd>${tel ? `<a href="tel:${esc(tel)}">${esc(k.telefon)}</a>` : "–"}</dd>
              <dt>E-Mail</dt><dd>${k.email ? `<a href="mailto:${esc(k.email)}">${esc(k.email)}</a>` : "–"}</dd>
              ${k.adresse ? `<dt>Adresse</dt><dd>${esc(k.adresse)}</dd>` : ""}
              <dt>Geburtstag</dt><dd>${g ? `${esc(geburtstagText(k))}<br><span class="leise">${esc(wannGeburtstag(g.tage))}${g.alter ? `, wird ${g.alter}` : ""} · jährliche Erinnerung</span>` : "–"}</dd>
            </dl>
            ${k.notiz ? `<div class="kontaktinfo"><strong>Gut zu wissen</strong><p>${esc(k.notiz)}</p></div>` : ""}
          </div>
        </section>
        <section class="flaeche" id="todos">
          <div class="flaeche__kopf"><h2>To-dos</h2><button type="button" class="knopf knopf--klein" id="todo-neu">${ICON_PLUS} To-do</button></div>
          ${start.todoListe(start.aufgabenKurz(aufgaben), { leer: "Keine offenen To-dos." })}
        </section>
      </div>
    </div>`;

  verbindeVerlauf($("#verlauf"), { verlauf, nachher: neuLaden });
  start.verbindeTodos($("#todos"), { aufgaben, nachher: neuLaden });
  $("#einsprechen").addEventListener("click", () => notizEinsprechen({ kontaktId: id }));
  $("#eintrag-neu").addEventListener("click", () => verlaufDialog({ kontakt_id: id }, { nachher: neuLaden }));
  $("#bearbeiten").addEventListener("click", () => kontaktDialog(k, { nachher: neuLaden, nachLoeschen: () => geheZu("#/kontakte") }));
  $("#todo-neu").addEventListener("click", () => start.aufgabeDialog({ kontakt_id: id }, { nachher: neuLaden }));
}

// ---------------------------------------------------------------------------
// Handwerker (eigene Liste, wie bisher; hier alle Häuser auf einen Blick)
// ---------------------------------------------------------------------------
export async function zeigeHandwerker() {
  const liste = await db.ladeDienstleister().catch(() => []);
  const neuLaden = () => zeigeHandwerker();
  inhalt().innerHTML = `
    ${reiterHtml("handwerker")}
    <div class="kopf">
      <div><h1>Handwerker</h1><p>Handwerker und Dienstleister aller Häuser</p></div>
      <div class="knopfreihe"><button type="button" class="knopf" id="dienst-neu">${ICON_PLUS} Hinzufügen</button></div>
    </div>
    <section class="flaeche">${ablage.dienstleisterListe(liste)}</section>`;
  ablage.verbindeListen(inhalt(), { dienstleister: liste, nachher: neuLaden });
  $("#dienst-neu").addEventListener("click", () => ablage.bearbeiteDienstleister(null, { nachher: neuLaden }));
}

// ---------------------------------------------------------------------------
// Verlauf: Anzeige und Bearbeiten (für Kontakte und Mietparteien)
// ---------------------------------------------------------------------------
export function verlaufHtml(liste, { leer = "Noch keine Einträge.", sichtbar = 50 } = {}) {
  if (!liste.length) return `<div class="leer">${esc(leer)}</div>`;
  const zeile = (v) => `
    <button type="button" class="verlauf__eintrag" data-verlauf="${esc(v.id)}">
      <span class="verlauf__kopf"><span class="verlauf__art verlauf__art--${esc(v.art)}">${esc(ARTEN[v.art] || "Notiz")}</span>
        <span class="leise">${esc(datumDE(v.datum))}</span></span>
      <span class="verlauf__text">${esc(v.text)}</span>
    </button>`;
  const erste = liste.slice(0, sichtbar), rest = liste.slice(sichtbar);
  return `<div class="verlauf">${erste.map(zeile).join("")}</div>
    ${rest.length ? `<details class="mehr"><summary>${rest.length} ältere anzeigen</summary><div class="verlauf">${rest.map(zeile).join("")}</div></details>` : ""}`;
}
export function verbindeVerlauf(root, { verlauf, nachher }) {
  for (const b of $$("[data-verlauf]", root)) {
    b.addEventListener("click", () => verlaufDialog(verlauf.find((v) => v.id === b.dataset.verlauf), { nachher }));
  }
}

/** Einen Verlaufseintrag von Hand anlegen oder ändern. v: vorhandener Eintrag oder { kontakt_id | mieter_id } */
export async function verlaufDialog(v, { nachher = () => {} } = {}) {
  const neu = !v.id;
  const abgelegt = !neu && v.mieter_id ? await db.ladeAbgelegte("verlauf_id", [v.id]).catch(() => []) : [];
  const daten = await dialogFormular(`
    <h2>${neu ? "Neuer Eintrag" : "Eintrag"}</h2>
    ${abgelegt.length ? `<p>${ablage.abgelegtHtml(abgelegt)}</p>` : ""}
    <div class="formraster formraster--zwei">
      <label class="feld"><span>Art</span><select name="art">${Object.entries(ARTEN).map(([k, t]) => `<option value="${k}" ${k === (v.art || "telefonat") ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      <label class="feld"><span>Datum</span><input type="date" name="datum" required value="${esc(v.datum || heuteISO())}" min="2000-01-01" max="2099-12-31"></label>
    </div>
    <label class="feld"><span>Was wurde besprochen?</span>
      <span class="diktat"><textarea name="text" rows="5" required maxlength="8000">${esc(v.text || "")}</textarea>${mikroKnopf()}</span></label>
    <div class="knopfreihe">
      ${neu ? "" : `<button class="knopf knopf--gefahr knopf--links" value="loeschen" formnovalidate>Löschen</button>`}
      <button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button>
      <button class="knopf knopf--primaer" value="ok">Speichern</button>
    </div>`, { breit: true, vorbereiten: (form) => {
    verbindeDiktat(form);
    for (const b of $$("[data-abgelegt]", form)) {
      b.addEventListener("click", () => {
        $("#dialog").close();
        setTimeout(() => ablage.oeffneDokument(abgelegt.find((x) => x.id === b.dataset.abgelegt), { nachher }), 0);
      });
    }
  } });
  if (!daten) return;
  try {
    if (daten.get("_aktion") === "loeschen") {
      if (!(await frage("Eintrag löschen?", `<p>Der Eintrag vom ${esc(datumDE(v.datum))} wird gelöscht.</p>`, "Löschen", { gefahr: true }))) return;
      await db.loescheVerlauf(v.id);
      melde("Eintrag gelöscht.", "ok");
      return nachher();
    }
    const text = String(daten.get("text") || "").trim();
    if (!text) return melde("Bitte kurz eintragen, was besprochen wurde.", "fehler");
    await db.speichereVerlauf(v.id || null, {
      ...(neu ? { kontakt_id: v.kontakt_id || null, mieter_id: v.mieter_id || null } : {}),
      art: daten.get("art"), datum: daten.get("datum") || heuteISO(), text,
    });
    melde("Gespeichert.", "ok");
    nachher();
  } catch (err) {
    melde(err.message, "fehler");
  }
}

// ---------------------------------------------------------------------------
// Kontakt anlegen oder bearbeiten
// ---------------------------------------------------------------------------
const geburtstagFelder = (k = {}) => `
  <span class="geburtstagsfeld__titel">Geburtstag</span>
  <div class="geburtstagsfeld">
    <label class="feld"><span>Tag</span><input name="g_tag" type="number" min="1" max="31" inputmode="numeric" value="${esc(k.geburtstag_tag || "")}" placeholder="22"></label>
    <label class="feld"><span>Monat</span><select name="g_monat"><option value="">–</option>${MONATE.map((m, i) => `<option value="${i + 1}" ${Number(k.geburtstag_monat) === i + 1 ? "selected" : ""}>${m}</option>`).join("")}</select></label>
    <label class="feld"><span>Jahr</span><input name="g_jahr" type="number" min="1900" max="2100" inputmode="numeric" value="${esc(k.geburtsjahr || "")}" placeholder="optional"></label>
  </div>`;
/** Geburtstag aus dem Formular; { fehler } bei ungültiger Angabe */
function geburtstagAus(daten) {
  const tag = Number(daten.get("g_tag")) || null, monat = Number(daten.get("g_monat")) || null, jahr = Number(daten.get("g_jahr")) || null;
  if (!tag && !monat) return { geburtstag_tag: null, geburtstag_monat: null, geburtsjahr: jahr };
  if (!tag || !monat) return { fehler: "Beim Geburtstag bitte Tag und Monat angeben (oder beides leer lassen)." };
  if (tag > new Date(2000, monat, 0).getDate()) return { fehler: "Diesen Tag gibt es im gewählten Monat nicht." };
  if (jahr && (jahr < 1900 || jahr > Number(heuteISO().slice(0, 4)))) return { fehler: "Das Geburtsjahr stimmt nicht." };
  return { geburtstag_tag: tag, geburtstag_monat: monat, geburtsjahr: jahr };
}

export async function kontaktDialog(k = null, { nachher = () => {}, nachLoeschen = null } = {}) {
  k = k || {};
  const neu = !k.id;
  const daten = await dialogFormular(`
    <h2>${neu ? "Neuer Kontakt" : esc(kontaktName(k))}</h2>
    <div class="formraster formraster--zwei">
      <label class="feld"><span>Vorname</span><input name="vorname" maxlength="60" value="${esc(k.vorname || "")}" autocomplete="off"></label>
      <label class="feld"><span>Nachname</span><input name="nachname" maxlength="80" value="${esc(k.nachname || "")}" autocomplete="off"></label>
      <label class="feld"><span>Firma / Stelle</span><input name="firma" maxlength="120" value="${esc(k.firma || "")}" placeholder="z. B. Sparkasse Musterstadt"></label>
      <label class="feld"><span>Rolle</span><input name="rolle" list="rollen" maxlength="40" value="${esc(k.rolle || "")}" placeholder="z. B. Makler"></label>
      <label class="feld"><span>Telefon</span><input name="telefon" type="tel" maxlength="40" value="${esc(k.telefon || "")}"></label>
      <label class="feld"><span>E-Mail</span><input name="email" type="email" maxlength="120" value="${esc(k.email || "")}"></label>
    </div>
    <datalist id="rollen">${ROLLEN.map((r) => `<option value="${esc(r)}">`).join("")}</datalist>
    <label class="feld"><span>Adresse (optional)</span><input name="adresse" maxlength="200" value="${esc(k.adresse || "")}"></label>
    ${geburtstagFelder(k)}
    <p class="feldhinweis feldhinweis--leise">Mit Geburtstag erinnert die App jedes Jahr in „Zu erledigen“ daran.</p>
    <label class="feld"><span>Gut zu wissen (z. B. Familie, Hobbys)</span><textarea name="notiz" rows="3" maxlength="2000">${esc(k.notiz || "")}</textarea></label>
    <p class="oz-fehler" data-fehler role="alert" hidden></p>
    <div class="knopfreihe">
      ${neu ? "" : `<button class="knopf knopf--gefahr knopf--links" value="loeschen" formnovalidate>Löschen</button>`}
      <button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button>
      <button class="knopf knopf--primaer" value="ok">Speichern</button>
    </div>`, { breit: true, vorbereiten: (form) => {
    form.addEventListener("submit", (e) => {
      if (e.submitter?.value !== "ok") return;
      const f = new FormData(form);
      const fehler = !String(f.get("nachname") || "").trim() && !String(f.get("firma") || "").trim()
        ? "Bitte einen Nachnamen oder eine Firma eintragen." : geburtstagAus(f).fehler || "";
      $("[data-fehler]", form).textContent = fehler;
      $("[data-fehler]", form).hidden = !fehler;
      if (fehler) e.preventDefault();
    });
  } });
  if (!daten) return;
  try {
    if (daten.get("_aktion") === "loeschen") {
      if (!(await frage("Kontakt löschen?", `<p>„${esc(kontaktName(k))}“ und der ganze Verlauf werden gelöscht. To-dos bleiben, aber ohne Kontakt.</p>`, "Löschen", { gefahr: true }))) return;
      await db.loescheKontakt(k.id);
      await kontakteListe(true);
      melde("Kontakt gelöscht.", "ok");
      return (nachLoeschen || nachher)();
    }
    const t = (n) => String(daten.get(n) || "").trim() || null;
    const g = geburtstagAus(daten);
    const felder = {
      vorname: t("vorname"), nachname: t("nachname"), firma: t("firma"), rolle: t("rolle"),
      telefon: t("telefon"), email: t("email"), adresse: t("adresse"), notiz: t("notiz"),
      geburtstag_tag: g.geburtstag_tag, geburtstag_monat: g.geburtstag_monat, geburtsjahr: g.geburtsjahr,
    };
    const gespeichert = await db.speichereKontakt(k.id || null, felder);
    await kontakteListe(true);
    melde(neu ? "Kontakt angelegt." : "Gespeichert.", "ok");
    nachher(gespeichert);
  } catch (err) {
    melde(err.message, "fehler");
  }
}

// ---------------------------------------------------------------------------
// Notiz einsprechen → KI-Vorschlag → prüfen und speichern
// kontaktId / mieterId: von wo aus gestartet (Vorauswahl und Hinweis für die KI)
// ---------------------------------------------------------------------------
export async function notizEinsprechen({ kontaktId = null, mieterId = null } = {}) {
  const kiDa = !!zustand.ki?.ki;
  const eingabe = await dialogFormular(`
    <h2>Notiz einsprechen</h2>
    <p class="leise">Einfach erzählen, mit wem was besprochen wurde. ${kiDa ? "Die KI ordnet es dem Kontakt oder der Mietpartei zu, schlägt To-dos vor und merkt sich Geburtstage. Gespeichert wird erst nach dem Prüfen." : "Danach Kontakt und Details auswählen."}</p>
    <label class="feld"><span>Was ist passiert?</span>
      <span class="diktat"><textarea name="text" rows="7" required maxlength="6000"
        placeholder="z. B. Mit Mieterin Huber vereinbart, dass die Kaution in 3 Raten bezahlt wird. Telefonat von heute. Bitte in der Mietakte ablegen."></textarea>${mikroKnopf()}</span></label>
    <div class="knopfreihe">
      <button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button>
      <button class="knopf knopf--primaer" value="ok">${kiDa ? "Weiter mit KI" : "Weiter"}</button>
    </div>`, { breit: true, vorbereiten: (form) => verbindeDiktat(form) });
  if (!eingabe) return;
  const text = String(eingabe.get("text") || "").trim();
  if (!text) return;

  let v = null;
  if (kiDa) {
    const warte = wartehinweis("Die KI ordnet die Notiz zu …");
    try {
      v = await db.funktion("ki", { aktion: "notiz_lesen", text, kontakt_id: kontaktId, mieter_id: mieterId });
      v.vonKi = true;
    } catch (err) {
      melde("Die KI konnte nicht helfen: " + err.message, "fehler");
    } finally {
      await warte.ende();
    }
  }
  v = v || {
    ziel: kontaktId ? "kontakt" : mieterId ? "mieter" : "keiner", kontakt_id: kontaktId, mieter_id: mieterId, neuer_kontakt: null,
    art: "telefonat", datum: heuteISO(), notiz: text, kontakt_info: null, geburtstag: null, aufgaben: [], ablegen: false, vonKi: false,
  };
  return notizPruefen(v, text);
}

async function notizPruefen(v, original) {
  const [mieterL, kontakteL] = await Promise.all([mieterListe(), kontakteListe()]);
  const startWert = v.ziel === "mieter" && v.mieter_id ? `m:${v.mieter_id}` : v.ziel === "kontakt" && v.kontakt_id ? `k:${v.kontakt_id}` : v.ziel === "neuer_kontakt" ? "neu" : "";
  const nk = v.neuer_kontakt || {};
  const aufgabeZeile = (a = {}) => `
    <div class="aufgabenzeile">
      <input type="checkbox" name="a_an" ${a.titel ? "checked" : ""} aria-label="To-do anlegen">
      <input name="a_titel" maxlength="200" value="${esc(a.titel || "")}" placeholder="To-do, z. B. Zweite Rate prüfen" aria-label="To-do">
      <input type="date" name="a_datum" value="${esc(a.faellig_am || "")}" min="2020-01-01" max="2099-12-31" aria-label="Fällig am">
    </div>`;
  const sortName = (a, b) => norm(a.nachname || a.firma).localeCompare(norm(b.nachname || b.firma), "de");
  let vorschlag = null; // Name in der Ablage (nur bei Mietparteien)
  let aufgaben = [];     // angehakte To-dos, beim Absenden aus dem Dialog gelesen

  const daten = await dialogFormular(`
    <h2>Notiz speichern</h2>
    <p class="leise">${v.vonKi ? "Vorschlag der KI. Bitte kurz prüfen, dann speichern." : "Bitte Kontakt oder Mietpartei wählen und prüfen."}</p>
    <label class="feld"><span>Gehört zu</span>
      <select name="ziel" required>
        <option value="" ${startWert ? "" : "selected"} disabled>Bitte wählen …</option>
        <option value="neu" ${startWert === "neu" ? "selected" : ""}>+ Neuer Kontakt</option>
        <optgroup label="Kontakte">${[...kontakteL].sort(sortName).map((k) => `<option value="k:${esc(k.id)}" ${startWert === `k:${k.id}` ? "selected" : ""}>${esc(kontaktName(k))}${k.firma && (k.vorname || k.nachname) ? ` (${esc(k.firma)})` : ""}</option>`).join("")}</optgroup>
        <optgroup label="Mietparteien">${mieterL.map((m) => {
          const w = wohnungVon(m.wohnung_id);
          return `<option value="m:${esc(m.id)}" ${startWert === `m:${m.id}` ? "selected" : ""}>${esc(mieterName(m))}${w ? ` (${esc(w.bezeichnung)})` : ""}</option>`;
        }).join("")}</optgroup>
      </select></label>
    <fieldset class="gruppe" data-teil="neu">
      <legend>Neuer Kontakt</legend>
      <div class="formraster formraster--zwei">
        <label class="feld"><span>Vorname</span><input name="vorname" maxlength="60" value="${esc(nk.vorname || "")}"></label>
        <label class="feld"><span>Nachname</span><input name="nachname" maxlength="80" value="${esc(nk.nachname || "")}"></label>
        <label class="feld"><span>Firma / Stelle</span><input name="firma" maxlength="120" value="${esc(nk.firma || "")}"></label>
        <label class="feld"><span>Rolle</span><input name="rolle" list="rollen" maxlength="40" value="${esc(nk.rolle || "")}"></label>
        <label class="feld"><span>Telefon</span><input name="telefon" type="tel" maxlength="40" value="${esc(nk.telefon || "")}"></label>
        <label class="feld"><span>E-Mail</span><input name="email" type="email" maxlength="120" value="${esc(nk.email || "")}"></label>
      </div>
      <datalist id="rollen">${ROLLEN.map((r) => `<option value="${esc(r)}">`).join("")}</datalist>
    </fieldset>
    <div class="formraster formraster--zwei">
      <label class="feld"><span>Art</span><select name="art">${Object.entries(ARTEN).map(([k, t]) => `<option value="${k}" ${k === v.art ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      <label class="feld"><span>Datum</span><input type="date" name="datum" required value="${esc(v.datum || heuteISO())}" min="2000-01-01" max="2099-12-31"></label>
    </div>
    <label class="feld"><span>Notiz für den Verlauf</span>
      <span class="diktat"><textarea name="text" rows="4" required maxlength="8000">${esc(v.notiz || original)}</textarea>${mikroKnopf()}</span></label>
    <fieldset class="gruppe" data-teil="kontakt">
      <legend>Für die Kontaktkarte</legend>
      ${geburtstagFelder({ geburtstag_tag: v.geburtstag?.tag, geburtstag_monat: v.geburtstag?.monat, geburtsjahr: v.geburtstag?.jahr })}
      <p class="feldhinweis feldhinweis--leise" data-geburtstag-info>${v.geburtstag ? "Geburtstag aus der Notiz erkannt: Die App erinnert jedes Jahr daran." : "Leer lassen, wenn kein Geburtstag genannt wurde."}</p>
      <label class="feld"><span>Gut zu wissen (wird beim Kontakt ergänzt)</span><textarea name="kontakt_info" rows="2" maxlength="300">${esc(v.kontakt_info || "")}</textarea></label>
    </fieldset>
    <fieldset class="gruppe">
      <legend>To-dos</legend>
      <div data-aufgaben>${(v.aufgaben || []).map(aufgabeZeile).join("")}${(v.aufgaben || []).length ? "" : aufgabeZeile()}</div>
      <button type="button" class="knopf knopf--klein" data-aufgabe-mehr>${ICON_PLUS} Weiteres To-do</button>
    </fieldset>
    <div data-teil="mieter">${ablage.ablageBlockHtml({ titel: "Auch als PDF in die Mietakte (Ablage)" })}</div>
    <p class="oz-fehler" data-fehler role="alert" hidden></p>
    <div class="knopfreihe">
      <button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button>
      <button class="knopf knopf--primaer" value="ok">Speichern</button>
    </div>`, {
    breit: true,
    vorbereiten: (form) => {
      verbindeDiktat(form);
      const ablageAn = $("[name=ablage_an]", form);
      if (ablageAn) ablageAn.checked = !!v.ablegen;
      // Name in der Ablage: neu berechnen, wenn eine andere Mietpartei gewählt wird (außer von Hand geändert)
      const ablageName = $("[name=ablage_titel]", form);
      let nameVonHand = false;
      ablageName?.addEventListener("input", () => { nameVonHand = true; });
      const nameFuer = (mieterId) => {
        if (!ablageName) return;
        const m = mieterL.find((x) => x.id === mieterId);
        if (!m) return;
        vorschlag = ablage.nameVorschlag(eintragVerlauf({ id: null, art: form.art.value, datum: form.datum.value, text: form.text.value }, m));
        vorschlag.then((r) => {
          if (!nameVonHand) ablageName.value = r.titel;
          const info = $("[data-ablage-info]", form);
          if (info) info.textContent = `Ordner: ${ablage.ordnerAnzeige(r.ordner)}${r.vonKi ? " · Vorschlag der KI, änderbar" : ""}`;
        }).catch(() => {});
      };
      const zeige = () => {
        const wahl = form.ziel.value;
        const teil = wahl === "neu" ? "neu" : wahl.startsWith("k:") ? "kontakt" : wahl.startsWith("m:") ? "mieter" : "";
        for (const el of $$("[data-teil]", form)) {
          const sichtbar = el.dataset.teil === teil || (el.dataset.teil === "kontakt" && teil === "neu");
          el.hidden = !sichtbar;
          if (el.tagName === "FIELDSET") el.disabled = !sichtbar;
        }
        if (teil === "mieter" && !nameVonHand) nameFuer(wahl.slice(2));
      };
      form.ziel.addEventListener("change", zeige);
      zeige();
      $("[data-aufgabe-mehr]", form).addEventListener("click", () => {
        $("[data-aufgaben]", form).insertAdjacentHTML("beforeend", aufgabeZeile());
        $$("[name=a_titel]", form).at(-1).focus();
      });
      // Häkchen setzt sich beim Tippen eines To-dos von selbst
      $("[data-aufgaben]", form).addEventListener("input", (e) => {
        if (e.target.name === "a_titel") e.target.closest(".aufgabenzeile").querySelector("[name=a_an]").checked = !!e.target.value.trim();
      });
      form.addEventListener("submit", (e) => {
        if (e.submitter?.value !== "ok") return;
        const f = new FormData(form);
        let fehler = "";
        if (!f.get("ziel")) fehler = "Bitte wählen, zu wem die Notiz gehört.";
        else if (f.get("ziel") === "neu" && !String(f.get("nachname") || "").trim() && !String(f.get("firma") || "").trim()) fehler = "Für den neuen Kontakt bitte Nachname oder Firma eintragen.";
        else if (!String(f.get("text") || "").trim()) fehler = "Die Notiz ist leer.";
        else if (f.get("ziel") !== "" && !String(f.get("ziel")).startsWith("m:")) fehler = geburtstagAus(f).fehler || "";
        $("[data-fehler]", form).textContent = fehler;
        $("[data-fehler]", form).hidden = !fehler;
        if (fehler) return e.preventDefault();
        aufgaben = $$(".aufgabenzeile", form)
          .map((z) => ({ an: z.querySelector("[name=a_an]").checked, titel: z.querySelector("[name=a_titel]").value.trim(), faellig_am: z.querySelector("[name=a_datum]").value || null }))
          .filter((a) => a.an && a.titel).map(({ titel, faellig_am }) => ({ titel, faellig_am }));
      });
    },
  });
  if (!daten) return;
  return speichereNotiz(daten, { mieterL, vorschlag, aufgaben });
}

async function speichereNotiz(daten, { mieterL, vorschlag, aufgaben }) {
  const ziel = String(daten.get("ziel"));
  const t = (n) => String(daten.get(n) || "").trim() || null;
  const text = t("text");
  const art = daten.get("art") || "notiz";
  const datum = daten.get("datum") || heuteISO();
  const warte = wartehinweis("Wird gespeichert …");
  let ziel_href = null, wer = "", erledigt = [];
  try {
    let kontaktId = null, mieterId = null;
    if (ziel === "neu" || ziel.startsWith("k:")) {
      const g = geburtstagAus(daten);
      const info = t("kontakt_info");
      if (ziel === "neu") {
        const k = await db.speichereKontakt(null, {
          vorname: t("vorname"), nachname: t("nachname"), firma: t("firma"), rolle: t("rolle"), telefon: t("telefon"), email: t("email"),
          notiz: info, geburtstag_tag: g.geburtstag_tag, geburtstag_monat: g.geburtstag_monat, geburtsjahr: g.geburtsjahr,
        });
        kontaktId = k.id;
        wer = kontaktName(k);
        erledigt.push("Kontakt angelegt");
      } else {
        kontaktId = ziel.slice(2);
        const k = await db.ladeKontakt(kontaktId);
        wer = kontaktName(k);
        const felder = {};
        if (g.geburtstag_tag && (g.geburtstag_tag !== k.geburtstag_tag || g.geburtstag_monat !== k.geburtstag_monat || (g.geburtsjahr && g.geburtsjahr !== k.geburtsjahr))) {
          Object.assign(felder, { geburtstag_tag: g.geburtstag_tag, geburtstag_monat: g.geburtstag_monat, geburtsjahr: g.geburtsjahr || k.geburtsjahr || null });
        }
        if (info && !norm(k.notiz || "").includes(norm(info))) felder.notiz = [k.notiz, info].filter(Boolean).join("\n");
        if (Object.keys(felder).length) await db.speichereKontakt(kontaktId, felder);
      }
      if (g.geburtstag_tag) erledigt.push(`Geburtstag ${g.geburtstag_tag}.${g.geburtstag_monat}.`);
      ziel_href = `#/kontakt/${kontaktId}`;
    } else {
      mieterId = ziel.slice(2);
      const m = mieterL.find((x) => x.id === mieterId);
      wer = m ? mieterName(m) : "Mietpartei";
      ziel_href = `#/mieter/${mieterId}`;
    }
    const eintrag = await db.speichereVerlauf(null, { kontakt_id: kontaktId, mieter_id: mieterId, art, datum, text });
    const m = mieterId ? mieterL.find((x) => x.id === mieterId) : null;
    const objektId = m ? wohnungVon(m.wohnung_id)?.objekt_id || null : null;
    for (const a of aufgaben) {
      await db.speichereAufgabe(null, { titel: a.titel, faellig_am: a.faellig_am, kontakt_id: kontaktId, mieter_id: mieterId, objekt_id: objektId });
    }
    if (aufgaben.length) erledigt.push(aufgaben.length === 1 ? "1 To-do" : `${aufgaben.length} To-dos`);
    await kontakteListe(true);
    // Mietpartei: auf Wunsch zusätzlich als PDF in die Ablage (Name wie im Dialog gezeigt)
    if (m && daten.get("ablage_an")) {
      const doc = await ablage.automatischAblegen(eintragVerlauf(eintrag, m), {
        meldung: false, vorgabe: ablage.ablageVorgabe(daten, vorschlag),
      });
      if (doc) erledigt.push(`abgelegt in „${ablage.ordnerAnzeige(doc.ordner)}“`);
    }
  } catch (err) {
    await warte.ende();
    return melde(err.message, "fehler");
  }
  await warte.ende();
  melde(`Gespeichert bei ${wer}${erledigt.length ? ": " + erledigt.join(", ") : ""}.`, "ok", { dauer: 8000 });
  geheZu(ziel_href);
}

/** Verlaufseintrag einer Mietpartei als PDF für die Ablage */
export function eintragVerlauf(v, m) {
  const w = wohnungVon(m.wohnung_id);
  const haus = w ? objektVon(w.objekt_id) : null;
  const artName = ARTEN[v.art] || "Notiz";
  return {
    quelle: { verlauf_id: v.id || null },
    richtung: "notiz",
    art: "Notiz", artFest: true,
    datum: v.datum || heuteISO(),
    objektId: haus?.id || null,
    mieterId: m.id,
    gegenueber: mieterName(m),
    gegenueberKurz: m.nachname || null,
    kiText: { titel: `${artName} mit ${mieterName(m)}`, text: v.text || "" },
    zusammenfassung: kurz(v.text || "", 200),
    beschreibung: "Die Notiz wird als PDF abgelegt.",
    datei: ablage.pdfEintrag({
      titel: `${artName} vom ${datumDE(v.datum || heuteISO())}`,
      angaben: [["Datum", datumDE(v.datum || heuteISO())], ["Art", artName], ["Mietpartei", mieterName(m)],
        ["Wohnung", [haus?.bezeichnung, w?.bezeichnung].filter(Boolean).join(", ")]],
      text: v.text || "",
    }),
  };
}
