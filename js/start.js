// Übersicht als priorisierte To-do-Liste, Seiten je Haus, Notizen mit Wiedervorlage
// Grundsatz: Die KI schlägt nur vor (Antwort, Datum). Gespeichert wird erst per Klick.
import * as db from "./daten.js";
import { euro, datumDE, mieterName } from "./dokumente.js";
import { $, $$, esc, melde, dialogFormular, frage, heuteISO, zustand, objektVon, wohnungVon } from "./helfer.js";
import {
  ICON_KI, ICON_KAMERA, kurz, norm, geheZu, mieterListe, mieterOptionen, mikroKnopf, verbindeDiktat, wartehinweis,
} from "./ui.js";
import { letzteMonate, mieterZeile, LEGENDE, naechsterSchritt, schreibenKachel, oeffneSchreiben } from "./bausteine.js";
import * as ablage from "./ablage.js";

const inhalt = () => $("#inhalt");
const ICON_PLUS = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>`;
const ICON_HAKEN = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M9.5 16.2 5.3 12l-1.4 1.4 5.6 5.6L20.1 8.4 18.7 7z"/></svg>`;
const SICHTBAR = 8; // so viele Punkte zeigt die Liste zuerst

// --- Datum ---------------------------------------------------------------------
const tag = (iso) => new Date(String(iso).slice(0, 10) + "T12:00:00");
const tageBis = (iso, heute = heuteISO()) => Math.round((tag(iso) - tag(heute)) / 86400000);
const plusTage = (iso, n) => {
  const d = tag(iso);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const kurzDatum = (iso) => `${String(iso).slice(8, 10)}.${String(iso).slice(5, 7)}.`;
function wannText(iso) {
  const t = tageBis(iso);
  if (t === 0) return "heute";
  if (t === 1) return "morgen";
  if (t === -1) return "gestern";
  if (t < 0) return `seit ${-t} Tagen`;
  if (t <= 6) return `in ${t} Tagen`;
  return kurzDatum(iso);
}
/** Frist einer Nachricht: bestätigt (von Robert) oder von der KI erkannt */
export const fristVon = (n) => (n.frist_bestaetigt ? n.frist : n.frist || n.ki_frist) || null;

// ---------------------------------------------------------------------------
// Was ist zu tun? Alles aus Nachrichten, Notizen, Rückständen und Entwürfen, nach Dringlichkeit
// ---------------------------------------------------------------------------
// stufe 0 = überfällig/sehr knapp, 1 = bald/dringend, 2 = normal, 3 = wenn Zeit ist
function sammle({ nachrichten = [], aufgaben = [], rueckstand = [], vorgaenge = [], entwuerfe = [], namen = {} }) {
  const heute = heuteISO();
  const jetzt = [], spaeter = [];
  const stufeFuer = (iso) => { const t = tageBis(iso); return t <= 3 ? 0 : t <= 7 ? 1 : 2; };

  for (const n of nachrichten) {
    const wer = (n.mieter_id && namen[n.mieter_id]) || n.absender_name || n.absender_email || "Unbekannt";
    const amt = n.ki_kategorie === "Amt/Jobcenter";
    const frist = fristVon(n);
    const marken = [
      amt ? `<span class="marker marker--messing">Amt/Jobcenter</span>` : "",
      n.ki_dringlichkeit === "hoch" ? `<span class="marker marker--offen">dringend</span>` : "",
      n.status === "neu" ? `<span class="marker marker--neu">neu</span>` : "",
    ].join("");
    if (frist) {
      jetzt.push({
        art: "Frist", stufe: stufeFuer(frist), datum: frist, href: `#/postfach/${n.id}`,
        titel: n.betreff || "(ohne Betreff)", unter: wer, marken,
        wann: `Frist ${kurzDatum(frist)}`, wannNot: tageBis(frist) <= 3,
        hinweis: n.frist_bestaetigt ? "" : "von der KI erkannt, bitte prüfen",
      });
    } else {
      jetzt.push({
        art: "Nachricht", stufe: n.ki_dringlichkeit === "hoch" ? 1 : n.status === "neu" ? 2 : 3,
        datum: String(n.eingang_am).slice(0, 10), href: `#/postfach/${n.id}`,
        titel: n.betreff || "(ohne Betreff)", unter: [wer, n.ki_zusammenfassung ? kurz(n.ki_zusammenfassung, 110) : ""].filter(Boolean).join(" · "),
        marken, wann: tageBis(String(n.eingang_am).slice(0, 10)) === 0 ? "heute" : kurzDatum(String(n.eingang_am).slice(0, 10)),
      });
    }
  }

  for (const a of aufgaben) {
    const bezug = a.mieter_id ? namen[a.mieter_id] : a.objekt_id ? objektVon(a.objekt_id)?.bezeichnung : "";
    const eintrag = {
      art: a.faellig_am ? "Wiedervorlage" : "Notiz", aufgabe: a, titel: a.titel,
      unter: [bezug, a.antwort ? "KI-Antwort liegt vor" : ""].filter(Boolean).join(" · "),
      marken: "",
    };
    if (!a.faellig_am) {
      jetzt.push({ ...eintrag, stufe: 3, datum: String(a.erstellt_am).slice(0, 10), wann: "" });
      continue;
    }
    const ab = plusTage(a.faellig_am, -(a.vorlauf_tage ?? 7));
    const x = { ...eintrag, datum: a.faellig_am, wann: wannText(a.faellig_am), wannNot: tageBis(a.faellig_am) <= 1 };
    if (ab <= heute) jetzt.push({ ...x, stufe: stufeFuer(a.faellig_am) });
    else spaeter.push({ ...x, stufe: 3, wann: kurzDatum(a.faellig_am), unter: [x.unter, `erscheint ab ${datumDE(ab)}`].filter(Boolean).join(" · ") });
  }

  // Mahnung fällig: Rückstand und seit 14 Tagen kein Schreiben dazu
  const mahnTypen = ["mahnung_1", "mahnung_2", "nachweis_jobcenter"];
  for (const m of rueckstand) {
    const letzte = vorgaenge.filter((v) => v.mieter_id === m.id && mahnTypen.includes(v.typ)).map((v) => v.erstellt_am).sort().pop();
    if (letzte && tageBis(String(letzte).slice(0, 10)) > -14) continue;
    jetzt.push({
      art: "Rückstand", stufe: 2, datum: m.aeltester_offener_monat || heute, href: `#/mieter/${m.id}`,
      titel: `${mieterName(m)}: ${euro(m.offen_summe)} offen`,
      unter: `Als Nächstes: ${naechsterSchritt(m, vorgaenge)}`,
      marken: m.kostentraeger ? `<span class="marker marker--messing">${esc(m.kostentraeger)}</span>` : "", wann: "",
    });
  }

  for (const a of entwuerfe) {
    jetzt.push({
      art: a.art === "auftrag" ? "Auftrag" : "Entwurf", stufe: 3, datum: String(a.aktualisiert_am || a.erstellt_am).slice(0, 10),
      href: a.nachricht_id ? `#/postfach/${a.nachricht_id}` : `#/entwurf/${a.id}`,
      titel: a.betreff || "(ohne Betreff)", unter: a.art === "auftrag" ? `an ${a.empfaenger_name || "Handwerker"}, noch nicht gesendet` : "liegt bereit, noch nicht gesendet",
      marken: "", wann: "",
    });
  }

  const ordnen = (x, y) => x.stufe - y.stufe || String(x.datum).localeCompare(String(y.datum));
  return { jetzt: jetzt.sort(ordnen), spaeter: spaeter.sort(ordnen) };
}

function todoZeile(t) {
  const kopf = `
      <span class="todo__art">${esc(t.art)}</span>
      <span class="todo__titel">${esc(t.titel)}</span>
      ${t.unter || t.marken || t.hinweis ? `<span class="todo__unter">${t.marken}${t.unter ? `<span>${esc(t.unter)}</span>` : ""}${t.hinweis ? `<em>${esc(t.hinweis)}</em>` : ""}</span>` : ""}`;
  const haupt = t.aufgabe
    ? `<button type="button" class="todo__haupt" data-aufgabe="${esc(t.aufgabe.id)}">${kopf}</button>`
    : `<a class="todo__haupt" href="${esc(t.href)}">${kopf}</a>`;
  return `
    <div class="todo todo--s${t.stufe}">
      ${haupt}
      <span class="todo__wann ${t.wannNot ? "todo__wann--not" : ""}">${esc(t.wann || "")}</span>
      ${t.aufgabe ? `<button type="button" class="todo__haken" data-erledigt="${esc(t.aufgabe.id)}" title="Erledigt" aria-label="Erledigt: ${esc(t.titel)}">${ICON_HAKEN}</button>` : `<span class="todo__haken todo__haken--leer" aria-hidden="true"></span>`}
    </div>`;
}

function todoListe({ jetzt, spaeter }, { leer = "Nichts zu tun. Schön!" } = {}) {
  const erste = jetzt.slice(0, SICHTBAR), rest = jetzt.slice(SICHTBAR);
  return `
    ${jetzt.length ? `<div class="todos">${erste.map(todoZeile).join("")}</div>` : `<div class="leer">${esc(leer)}</div>`}
    ${rest.length ? `<details class="mehr"><summary>${rest.length} weitere anzeigen</summary><div class="todos">${rest.map(todoZeile).join("")}</div></details>` : ""}
    ${spaeter.length ? `<details class="mehr"><summary>Später (${spaeter.length} Wiedervorlagen)</summary><div class="todos">${spaeter.map(todoZeile).join("")}</div></details>` : ""}`;
}

function verbindeTodos(root, { aufgaben, nachher }) {
  for (const b of $$("[data-aufgabe]", root)) {
    b.addEventListener("click", () => aufgabeDialog(aufgaben.find((a) => a.id === b.dataset.aufgabe), { nachher }));
  }
  for (const b of $$("[data-erledigt]", root)) {
    b.addEventListener("click", async () => {
      b.disabled = true;
      try {
        await db.speichereAufgabe(b.dataset.erledigt, { status: "erledigt", erledigt_am: new Date().toISOString() });
        melde("Erledigt.", "ok");
        nachher();
      } catch (err) {
        b.disabled = false;
        melde(err.message, "fehler");
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Übersicht
// ---------------------------------------------------------------------------
export async function zeigeStart() {
  const monate = letzteMonate(4);
  const [liste, forderungen, vorgaenge, nachrichten, aufgaben, antworten, mieterL] = await Promise.all([
    db.ladeUebersicht(),
    db.ladeForderungen({ abMonat: monate[0] }),
    db.ladeVorgaenge({ anzahl: 200 }),
    db.ladeNachrichten({ status: ["neu", "offen"], anzahl: 100 }).catch(() => []),
    db.ladeAufgaben().catch(() => []),
    db.ladeAntworten({ anzahl: 50 }).catch(() => []),
    mieterListe(),
  ]);
  const namen = Object.fromEntries(mieterL.map((m) => [m.id, mieterName(m)]));
  const rueckstand = liste.filter((m) => Number(m.offen_summe) > 0).sort((a, b) => b.offen_summe - a.offen_summe);
  const gesamt = rueckstand.reduce((s, m) => s + Number(m.offen_summe), 0);
  const entwuerfe = antworten.filter((a) => a.status === "entwurf");
  const todos = sammle({ nachrichten, aufgaben, rueckstand, vorgaenge, entwuerfe, namen });
  const dringend = todos.jetzt.filter((t) => t.stufe <= 1).length;
  const neu = nachrichten.filter((n) => n.status === "neu").length;
  const nachName = Object.fromEntries(liste.map((m) => [m.id, m]));

  // Häuser mit offenen Punkten
  const haeuser = zustand.stamm.objekte.map((o) => {
    const leute = liste.filter((m) => m.objekt_id === o.id);
    const ids = new Set(leute.map((m) => m.id));
    const offen = leute.reduce((s, m) => s + Number(m.offen_summe || 0), 0);
    const punkte = todos.jetzt.filter((t) =>
      (t.aufgabe && (t.aufgabe.objekt_id === o.id || ids.has(t.aufgabe.mieter_id))) ||
      (t.href && [...ids].some((id) => t.href === `#/mieter/${id}`)) ||
      nachrichten.some((n) => ids.has(n.mieter_id) && t.href === `#/postfach/${n.id}`)).length;
    return { o, leute: leute.length, offen, punkte };
  });

  inhalt().innerHTML = `
    <div class="kopf">
      <div><h1>Übersicht</h1><p>${esc(zustand.profil?.firma || "")}, ${datumDE(new Date())}</p></div>
      <div class="knopfreihe">
        <button type="button" class="knopf knopf--primaer" id="notiz-neu">${ICON_PLUS} Notiz</button>
        <label class="knopf">${ICON_KAMERA} Foto / Datei<input type="file" accept="image/*,application/pdf,.docx,.xlsx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" id="erfassen" multiple hidden></label>
      </div>
    </div>
    <div class="lage lage--kompakt">
      <div><div class="lage__wert ${dringend ? "lage__wert--offen" : ""}">${todos.jetzt.length}</div>
        <div class="lage__text">zu erledigen${dringend ? `, ${dringend} davon eilig` : ""}</div></div>
      <a href="#/postfach"><div class="lage__wert">${neu}</div><div class="lage__text">neue Nachrichten</div></a>
      <div><div class="lage__wert ${gesamt > 0 ? "lage__wert--offen" : ""}">${euro(gesamt)}</div>
        <div class="lage__text">Mietrückstand, ${rueckstand.length} von ${liste.length} Mietparteien</div></div>
    </div>

    <div class="start">
      <section class="flaeche start__liste" id="zu-erledigen">
        <div class="flaeche__kopf"><h2>Zu erledigen</h2><span class="leise">das Dringendste zuerst</span></div>
        ${todoListe(todos)}
      </section>

      <div class="stapel">
        <section class="flaeche">
          <div class="flaeche__kopf"><h2>Häuser</h2></div>
          <div class="haeuser">
            ${haeuser.map(({ o, leute, offen, punkte }) => `
              <a class="haus" href="#/objekt/${esc(o.id)}">
                <span class="haus__name">${esc(o.bezeichnung)}</span>
                <span class="leise">${esc([o.strasse, o.ort].filter(Boolean).join(", "))}</span>
                <span class="haus__zahlen">
                  <span>${leute} Mietparteien</span>
                  ${punkte ? `<span class="marker">${punkte} zu erledigen</span>` : ""}
                  ${offen > 0 ? `<span class="marker marker--offen">${euro(offen)} offen</span>` : ""}
                </span>
              </a>`).join("")}
            <a class="haus haus--allgemein" href="#/objekt/allgemein">
              <span class="haus__name">Allgemein</span>
              <span class="leise">Unterlagen und Wissen, die zu keinem Haus gehören</span>
            </a>
          </div>
        </section>

        <details class="flaeche ausklapp">
          <summary>Mietrückstände (${rueckstand.length})</summary>
          ${LEGENDE.replace('class="mietbuch-legende"', 'class="mietbuch-legende mietbuch-legende--innen"')}
          ${rueckstand.length
            ? `<div class="zeilen">${rueckstand.map((m) => mieterZeile(m, forderungen, monate,
                `<span class="zeile__schritt">Als Nächstes: ${esc(naechsterSchritt(m, vorgaenge))}</span>`, true)).join("")}</div>`
            : `<div class="leer">Alle Mieten sind bezahlt.</div>`}
        </details>

        <details class="flaeche ausklapp">
          <summary>Zuletzt erstellte Schreiben</summary>
          ${vorgaenge.length
            ? `<div class="kacheln kacheln--eng">${vorgaenge.slice(0, 6).map((v) => schreibenKachel(v, mieterName(nachName[v.mieter_id] || { nachname: "?" }))).join("")}</div>`
            : `<div class="leer">Noch keine Schreiben erstellt.</div>`}
        </details>
      </div>
    </div>`;

  verbindeTodos(inhalt(), { aufgaben, nachher: zeigeStart });
  $("#notiz-neu").addEventListener("click", () => aufgabeDialog(null, { nachher: zeigeStart }));
  $("#erfassen").addEventListener("change", (e) => { const d = [...e.target.files]; e.target.value = ""; ablage.erfasseAlle(d); });
  for (const b of $$("[data-schreiben]", inhalt())) {
    b.addEventListener("click", async () => {
      const v = vorgaenge.find((x) => x.id === b.dataset.schreiben);
      const m = v && (await db.ladeMieter(v.mieter_id).catch(() => null));
      oeffneSchreiben(v, m);
    });
  }
}

// ---------------------------------------------------------------------------
// Seite eines Hauses (oder „Allgemein“): Zu erledigen, Mietparteien, Dokumente, Wissen, Handwerker
// ---------------------------------------------------------------------------
export async function zeigeObjekt(id) {
  const allgemein = id === "allgemein";
  const o = allgemein ? null : objektVon(id);
  if (!allgemein && !o) throw new Error("Dieses Haus gibt es nicht (mehr).");
  const objektId = allgemein ? null : o.id;
  const monate = letzteMonate(6);
  const [liste, forderungen, vorgaenge, nachrichten, aufgaben, antworten, dokumente, wissen, dienstleister, mieterL] = await Promise.all([
    ablage.ordnerListe().then(() => db.ladeUebersicht()),
    allgemein ? [] : db.ladeForderungen({ abMonat: monate[0] }),
    db.ladeVorgaenge({ anzahl: 200 }),
    db.ladeNachrichten({ status: ["neu", "offen"], anzahl: 100 }).catch(() => []),
    db.ladeAufgaben().catch(() => []),
    db.ladeAntworten({ anzahl: 50 }).catch(() => []),
    db.ladeDokumente({ objektId }).catch(() => []),
    db.ladeWissen().catch(() => []),
    db.ladeDienstleister().catch(() => []),
    mieterListe(),
  ]);
  const namen = Object.fromEntries(mieterL.map((m) => [m.id, mieterName(m)]));
  const leute = allgemein ? [] : liste.filter((m) => m.objekt_id === o.id);
  const ids = new Set(leute.map((m) => m.id));
  const gehoertHierher = (x) => (allgemein ? !x.mieter_id && !x.objekt_id : x.objekt_id === o.id || ids.has(x.mieter_id));
  const todos = sammle({
    nachrichten: nachrichten.filter((n) => (allgemein ? !n.mieter_id : ids.has(n.mieter_id))),
    aufgaben: aufgaben.filter(gehoertHierher),
    rueckstand: leute.filter((m) => Number(m.offen_summe) > 0),
    vorgaenge,
    entwuerfe: antworten.filter((a) => a.status === "entwurf" && (allgemein ? !a.mieter_id : ids.has(a.mieter_id))),
    namen,
  });
  const wissenHier = wissen.filter((w) => (w.objekt_id || null) === objektId);
  const dienstHier = dienstleister.filter((d) => !d.objekt_id || d.objekt_id === objektId);
  const titel = allgemein ? "Allgemein" : o.bezeichnung;
  const neuLaden = () => zeigeObjekt(id);

  inhalt().innerHTML = `
    <a class="zurueck" href="#/objekte">Alle Objekte</a>
    <div class="kopf">
      <div><h1>${esc(titel)}</h1>
        <p>${allgemein ? "Unterlagen, Wissen und Notizen, die zu keinem bestimmten Haus gehören." : esc([o.strasse, [o.plz, o.ort].filter(Boolean).join(" ")].filter(Boolean).join(", "))}</p></div>
      <div class="knopfreihe">
        <button type="button" class="knopf knopf--primaer" id="notiz-neu">${ICON_PLUS} Notiz</button>
        <label class="knopf">${ICON_KAMERA} Dokument ablegen<input type="file" accept="image/*,application/pdf,.docx,.xlsx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" id="erfassen" multiple hidden></label>
        <button type="button" class="knopf" id="wissen-sprechen">${ICON_KI} Wissen einsprechen</button>
      </div>
    </div>
    <div class="stapel">
      <details class="flaeche ausklapp" open>
        <summary>Zu erledigen (${todos.jetzt.length})</summary>
        ${todoListe(todos, { leer: "Für dieses Haus ist gerade nichts offen." })}
      </details>
      ${allgemein ? "" : `
      <details class="flaeche ausklapp" open>
        <summary>Mietparteien (${leute.length})</summary>
        ${leute.length ? `${LEGENDE.replace('class="mietbuch-legende"', 'class="mietbuch-legende mietbuch-legende--innen"')}
          <div class="zeilen">${leute.map((m) => mieterZeile(m, forderungen, monate)).join("")}</div>` : `<div class="leer">Keine Mietparteien erfasst.</div>`}
      </details>`}
      <details class="flaeche ausklapp" ${dokumente.length && dokumente.length <= 12 ? "open" : ""}>
        <summary>Dokumente (${dokumente.length})</summary>
        ${ablage.ablegeflaecheHtml({ text: "Dateien hierher ziehen", klein: true })}
        ${ablage.dokumentListe(dokumente, { leer: "Noch keine Dokumente. Mit „Dokument ablegen“ ein Foto oder PDF hinzufügen." })}
        <div class="flaeche__fuss knopfreihe">
          <a class="knopf knopf--klein knopf--primaer" href="#/ablage/${esc(id)}">Alle Ordner öffnen</a>
          <button type="button" class="knopf knopf--klein" id="ordner-bearbeiten">Ordner bearbeiten</button>
          ${dokumente.length ? `<button type="button" class="knopf knopf--klein" id="zip">Als ZIP herunterladen</button>` : ""}
        </div>
      </details>
      <details class="flaeche ausklapp">
        <summary>Wissen (${wissenHier.length})</summary>
        ${ablage.wissenListe(wissenHier)}
        <div class="flaeche__fuss knopfreihe"><button type="button" class="knopf knopf--klein" id="wissen-neu">Eintrag tippen</button></div>
      </details>
      <details class="flaeche ausklapp">
        <summary>Handwerker &amp; Dienstleister (${dienstHier.length})</summary>
        ${ablage.dienstleisterListe(dienstHier)}
        <div class="flaeche__fuss knopfreihe"><button type="button" class="knopf knopf--klein" id="dienst-neu">${ICON_PLUS} Hinzufügen</button></div>
      </details>
      ${allgemein ? "" : `
      <details class="flaeche ausklapp">
        <summary>Einstellungen zum Haus</summary>
        <form class="flaeche__inhalt" id="hausformular">
          <label class="feld"><span>Orts-Kürzel für Dateinamen</span>
            <input name="kuerzel" value="${esc(o.kuerzel || "")}" maxlength="10" placeholder="z. B. SR" autocomplete="off" style="max-width: 8rem">
            <span class="feldhinweis feldhinweis--leise">Dateinamen: ${esc(ablage.dokumentTitel({ datum: heuteISO(), objekt: { ...o, kuerzel: o.kuerzel || "SR" }, art: "Rechnung", details: "Sanitär Gruber_102,89" }))}</span></label>
          <label class="feld"><span>Kappungsgrenze für Mieterhöhungen</span>
            <select name="kappungsgrenze">
              <option value="20" ${Number(o.kappungsgrenze) !== 15 ? "selected" : ""}>20 % in drei Jahren (Normalfall)</option>
              <option value="15" ${Number(o.kappungsgrenze) === 15 ? "selected" : ""}>15 % in drei Jahren (Gemeinde mit angespanntem Wohnungsmarkt)</option>
            </select>
            <span class="feldhinweis feldhinweis--leise">Ob 15 % gelten, legt das Land per Verordnung fest. Im Zweifel bei Haus &amp; Grund nachfragen.</span></label>
          <div class="knopfreihe"><button class="knopf knopf--primaer" type="submit">Speichern</button></div>
        </form>
      </details>`}
    </div>`;

  verbindeTodos(inhalt(), { aufgaben, nachher: neuLaden });
  ablage.verbindeListen(inhalt(), { dokumente, wissen: wissenHier, dienstleister: dienstHier, objektId, nachher: neuLaden });
  $("#notiz-neu").addEventListener("click", () => aufgabeDialog({ objekt_id: objektId }, { nachher: neuLaden }));
  $("#erfassen").addEventListener("change", (e) => { const d = [...e.target.files]; e.target.value = ""; ablage.erfasseAlle(d, { objektId, nurAblage: true }); });
  ablage.verbindeAblegeflaeche($("[data-ablegeflaeche]", inhalt()), { objektId, nurAblage: true });
  $("#wissen-sprechen").addEventListener("click", () => ablage.wissenEinsprechen({ objektId, nachher: neuLaden }));
  $("#wissen-neu").addEventListener("click", () => ablage.bearbeiteWissen({ objekt_id: objektId }, { nachher: neuLaden }));
  $("#dienst-neu").addEventListener("click", () => ablage.bearbeiteDienstleister({ objekt_id: objektId }, { nachher: neuLaden }));
  $("#ordner-bearbeiten").addEventListener("click", () => ablage.ordnerBearbeiten({ nachher: neuLaden }));
  $("#zip")?.addEventListener("click", () => ablage.zipExport({ objektId }));
  $("#hausformular")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const f = new FormData(e.currentTarget);
      const neu = await db.speichereObjekt(o.id, {
        kappungsgrenze: Number(f.get("kappungsgrenze")),
        kuerzel: String(f.get("kuerzel") || "").trim().toUpperCase() || null,
      });
      Object.assign(objektVon(o.id) || {}, neu);
      Object.assign(o, neu);
      melde("Gespeichert.", "ok");
    } catch (err) { melde(err.message, "fehler"); }
  });
}

// ---------------------------------------------------------------------------
// Notiz / Wiedervorlage anlegen oder bearbeiten
// a: vorhandene Aufgabe (mit id) oder Vorbelegung { titel, notiz, mieter_id, objekt_id, nachricht_id, faellig_am }
// ---------------------------------------------------------------------------
export async function aufgabeDialog(a = null, { nachher = () => {}, vorschlag = null } = {}) {
  a = a || {};
  const mieterL = await mieterListe();
  const vorhanden = !!a.id;
  const kiDa = !!zustand.ki?.ki;
  const faellig = vorschlag?.wiedervorlage || a.faellig_am || "";
  const abgelegt = vorhanden ? await db.ladeAbgelegte("aufgabe_id", [a.id]).catch(() => []) : [];
  const daten = await dialogFormular(`
    <h2>${vorhanden ? "Notiz" : "Neue Notiz"}</h2>
    ${abgelegt.length ? `<p>${ablage.abgelegtHtml(abgelegt)}</p>` : ""}
    <label class="feld"><span>Worum geht es?</span>
      <span class="diktat"><input name="titel" required maxlength="200" value="${esc(a.titel || "")}" placeholder="z. B. Check Möglichkeit Mieterhöhung Huber" autocomplete="off">${mikroKnopf()}</span></label>
    <label class="feld"><span>Notiz (optional)</span>
      <span class="diktat"><textarea name="notiz" rows="3">${esc(a.notiz || "")}</textarea>${mikroKnopf()}</span></label>
    <div class="formraster formraster--zwei">
      <label class="feld"><span>Mietpartei</span><select name="mieter_id">${mieterOptionen(mieterL, a.mieter_id || null)}</select></label>
      <label class="feld"><span>Haus</span><select name="objekt_id">
        <option value="">–</option>
        ${zustand.stamm.objekte.map((o) => `<option value="${esc(o.id)}" ${o.id === a.objekt_id ? "selected" : ""}>${esc(o.bezeichnung)}</option>`).join("")}
      </select></label>
      <label class="feld"><span>Wiedervorlage am</span><input type="date" name="faellig_am" value="${esc(faellig)}" min="2020-01-01" max="2099-12-31">
        ${vorschlag?.wiedervorlage && vorschlag.wiedervorlage !== a.faellig_am ? `<span class="feldhinweis">Vorschlag der KI – mit „Speichern“ übernehmen.</span>` : ""}</label>
      <label class="feld"><span>In der Liste zeigen ab … Tage vorher</span><input type="number" name="vorlauf_tage" min="0" max="60" value="${esc(a.vorlauf_tage ?? 7)}"></label>
    </div>
    ${a.antwort ? `<div class="ki-antwort"><strong>${ICON_KI} Einschätzung der KI</strong>${vorschlag ? "" : ` <span class="leise">(vom ${esc(datumDE(a.aktualisiert_am))})</span>`}
      <p>${esc(a.antwort)}</p>
      ${vorschlag?.fehlend?.length ? `<p class="leise">Für eine sichere Antwort fehlt: ${esc(vorschlag.fehlend.join(", "))}.</p>` : ""}
      <p class="leise">Nur ein Vorschlag, keine Rechtsberatung.</p></div>` : ""}
    <div class="knopfreihe">
      ${vorhanden ? `<button class="knopf knopf--gefahr knopf--links" value="loeschen" formnovalidate>Löschen</button>` : ""}
      <button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button>
      ${kiDa ? `<button class="knopf knopf--ki" value="pruefen">${ICON_KI} Mit KI prüfen</button>` : ""}
      <button class="knopf" value="ablage" title="Notiz speichern und als PDF in die Ablage legen">In Ablage</button>
      ${vorhanden && a.status !== "erledigt" ? `<button class="knopf" value="erledigt">Erledigt</button>` : ""}
      <button class="knopf knopf--primaer" value="ok">Speichern</button>
    </div>`, {
    breit: true,
    vorbereiten: (form) => {
      verbindeDiktat(form);
      // „In der Ablage“ öffnet das Dokument (der Notiz-Dialog schließt sich dabei)
      for (const b of $$("[data-abgelegt]", form)) {
        b.addEventListener("click", () => {
          const d = abgelegt.find((x) => x.id === b.dataset.abgelegt);
          $("#dialog").close();
          setTimeout(() => ablage.oeffneDokument(d, { nachher }), 0);
        });
      }
      // Mietpartei anhand des Nachnamens im Titel vorschlagen, solange keine gewählt ist
      let vonHand = !!a.mieter_id;
      form.mieter_id.addEventListener("change", () => { vonHand = true; });
      form.titel.addEventListener("input", () => {
        if (vonHand) return;
        const t = ` ${norm(form.titel.value).replace(/[^a-z0-9]+/g, " ")} `;
        const treffer = mieterL.filter((m) => m.nachname && t.includes(` ${norm(m.nachname).replace(/[^a-z0-9]+/g, " ").trim()} `));
        form.mieter_id.value = treffer.length === 1 ? treffer[0].id : "";
      });
    },
  });
  if (!daten) return;
  const aktion = daten.get("_aktion");
  try {
    if (aktion === "loeschen") {
      if (!(await frage("Notiz löschen?", `<p>„${esc(a.titel)}“ wird gelöscht.</p>`, "Löschen", { gefahr: true }))) return;
      await db.loescheAufgabe(a.id);
      melde("Notiz gelöscht.", "ok");
      return nachher();
    }
    const titel = String(daten.get("titel") || "").trim();
    if (!titel) return melde("Bitte kurz eintragen, worum es geht.", "fehler");
    const vorlauf = Math.min(60, Math.max(0, Number(daten.get("vorlauf_tage")) || 0));
    const felder = {
      titel,
      notiz: String(daten.get("notiz") || "").trim() || null,
      mieter_id: daten.get("mieter_id") || null,
      objekt_id: daten.get("objekt_id") || null,
      faellig_am: daten.get("faellig_am") || null,
      vorlauf_tage: vorlauf,
    };
    if (!vorhanden && a.nachricht_id) felder.nachricht_id = a.nachricht_id;
    if (aktion === "erledigt") Object.assign(felder, { status: "erledigt", erledigt_am: new Date().toISOString() });
    const gespeichert = await db.speichereAufgabe(a.id, felder);
    if (aktion === "pruefen") return pruefeMitKi(gespeichert, nachher);
    if (aktion === "ablage") {
      nachher();
      return ablage.inAblageDialog(eintragNotiz(gespeichert), { nachher, schon: abgelegt });
    }
    melde(aktion === "erledigt" ? "Erledigt." : "Notiz gespeichert.", "ok");
    nachher();
  } catch (err) {
    melde(err.message, "fehler");
  }
}

// Notiz als PDF für die Ablage
function eintragNotiz(a) {
  const m = a.mieter_id ? zustand.mieterKurz?.find?.((x) => x.id === a.mieter_id) : null;
  const hausId = a.objekt_id || (m ? wohnungVon(m.wohnung_id)?.objekt_id : null) || null;
  const haus = hausId ? objektVon(hausId) : null;
  return {
    quelle: { aufgabe_id: a.id },
    richtung: "notiz",
    art: "Notiz", artFest: true,
    datum: heuteISO(),
    objektId: hausId,
    mieterId: a.mieter_id || null,
    gegenueber: m ? mieterName(m) : haus?.bezeichnung || "",
    gegenueberKurz: m?.nachname || null,
    kiText: { titel: a.titel, text: [a.notiz, a.antwort].filter(Boolean).join("\n\n") },
    zusammenfassung: a.titel,
    beschreibung: "Die Notiz wird als PDF abgelegt (mit Einschätzung der KI, falls vorhanden).",
    datei: async () => {
      const mieterL = await mieterListe().catch(() => []);
      const mp = mieterL.find((x) => x.id === a.mieter_id);
      return ablage.pdfEintrag({
        titel: a.titel,
        angaben: [
          ["Erstellt", datumDE(a.erstellt_am || new Date())], ["Wiedervorlage", a.faellig_am ? datumDE(a.faellig_am) : ""],
          ["Status", a.status === "erledigt" ? "erledigt" : "offen"], ["Mietpartei", mp ? mieterName(mp) : ""], ["Haus", haus?.bezeichnung || ""],
        ],
        text: a.notiz || "",
        abschnitte: a.antwort ? [{ titel: "Einschätzung der KI (keine Rechtsberatung)", text: a.antwort }] : [],
      })();
    },
  };
}

// Notiz von der KI prüfen lassen. Die Antwort wird gespeichert; das Datum nur als Vorschlag gezeigt.
async function pruefeMitKi(a, nachher) {
  const warte = wartehinweis("Die KI prüft die Notiz …");
  let r = null;
  try {
    r = await db.funktion("ki", { aktion: "notiz_pruefen", aufgabe_id: a.id });
    a = await db.speichereAufgabe(a.id, { antwort: r.antwort });
  } catch (err) {
    melde("Prüfen nicht möglich: " + err.message, "fehler");
  } finally {
    await warte.ende();
  }
  return aufgabeDialog(a, { nachher, vorschlag: r });
}

/** Mieterhöhung für eine Mietpartei prüfen: vorhandene Notiz nutzen oder anlegen, dann die KI fragen */
export async function mieterhoehungPruefen(mieter, aufgaben, nachher) {
  if (!zustand.ki?.ki) return melde("Die KI ist noch nicht eingerichtet (Einstellungen).", "fehler");
  let a = aufgaben.find((x) => /miet\w*erh(ö|oe)h/i.test(x.titel));
  try {
    a = a || await db.speichereAufgabe(null, { titel: `Check Möglichkeit Mieterhöhung ${mieter.nachname}`, mieter_id: mieter.id });
  } catch (err) {
    return melde(err.message, "fehler");
  }
  return pruefeMitKi(a, nachher);
}

/** Kompakte Liste von Notizen (z. B. in der Mieterakte) */
export function aufgabenKurz(aufgaben) {
  return sammle({ aufgaben });
}
export { todoListe, verbindeTodos };
