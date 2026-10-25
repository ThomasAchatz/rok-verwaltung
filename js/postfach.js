// Postfach, KI-Entwürfe, Wissen und Einstellungen
// Grundsatz: Die KI schreibt nur Entwürfe. Verschickt wird ausschließlich per Klick.
import * as db from "./daten.js";
import { antwortDaten, briefanrede, fuelleVorlage, vorlagenFehler, datumDE, mieterName, profilFuer } from "./dokumente.js";
import { zeigeDokument } from "./vorschau.js";
import * as unterschrift from "./unterschrift.js";
import {
  $, $$, esc, melde, dialogFormular, frage, dateiTeil, heuteISO,
  zustand, wohnungVon, objektVon, kostentraegerVon, brotkrumen, KRUMEN,
} from "./helfer.js";

import {
  ICON_MIKRO, ICON_KI, ICON_KAMERA, istEmail, kurz, norm, anschriftAnrede, zeitDE, datumZeit, geheZu,
  mieterListe, ortVon, mieterOptionen, betrifftOptionen, betrifftAus, mikroKnopf, verbindeDiktat, stoppeDiktat, wachsen, wartehinweis, beschaeftigt,
  suchauswahlHtml, verbindeSuchauswahl,
} from "./ui.js";
import * as ablage from "./ablage.js";
import { drucke } from "./ui.js";
import { aufgabeDialog, fristVon } from "./start.js";
import { kontakteListe, kontaktName } from "./kontakte.js";
import * as vorgaenge from "./vorgaenge.js";

const inhalt = () => $("#inhalt");

const QUELLE = { email: "E-Mail", brief: "Brief", notiz: "Notiz" };
const ZUORDNUNG = {
  email: "Über die E-Mail-Adresse erkannt.",
  ki: "Von der KI zugeordnet. Bitte kurz prüfen.",
  manuell: "Von Hand zugeordnet.",
};
const FILTER = { offen: ["neu", "offen"], beantwortet: ["beantwortet"], erledigt: ["erledigt"], alle: null };
const FILTER_NAME = { offen: "Offen", beantwortet: "Beantwortet", erledigt: "Erledigt", alle: "Alle" };
const FILTER_LEER = {
  offen: "Keine offenen Nachrichten. Alles beantwortet.",
  beantwortet: "Noch nichts beantwortet.",
  erledigt: "Nichts als erledigt markiert.",
  alle: "Das Postfach ist leer.",
};

// Briefkopf unter E-Mails (gleich wie in der Server-Funktion „versand“)
function briefkopfText() {
  const p = zustand.profil || {};
  return [p.firma, [p.strasse, [p.plz, p.ort].filter(Boolean).join(" ")].filter(Boolean).join(", "),
    [p.telefon ? `Tel. ${p.telefon}` : "", p.email, p.web].filter(Boolean).join(" · ")].filter(Boolean).join(" · ");
}

function signaturText() {
  const p = zustand.profil || {};
  return (p.email_signatur || "").trim() || [p.inhaber, p.firma].filter(Boolean).join("\n");
}

// Weitere Absender (z. B. „Privat“) aus den Einstellungen; null = Firma
export const absenderListe = () => (Array.isArray(zustand.profil?.absender) ? zustand.profil.absender : []).filter((a) => a?.id && a?.name);
const signaturFuer = (abs) => (abs ? String(abs.signatur || "").trim() || abs.name : signaturText());
function briefkopfFuer(abs) {
  if (!abs) return briefkopfText();
  return [abs.name, [abs.strasse, [abs.plz, abs.ort].filter(Boolean).join(" ")].filter(Boolean).join(", "),
    [abs.telefon ? `Tel. ${abs.telefon}` : "", abs.email].filter(Boolean).join(" · ")].filter(Boolean).join(" · ");
}
/** Bestätigungsdialog: von wem die E-Mail kommt und wohin Antworten gehen */
function absenderHinweis(abs) {
  const technisch = zustand.ki?.absender || "";
  const adresse = (technisch.match(/<([^>]+)>/) || [])[1] || technisch;
  const antworten = abs ? (istEmail(abs.email) ? abs.email : zustand.profil?.antwort_email) : zustand.profil?.antwort_email;
  return `<p class="leise">Absender: ${esc(abs ? `${abs.name} <${adresse}>` : technisch)}${antworten ? `. Antworten gehen an ${esc(antworten)}.` : ""}
    Unter der Signatur steht ${abs ? `die Anschrift von „${esc(abs.bezeichnung || abs.name)}“` : "der Briefkopf (Firma, Anschrift, Kontakt aus den Einstellungen)"}.</p>`;
}
const signaturHtml = (abs) => `Wird automatisch angefügt:<br>Mit freundlichen Grüßen<br>${esc(signaturFuer(abs)).replace(/\n/g, "<br>")}${briefkopfFuer(abs) ? `<br><span class="signatur__kopf">${esc(briefkopfFuer(abs))}</span>` : ""}`;

// ---------------------------------------------------------------------------
// Für die Ablage: was abgelegt wird (siehe ablage.js, „Aus der App ablegen“)
// ---------------------------------------------------------------------------
const isoTag = (wert) => new Date(wert || Date.now()).toLocaleDateString("sv-SE");
function briefkopfZeilen() {
  const p = zustand.profil || {};
  return [p.firma, [p.strasse, [p.plz, p.ort].filter(Boolean).join(" ")].filter(Boolean).join(", "),
    [p.telefon ? `Tel. ${p.telefon}` : "", p.email, p.web].filter(Boolean).join(" · ")].filter(Boolean);
}
function mietparteiText(mieter) {
  if (!mieter) return "";
  const w = wohnungVon(mieter.wohnung_id);
  const o = w && objektVon(w.objekt_id);
  return [mieterName(mieter), o?.bezeichnung, w?.bezeichnung].filter(Boolean).join(", ");
}

/** Eingegangene Nachricht (E-Mail, fotografierter Brief, Anruf-Notiz) */
function eintragNachricht(n, mieter, o) {
  const art = n.quelle === "notiz" ? "Notiz" : n.quelle === "brief" ? "Brief" : "E-Mail";
  const von = [n.absender_name, n.absender_email ? `<${n.absender_email}>` : ""].filter(Boolean).join(" ") || "Unbekannt";
  const anhaenge = (n.anhaenge || []).filter((a) => a.pfad);
  const vomMieter = mieter && (norm(n.absender_email) === norm(mieter.email) || norm(n.absender_name) === norm(mieterName(mieter)));
  return {
    quelle: { nachricht_id: n.id },
    richtung: n.quelle === "notiz" ? "notiz" : "eingang",
    art, artFest: n.quelle !== "email",
    datum: isoTag(n.eingang_am),
    objektId: o?.id || null,
    mieterId: mieter?.id || null,
    gegenueber: n.absender_name || n.absender_email || "",
    gegenueberKurz: vomMieter ? mieter.nachname : null,
    kiText: { titel: n.betreff || "", text: n.text || "" },
    zusammenfassung: n.ki_zusammenfassung || "",
    anhaenge,
    beschreibung: `${QUELLE[n.quelle] || "Nachricht"} wird als PDF abgelegt${anhaenge.length ? ", die Anhänge auf Wunsch als eigene Dateien" : ""}.`,
    datei: ablage.pdfEintrag({
      titel: n.betreff || "(ohne Betreff)",
      angaben: [
        ["Von", von], ["Eingang", datumZeit(n.eingang_am)], ["Art", QUELLE[n.quelle] || ""], ["Mietpartei", mietparteiText(mieter)],
        ["Anhänge", (n.anhaenge || []).map((a) => a.name || "Datei").join(", ")],
      ],
      text: n.text || "(kein Text)",
      abschnitte: n.ki_zusammenfassung ? [{ titel: "Kurzfassung (KI)", text: n.ki_zusammenfassung }] : [],
    }),
  };
}

/**
 * Gesendete Antwort, Schreiben oder Auftrag.
 * kanal: "email" | "email-programm" | "druck" | "brief"; bytes: Word-Datei beim Brief
 */
function eintragAntwort(a, { nachricht = null, mieter = null, objektId = null, kanal = "email", an = null, bytes = null, vorgangId = null }) {
  const art = a.art === "auftrag" ? "Auftrag" : kanal === "brief" || a.status === "als_brief" ? "Brief" : "E-Mail";
  const empfaenger = a.empfaenger_name || an || a.empfaenger_email || "";
  const anMieter = mieter && a.art !== "auftrag" && !a.dienstleister_id && !a.kontakt_id && !a.kostentraeger_id && (!an || norm(an) === norm(mieter.email));
  const voll = `${String(a.text || "").trim()}\n\nMit freundlichen Grüßen\n${signaturFuer(a.absender || null)}`;
  const p = zustand.profil || {};
  const datei = bytes
    ? async () => ({ blob: new Blob([typeof bytes === "function" ? bytes() : bytes], { type: ablage.DOCX_TYP }), typ: ablage.DOCX_TYP })
    : ablage.pdfEintrag({
      kopf: briefkopfZeilen(),
      titel: a.betreff || (art === "Auftrag" ? "Auftrag" : "Schreiben"),
      angaben: [
        ["Von", [p.firma || p.inhaber, zustand.ki?.absender ? `<${zustand.ki.absender}>` : ""].filter(Boolean).join(" ")],
        ["An", [a.empfaenger_name, (an || a.empfaenger_email) ? `<${an || a.empfaenger_email}>` : ""].filter(Boolean).join(" ")],
        [kanal === "druck" ? "Gedruckt" : "Gesendet", datumZeit(a.gesendet_am || new Date().toISOString())],
        ["Weg", { email: "E-Mail aus der App", "email-programm": "eigenes E-Mail-Programm", druck: "Ausdruck", brief: "Brief" }[kanal] || ""],
        ["Mietpartei", art === "Auftrag" || a.dienstleister_id ? "" : mietparteiText(mieter)],
        ["Antwort auf", nachricht && art !== "Auftrag" ? `${nachricht.betreff || "(ohne Betreff)"} vom ${datumDE(nachricht.eingang_am)}` : ""],
        ["Anhänge", (a.anhaenge || []).length ? `${a.anhaenge.length} Foto(s)` : ""],
      ],
      text: voll,
    });
  return {
    quelle: { antwort_id: a.id, vorgang_id: vorgangId },
    richtung: "ausgang",
    art, artFest: true,
    datum: isoTag(a.gesendet_am),
    objektId, mieterId: art === "Auftrag" ? null : mieter?.id || null,
    gegenueber: empfaenger,
    gegenueberKurz: anMieter ? mieter.nachname : null,
    kiText: { titel: a.betreff || "", text: a.text || "" },
    beschreibung: bytes ? "Das Schreiben wird als Word-Datei abgelegt." : `${art === "Auftrag" ? "Der Auftrag" : "Die E-Mail"} wird als PDF abgelegt.`,
    datei,
  };
}


// ---------------------------------------------------------------------------
// Was ist auf dem Server eingerichtet? (KI-Schlüssel, Versand)
// ---------------------------------------------------------------------------
let kiAnfrage = null;
export function ladeKiStatus(neu = false) {
  if (!kiAnfrage || neu) {
    kiAnfrage = db.funktion("ki", { aktion: "status" })
      .then((s) => (zustand.ki = s))
      .catch((err) => (zustand.ki = { ki: false, versand: false, fehler: err.message }));
  }
  return kiAnfrage;
}

function kiBanner() {
  const ki = zustand.ki;
  if (ki?.ki) return "";
  if (ki?.fehler) {
    return `<div class="banner">Die KI-Funktionen sind gerade nicht erreichbar (${esc(ki.fehler)}). Nachrichten und Antworten funktionieren trotzdem.</div>`;
  }
  return `<div class="banner">Die KI ist noch nicht eingerichtet. Nachrichten kommen trotzdem an, und Antworten können Sie selbst schreiben.
    Für automatisches Einordnen und Entwürfe: <a href="#/einstellungen">Einstellungen</a>.</div>`;
}

export async function aktualisiereZaehler() {
  const el = $("#nav-postfach-zahl");
  if (!el) return;
  try {
    const n = await db.zaehleNeue();
    el.textContent = n > 99 ? "99+" : String(n);
    el.hidden = n === 0;
    el.setAttribute("aria-label", `${n} neue Nachrichten`);
  } catch {
    el.hidden = true;
  }
}

// ---------------------------------------------------------------------------
// Zeile im Postfach
// ---------------------------------------------------------------------------
function marken(n, { mitStatus = true } = {}) {
  return [
    n.status === "neu" ? `<span class="marker marker--neu">neu</span>` : "",
    n.ki_dringlichkeit === "hoch" ? `<span class="marker marker--offen">dringend</span>` : "",
    fristVon(n) && !["beantwortet", "erledigt"].includes(n.status) ? `<span class="marker marker--offen">Frist ${esc(datumDE(fristVon(n)))}</span>` : "",
    n.ki_kategorie ? `<span class="marker">${esc(n.ki_kategorie)}</span>` : "",
    n.quelle !== "email" ? `<span class="marker marker--messing">${esc(QUELLE[n.quelle] || n.quelle)}</span>` : "",
    mitStatus && n.status === "beantwortet" ? `<span class="marker marker--ok">beantwortet</span>` : "",
    mitStatus && n.status === "erledigt" ? `<span class="marker marker--leise">erledigt</span>` : "",
  ].join("");
}

export function nachrichtZeile(n, namen = {}) {
  const wer = (n.mieter_id && namen[n.mieter_id]) || n.absender_name || n.absender_email || "Unbekannt";
  const vorschau = n.ki_zusammenfassung || kurz(n.text, 180);
  return `
    <a class="post ${n.status === "neu" ? "post--neu" : ""}" href="#/postfach/${esc(n.id)}" data-nachricht="${esc(n.id)}">
      <span class="post__punkt" aria-hidden="true"></span>
      <span class="post__haupt">
        <span class="post__kopf"><span class="post__wer">${esc(wer)}</span><span class="post__wann">${esc(zeitDE(n.eingang_am))}</span></span>
        <span class="post__betreff">${esc(n.betreff || "(ohne Betreff)")}</span>
        <span class="post__vorschau">${esc(vorschau)}</span>
        <span class="post__marken">${marken(n)}${n.ki_am ? "" : `<span class="post__ki" hidden>wird eingeordnet …</span>`}</span>
      </span>
    </a>`;
}

// ---------------------------------------------------------------------------
// Postfach-Liste
// ---------------------------------------------------------------------------
let filter = "offen";
let einordnenLaeuft = false;

export async function zeigePostfach() {
  const [liste, mieterL, pf] = await Promise.all([
    db.ladeNachrichten({ status: FILTER[filter] }),
    mieterListe(),
    db.ladePostfach().catch(() => null),
    ladeKiStatus(),
  ]);
  const namen = Object.fromEntries(mieterL.map((m) => [m.id, mieterName(m)]));
  bereiteImHintergrundVor(liste).catch(() => null);

  inhalt().innerHTML = `
    <div class="kopf">
      <div><h1>Postfach</h1>
        <p>${pf?.adresse ? `Eingang: <strong class="umbruch">${esc(pf.adresse)}</strong>` : "Anfragen von Mietern, Ämtern und Interessenten"}</p></div>
      <div class="knopfreihe">
        <label class="knopf">${ICON_KAMERA} Foto / Datei<input type="file" accept="image/*,application/pdf,.docx,.xlsx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" id="foto" multiple hidden></label>
        <button type="button" class="knopf" id="notiz">Anruf erfassen</button>
        <a class="knopf knopf--primaer" href="#/schreiben">Neues Schreiben</a>
      </div>
    </div>
    ${kiBanner()}
    <div class="reiter" role="group" aria-label="Filter">
      ${Object.keys(FILTER).map((k) => `<button type="button" class="reiter__knopf" data-filter="${k}" aria-pressed="${k === filter}">
        ${FILTER_NAME[k]}${k === filter ? ` <span class="reiter__zahl">${liste.length}</span>` : ""}</button>`).join("")}
    </div>
    <section class="flaeche">
      ${liste.length ? `<div class="posts">${liste.map((n) => nachrichtZeile(n, namen)).join("")}</div>` : `<div class="leer">${FILTER_LEER[filter]}</div>`}
    </section>`;

  for (const b of $$("[data-filter]")) b.addEventListener("click", () => { filter = b.dataset.filter; zeigePostfach(); });
  $("#foto").addEventListener("change", (e) => { const d = [...e.target.files]; e.target.value = ""; ablage.erfasseAlle(d); });
  $("#notiz").addEventListener("click", notizErfassen);
  aktualisiereZaehler();
  if (zustand.ki?.ki) ordneNachEin(liste.filter((n) => !n.ki_am).slice(0, 8), namen);
}

// Noch nicht eingeordnete Nachrichten nacheinander von der KI einordnen lassen
async function ordneNachEin(liste, namen) {
  if (einordnenLaeuft || !liste.length) return;
  einordnenLaeuft = true;
  try {
    for (const n of liste) {
      const zeile = document.querySelector(`[data-nachricht="${n.id}"]`);
      if (!zeile) break; // Seite wurde verlassen
      const hinweis = zeile.querySelector(".post__ki");
      if (hinweis) hinweis.hidden = false;
      try {
        const { nachricht } = await db.funktion("ki", { aktion: "einordnen", nachricht_id: n.id });
        const jetzt = document.querySelector(`[data-nachricht="${n.id}"]`);
        if (jetzt && nachricht) jetzt.outerHTML = nachrichtZeile(nachricht, namen);
      } catch (err) {
        if (hinweis) hinweis.hidden = true;
        melde("Einordnen nicht möglich: " + err.message, "fehler");
        break;
      }
    }
  } finally {
    einordnenLaeuft = false;
  }
}

async function ordneEinMitHinweis(id) {
  if (!zustand.ki?.ki) return;
  const warte = wartehinweis("Die KI ordnet die Nachricht ein …");
  try {
    await db.funktion("ki", { aktion: "einordnen", nachricht_id: id });
  } catch (err) {
    melde("Einordnen nicht möglich: " + err.message, "fehler");
  } finally {
    await warte.ende();
  }
}

// ---------------------------------------------------------------------------
// Notiz / Anruf erfassen
// ---------------------------------------------------------------------------
async function notizErfassen() {
  const mieterL = await mieterListe();
  const daten = await dialogFormular(`
    <h2>Anruf oder Gespräch erfassen</h2>
    <p class="leise">Zum Beispiel ein Anruf oder ein Gespräch im Treppenhaus. Danach können Sie wie auf eine E-Mail antworten.
      Für eigene Erinnerungen gibt es „Notiz“ auf der Übersicht.</p>
    <label class="feld"><span>Betrifft</span><select name="betrifft">${betrifftOptionen(mieterL, null)}</select></label>
    <label class="feld"><span>Von (wenn keine Mietpartei)</span><input name="absender" placeholder="Name"></label>
    <label class="feld"><span>Betreff</span><input name="betreff" required placeholder="z. B. Anruf: Wasserhahn tropft"></label>
    <label class="feld"><span>Was wurde gesagt?</span>
      <span class="diktat"><textarea name="text" rows="5" required></textarea>${mikroKnopf()}</span></label>
    <div class="knopfreihe">
      <button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button>
      <button class="knopf knopf--primaer" value="ok">Ins Postfach</button>
    </div>`, { breit: true, vorbereiten: verbindeDiktat });
  if (!daten) return;
  const betrifft = betrifftAus(daten.get("betrifft"));
  const m = mieterL.find((x) => x.id === betrifft.mieter_id);
  try {
    const n = await db.neueNachricht({
      quelle: "notiz",
      status: "offen",
      mieter_id: m?.id || null,
      objekt_id: betrifft.objekt_id,
      zuordnung: m ? "manuell" : null,
      absender_name: m ? mieterName(m) : (String(daten.get("absender")).trim() || null),
      absender_email: m?.email || null,
      betreff: String(daten.get("betreff")).trim(),
      text: String(daten.get("text")).trim(),
    });
    await ordneEinMitHinweis(n.id);
    geheZu(`#/postfach/${n.id}`);
  } catch (err) {
    melde(err.message, "fehler");
  }
}

// ---------------------------------------------------------------------------
// Eine Nachricht mit Antwort
// ---------------------------------------------------------------------------
function antwortEintrag(a, abgelegt = []) {
  const art = a.art === "auftrag"
    ? `Auftrag an ${a.empfaenger_name || a.empfaenger_email || "Handwerker"}${a.status === "gesendet" ? " (E-Mail)" : " (gedruckt)"}`
    : a.status === "gesendet" ? `E-Mail an ${a.empfaenger_email || "?"}` : "Als Brief erstellt";
  const wann = a.gesendet_am || a.aktualisiert_am || a.erstellt_am;
  return `
    <details class="antwort">
      <summary><span class="antwort__art">${esc(art)}</span><span class="leise">${esc(datumZeit(wann))}</span></summary>
      <div class="antwort__text"><strong>${esc(a.betreff)}</strong>\n\n${esc(a.text)}</div>
      <div class="antwort__fuss">${abgelegt.length ? ablage.abgelegtHtml(abgelegt)
        : `<button type="button" class="knopf knopf--klein" data-antwort-ablage="${esc(a.id)}">In Ablage speichern</button>`}</div>
    </details>`;
}

function einordnungHtml(n) {
  const kiDa = !!zustand.ki?.ki;
  return `
    <div class="flaeche__kopf"><h2>Einordnung</h2>${n.ki_am ? `<span class="leise">KI, ${esc(zeitDE(n.ki_am))}</span>` : ""}</div>
    <div class="flaeche__inhalt">
      ${n.ki_am ? `
        <dl class="datenliste">
          <dt>Thema</dt><dd>${esc(n.ki_kategorie || "–")}</dd>
          <dt>Dringlichkeit</dt><dd>${n.ki_dringlichkeit === "hoch" ? `<span class="marker marker--offen">dringend</span>` : esc(n.ki_dringlichkeit || "–")}</dd>
        </dl>
        ${n.ki_zusammenfassung ? `<p class="ki-text">${esc(n.ki_zusammenfassung)}</p>` : ""}
        ${n.ki_vorschlag ? `<p class="ki-vorschlag"><strong>Vorschlag:</strong> ${esc(n.ki_vorschlag)}</p>` : ""}`
        : `<p class="leise">${kiDa ? "Noch nicht eingeordnet." : "Die KI ist noch nicht eingerichtet."}</p>`}
      <div class="knopfreihe">
        <button type="button" class="knopf knopf--klein" id="einordnen" ${kiDa ? "" : "disabled"}>${ICON_KI} ${n.ki_am ? "Neu einordnen" : "Mit KI einordnen"}</button>
        ${fristVon(n) ? "" : `<button type="button" class="knopf knopf--klein" data-frist="aendern">Frist eintragen</button>`}
      </div>
    </div>`;
}

// Frist: von der KI erkannt (mit wörtlicher Textstelle) oder von Robert bestätigt
function fristHtml(n) {
  const frist = fristVon(n);
  if (!frist) return "";
  const tage = Math.round((new Date(frist + "T12:00:00") - new Date(heuteISO() + "T12:00:00")) / 86400000);
  const wann = tage < 0 ? `seit ${-tage} ${-tage === 1 ? "Tag" : "Tagen"} vorbei` : tage === 0 ? "heute" : tage === 1 ? "morgen" : `in ${tage} Tagen`;
  return `
    <section class="flaeche frist ${tage <= 3 ? "frist--knapp" : ""}">
      <div class="flaeche__kopf"><h2>Frist</h2>${n.frist_bestaetigt ? `<span class="marker marker--ok">bestätigt</span>` : `<span class="marker marker--messing">von der KI erkannt</span>`}</div>
      <div class="flaeche__inhalt">
        <p class="frist__datum">bis ${esc(datumDE(frist))} <span class="leise">(${esc(wann)})</span></p>
        ${!n.frist_bestaetigt && n.ki_frist_zitat ? `<blockquote class="zitat">„${esc(n.ki_frist_zitat)}“</blockquote><p class="leise">Stelle aus der Nachricht. Stimmt das Datum?</p>` : ""}
        ${!n.frist_bestaetigt && !n.ki_frist_zitat ? `<p class="leise">Keine eindeutige Textstelle gefunden. Bitte im Text prüfen.</p>` : ""}
        <div class="knopfreihe">
          ${n.frist_bestaetigt ? "" : `<button type="button" class="knopf knopf--klein knopf--primaer" data-frist="stimmt">Stimmt</button>`}
          <button type="button" class="knopf knopf--klein" data-frist="aendern">Ändern</button>
          <button type="button" class="knopf knopf--klein" data-frist="keine">${n.frist_bestaetigt ? "Entfernen" : "Keine Frist"}</button>
        </div>
      </div>
    </section>`;
}

const istBild = (a) => /^image\//.test(a.typ || "") || /\.(jpe?g|png|webp)$/i.test(a.pfad || "");
const hinweisSpeicher = new Map(); // KI-Hinweise zu frisch erstellten Aufträgen (bis zum nächsten Aufbau)

// ---------------------------------------------------------------------------
// „Ja und Ja“: Die KI bereitet bei Schadensmeldungen Antwort und Handwerker-Auftrag als Entwürfe vor.
// Jedes „Ja“ öffnet den normalen Senden-Dialog (Vorschau), nichts geht automatisch raus.
// ---------------------------------------------------------------------------
const SCHADEN = "Reparatur/Mangel";
const laeuftNoch = (s) => s?.status === "laeuft" && Date.now() - new Date(s.am).getTime() < 3 * 60000;
function sollVorbereiten(n, antworten = []) {
  const s = n.ki_schritte;
  return !!zustand.ki?.ki && n.ki_kategorie === SCHADEN && !["beantwortet", "erledigt"].includes(n.status) && !antworten.length
    && (!s || s.status === "keine" || (s.status === "laeuft" && !laeuftNoch(s)));
}
const vorbereitung = new Map(); // nachricht_id → laufender Aufruf (nicht doppelt starten)
export function bereiteSchritteVor(n, { erzwingen = false } = {}) {
  if (!vorbereitung.has(n.id)) {
    vorbereitung.set(n.id, db.funktion("ki", { aktion: "schritte", nachricht_id: n.id, erzwingen })
      .finally(() => setTimeout(() => vorbereitung.delete(n.id), 1000)));
  }
  return vorbereitung.get(n.id);
}
/** Im Hintergrund für neue Schadensmeldungen vorbereiten (Übersicht, Postfach), höchstens 3 auf einmal */
export async function bereiteImHintergrundVor(nachrichten = []) {
  if (!zustand.ki?.ki) return;
  const offen = nachrichten.filter((n) => n.ki_kategorie === SCHADEN && ["neu", "offen"].includes(n.status) && !n.ki_schritte).slice(0, 3);
  for (const n of offen) await bereiteSchritteVor(n).catch(() => null);
}

function schritteHtml(n, antworten, erledigt) {
  const s = n.ki_schritte;
  if (erledigt && s?.status !== "fertig") return "";
  const kasten = (inhalt) => `<section class="flaeche schritte" id="schritte"><div class="flaeche__kopf"><h2>${ICON_KI} Nächste Schritte</h2>
    <span class="leise">Vorschlag der KI</span></div><div class="flaeche__inhalt">${inhalt}</div></section>`;
  if (laeuftNoch(s) || sollVorbereiten(n, antworten)) {
    return kasten(`<p class="schritte__laeuft"><span class="kreisel" aria-hidden="true"></span> Die KI schreibt eine Antwort und einen Auftrag an den passenden Handwerker …</p>`);
  }
  if (s?.status === "fehler" && !antworten.length) {
    return kasten(`<p class="formfehler">Vorbereiten hat nicht geklappt: ${esc(s.meldung || "unbekannter Fehler")}</p>
      <button type="button" class="knopf knopf--ki" data-schritte="nochmal">${ICON_KI} Nochmal versuchen</button>`);
  }
  if (s?.status !== "fertig") return "";
  const zeile = (nr, text, a, knopf) => {
    const fertig = a && a.status && a.status !== "entwurf";
    return `<li class="schritt ${fertig ? "schritt--fertig" : ""}"><span class="schritt__nr">${fertig ? "✓" : nr}</span>
      <span class="schritt__text">${text}</span>
      <span class="schritt__aktion">${fertig ? `<span class="leise">${a.status === "als_brief" ? "als Brief erledigt" : "gesendet"}</span>` : !a ? `<span class="leise">verworfen</span>` : knopf}</span></li>`;
  };
  const aw = antworten.find((a) => a.id === s.antwort_id);
  const au = antworten.find((a) => a.id === s.auftrag_id);
  const hw = s.dienstleister;
  const offen = [aw, au].filter((a) => a && (!a.status || a.status === "entwurf"));
  return kasten(`
    <ol class="schritte__liste">
      ${zeile(1, `Antwort an <strong>${esc(n.absender_name || n.absender_email || "Absender")}</strong>: Eingang bestätigen, Handwerker kommt`, aw,
        `<button type="button" class="knopf knopf--primaer knopf--klein" data-schritte="antwort">Ja, Antwort senden</button>`)}
      ${hw
        ? zeile(2, `<strong>${esc(hw.name)}</strong>${hw.gewerk ? ` (${esc(hw.gewerk)})` : ""} beauftragen${au?.anhaenge?.length ? `, mit ${au.anhaenge.length} ${au.anhaenge.length === 1 ? "Foto" : "Fotos"}` : ""}${hw.email ? "" : " · <em>keine E-Mail hinterlegt</em>"}`, au,
          `<button type="button" class="knopf knopf--primaer knopf--klein" data-schritte="auftrag">${hw.email ? "Ja, Auftrag senden" : "Ja, Auftrag öffnen"}</button>
           <button type="button" class="knopf knopf--klein knopf--leise" data-schritte="anderer">Anderer Handwerker</button>`)
        : `<li class="schritt"><span class="schritt__nr">2</span><span class="schritt__text">Kein passender Handwerker in der Liste gefunden.</span>
           <span class="schritt__aktion"><button type="button" class="knopf knopf--klein" data-schritte="anderer">Handwerker wählen</button></span></li>`}
    </ol>
    ${s.hinweise?.length ? `<p class="leise">Bitte prüfen: ${s.hinweise.map(esc).join(" · ")}</p>` : ""}
    <p class="leise schritte__fuss">Jedes „Ja“ zeigt die E-Mail vorher noch einmal. Die Entwürfe stehen unten und lassen sich ändern.
      ${offen.length ? `<button type="button" class="textknopf" data-schritte="verwerfen">Vorschlag verwerfen</button>` : ""}</p>`);
}

function verbindeSchritte(n, antworten, erledigt, neu) {
  const box = $("#schritte");
  if (!box) return;
  const s = n.ki_schritte;
  if (laeuftNoch(s) || sollVorbereiten(n, antworten)) {
    // Selbst vorbereiten (oder auf einen laufenden Aufruf warten) und dann neu zeichnen
    const warte = laeuftNoch(s) && !vorbereitung.has(n.id)
      ? new Promise((ok) => setTimeout(ok, 6000))
      : bereiteSchritteVor(n).catch((err) => melde(err.message, "fehler"));
    warte.then(() => {
      if (location.hash !== `#/postfach/${n.id}`) return;
      // Hat Robert unten schon angefangen zu schreiben, nicht einfach neu zeichnen (sonst ist sein Text weg)
      const bisher = $("#entwurf")?.mitnehmen?.() || {};
      const tippt = !!(bisher.anweisung || (bisher.editor && bisher.text?.trim()));
      if (!tippt) return neu();
      const b = $("#schritte .flaeche__inhalt");
      if (b) {
        b.innerHTML = `<p>Die KI hat eine Antwort und einen Handwerker-Auftrag vorbereitet.</p>
          <button type="button" class="knopf knopf--klein" data-schritte-zeigen>Vorschlag anzeigen</button>
          <span class="leise">(Dein angefangener Text unten wird dabei verworfen.)</span>`;
        b.querySelector("[data-schritte-zeigen]").addEventListener("click", neu);
      }
    });
    return;
  }
  const klick = (sel) => {
    const k = $(sel);
    if (!k) return false;
    k.closest(".flaeche")?.scrollIntoView({ behavior: "smooth", block: "start" });
    k.click();
    return true;
  };
  for (const b of $$("[data-schritte]", box)) b.addEventListener("click", async () => {
    const was = b.dataset.schritte;
    if (was === "antwort") klick("#entwurf [data-k=senden]") || melde("Der Antwort-Entwurf ist nicht mehr da.", "info");
    if (was === "auftrag") {
      const ziel = `[data-auftrag="${s.auftrag_id}"]`;
      if (s.dienstleister?.email) klick(`${ziel} [data-k=senden]`) || melde("Der Auftrag ist nicht mehr da.", "info");
      else $(ziel)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    if (was === "anderer") $("#handwerker")?.click();
    if (was === "nochmal") {
      b.disabled = true;
      await db.aendereNachricht(n.id, { ki_schritte: null }).catch(() => null);
      n.ki_schritte = null;
      bereiteSchritteVor(n, { erzwingen: true }).then(neu).catch((err) => { b.disabled = false; melde(err.message, "fehler"); });
    }
    if (was === "verwerfen") {
      if (!(await frage("Vorschlag verwerfen?", "<p>Die vorbereitete Antwort und der Auftrag werden gelöscht. Du kannst danach selbst antworten oder beauftragen.</p>", "Verwerfen", { gefahr: true }))) return;
      try {
        for (const id of [s.antwort_id, s.auftrag_id]) {
          const a = antworten.find((x) => x.id === id);
          if (a && (!a.status || a.status === "entwurf")) await db.loescheAntwort(a.id);
        }
        await db.aendereNachricht(n.id, { ki_schritte: { ...s, status: "verworfen", am: new Date().toISOString() } });
        melde("Vorschlag verworfen.", "ok");
        neu();
      } catch (err) { melde(err.message, "fehler"); }
    }
  });
}

export async function zeigeNachricht(id) {
  let [n, mieterL, antworten] = await Promise.all([
    db.ladeNachricht(id), mieterListe(), db.ladeAntworten({ nachrichtId: id }), ladeKiStatus(),
  ]);
  if (n.status === "neu") {
    n = await db.aendereNachricht(id, { status: "offen" }).catch(() => n);
    aktualisiereZaehler();
  }
  const mieter = n.mieter_id ? await db.ladeMieter(n.mieter_id).catch(() => null) : null;
  const [abgelegtN, abgelegtA] = await Promise.all([
    db.ladeAbgelegte("nachricht_id", [id]).catch(() => []),
    db.ladeAbgelegte("antwort_id", antworten.filter((a) => a.status !== "entwurf").map((a) => a.id)).catch(() => []),
  ]);
  const abgelegtVon = (aid) => abgelegtA.filter((d) => d.antwort_id === aid);
  const entwurf = antworten.find((a) => a.status === "entwurf" && a.art !== "auftrag") || null;
  const auftraege = antworten.filter((a) => a.status === "entwurf" && a.art === "auftrag");
  const fertige = antworten.filter((a) => a.status !== "entwurf");
  const w = mieter && wohnungVon(mieter.wohnung_id);
  const hausN = !mieter && n.objekt_id ? objektVon(n.objekt_id) : null; // betrifft das ganze Haus
  const o = (w && objektVon(w.objekt_id)) || hausN;
  const absender = [n.absender_name, n.absender_email ? `<${n.absender_email}>` : ""].filter(Boolean).join(" ") || "Unbekannt";
  const anhaenge = n.anhaenge || [];
  const bilder = anhaenge.filter((a) => a.pfad && istBild(a));
  const pdfs = anhaenge.filter((a) => a.pfad && a.typ === "application/pdf");
  const ohne = anhaenge.filter((a) => !a.pfad);
  const erledigt = n.status === "erledigt" || n.status === "beantwortet";
  const vorbelegt = zustand.vorbelegung?.nachricht_id === id ? zustand.vorbelegung.anweisung : null;
  zustand.vorbelegung = null;
  const vorgangKasten = await vorgaenge.vorgangKastenHtml(n).catch(() => "");

  inhalt().innerHTML = `
    ${brotkrumen([...KRUMEN.postfach, { text: n.betreff || "(ohne Betreff)" }])}
    <div class="akte__kopf">
      <h1>${esc(n.betreff || "(ohne Betreff)")}</h1>
      <div class="unter">
        <span class="umbruch">${esc(absender)}</span>
        <span>${esc(datumZeit(n.eingang_am))}</span>
        ${marken(n)}
      </div>
    </div>
    <div class="akte">
      <div class="stapel">
        ${schritteHtml(n, antworten, erledigt)}
        <section class="flaeche">
          <div class="flaeche__kopf"><h2>${n.quelle === "brief" ? "Brief" : n.quelle === "notiz" ? "Notiz" : "Nachricht"}</h2></div>
          <div class="flaeche__inhalt">
            <div class="nachricht__text">${esc(n.text || "(kein Text)")}</div>
            ${bilder.length || pdfs.length ? `<div class="anhangliste">
              ${bilder.map((a) => `<a class="anhang-bild" data-datei="${esc(a.pfad)}" target="_blank" rel="noopener" title="${esc(a.name || "Foto")}"><img alt="${esc(a.name || "Foto")}"></a>`).join("")}
              ${pdfs.map((a) => `<a class="knopf knopf--klein" data-datei="${esc(a.pfad)}" target="_blank" rel="noopener"><span class="dok__icon">PDF</span> ${esc(a.name || "Dokument.pdf")}</a>`).join("")}
            </div>` : ""}
            ${ohne.length ? `<p class="leise anhaenge">${ohne.some((a) => a.verworfen)
              ? `Nicht übernommen: ${ohne.map((a) => esc(a.name || "Datei")).join(", ")}. Gespeichert werden nur Fotos und PDFs bis 10 MB.`
              : `Anhänge: ${ohne.map((a) => esc(a.name || "Datei")).join(", ")} (liegen nur beim E-Mail-Dienst).`}</p>` : ""}
          </div>
        </section>
        <div id="entwurf"></div>
        ${auftraege.map((a) => `<div data-auftrag="${esc(a.id)}"></div>`).join("")}
        ${fertige.length ? `<section class="flaeche"><div class="flaeche__kopf"><h2>Bisher erledigt</h2></div>${fertige.map((a) => antwortEintrag(a, abgelegtVon(a.id))).join("")}</section>` : ""}
      </div>
      <div class="stapel">
        ${vorgangKasten}
        ${fristHtml(n)}
        <section class="flaeche" id="einordnung">${einordnungHtml(n)}</section>
        <section class="flaeche">
          <div class="flaeche__kopf"><h2>Betrifft</h2></div>
          <div class="flaeche__inhalt">
            ${mieter ? `
              <p class="mieterkarte"><a class="name" href="#/mieter/${esc(mieter.id)}">${esc(mieterName(mieter))}</a>
                <span class="leise">${esc([o?.bezeichnung, w?.bezeichnung].filter(Boolean).join(", "))}</span></p>
              <p class="leise">${esc(ZUORDNUNG[n.zuordnung] || "")}</p>`
              : hausN ? `
              <p class="mieterkarte"><a class="name" href="#/objekt/${esc(hausN.id)}">Ganzes Haus: ${esc(hausN.bezeichnung)}</a>
                <span class="leise">keine bestimmte Mietpartei</span></p>`
              : `<p class="leise">Keiner Mietpartei zugeordnet. Die KI kennt dann nur das allgemeine Wissen.</p>`}
            <div id="zuordnung">${suchauswahlHtml({ label: mieter || hausN ? "Ändern" : "Mietpartei oder Haus zuordnen", placeholder: "Name oder Haus suchen …", wert: mieter ? mieterName(mieter) : hausN ? `Ganzes Haus: ${hausN.bezeichnung}` : "" })}</div>
            ${o ? `<button type="button" class="knopf knopf--klein" id="rundschreiben">An alle im Haus schreiben</button>` : ""}
          </div>
        </section>
        <section class="flaeche">
          <div class="flaeche__inhalt knopfreihe knopfreihe--senkrecht">
            <button type="button" class="knopf" id="handwerker">Handwerker beauftragen</button>
            <button type="button" class="knopf" id="wiedervorlage">Wiedervorlage / Notiz</button>
            <button type="button" class="knopf" id="in-ablage">${abgelegtN.length ? "Nochmals ablegen" : "In Ablage speichern"}</button>
            ${abgelegtN.length ? ablage.abgelegtHtml(abgelegtN) : ""}
            ${erledigt
              ? `<button type="button" class="knopf" id="wiederoffen">Wieder öffnen</button>`
              : `<button type="button" class="knopf" id="erledigt">Erledigt, keine Antwort nötig</button>`}
          </div>
        </section>
      </div>
    </div>`;

  const neu = () => zeigeNachricht(id);
  baueEntwurf($("#entwurf"), { nachricht: n, mieter, antwort: entwurf, anweisung: vorbelegt, nachEnde: neu, objektId: () => o?.id || null });
  for (const a of auftraege) {
    baueEntwurf($(`[data-auftrag="${a.id}"]`), { nachricht: n, mieter, antwort: a, auftrag: true, hinweise: hinweisSpeicher.get(a.id), nachEnde: neu, objektId: () => o?.id || null });
    hinweisSpeicher.delete(a.id);
  }
  verbindeSchritte(n, antworten, erledigt, neu);

  for (const a of $$("[data-datei]")) {
    db.dateiAdresse("eingang", a.dataset.datei).then((url) => {
      a.href = url;
      const img = $("img", a);
      if (img) img.src = url;
    }).catch(() => {});
  }
  $("#einordnen").addEventListener("click", (e) =>
    beschaeftigt($("#einordnung"), e.currentTarget, "KI ordnet ein …", async () => {
      try {
        await db.funktion("ki", { aktion: "einordnen", nachricht_id: id });
        await neu();
      } catch (err) {
        melde(err.message, "fehler");
      }
    }));
  for (const b of $$("[data-frist]")) b.addEventListener("click", () => fristSetzen(n, b.dataset.frist, neu));
  verbindeSuchauswahl($("#zuordnung .suchauswahl"), [
    { wert: "", name: "Keine Mietpartei", gruppe: "" },
    ...zustand.stamm.objekte.map((x) => ({ wert: `h:${x.id}`, name: `Ganzes Haus: ${x.bezeichnung}`, gruppe: "Ganzes Haus" })),
    ...mieterL.map((m) => ({ wert: m.id, name: mieterName(m), zusatz: ortVon(m), gruppe: "Mietparteien" })),
  ], async (wahl) => {
    const b = betrifftAus(wahl.wert);
    if (b.mieter_id === (n.mieter_id || null) && b.objekt_id === (n.objekt_id || null)) return;
    try {
      await db.aendereNachricht(id, { mieter_id: b.mieter_id, objekt_id: b.objekt_id, zuordnung: b.mieter_id || b.objekt_id ? "manuell" : null });
      if (b.mieter_id !== (n.mieter_id || null)) await vorgaenge.mieterNachziehen(n.thema_id, b.mieter_id, n.mieter_id);
      melde(b.objekt_id ? "Dem ganzen Haus zugeordnet." : b.mieter_id ? "Mietpartei zugeordnet." : "Zuordnung entfernt.", "ok");
      await neu();
    } catch (err) {
      melde(err.message, "fehler");
    }
  });
  // Rundschreiben ans Haus: Anweisung (und schon geschriebener Text) wandern mit, Vorgang bleibt derselbe
  $("#rundschreiben")?.addEventListener("click", () => {
    const alt = $("#entwurf")?.mitnehmen?.() || {};
    zustand.vorbelegung = {
      nachricht_id: null,
      anweisung: alt.anweisung || `Rundschreiben an alle Mietparteien wegen: ${n.betreff || "Nachricht"}`,
      uebernahme: alt.editor && alt.text?.trim() ? { betreff: String(alt.betreff || "").replace(/^(aw|re):\s*/i, ""), text: alt.text, editor: true } : null,
    };
    zustand.themaVorgabe = n.thema_id || null;
    geheZu(`#/schreiben/h-${o.id}`);
  });
  $("#handwerker").addEventListener("click", () => auftragStarten(n, mieter, bilder, o));
  $("#in-ablage").addEventListener("click", () => ablage.inAblageDialog(eintragNachricht(n, mieter, o), { nachher: neu, schon: abgelegtN }));
  ablage.verbindeAbgelegt(inhalt(), [...abgelegtN, ...abgelegtA], { nachher: neu });
  for (const b of $$("[data-antwort-ablage]")) {
    b.addEventListener("click", () => {
      const a = fertige.find((x) => x.id === b.dataset.antwortAblage);
      ablage.inAblageDialog(eintragAntwort(a, { nachricht: n, mieter, objektId: o?.id || null, kanal: a.status === "als_brief" ? (a.art === "auftrag" ? "druck" : "brief") : "email", an: a.empfaenger_email }), { nachher: neu });
    });
  }
  $("#wiedervorlage").addEventListener("click", () => aufgabeDialog({
    titel: `Nachfassen: ${n.betreff || "Nachricht"}`.slice(0, 200), mieter_id: n.mieter_id, objekt_id: o?.id || null,
    nachricht_id: n.id, faellig_am: fristVon(n) || "", vorlauf_tage: 3,
  }, { nachher: neu }));
  $("#erledigt")?.addEventListener("click", async () => {
    try {
      await db.aendereNachricht(id, { status: "erledigt" });
      melde("Als erledigt markiert.", "ok");
      geheZu("#/postfach");
    } catch (err) { melde(err.message, "fehler"); }
  });
  $("#wiederoffen")?.addEventListener("click", async () => {
    try {
      await db.aendereNachricht(id, { status: "offen" });
      await neu();
    } catch (err) { melde(err.message, "fehler"); }
  });
}

async function fristSetzen(n, art, nachher) {
  let felder;
  if (art === "stimmt") felder = { frist: fristVon(n), frist_bestaetigt: true };
  else if (art === "keine") felder = { frist: null, frist_bestaetigt: true };
  else {
    const daten = await dialogFormular(`
      <h2>Frist</h2>
      ${n.ki_frist_zitat ? `<blockquote class="zitat">„${esc(n.ki_frist_zitat)}“</blockquote>` : ""}
      <label class="feld"><span>Bis wann muss etwas passieren?</span><input type="date" name="frist" required value="${esc(fristVon(n) || "")}" min="2020-01-01" max="2099-12-31"></label>
      <div class="knopfreihe">
        <button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button>
        <button class="knopf knopf--primaer" value="ok">Speichern</button>
      </div>`);
    if (!daten) return;
    felder = { frist: daten.get("frist"), frist_bestaetigt: true };
  }
  try {
    await db.aendereNachricht(n.id, felder);
    melde(felder.frist ? "Frist gespeichert." : "Frist entfernt.", "ok");
    nachher();
  } catch (err) {
    melde(err.message, "fehler");
  }
}

// Auftrag an einen Handwerker: Firma und Fotos wählen, die KI schreibt das Briefing
async function auftragStarten(n, mieter, bilder, objekt) {
  const alle = (await db.ladeDienstleister().catch(() => [])).filter((d) => d.aktiv);
  // Vorauswahl: Gewerk, das zum Text passt (Heizung, Wasser, Strom …); Robert kann frei wählen
  const text = norm(`${n.betreff || ""} ${n.text || ""} ${n.ki_zusammenfassung || ""}`);
  const PASST = [
    [/heiz|warmwasser|therme|kalt/, /heiz|sanit/], [/wasser|rohr|tropf|abfluss|verstopf|wc|toilette|dusche|bad|feucht|schimmel/, /sanit|heiz/],
    [/strom|licht|steckdose|sicherung|elektr|kabel/, /elektr/], [/schluessel|schloss|tuer|ausgesperrt/, /schluess|schloss/],
    [/dach|regen|undicht|ziegel/, /dach/], [/wand|farbe|tapete|streichen/, /maler/],
  ];
  const punkte = (d) => {
    const g = norm(d.gewerk);
    return PASST.reduce((s, [t, gw]) => s + (t.test(text) && gw.test(g) ? 1 : 0), 0) * 10 + (objekt && d.objekt_id === objekt.id ? 1 : 0);
  };
  const passend = alle.filter((d) => !objekt || !d.objekt_id || d.objekt_id === objekt.id)
    .sort((a, b) => punkte(b) - punkte(a) || String(a.gewerk).localeCompare(String(b.gewerk)));
  if (!passend.length) {
    return melde("Noch keine Handwerker eingetragen. Unter Wissen → Handwerker & Dienstleister hinzufügen.", "fehler");
  }
  const kiDa = !!zustand.ki?.ki;
  const daten = await dialogFormular(`
    <h2>Handwerker beauftragen</h2>
    ${suchauswahlHtml({ label: "Wer soll kommen?", placeholder: "Handwerker suchen …", wert: passend[0].name, name: "dienstleister_id", versteckt: passend[0].id, inline: true })}
    ${bilder.length ? `<fieldset class="gruppe"><legend>Fotos mitschicken</legend>
      <div class="fotowahl">${bilder.map((a, i) => `<label><input type="checkbox" name="foto" value="${i}" checked><img data-datei="${esc(a.pfad)}" alt="${esc(a.name || "Foto")}"></label>`).join("")}</div>
    </fieldset>` : `<p class="leise">Zu dieser Nachricht gibt es keine Fotos.</p>`}
    <label class="feld"><span>Hinweis an die KI (optional)</span>
      <span class="diktat"><textarea name="anweisung" rows="2" placeholder="z. B. Termin bitte direkt mit der Mieterin absprechen."></textarea>${mikroKnopf()}</span></label>
    <p class="leise">Der Handwerker erfährt nur Adresse, Wohnung, Name und Telefon der Mietpartei, die Schadensbeschreibung und die Fotos.
      Keine Miete, keine Rückstände, keine Bankdaten.</p>
    <div class="knopfreihe">
      <button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button>
      <button class="knopf knopf--primaer" value="ok">${kiDa ? `${ICON_KI} Auftrag entwerfen` : "Auftrag schreiben"}</button>
    </div>`, {
    breit: true,
    vorbereiten: (form) => {
      verbindeDiktat(form);
      // Suche statt langer Auswahlliste; passende Gewerke stehen oben
      verbindeSuchauswahl($(".suchauswahl", form), passend.map((d) => ({
        wert: d.id, name: d.name, gruppe: punkte(d) >= 10 ? "Passt zur Meldung" : "Weitere Handwerker",
        zusatz: [d.gewerk, d.email ? "" : "keine E-Mail"].filter(Boolean).join(" · "),
      })));
      form.addEventListener("submit", (e) => {
        if (e.submitter?.value === "ok" && !form.dienstleister_id.value) { e.preventDefault(); $(".suchauswahl input", form).focus(); }
      });
      for (const img of $$("img[data-datei]", form)) db.dateiAdresse("eingang", img.dataset.datei).then((u) => (img.src = u)).catch(() => {});
    },
  });
  if (!daten) return;
  const d = passend.find((x) => x.id === daten.get("dienstleister_id"));
  const fotos = daten.getAll("foto").map((i) => bilder[Number(i)]).filter(Boolean);
  const anweisung = String(daten.get("anweisung") || "").trim();
  let r = { betreff: `Auftrag: ${n.betreff || "Reparatur"}`.slice(0, 200), text: "Sehr geehrte Damen und Herren,\n\n", hinweise: [] };
  if (kiDa) {
    const warte = wartehinweis("Die KI schreibt den Auftrag …");
    try {
      r = await db.funktion("ki", { aktion: "auftrag", nachricht_id: n.id, dienstleister_id: d.id, anweisung: anweisung || null });
    } catch (err) {
      melde(err.message, "fehler");
    } finally {
      await warte.ende();
    }
  }
  try {
    const thema = await vorgaenge.themaFuerNachricht(n).catch(() => null);
    const a = await db.speichereAntwort(null, {
      thema_id: thema, art: "auftrag", nachricht_id: n.id, mieter_id: mieter?.id || null, dienstleister_id: d.id,
      empfaenger_email: d.email || null, empfaenger_name: d.name, betreff: r.betreff, text: r.text,
      anweisung: anweisung || null, ki_modell: r.modell || null,
      anhaenge: fotos.map((f) => ({ bucket: "eingang", pfad: f.pfad, name: f.name || "Foto.jpg" })),
    });
    if (r.hinweise?.length) hinweisSpeicher.set(a.id, r.hinweise);
    await zeigeNachricht(n.id);
    $(`[data-auftrag="${a.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    melde(err.message, "fehler");
  }
}

// ---------------------------------------------------------------------------
// Entwurf: Anweisung (tippen oder diktieren) → KI-Entwurf → bearbeiten → senden oder als Brief
// k = { nachricht, mieter, antwort, nachEnde, auftrag?, anweisung?, hinweise? }
// auftrag: Entwurf eines Auftrags an einen Handwerker (antwort.art = "auftrag")
// ---------------------------------------------------------------------------
function baueEntwurf(el, k) {
  // Empfänger gewechselt: Anweisung und Text (ggf. der schon gespeicherte Entwurf) kommen von der vorigen Seite mit
  const umzug = !k.antwort && !k.nachricht ? k.uebernahme || null : null;
  let antwort = k.antwort || umzug?.antwort || null;
  const kiDa = !!zustand.ki?.ki;
  const standardAn = k.haus ? "" : k.nachricht?.absender_email || k.dienstleister?.email || k.kontakt?.email || k.kostentraeger?.email || k.mieter?.email || "";
  // Absender: Firma (Standard) oder ein weiterer aus den Einstellungen (z. B. „Privat“)
  const absenderL = k.auftrag ? [] : absenderListe();
  const absenderStart = absenderL.some((a) => a.id === antwort?.absender?.id) ? antwort.absender.id : "";
  // „An alle im Haus“: aus einem Schreiben an eine Person ein Rundschreiben machen (nicht bei Aufträgen)
  const anHausMoeglich = !k.haus && !k.auftrag && (zustand.stamm?.objekte?.length || 0) > 0;
  // Beim Einsprechen „als Brief“ gewünscht: Brief ist der Hauptknopf
  const briefZuerst = !k.auftrag && !!antwort && !!zustand.briefWunsch?.has(antwort.id);
  const platzhalter = k.nachricht
    ? "z. B. „Handwerker ist beauftragt, meldet sich bis Freitag.“ Leer lassen: Die KI antwortet anhand des Wissens."
    : k.dienstleister
    ? "z. B. „Angebot für den Anstrich im Treppenhaus anfragen, Besichtigung nächste Woche möglich.“"
    : k.kontakt
    ? "z. B. „Danke für das Gespräch, bitte das Exposé bis Freitag schicken.“"
    : k.kostentraeger
    ? (k.mieter ? "z. B. „Mietbescheinigung für die Mietpartei schicken, Nebenkosten ab Januar höher.“" : "z. B. „Nach dem Stand der Kostenübernahme fragen.“")
    : k.haus
    ? "z. B. „Kanister im Versorgungsraum bis 31.10. entfernen, sonst Entsorgung auf Kosten aller.“"
    : "z. B. „Frau Huber an die Mülltrennung erinnern, freundlich.“ oder „Termin zur Wohnungsbesichtigung am 3.11. um 10 Uhr ankündigen.“";

  el.innerHTML = `
    <section class="flaeche entwurf">
      <div class="flaeche__kopf"><h2>${k.auftrag ? `Auftrag an ${esc(antwort.empfaenger_name || "Handwerker")}` : k.nachricht ? "Antwort" : k.haus ? "Rundschreiben" : "Schreiben"}</h2>
        ${antwort ? `<span class="marker marker--messing">Entwurf gespeichert</span>` : ""}</div>
      <div class="flaeche__inhalt">
        <label class="feld"><span>${k.auftrag ? "Hinweis an die KI (optional)" : k.nachricht ? "Was soll in der Antwort stehen? (optional)" : "Was soll im Schreiben stehen?"}</span>
          <span class="diktat"><textarea name="anweisung" rows="${k.auftrag ? 2 : 3}" placeholder="${esc(k.auftrag ? "z. B. Termin bitte direkt mit der Mieterin absprechen." : platzhalter)}">${esc(antwort?.anweisung || k.anweisung || "")}</textarea>${mikroKnopf()}</span></label>
        <div class="knopfreihe">
          <button type="button" class="knopf knopf--ki" data-k="entwerfen" ${kiDa ? "" : `aria-disabled="true"`}>${ICON_KI} ${antwort ? "Neu entwerfen" : "Entwurf mit KI"}</button>
          ${k.nachricht && !k.auftrag && kiDa ? `<button type="button" class="knopf knopf--ki" data-k="fotos" title="Entwurf, der freundlich um Fotos bittet">${ICON_KI} Fotos anfordern</button>` : ""}
          ${antwort ? "" : `<button type="button" class="knopf" data-k="selbst">Selbst schreiben</button>`}
        </div>
        <div class="entwurf__editor" data-teil="editor" ${antwort ? "" : "hidden"}>
          <div class="ki-hinweise" data-teil="hinweise" hidden></div>
          ${k.auftrag && antwort?.anhaenge?.length ? `<p class="leise">Im Anhang: ${antwort.anhaenge.length} ${antwort.anhaenge.length === 1 ? "Foto" : "Fotos"} aus der Nachricht.</p>` : ""}
          ${absenderL.length ? `<label class="feld feld--eng"><span>Absender</span><select name="absender">
            <option value="">${esc(zustand.profil?.firma || "Firma")}</option>
            ${absenderL.map((a) => `<option value="${esc(a.id)}" ${a.id === absenderStart ? "selected" : ""}>${esc(a.bezeichnung || a.name)}${a.bezeichnung ? ` (${esc(a.name)})` : ""}</option>`).join("")}
          </select></label>` : ""}
          <p class="hinweisbox rundtipp" data-teil="rundtipp" hidden>Das klingt nach einem Schreiben an alle Mietparteien.
            <button type="button" class="knopf knopf--klein knopf--primaer" data-anhaus>An alle im Haus senden</button>
            <button type="button" class="knopf knopf--klein knopf--leise" data-rundtipp-weg>Nein, nur an diesen Empfänger</button></p>
          <div class="formraster formraster--zwei">
            ${k.haus
              ? `<div class="feld"><span>An</span><p class="rundan" data-teil="rundan">Die Mietparteien rechts (jede bekommt eine eigene E-Mail)</p><input type="hidden" name="an" value=""></div>`
              : `<div class="feld">
                  <span class="feld__zeile"><span>An (E-Mail)</span>${anHausMoeglich ? `<button type="button" class="textknopf" data-anhaus>An alle im Haus</button>` : ""}</span>
                  <input type="email" name="an" aria-label="An (E-Mail)" value="${esc((umzug ? "" : antwort?.empfaenger_email) || standardAn)}" placeholder="name@beispiel.de" autocomplete="off"></div>`}
            <label class="feld"><span>Betreff</span><input name="betreff" value="${esc(antwort?.betreff || "")}"></label>
          </div>
          <label class="feld"><span>Text</span><textarea name="text" rows="10" class="entwurf__text">${esc(antwort?.text || "")}</textarea></label>
          <p class="signatur" data-teil="signatur">${signaturHtml(absenderL.find((a) => a.id === absenderStart) || null)}</p>
          <div class="ueberarbeiten" ${k.auftrag ? "hidden" : ""}>
            <label class="feld"><span>Änderungswunsch an die KI</span>
              <span class="diktat"><input name="aenderung" placeholder="z. B. kürzer, oder: Termin Dienstag 10 Uhr nennen" autocomplete="off">${mikroKnopf()}</span></label>
            <button type="button" class="knopf" data-k="ueberarbeiten">${ICON_KI} Überarbeiten</button>
          </div>
          <div class="entwurf__aktionen">
            ${briefZuerst ? `<button type="button" class="knopf knopf--primaer" data-k="brief">Als Brief</button>` : ""}
            <button type="button" class="knopf ${briefZuerst ? "" : "knopf--primaer"}" data-k="senden">${k.haus ? "Per E-Mail an alle senden" : "Per E-Mail senden"}</button>
            ${k.auftrag ? `<button type="button" class="knopf" data-k="drucken">Drucken</button>` : briefZuerst ? "" : `<button type="button" class="knopf" data-k="brief">${k.haus ? "Als Aushang/Brief" : "Als Brief"}</button>`}
            <button type="button" class="knopf" data-k="speichern">Entwurf speichern</button>
            <button type="button" class="knopf knopf--leise knopf--gefahr" data-k="verwerfen">Verwerfen</button>
          </div>
          <p class="leise entwurf__hinweis">Nichts geht automatisch raus. Erst „Per E-Mail senden“ oder „${k.auftrag ? "Drucken" : "Als Brief"}“ verlässt die App.</p>
        </div>
      </div>
    </section>`;

  const feld = (name) => el.querySelector(`[name="${name}"]`);
  const editor = el.querySelector('[data-teil="editor"]');
  const hinweisBox = el.querySelector('[data-teil="hinweise"]');
  verbindeDiktat(el);
  const textGroesse = wachsen(feld("text"));
  wachsen(feld("anweisung"));

  if (k.hinweise?.length) setTimeout(() => zeigeHinweise(k.hinweise));
  const gewaehlterAbsender = () => absenderL.find((a) => a.id === feld("absender")?.value) || null;
  const aktSignatur = () => signaturFuer(gewaehlterAbsender());
  // Für die KI: als wer wird geschrieben?
  const kiAbsender = () => { const a = gewaehlterAbsender(); return a ? { name: a.name, bezeichnung: a.bezeichnung || null } : null; };
  feld("absender")?.addEventListener("change", () => {
    el.querySelector('[data-teil="signatur"]').innerHTML = signaturHtml(gewaehlterAbsender());
    if (antwort) speichere().catch(() => null);
  });
  const werte = () => ({
    an: feld("an").value.trim(),
    betreff: feld("betreff").value.trim(),
    text: feld("text").value.replace(/\s+$/, ""),
    anweisung: feld("anweisung").value.trim(),
  });

  function zeigeEditor(daten) {
    if (daten) {
      if (daten.betreff != null) feld("betreff").value = daten.betreff;
      if (daten.text != null) feld("text").value = daten.text;
    }
    editor.hidden = false;
    textGroesse();
    pruefeRundtipp();
  }
  function zeigeHinweise(liste) {
    hinweisBox.hidden = !liste?.length;
    hinweisBox.innerHTML = liste?.length
      ? `<strong>Bitte vor dem Senden prüfen:</strong><ul>${liste.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>`
      : "";
  }

  // Klingt der Text nach „an alle“? Dann Hinweis über dem Feld „An“ (nur Vorschlag, umgestellt wird nichts)
  const RUND_ANREDE = /^\s*(sehr geehrte|liebe|hallo|guten tag)?,?\s*(an\s+)?(alle\s+)?(mieterinnen\s+und\s+mieter|mieter\s*innen|mieter\*innen|mietparteien|hausbewohner(innen)?|bewohnerinnen\s+und\s+bewohner|liebe\s+nachbarn|nachbarinnen\s+und\s+nachbarn)\b/i;
  const rundtipp = el.querySelector('[data-teil="rundtipp"]');
  let rundtippWeg = false;
  function pruefeRundtipp() {
    if (!rundtipp || !anHausMoeglich) return;
    rundtipp.hidden = rundtippWeg || !RUND_ANREDE.test(feld("text").value);
  }
  el.querySelector("[data-rundtipp-weg]")?.addEventListener("click", () => { rundtippWeg = true; pruefeRundtipp(); });
  feld("text").addEventListener("input", pruefeRundtipp);

  // Haus für das Rundschreiben: aus Mietpartei, Nachricht oder gewähltem Haus; sonst kurz fragen
  async function hausFuerRund() {
    const bekannt = hausId() || k.nachricht?.objekt_id || null;
    if (bekannt) return bekannt;
    const objekte = zustand.stamm?.objekte || [];
    if (objekte.length === 1) return objekte[0].id;
    const fd = await dialogFormular(`
      <h2>An alle Mietparteien welches Hauses?</h2>
      <label class="feld"><span>Haus</span><select name="haus" required>
        ${objekte.map((o) => `<option value="${esc(o.id)}">${esc(o.bezeichnung)}</option>`).join("")}</select></label>
      <div class="knopfreihe"><button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button>
        <button class="knopf knopf--primaer" value="ok">Weiter</button></div>`);
    return fd ? String(fd.get("haus") || "") || null : null;
  }
  // Umziehen ins Rundschreiben: Anweisung, Betreff, Text und ein gespeicherter Entwurf wandern mit (kein zweiter Entwurf)
  async function zumHaus() {
    const haus = await hausFuerRund();
    if (!haus) return;
    const alt = el.mitnehmen();
    zustand.vorbelegung = {
      nachricht_id: null,
      anweisung: alt.anweisung || (k.nachricht ? `Rundschreiben an alle Mietparteien wegen: ${k.nachricht.betreff || "Nachricht"}` : ""),
      uebernahme: {
        betreff: String(alt.betreff || "").replace(/^(aw|re|wg):\s*/i, ""), text: alt.text, editor: alt.editor || !!alt.text?.trim(),
        antwortId: alt.antwortId, eigenesThema: alt.eigenesThema, rund: true,
      },
    };
    zustand.themaVorgabe = k.nachricht?.thema_id || (alt.eigenesThema ? null : k.themaId) || null;
    geheZu(`#/schreiben/h-${haus}`);
  }
  el.addEventListener("click", (e) => {
    if (e.target.closest("[data-anhaus]")) zumHaus().catch((err) => melde(err.message, "fehler"));
  });

  // Vorgang: der der Nachricht, ein vorgegebener (aus der Vorgangsseite) oder ein neuer
  let eigenesThema = umzug ? !!umzug.eigenesThema : !k.nachricht && !k.themaId;
  async function themaId(v) {
    if (antwort?.thema_id) return antwort.thema_id;
    if (k.nachricht) return vorgaenge.themaFuerNachricht(k.nachricht);
    if (k.themaId) return k.themaId;
    const neu = await vorgaenge.neuesThema({
      betreff: v.betreff, an: v.an, mieterId: k.mieter?.id, kontaktId: k.kontakt?.id, dienstleisterId: k.dienstleister?.id,
      kostentraegerId: k.kostentraeger?.id, objektId: k.haus?.id || k.objektId?.() || null,
    });
    // Aus einer Notiz gestartet: die Notiz zeigt danach auf diesen Vorgang
    if (k.aufgabeId) await db.speichereAufgabe(k.aufgabeId, { thema_id: neu }).catch(() => null);
    return neu;
  }
  async function speichere(extra = {}) {
    const v = werte();
    const thema = await themaId(v);
    // Eigenes Schreiben: Vorgang heißt wie der Betreff, solange noch nichts gesendet ist
    if (eigenesThema && antwort?.thema_id && (!antwort.status || antwort.status === "entwurf") && v.betreff) {
      await db.speichereThema(thema, { titel: vorgaenge.betreffTitel(v.betreff), betreff_norm: vorgaenge.betreffNorm(v.betreff), partner_email: v.an ? v.an.toLowerCase() : null }).catch(() => null);
    }
    antwort = await db.speichereAntwort(antwort?.id, {
      thema_id: thema,
      nachricht_id: k.nachricht?.id || null,
      mieter_id: k.mieter?.id || null,
      empfaenger_email: v.an || null,
      empfaenger_name: k.auftrag ? antwort.empfaenger_name : k.dienstleister ? k.dienstleister.name
        : k.kontakt ? kontaktName(k.kontakt) : k.kostentraeger ? k.kostentraeger.name
        : k.haus ? `Mietparteien ${k.haus.bezeichnung}`
        : k.nachricht?.absender_name || (k.mieter ? mieterName(k.mieter) : null),
      ...(k.haus ? { objekt_id: k.haus.id } : {}),
      ...(k.auftrag ? {} : { absender: gewaehlterAbsender() }),
      ...(k.dienstleister ? { dienstleister_id: k.dienstleister.id } : {}),
      ...(k.kontakt ? { kontakt_id: k.kontakt.id } : {}),
      ...(k.kostentraeger ? { kostentraeger_id: k.kostentraeger.id } : {}),
      betreff: v.betreff,
      text: v.text,
      anweisung: v.anweisung || null,
      ...extra,
    });
    const kopf = el.querySelector(".flaeche__kopf");
    if (kopf && !kopf.querySelector(".marker")) kopf.insertAdjacentHTML("beforeend", `<span class="marker marker--messing">Entwurf gespeichert</span>`);
    return antwort;
  }

  function kiPruefen() {
    if (zustand.ki?.ki) return true;
    melde("Die KI ist noch nicht eingerichtet (Einstellungen → Einrichtung). Sie können den Text selbst schreiben.", "fehler");
    return false;
  }

  // Nach dem Versand: automatisch in die Ablage (abschaltbar in den Einstellungen)
  function hausId() {
    const w = k.mieter && wohnungVon(k.mieter.wohnung_id);
    return k.haus?.id || k.objektId?.() || w?.objekt_id || k.dienstleister?.objekt_id || null;
  }
  // Was abgelegt wird (für den Namensvorschlag im Bestätigungsdialog und das Ablegen danach)
  function eintragJetzt(kanal, an, extra = {}) {
    const a = { ...antwort, betreff: werte().betreff, text: werte().text, gesendet_am: new Date().toISOString(), empfaenger_email: an || antwort.empfaenger_email };
    return eintragAntwort(a, { nachricht: k.nachricht, mieter: k.mieter, objektId: hausId(), kanal, an, ...extra });
  }
  function ablegenNachVersand(kanal, an, extra = {}) {
    return ablage.automatischAblegen(eintragJetzt(kanal, an, extra), { nachher: k.nachEnde, meldung: extra.meldung !== false, vorgabe: extra.vorgabe || null });
  }

  async function alsGesendetMarkieren(an, kanal) {
    await db.speichereAntwort(antwort.id, { status: kanal === "druck" ? "als_brief" : "gesendet", gesendet_am: new Date().toISOString(), empfaenger_email: an || antwort.empfaenger_email || null });
    await vorgaenge.beruehre(antwort.thema_id);
    if (k.nachricht && !k.auftrag) await db.aendereNachricht(k.nachricht.id, { status: "beantwortet" });
    if (k.kontakt) await vermerkeBeimKontakt(kanal === "druck" ? "Brief" : "E-Mail");
    if (k.mieter) {
      await db.protokolliereVorgang({
        mieter_id: k.mieter.id, typ: k.auftrag ? "auftrag" : "antwort",
        titel: k.auftrag ? `Auftrag an ${antwort.empfaenger_name || "Handwerker"}: ${werte().betreff || "Auftrag"}` : `E-Mail: ${werte().betreff || "Antwort"}`,
        details: { antwort_id: antwort.id, an, kanal },
      });
    }
  }

  // Beim Kontakt im Verlauf vermerken, was rausging (Mini-CRM)
  async function vermerkeBeimKontakt(weg) {
    await db.speichereVerlauf(null, {
      kontakt_id: k.kontakt.id, art: weg === "E-Mail" ? "email" : "notiz", datum: heuteISO(),
      text: `${weg} gesendet: ${werte().betreff || "(ohne Betreff)"}`,
    }).catch(() => null);
  }

  // Rundschreiben: jede angehakte Mietpartei mit E-Mail bekommt eine eigene Mail (Kopie je Mietpartei, steht in ihrer Akte).
  // Der Entwurf selbst bleibt im Vorgang als „Rundschreiben an n Mietparteien“.
  async function rundSenden(knopf) {
    const v = werte();
    if (!v.text.trim()) return melde("Der Text ist leer.", "fehler");
    if (!v.betreff) { feld("betreff").focus(); return melde("Bitte einen Betreff eintragen.", "fehler"); }
    const alle = k.rundEmpfaenger?.() || [];
    if (!alle.length) return melde("Bitte rechts mindestens eine Mietpartei anhaken.", "fehler");
    const mitMail = alle.filter((m) => istEmail(m.email));
    const ohne = alle.filter((m) => !istEmail(m.email));
    try { await speichere(); } catch (err) { return melde(err.message, "fehler"); }
    if (!zustand.ki?.versand) return melde("Der E-Mail-Versand aus der App ist noch nicht eingerichtet. Bitte „Als Aushang/Brief“ nutzen.", "fehler");
    if (!mitMail.length) return melde("Keine der gewählten Mietparteien hat eine E-Mail-Adresse. Bitte „Als Aushang/Brief“ nutzen.", "info");
    const voll = `${v.text.trim()}\n\nMit freundlichen Grüßen\n${aktSignatur()}`;
    // Kopie an die eigene Adresse (Absender-E-Mail, sonst „Antworten gehen an“, sonst Briefkopf-E-Mail)
    const p = zustand.profil || {};
    const eigene = [gewaehlterAbsender()?.email, p.antwort_email, p.email].find((x) => istEmail(x)) || null;
    const ok = await frage("Rundschreiben senden?", `
      <p><strong>${mitMail.length} ${mitMail.length === 1 ? "E-Mail" : "E-Mails"}</strong>, jede einzeln – keiner sieht die Adressen der anderen:</p>
      <ul class="rundliste">${mitMail.map((m) => `<li>${esc(mieterName(m))} <span class="leise">${esc(m.email)}</span></li>`).join("")}</ul>
      ${eigene ? `<p>Eine Kopie geht an <strong>${esc(eigene)}</strong> (für euren Posteingang).</p>` : ""}
      ${ohne.length ? `<p class="hinweisbox">Ohne E-Mail (${ohne.length}): ${ohne.map((m) => esc(mieterName(m))).join(", ")}. Für sie danach „Als Aushang/Brief“.</p>` : ""}
      <p>Betreff: ${esc(v.betreff)}</p>
      <div class="mailvorschau">${esc(voll)}</div>
      ${absenderHinweis(gewaehlterAbsender())}`, `${mitMail.length} ${mitMail.length === 1 ? "E-Mail" : "E-Mails"} senden`);
    if (!ok) return;
    const gesendet = [], fehler = [];
    await beschaeftigt(el, knopf, "Wird gesendet …", async () => {
      for (const m of mitMail) {
        let kopie = null;
        try {
          kopie = await db.speichereAntwort(null, {
            mieter_id: m.id, objekt_id: k.haus.id, empfaenger_email: m.email, empfaenger_name: mieterName(m),
            betreff: v.betreff, text: v.text, anweisung: `Rundschreiben ${k.haus.bezeichnung}`, absender: gewaehlterAbsender(),
          });
          await db.funktion("versand", { antwort_id: kopie.id, an: m.email });
          gesendet.push(m);
        } catch (err) {
          if (kopie) await db.loescheAntwort(kopie.id).catch(() => null);
          fehler.push(`${mieterName(m)}: ${err.message}`);
        }
      }
      if (eigene && gesendet.length) {
        let kopie = null;
        try {
          kopie = await db.speichereAntwort(null, {
            objekt_id: k.haus.id, empfaenger_email: eigene, empfaenger_name: "Kopie an die eigene Adresse",
            betreff: v.betreff, text: v.text, anweisung: `Rundschreiben ${k.haus.bezeichnung} (Kopie)`, absender: gewaehlterAbsender(),
          });
          await db.funktion("versand", { antwort_id: kopie.id, an: eigene });
        } catch (err) {
          if (kopie) await db.loescheAntwort(kopie.id).catch(() => null);
          fehler.push(`Kopie an ${eigene}: ${err.message}`);
        }
      }
    });
    if (fehler.length) melde(`Nicht gesendet: ${fehler.join("; ")}`, "fehler");
    if (!gesendet.length) return;
    melde(`Rundschreiben an ${gesendet.length} ${gesendet.length === 1 ? "Mietpartei" : "Mietparteien"} gesendet.`, "ok");
    await vorgaenge.beruehre(antwort.thema_id);
    // Ohne E-Mail: gleich Aushang/Brief (der markiert den Entwurf dann als Brief)
    if (ohne.length && await frage("Noch ohne E-Mail", `<p>${ohne.map((m) => esc(mieterName(m))).join(", ")} ${ohne.length === 1 ? "hat" : "haben"} keine E-Mail-Adresse.
      Jetzt einen Aushang bzw. Brief erstellen?</p>`, "Als Aushang/Brief")) {
      return aktionen.brief(knopf);
    }
    await db.speichereAntwort(antwort.id, {
      status: "gesendet", gesendet_am: new Date().toISOString(),
      empfaenger_name: `Rundschreiben an ${gesendet.length} ${gesendet.length === 1 ? "Mietpartei" : "Mietparteien"} (${k.haus.bezeichnung})`,
    });
    ablegenNachVersand("email", null);
    k.nachEnde();
  }

  const aktionen = {
    async entwerfen(knopf) {
      if (!kiPruefen()) return;
      const v = werte();
      if (!k.nachricht && !v.anweisung) {
        feld("anweisung").focus();
        return melde("Bitte sagen oder schreiben Sie kurz, was im Schreiben stehen soll.", "fehler");
      }
      await beschaeftigt(el, knopf, "KI schreibt …", async () => {
        try {
          const r = k.auftrag
            ? await db.funktion("ki", { aktion: "auftrag", nachricht_id: k.nachricht.id, dienstleister_id: antwort.dienstleister_id, anweisung: v.anweisung || null })
            : await db.funktion("ki", {
              aktion: "entwurf", nachricht_id: k.nachricht?.id || null, mieter_id: k.mieter?.id || null, anweisung: v.anweisung || null,
              dienstleister_id: k.dienstleister?.id || null, objekt_id: k.haus?.id || k.objektId?.() || null,
              kontakt_id: k.kontakt?.id || null, kostentraeger_id: k.kostentraeger?.id || null,
              rundschreiben: !!k.haus, absender: kiAbsender(),
            });
          zeigeEditor(r);
          zeigeHinweise(r.hinweise);
          await speichere({ ki_modell: r.modell || null });
          feld("text").scrollIntoView({ behavior: "smooth", block: "center" });
        } catch (err) {
          melde(err.message, "fehler");
        }
      });
      if (antwort) {
        knopf.innerHTML = `${ICON_KI} Neu entwerfen`;
        el.querySelector('[data-k="selbst"]')?.remove();
      }
    },
    async fotos(knopf) {
      const f = feld("anweisung");
      if (!/foto/i.test(f.value)) f.value = [f.value.trim(), "Bitte freundlich um 1 bis 3 Fotos vom Schaden bitten (einfach als Antwort auf diese E-Mail) und fragen, seit wann es so ist."].filter(Boolean).join("\n");
      return aktionen.entwerfen(el.querySelector('[data-k="entwerfen"]') || knopf);
    },
    async drucken(knopf) {
      const v = werte();
      if (!v.text.trim()) return melde("Der Text ist leer.", "fehler");
      try { await speichere(); } catch (err) { return melde(err.message, "fehler"); }
      await beschaeftigt(el, knopf, "Druckansicht …", async () => {
        const urls = await Promise.all((antwort.anhaenge || []).map((a) => db.dateiAdresse(a.bucket, a.pfad).catch(() => null)));
        await druckeAuftrag({ an: antwort.empfaenger_name, betreff: v.betreff, text: v.text, signatur: aktSignatur(), fotos: urls.filter(Boolean) });
      });
      const gedruckt = await ablage.frageMitAblage("Gedruckt?", "<p>Dann wird der Auftrag im Verlauf vermerkt.</p>", "Ja, vermerken", eintragJetzt("druck", null));
      if (gedruckt) {
        try {
          await alsGesendetMarkieren(null, "druck");
          melde("Auftrag vermerkt.", "ok");
          ablegenNachVersand("druck", null, { vorgabe: gedruckt.vorgabe });
          k.nachEnde();
        } catch (err) { melde(err.message, "fehler"); }
      }
    },
    async ueberarbeiten(knopf) {
      if (!kiPruefen()) return;
      const v = werte();
      const aenderung = feld("aenderung").value.trim();
      if (!aenderung) {
        feld("aenderung").focus();
        return melde("Bitte kurz sagen, was geändert werden soll.", "fehler");
      }
      await beschaeftigt(el, knopf, "KI überarbeitet …", async () => {
        try {
          const r = await db.funktion("ki", {
            aktion: "entwurf", nachricht_id: k.nachricht?.id || null, mieter_id: k.mieter?.id || null,
            dienstleister_id: k.dienstleister?.id || null, objekt_id: k.haus?.id || k.objektId?.() || null,
            kontakt_id: k.kontakt?.id || null, kostentraeger_id: k.kostentraeger?.id || null,
            rundschreiben: !!k.haus, absender: kiAbsender(),
            anweisung: v.anweisung || null, bisher: { betreff: v.betreff, text: v.text }, aenderung,
          });
          zeigeEditor(r);
          zeigeHinweise(r.hinweise);
          feld("aenderung").value = "";
          await speichere({ ki_modell: r.modell || null });
        } catch (err) {
          melde(err.message, "fehler");
        }
      });
    },
    selbst() {
      const anrede = k.haus ? "Sehr geehrte Mieterinnen und Mieter,"
        : k.dienstleister || k.kostentraeger ? "Sehr geehrte Damen und Herren,"
        : k.kontakt ? (k.kontakt.nachname ? `Guten Tag ${kontaktName(k.kontakt)},` : "Sehr geehrte Damen und Herren,")
        : k.mieter ? briefanrede(k.mieter) + "," : "Guten Tag,";
      zeigeEditor({
        betreff: k.nachricht ? (/^(aw|re):/i.test(k.nachricht.betreff || "") ? k.nachricht.betreff : `AW: ${k.nachricht.betreff || ""}`.trim()) : "",
        text: `${anrede}\n\n`,
      });
      el.querySelector('[data-k="selbst"]')?.remove();
      const t = feld("text");
      t.focus();
      t.setSelectionRange(t.value.length, t.value.length);
    },
    async speichern(knopf) {
      await beschaeftigt(el, knopf, "Speichert …", async () => {
        try { await speichere(); melde("Entwurf gespeichert.", "ok"); } catch (err) { melde(err.message, "fehler"); }
      });
    },
    async verwerfen() {
      if (!(await frage("Entwurf verwerfen?", "<p>Der Text wird gelöscht.</p>", "Verwerfen", { gefahr: true }))) return;
      try {
        if (antwort?.id) await db.loescheAntwort(antwort.id);
        melde("Entwurf verworfen.", "ok");
        k.nachEnde();
      } catch (err) { melde(err.message, "fehler"); }
    },
    async senden(knopf) {
      if (k.haus) return rundSenden(knopf);
      const v = werte();
      if (!istEmail(v.an)) { feld("an").focus(); return melde("Bitte eine gültige E-Mail-Adresse eintragen.", "fehler"); }
      if (!v.text.trim()) return melde("Der Text ist leer.", "fehler");
      try { await speichere(); } catch (err) { return melde(err.message, "fehler"); }
      const voll = `${v.text.trim()}\n\nMit freundlichen Grüßen\n${aktSignatur()}`;
      const abs = gewaehlterAbsender();

      const anzahlFotos = k.auftrag ? (antwort.anhaenge || []).length : 0;
      if (zustand.ki?.versand) {
        const ok = await ablage.frageMitAblage("E-Mail jetzt senden?", `
          <p>An <strong>${esc(v.an)}</strong><br>Betreff: ${esc(v.betreff || "Ihre Nachricht")}${anzahlFotos ? `<br>Anhang: ${anzahlFotos} ${anzahlFotos === 1 ? "Foto" : "Fotos"}` : ""}</p>
          <div class="mailvorschau">${esc(voll)}</div>
          ${absenderHinweis(abs)}`,
        "Jetzt senden", eintragJetzt("email", v.an));
        if (!ok) return;
        const erfolg = await beschaeftigt(el, knopf, "Wird gesendet …", async () => {
          try {
            await db.funktion("versand", { antwort_id: antwort.id, an: v.an });
            return true;
          } catch (err) {
            if (err.code === "versand_fehlt") return false;
            melde(err.message, "fehler");
            return null;
          }
        });
        if (erfolg) {
          melde(`E-Mail an ${v.an} gesendet.`, "ok");
          await vorgaenge.beruehre(antwort.thema_id);
          if (k.kontakt) await vermerkeBeimKontakt("E-Mail");
          ablegenNachVersand("email", v.an, { vorgabe: ok.vorgabe });
          return k.nachEnde();
        }
        if (erfolg === null) return;
      }

      // Rückfall: Das eigene E-Mail-Programm öffnen
      const ok = await frage("Im E-Mail-Programm öffnen", `
        <p>Der direkte Versand aus der App ist noch nicht eingerichtet. Die E-Mail öffnet sich in Ihrem E-Mail-Programm.
        Dort prüfen und abschicken.</p>${anzahlFotos ? `<p><strong>Die Fotos bitte im E-Mail-Programm selbst anhängen</strong> (oder „Drucken“ nutzen).</p>` : ""}`, "E-Mail-Programm öffnen");
      if (!ok) return;
      window.location.href = `mailto:${encodeURIComponent(v.an)}?subject=${encodeURIComponent(v.betreff)}&body=${encodeURIComponent(voll)}`;
      await new Promise((r) => setTimeout(r, 600));
      const raus = await ablage.frageMitAblage("Abgeschickt?", `<p>Wenn die E-Mail raus ist, wird ${k.auftrag ? "der Auftrag im Verlauf vermerkt" : "die Nachricht als beantwortet markiert"}.</p>`,
        k.auftrag ? "Ja, vermerken" : "Ja, als beantwortet markieren", eintragJetzt("email-programm", v.an));
      if (raus) {
        try {
          await alsGesendetMarkieren(v.an, "email-programm");
          melde("Als beantwortet markiert.", "ok");
          ablegenNachVersand("email-programm", v.an, { vorgabe: raus.vorgabe });
          k.nachEnde();
        } catch (err) { melde(err.message, "fehler"); }
      }
    },
    async brief(knopf) {
      const v = werte();
      if (!v.text.trim()) return melde("Der Text ist leer.", "fehler");
      try { await speichere(); } catch (err) { return melde(err.message, "fehler"); }
      const empf = await empfaengerDialog(k);
      if (!empf) return;
      let bytes, dateiname, uOption;
      const ergebnis = await beschaeftigt(el, knopf, "Wird vorbereitet …", async () => {
        try {
          if (!zustand.vorlagen?.some((x) => x.schluessel === "antwort")) zustand.vorlagen = await db.ladeVorlagen();
          const vorlage = zustand.vorlagen.find((x) => x.schluessel === "antwort");
          if (!vorlage) throw new Error("Die Vorlage „Antwortschreiben“ fehlt.");
          const w = k.mieter && wohnungVon(k.mieter.wohnung_id);
          const o = w && objektVon(w.objekt_id);
          const datei = await db.ladeVorlagenDatei(vorlage);
          try {
            const daten = antwortDaten({
              profil: profilFuer(zustand.profil || {}, gewaehlterAbsender()), mieter: k.mieter, wohnung: w || {}, objekt: o || {},
              empfaenger: empf, betreff: v.betreff, text: v.text,
            });
            // Unterschrift: bei Ämtern und Vertraglichem vorbelegt, bei Aushängen nicht (in der Vorschau umschaltbar)
            const soll = unterschrift.sollUnterschreiben({ kostentraeger: !!k.kostentraeger, haus: !!k.haus, betreff: v.betreff, text: v.text });
            uOption = await unterschrift.vorschauOption(soll, (u) => (bytes = fuelleVorlage(datei, daten, { unterschrift: u })));
            uOption.erzeuge(uOption.an);
          } catch (err) {
            throw new Error("Die Vorlage enthält einen Fehler: " + vorlagenFehler(err));
          }
          dateiname = `${heuteISO()}_${k.haus ? "Aushang" : "Schreiben"}_${dateiTeil(k.haus ? k.haus.bezeichnung : (k.kostentraeger || k.kontakt ? null : k.mieter?.nachname) || empf.name || "Empfaenger")}.docx`;
          return true;
        } catch (err) {
          melde(err.message, "fehler");
          return false;
        }
      });
      if (!ergebnis) return;
      const vorgangId = crypto.randomUUID();
      const anrede = v.text.split(/\n/)[0] || "Guten Tag,";
      let ablageLaeuft = null;
      // Dateiname nach eurem Schema: sichtbar in der Vorschau, die KI schlägt ihn vor
      const briefEintrag = eintragJetzt("brief", null, { bytes: () => bytes, vorgangId: k.mieter ? vorgangId : null });
      const namensVorschlag = ablage.nameVorschlag(briefEintrag);
      const gespeichert = await zeigeDokument({
        titel: v.betreff || "Schreiben",
        untertitel: `An ${empf.name}`,
        bytes,
        dateiname,
        name: { vorschlag: namensVorschlag },
        hinweis: k.mieter
          ? "Noch nicht gespeichert. Beim Herunterladen, Drucken oder Versenden wird der Brief in der Akte abgelegt."
          : "Beim Herunterladen, Drucken oder Versenden wird das Schreiben als erledigt vermerkt.",
        unterschrift: uOption,
        email: { an: v.an, betreff: v.betreff, text: `${anrede}\n\nim Anhang erhalten Sie unser Schreiben.\n\nMit freundlichen Grüßen\n${aktSignatur()}` },
        melde,
        vorAbschluss: async ({ titel }) => {
          if (k.mieter) {
            await db.archiviereSchreiben({
              vorgangId, mieterId: k.mieter.id, bytes,
              vorgang: { typ: "antwort", titel: `Brief: ${v.betreff || "Schreiben"}`, details: { antwort_id: antwort.id, datei: `${titel}.docx` } },
            });
          }
          await db.speichereAntwort(antwort.id, { status: "als_brief" });
          await vorgaenge.beruehre(antwort.thema_id);
          if (k.kontakt) await vermerkeBeimKontakt("Brief");
          if (k.nachricht) await db.aendereNachricht(k.nachricht.id, { status: "beantwortet" });
          const h = $("#dialog [data-v=hinweis]");
          if (h) h.textContent = k.mieter ? "In der Akte gespeichert." : "Vermerkt.";
          ablageLaeuft = ablage.automatischAblegen(briefEintrag, { meldung: false, vorgabe: { titel, vorschlag: namensVorschlag } });
          ablageLaeuft.then((doc) => {
            const h2 = $("#dialog [data-v=hinweis]");
            if (doc && h2) h2.textContent += ` Abgelegt in „${ablage.ordnerAnzeige(doc.ordner)}“.`;
          });
        },
      });
      if (gespeichert) {
        melde("Brief erstellt und vermerkt.", "ok");
        k.nachEnde();
        if (ablageLaeuft) ablageLaeuft.then((doc) => ablage.zeigeAblageMeldung(doc, { nachher: k.nachEnde }));
      }
    },
  };

  for (const b of $$("[data-k]", el)) {
    b.addEventListener("click", () => aktionen[b.dataset.k](b));
  }

  // Für einen Wechsel des Empfängers: was bisher eingegeben bzw. entworfen wurde
  el.mitnehmen = () => ({
    ...werte(), editor: !editor.hidden, eigenesThema, aufgabeId: k.aufgabeId || null,
    antwortId: antwort?.id && (!antwort.status || antwort.status === "entwurf") && !k.nachricht && !k.auftrag ? antwort.id : null,
  });
  if (umzug && (umzug.antwort || (umzug.editor && (umzug.text || umzug.betreff)))) {
    // Die Felder der vorigen Seite sind neuer als der gespeicherte Entwurf (ungespeicherte Änderungen)
    zeigeEditor(umzug.editor ? { betreff: umzug.betreff, text: umzug.text } : null);
    el.querySelector('[data-k="selbst"]')?.remove();
    const passt = k.haus && umzug.rund && RUND_ANREDE.test(umzug.text || "");
    zeigeHinweise([passt
      ? "Aus dem Schreiben an eine Person ist ein Rundschreiben geworden: rechts prüfen, wer es bekommt."
      : "Der Text wurde für den vorigen Empfänger geschrieben: Anrede und Inhalt prüfen oder „Neu entwerfen“."]);
    if (umzug.antwort) {
      // Den Entwurf auf den neuen Empfänger umschreiben (alte Zuordnung löschen), den eigenen Vorgang mitnehmen
      const ziel = {
        mieter_id: k.mieter?.id || null, dienstleister_id: k.dienstleister?.id || null,
        kontakt_id: k.kontakt?.id || null, kostentraeger_id: k.kostentraeger?.id || null, objekt_id: k.haus?.id || null,
      };
      speichere(ziel).then(async (a) => {
        if (eigenesThema && a?.thema_id) await db.speichereThema(a.thema_id, { ...ziel, objekt_id: k.objektId?.() || null, partner_email: feld("an").value.trim().toLowerCase() || null }).catch(() => null);
      }).catch((err) => melde(err.message, "fehler"));
    }
  }
}

// Druckansicht für einen Auftrag (Text und Fotos), ohne Datei-Download
async function druckeAuftrag({ an, betreff, text, signatur, fotos }) {
  const p = zustand.profil || {};
  const kopf = [p.firma, p.strasse, [p.plz, p.ort].filter(Boolean).join(" "), p.telefon ? `Tel. ${p.telefon}` : "", p.email].filter(Boolean);
  await drucke(`
    <div class="druck__kopf">${kopf.map(esc).join(" · ")}</div>
    <p>${esc(an || "")}</p>
    <p class="druck__datum">${esc(datumDE(new Date()))}</p>
    <h1>${esc(betreff || "Auftrag")}</h1>
    <div class="druck__text">${esc(text)}\n\nMit freundlichen Grüßen\n${esc(signatur)}</div>
    ${fotos.map((u, i) => `<figure><img src="${esc(u)}" alt="Foto ${i + 1}"><figcaption>Foto ${i + 1}</figcaption></figure>`).join("")}`);
}

// Anschrift für den Brief wählen (Mietpartei, Kostenträger, Absender oder frei)
async function empfaengerDialog(k) {
  const vorschlaege = [];
  const m = k.mieter;
  let standard = null;
  const ktAnschrift = (kt) => ({
    wert: "kt", label: `Kostenträger: ${kt.name}`, name: kt.name, zusatz: kt.abteilung || "",
    strasse: kt.strasse || "", plz_ort: [kt.plz, kt.ort].filter(Boolean).join(" "),
  });
  if (k.kontakt) {
    // Adresse ist ein freies Feld: „Straße 1, 12345 Ort“ oder mehrzeilig
    const teile = String(k.kontakt.adresse || "").split(/\n|,/).map((x) => x.trim()).filter(Boolean);
    const plzIdx = teile.findIndex((x) => /^\d{5}\b/.test(x));
    const name = [k.kontakt.vorname, k.kontakt.nachname].filter(Boolean).join(" ");
    vorschlaege.push({
      wert: "kontakt", label: `Kontakt: ${kontaktName(k.kontakt)}`,
      name: name || k.kontakt.firma || "", zusatz: name ? k.kontakt.firma || "" : "",
      strasse: plzIdx > 0 ? teile[plzIdx - 1] : plzIdx < 0 ? teile[0] || "" : "",
      plz_ort: plzIdx >= 0 ? teile[plzIdx] : teile[1] || "",
    });
    standard = "kontakt";
  }
  if (k.kostentraeger && !m) {
    vorschlaege.push(ktAnschrift(k.kostentraeger));
    standard = "kt";
  }
  if (k.dienstleister) {
    vorschlaege.push({ wert: "dienst", label: `Handwerker: ${k.dienstleister.name}`, name: k.dienstleister.name, zusatz: "", strasse: "", plz_ort: "" });
    standard = "dienst";
  }
  if (m) {
    const w = wohnungVon(m.wohnung_id);
    const o = w && objektVon(w.objekt_id);
    vorschlaege.push({
      wert: "mieter", label: `Mietpartei: ${mieterName(m)}`,
      name: anschriftAnrede(m) + mieterName(m), zusatz: w ? `Wohnung ${w.bezeichnung}` : "",
      strasse: o?.strasse || "", plz_ort: [o?.plz, o?.ort].filter(Boolean).join(" "),
    });
    const kt = k.kostentraeger || kostentraegerVon(m.kostentraeger_id);
    if (kt) {
      vorschlaege.push(ktAnschrift(kt));
      if (k.kostentraeger) standard = "kt";
      const von = norm(k.nachricht?.absender_email);
      if (k.nachricht && ((kt.email && von === norm(kt.email)) || /jobcenter|sozialamt|landratsamt|agentur/.test(norm(k.nachricht.absender_name)))) {
        standard = "kt";
      }
    }
  }
  if (k.nachricht?.absender_name && !(m && norm(k.nachricht.absender_name) === norm(mieterName(m)))) {
    vorschlaege.push({ wert: "absender", label: `Absender: ${k.nachricht.absender_name}`, name: k.nachricht.absender_name, zusatz: "", strasse: "", plz_ort: "" });
    if (!standard && !m) standard = "absender";
  }
  if (k.haus) {
    vorschlaege.unshift({
      wert: "aushang", label: `Aushang: alle Mietparteien ${k.haus.bezeichnung}`, name: "An alle Mieterinnen und Mieter",
      zusatz: k.haus.bezeichnung, strasse: k.haus.strasse || "", plz_ort: [k.haus.plz, k.haus.ort].filter(Boolean).join(" "),
    });
    standard = "aushang";
  }
  vorschlaege.push({ wert: "frei", label: "Andere Anschrift", name: "", zusatz: "", strasse: "", plz_ort: "" });
  standard = standard || vorschlaege[0].wert;
  const start = vorschlaege.find((x) => x.wert === standard);

  const daten = await dialogFormular(`
    <h2>Brief an …</h2>
    <label class="feld"><span>Empfänger</span><select name="quelle">
      ${vorschlaege.map((x) => `<option value="${x.wert}" ${x.wert === standard ? "selected" : ""}>${esc(x.label)}</option>`).join("")}</select></label>
    <label class="feld"><span>Name</span><input name="name" required value="${esc(start.name)}"></label>
    <label class="feld"><span>Zusatz (optional)</span><input name="zusatz" value="${esc(start.zusatz)}"></label>
    <label class="feld"><span>Straße und Hausnummer</span><input name="strasse" value="${esc(start.strasse)}"></label>
    <label class="feld"><span>PLZ und Ort</span><input name="plz_ort" value="${esc(start.plz_ort)}"></label>
    <div class="knopfreihe">
      <button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button>
      <button class="knopf knopf--primaer" value="ok">Vorschau</button>
    </div>`, {
    vorbereiten: (form) => {
      form.quelle.addEventListener("change", () => {
        const x = vorschlaege.find((y) => y.wert === form.quelle.value);
        for (const f of ["name", "zusatz", "strasse", "plz_ort"]) form[f].value = x[f];
      });
    },
  });
  if (!daten) return null;
  return Object.fromEntries(["name", "zusatz", "strasse", "plz_ort"].map((f) => [f, String(daten.get(f) || "").trim()]));
}

// ---------------------------------------------------------------------------
// Neues Schreiben (ohne eingegangene Nachricht), auch aus der Mieterakte
// ---------------------------------------------------------------------------
export async function zeigeNeuesSchreiben(ziel = null, antwortId = null) {
  // ziel: Mieter-ID, „d-<ID>“ Handwerker, „k-<ID>“ Kontakt, „t-<ID>[.<Mieter-ID>]“ Kostenträger (optional zu einer Mietpartei),
  // „h-<Objekt-ID>“ Rundschreiben an Mietparteien eines Hauses
  const z = String(ziel || "");
  let dienstId = z.startsWith("d-") ? z.slice(2) : null;
  let kontaktId = z.startsWith("k-") ? z.slice(2) : null;
  let ktId = z.startsWith("t-") ? z.slice(2).split(".")[0] : null;
  let hausId = z.startsWith("h-") ? z.slice(2) : null;
  let mieterId = z.startsWith("t-") ? z.slice(2).split(".")[1] || null : z && !/^[dkh]-/.test(z) ? z : null;
  let antwort = null;
  if (antwortId) {
    antwort = await db.ladeAntwort(antwortId);
    if (antwort.nachricht_id) return geheZu(`#/postfach/${antwort.nachricht_id}`);
    mieterId = antwort.mieter_id;
    dienstId = antwort.dienstleister_id || null;
    kontaktId = antwort.kontakt_id || null;
    ktId = antwort.kostentraeger_id || null;
    hausId = !antwort.mieter_id ? antwort.objekt_id || null : null;
  }
  const [mieterL, alleDienst, kontaktL] = await Promise.all([
    mieterListe(), db.ladeDienstleister().catch(() => []), kontakteListe(true), ladeKiStatus(),
  ]);
  const dienstL = alleDienst.filter((d) => d.aktiv || d.id === dienstId);
  const dienstleister = dienstId ? dienstL.find((d) => d.id === dienstId) || null : null;
  const kontakt = !dienstleister && kontaktId ? kontaktL.find((x) => x.id === kontaktId) || null : null;
  const kostentraeger = !dienstleister && !kontakt && ktId ? kostentraegerVon(ktId) : null;
  const mieter = !dienstleister && !kontakt && mieterId ? await db.ladeMieter(mieterId).catch(() => null) : null;
  const haus = !dienstleister && !kontakt && !kostentraeger && !mieter && hausId ? objektVon(hausId) : null;
  // Rundschreiben: Mietparteien des Hauses (alle angehakt)
  const hausMieter = haus ? mieterL.filter((m) => wohnungVon(m.wohnung_id)?.objekt_id === haus.id) : [];
  const passt = (a) => a.status === "entwurf" && !a.nachricht_id && a.art !== "auftrag" && a.id !== antwort?.id &&
    (kontakt ? a.kontakt_id === kontakt.id : kostentraeger ? a.kostentraeger_id === kostentraeger.id
      : dienstleister ? a.dienstleister_id === dienstleister.id : haus ? a.objekt_id === haus.id && !a.mieter_id
      : mieter ? !a.kostentraeger_id : !a.mieter_id && !a.kontakt_id && !a.kostentraeger_id && !a.dienstleister_id && !a.objekt_id);
  const entwuerfe = (await db.ladeAntworten({ mieterId: mieter?.id || null, anzahl: 40 }).catch(() => [])).filter(passt);
  const w = mieter && wohnungVon(mieter.wohnung_id);
  const o = w && objektVon(w.objekt_id);
  const kt = mieter && kostentraegerVon(mieter.kostentraeger_id);
  const zurueck = kontakt ? `#/kontakt/${kontakt.id}` : mieter ? `#/mieter/${mieter.id}` : haus ? `#/objekt/${haus.id}` : dienstleister?.objekt_id ? `#/objekt/${dienstleister.objekt_id}` : "#/postfach";
  // Brotkrumen: das Schreiben hängt am Empfänger (Kostenträger: an der Mietpartei, falls gewählt)
  const seite = antwort ? "Entwurf" : haus ? "Rundschreiben" : kostentraeger ? `Schreiben an ${kostentraeger.name}` : dienstleister ? `Schreiben an ${dienstleister.name}` : "Neues Schreiben";
  const krumen = kontakt ? [...KRUMEN.sonstige, { text: kontaktName(kontakt), href: `#/kontakt/${kontakt.id}` }]
    : mieter ? [...KRUMEN.mieter, { text: mieterName(mieter), href: `#/mieter/${mieter.id}` }]
    : haus ? [...KRUMEN.objekte, { text: haus.bezeichnung, href: `#/objekt/${haus.id}` }]
    : dienstleister ? KRUMEN.handwerker
    : KRUMEN.postfach;

  // Eine Suche über alle, an die man schreiben kann (Roberts Wunsch: ein Feld statt mehrerer Listen)
  const eintraege = [
    ...mieterL.map((m) => ({ wert: m.id, name: mieterName(m), zusatz: ortVon(m), gruppe: "Mietparteien" })),
    ...dienstL.map((d) => ({ wert: `d-${d.id}`, name: d.name, zusatz: d.gewerk || "", gruppe: "Handwerker" })),
    ...kontaktL.map((x) => ({ wert: `k-${x.id}`, name: kontaktName(x), zusatz: [x.vorname || x.nachname ? x.firma : "", x.rolle].filter(Boolean).join(" · "), gruppe: "Sonstige" })),
    ...zustand.stamm.kostentraeger.map((x) => ({ wert: `t-${x.id}`, name: x.name, zusatz: x.abteilung || "", gruppe: "Kostenträger" })),
    ...zustand.stamm.objekte.map((x) => ({ wert: `h-${x.id}`, name: `Alle Mietparteien – ${x.bezeichnung}`, zusatz: "Rundschreiben", gruppe: "Häuser" })),
  ];
  const gewaehlt = kontakt ? kontaktName(kontakt) : dienstleister ? dienstleister.name : kostentraeger ? kostentraeger.name : mieter ? mieterName(mieter)
    : haus ? `Alle Mietparteien – ${haus.bezeichnung}` : "";
  const gruppe = kontakt ? "Sonstige" : dienstleister ? "Handwerker" : kostentraeger ? "Kostenträger" : mieter ? "Mietpartei" : haus ? "Rundschreiben" : "";
  const hausVorgabe = zustand.hausVorgabe || null;
  zustand.hausVorgabe = null;
  const hausWahl = (vorwahl) => `<label class="feld feld--eng feld--oben"><span>Betrifft Haus (optional)</span><select id="empf-haus" ${antwort ? "disabled" : ""}>
      <option value="">–</option>
      ${zustand.stamm.objekte.map((x) => `<option value="${esc(x.id)}" ${x.id === (hausVorgabe || vorwahl) ? "selected" : ""}>${esc(x.bezeichnung)}</option>`).join("")}
    </select></label>`;
  const mail = (adresse) => `<dt>E-Mail</dt><dd>${adresse ? esc(adresse) : `<span class="betrag--offen">keine hinterlegt</span>`}</dd>`;
  const telefon = (t) => (t ? `<dt>Telefon</dt><dd><a href="tel:${esc(String(t).replace(/[^\d+]/g, ""))}">${esc(t)}</a></dd>` : "");
  // Für ein Amt: zu welcher Mietpartei? (zuerst die, die dort geführt werden)
  const ktMieter = kostentraeger
    ? [...mieterL].sort((a, b) => (b.kostentraeger_id === kostentraeger.id) - (a.kostentraeger_id === kostentraeger.id))
    : [];

  let details;
  if (mieter && !kostentraeger) {
    details = `<dl class="datenliste datenliste--abstand">
        <dt>Wohnung</dt><dd>${esc([o?.bezeichnung, w?.bezeichnung].filter(Boolean).join(", ") || "–")}</dd>
        <dt>E-Mail</dt><dd>${esc(mieter.email || "–")}</dd>
        ${kt ? `<dt>Kostenträger</dt><dd>${esc(kt.name)}${antwort ? "" : ` · <a href="#/schreiben/t-${esc(kt.id)}.${esc(mieter.id)}">an das Amt schreiben</a>`}</dd>` : ""}
      </dl>`;
  } else if (dienstleister) {
    details = `<dl class="datenliste datenliste--abstand">
        ${dienstleister.gewerk ? `<dt>Gewerk</dt><dd>${esc(dienstleister.gewerk)}</dd>` : ""}
        ${mail(dienstleister.email)}${telefon(dienstleister.telefon)}
      </dl>${hausWahl(dienstleister.objekt_id)}
      <p class="leise">Die KI bekommt keine Daten von Mietern, nur Haus und Wissen.</p>`;
  } else if (kontakt) {
    details = `<dl class="datenliste datenliste--abstand">
        ${kontakt.firma && (kontakt.vorname || kontakt.nachname) ? `<dt>Firma</dt><dd>${esc(kontakt.firma)}</dd>` : ""}
        ${kontakt.rolle ? `<dt>Rolle</dt><dd>${esc(kontakt.rolle)}</dd>` : ""}
        ${mail(kontakt.email)}${telefon(kontakt.telefon)}
      </dl>${hausWahl(null)}
      <p class="leise">Die KI kennt die letzten Gespräche aus dem Verlauf, aber keine Daten von Mietern.</p>`;
  } else if (kostentraeger) {
    details = `<dl class="datenliste datenliste--abstand">
        ${kostentraeger.abteilung ? `<dt>Abteilung</dt><dd>${esc(kostentraeger.abteilung)}</dd>` : ""}
        ${mail(kostentraeger.email)}
        ${kostentraeger.strasse || kostentraeger.ort ? `<dt>Anschrift</dt><dd>${esc([kostentraeger.strasse, [kostentraeger.plz, kostentraeger.ort].filter(Boolean).join(" ")].filter(Boolean).join(", "))}</dd>` : ""}
      </dl>
      <label class="feld feld--eng feld--oben"><span>Wegen welcher Mietpartei? (optional)</span><select id="empf-kt-mieter" ${antwort ? "disabled" : ""}>
        ${mieterOptionen(ktMieter, mieter?.id || null, "Keine bestimmte")}</select></label>
      <p class="leise">${mieter ? "Die KI bekommt Wohnung, Miete und das Aktenzeichen dieser Mietpartei." : "Ohne Mietpartei nutzt die KI nur das allgemeine Wissen."}</p>`;
  } else if (haus) {
    details = hausMieter.length
      ? `<p class="leise">Jede angehakte Mietpartei bekommt eine eigene E-Mail. Mietparteien ohne E-Mail: „Als Aushang/Brief“.</p>
        <div class="rundempf" id="rund-liste">
          ${hausMieter.map((m) => `<label class="checkfeld rundempf__zeile"><input type="checkbox" data-rund="${esc(m.id)}" checked>
            <span><span class="rundempf__name">${esc(mieterName(m))}</span> <span class="leise">${esc(wohnungVon(m.wohnung_id)?.bezeichnung || "")} · ${istEmail(m.email) ? esc(m.email) : `<span class="betrag--offen">keine E-Mail</span>`}</span></span></label>`).join("")}
        </div>
        <div class="knopfreihe knopfreihe--eng"><button type="button" class="knopf knopf--klein knopf--leise" id="rund-alle">Alle</button>
          <button type="button" class="knopf knopf--klein knopf--leise" id="rund-keine">Keine</button></div>
        <p class="leise">Die KI bekommt nur Haus und Wissen, keine Daten einzelner Mietparteien.</p>`
      : `<p class="leise">In diesem Haus sind noch keine Mietparteien eingetragen.</p>`;
  } else {
    details = `<p class="leise">Mietpartei, Kontakt, Handwerker, Amt oder ein ganzes Haus suchen. Ohne Auswahl nutzt die KI nur das allgemeine Wissen.</p>`;
  }

  inhalt().innerHTML = `
    ${brotkrumen([...krumen, { text: seite }])}
    <div class="kopf"><div><h1>${antwort ? "Entwurf" : "Neues Schreiben"}</h1>
      <p>Sagen oder tippen Sie, was drinstehen soll. Die KI entwirft das Schreiben ${dienstleister ? "an den Handwerker mit dem Wissen zum Haus"
        : kontakt ? "mit dem Verlauf der bisherigen Gespräche" : kostentraeger ? "an das Amt" : haus ? "als Rundschreiben an die Mietparteien des Hauses"
        : "mit den Daten der Mietpartei und dem Wissen"}.</p></div></div>
    ${kiBanner()}
    <div class="akte">
      <div class="stapel"><div id="entwurf"></div></div>
      <div class="stapel">
        <section class="flaeche" id="empfaenger">
          <div class="flaeche__kopf"><h2>An wen?</h2>${gruppe ? `<span class="marker">${esc(gruppe)}</span>` : ""}</div>
          <div class="flaeche__inhalt">
            ${antwort
              ? `<p><strong>${esc(gewaehlt || antwort.empfaenger_name || "Ohne Empfänger")}</strong></p>`
              : suchauswahlHtml({ label: "Empfänger suchen", placeholder: "Name, Firma oder Amt …", wert: gewaehlt })}
            ${details}
          </div>
        </section>
        ${entwuerfe.length ? `
        <section class="flaeche">
          <div class="flaeche__kopf"><h2>Weitere Entwürfe</h2></div>
          <div class="zeilen">${entwuerfe.map((a) => `<a class="entwurfzeile" href="#/entwurf/${esc(a.id)}">
            <span>${esc(a.betreff || "(ohne Betreff)")}${a.empfaenger_name ? ` <span class="leise">an ${esc(a.empfaenger_name)}</span>` : ""}</span><span class="leise">${esc(zeitDE(a.aktualisiert_am))}</span></a>`).join("")}</div>
        </section>` : ""}
      </div>
    </div>`;

  const vorbelegt = zustand.vorbelegung && !zustand.vorbelegung.nachricht_id ? zustand.vorbelegung.anweisung : null;
  // Aus einer Notiz gestartet: der Vorgang wird an der Notiz gemerkt
  const aufgabeId = !antwort && zustand.vorbelegung && !zustand.vorbelegung.nachricht_id ? zustand.vorbelegung.aufgabeId || null : null;
  let uebernahme = !antwort && zustand.vorbelegung && !zustand.vorbelegung.nachricht_id ? zustand.vorbelegung.uebernahme || null : null;
  zustand.vorbelegung = null;
  if (uebernahme?.antwortId) {
    const a = await db.ladeAntwort(uebernahme.antwortId).catch(() => null);
    uebernahme = { ...uebernahme, antwort: a && (!a.status || a.status === "entwurf") ? a : null };
  }
  const themaVorgabe = antwort ? null : zustand.themaVorgabe || null;
  zustand.themaVorgabe = null;
  baueEntwurf($("#entwurf"), {
    nachricht: null, mieter, dienstleister, kontakt, kostentraeger, haus, antwort, anweisung: vorbelegt, themaId: themaVorgabe, uebernahme, aufgabeId,
    rundEmpfaenger: () => hausMieter.filter((m) => $(`[data-rund="${m.id}"]`)?.checked),
    hinweise: antwort ? zustand.entwurfHinweise?.get(antwort.id) : null,
    objektId: () => $("#empf-haus")?.value || null,
    nachEnde: () => geheZu(zurueck),
  });
  // Rundschreiben: Zähler unter „An“
  const rundZaehlen = () => {
    const gew = hausMieter.filter((m) => $(`[data-rund="${m.id}"]`)?.checked);
    const mail = gew.filter((m) => istEmail(m.email)).length;
    const ziel = $("#entwurf [data-teil=rundan]");
    if (ziel) ziel.textContent = gew.length
      ? `${gew.length} ${gew.length === 1 ? "Mietpartei" : "Mietparteien"}: ${mail} per E-Mail${gew.length - mail ? `, ${gew.length - mail} ohne E-Mail (Aushang/Brief)` : ""}`
      : "Keine Mietpartei angehakt";
  };
  if (haus) {
    for (const c of $$("[data-rund]")) c.addEventListener("change", rundZaehlen);
    $("#rund-alle")?.addEventListener("click", () => { for (const c of $$("[data-rund]")) c.checked = true; rundZaehlen(); });
    $("#rund-keine")?.addEventListener("click", () => { for (const c of $$("[data-rund]")) c.checked = false; rundZaehlen(); });
    rundZaehlen();
  }
  const ohneMail = !antwort && (dienstleister || kontakt || kostentraeger);
  if (ohneMail && !(dienstleister || kontakt || kostentraeger).email) {
    melde(`Für ${gewaehlt} ist keine E-Mail hinterlegt. Bitte im Feld „An“ eintragen oder als Brief schicken.`, "info");
  }
  // Empfänger wechseln: Anweisung, Text und Entwurf wandern mit (Roberts Wunsch: der KI-Vorschlag soll bleiben)
  const wechsle = (ziel) => {
    const alt = $("#entwurf")?.mitnehmen?.();
    if (alt && (alt.anweisung || alt.antwortId || (alt.editor && alt.text.trim()))) {
      zustand.vorbelegung = {
        nachricht_id: null, anweisung: alt.anweisung, aufgabeId: alt.aufgabeId || null,
        uebernahme: { betreff: alt.betreff, text: alt.text, editor: alt.editor, antwortId: alt.antwortId, eigenesThema: alt.eigenesThema },
      };
    }
    geheZu(`#/schreiben/${ziel}`);
  };
  const such = $("#empfaenger .suchauswahl");
  if (such) verbindeSuchauswahl(such, eintraege, (e) => wechsle(e.wert));
  $("#empf-kt-mieter")?.addEventListener("change", (e) => wechsle(`t-${kostentraeger.id}${e.target.value ? "." + e.target.value : ""}`));
}

// ---------------------------------------------------------------------------
// Weitere Absender (Einstellungen)
// ---------------------------------------------------------------------------
function absenderZeilenHtml() {
  const liste = absenderListe();
  return liste.length
    ? liste.map((a) => `<button type="button" class="zeile--knopf" data-absender="${esc(a.id)}">
        <span><strong>${esc(a.bezeichnung || a.name)}</strong> <span class="leise">${esc([a.name, [a.strasse, [a.plz, a.ort].filter(Boolean).join(" ")].filter(Boolean).join(", "), a.email].filter(Boolean).join(" · "))}</span></span>
        <span class="leise">Bearbeiten</span></button>`).join("")
    : `<div class="leer">Noch keine weiteren Absender.</div>`;
}

async function absenderDialog(a, nachher) {
  const neu = !a;
  a = a || {};
  const f = (name, label, attrs = "") => `<label class="feld"><span>${label}</span><input name="${name}" value="${esc(a[name] || "")}" ${attrs}></label>`;
  const daten = await dialogFormular(`
    <h2>${neu ? "Absender hinzufügen" : esc(a.bezeichnung || a.name)}</h2>
    <div class="formraster formraster--zwei">
      ${f("bezeichnung", "Bezeichnung (in der Auswahl)", `required maxlength="40" placeholder="z. B. Privat"`)}
      ${f("name", "Name", `required maxlength="80" placeholder="z. B. Robert Mustermann"`)}
      ${f("strasse", "Straße und Hausnummer", `maxlength="80"`)}
      <div class="formraster formraster--zwei">${f("plz", "PLZ", `maxlength="10" inputmode="numeric"`)}${f("ort", "Ort", `maxlength="60"`)}</div>
      ${f("telefon", "Telefon", `type="tel" maxlength="40"`)}
      ${f("email", "E-Mail (Antworten gehen hierhin)", `type="email" maxlength="120"`)}
    </div>
    <label class="feld"><span>Signatur unter E-Mails</span>
      <textarea name="signatur" rows="3" maxlength="600" placeholder="z. B. Robert Mustermann">${esc(a.signatur || "")}</textarea></label>
    <p class="leise">Die E-Mail geht technisch weiter über die Adresse der App raus, aber mit diesem Namen als Absender.
      Im Brief stehen Name und Anschrift statt des Firmen-Briefkopfs.</p>
    <div class="knopfreihe">
      ${neu ? "" : `<button class="knopf knopf--gefahr knopf--links" value="loeschen" formnovalidate>Löschen</button>`}
      <button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button>
      <button class="knopf knopf--primaer" value="ok">Speichern</button>
    </div>`, { breit: true });
  if (!daten) return;
  let liste = absenderListe();
  if (daten.get("_aktion") === "loeschen") {
    if (!(await frage("Absender löschen?", `<p>„${esc(a.bezeichnung || a.name)}“ wird aus der Auswahl entfernt. Bereits gesendete Schreiben bleiben unverändert.</p>`, "Löschen", { gefahr: true }))) return;
    liste = liste.filter((x) => x.id !== a.id);
  } else {
    const t = (n) => String(daten.get(n) || "").trim();
    const email = t("email");
    if (email && !istEmail(email)) return melde("Die E-Mail-Adresse sieht nicht richtig aus.", "fehler");
    const eintrag = {
      id: a.id || crypto.randomUUID(), bezeichnung: t("bezeichnung"), name: t("name"),
      strasse: t("strasse"), plz: t("plz"), ort: t("ort"), telefon: t("telefon"), email, signatur: t("signatur"),
    };
    liste = neu ? [...liste, eintrag] : liste.map((x) => (x.id === a.id ? eintrag : x));
  }
  try {
    zustand.profil = await db.speichereProfil({ absender: liste });
    melde("Gespeichert.", "ok");
    nachher?.();
  } catch (err) {
    melde(err.message, "fehler");
  }
}

// ---------------------------------------------------------------------------
// Einstellungen (Briefkopf, Antworten, Einrichtung)
// ---------------------------------------------------------------------------
export async function zeigeEinstellungen() {
  const [profil, pf, ki] = await Promise.all([db.ladeProfil(), db.ladePostfach().catch(() => null), ladeKiStatus(true)]);
  const p = (zustand.profil = profil || {});
  const webhook = pf ? `${db.SUPABASE_URL}/functions/v1/posteingang?token=${pf.token}` : "";
  const f = (name, label, attrs = "") =>
    `<label class="feld"><span>${label}</span><input name="${name}" value="${esc(p[name] ?? "")}" ${attrs}></label>`;
  const status = (an, titel, text) => `<li class="${an ? "an" : "aus"}"><span class="statuspunkt" aria-hidden="true"></span>
    <span><strong>${titel}:</strong> ${text}</span></li>`;

  inhalt().innerHTML = `
    <div class="kopf"><div><h1>Einstellungen</h1><p>Briefkopf, Antworten und die Anbindung des Postfachs.</p></div></div>
    <div class="stapel">
      <section class="flaeche">
        <div class="flaeche__kopf"><h2>Briefkopf</h2><span class="leise">erscheint in allen Schreiben</span></div>
        <form class="flaeche__inhalt" id="profilformular">
          <div class="formraster">
            ${f("firma", "Firma", "required")}${f("inhaber", "Inhaber / Unterzeichner")}
            ${f("strasse", "Straße und Hausnummer")}${f("plz", "PLZ")}${f("ort", "Ort")}
            ${f("telefon", "Telefon")}${f("email", "E-Mail", `type="email"`)}${f("web", "Website")}
          </div>
          <div class="knopfreihe"><button class="knopf knopf--primaer" type="submit">Briefkopf speichern</button></div>
        </form>
      </section>

      ${unterschrift.unterschriftBereichHtml()}

      <section class="flaeche">
        <div class="flaeche__kopf"><h2>Antworten und E-Mails</h2></div>
        <form class="flaeche__inhalt" id="antwortformular">
          <label class="feld"><span>So soll die KI schreiben</span>
            <textarea name="ki_tonfall" rows="3" placeholder="z. B. Sie-Form, freundlich, kurz. Keine Zusagen zu Geld oder Terminen.">${esc(p.ki_tonfall || "")}</textarea></label>
          <label class="feld"><span>Signatur unter E-Mails</span>
            <textarea name="email_signatur" rows="4" placeholder="${esc([p.inhaber, p.firma].filter(Boolean).join("\n"))}">${esc(p.email_signatur || "")}</textarea></label>
          <label class="feld"><span>Antworten der Empfänger gehen an</span>
            <input type="email" name="antwort_email" value="${esc(p.antwort_email || "")}" placeholder="z. B. info@ihre-firma.de">
            <span class="feldhinweis feldhinweis--leise">Ihre normale E-Mail-Adresse oder die Adresse des Postfachs.</span></label>
          <div class="knopfreihe"><button class="knopf knopf--primaer" type="submit">Speichern</button></div>
        </form>
      </section>

      <section class="flaeche" id="absender-bereich">
        <div class="flaeche__kopf"><h2>Weitere Absender</h2><span class="leise">z. B. als Privatperson</span></div>
        <div class="flaeche__inhalt">
          <p class="leise">Beim Schreiben wählbar: eigene Signatur, Anschrift im Brief und Absendername der E-Mail. Standard ist „${esc(p.firma || "Firma")}“ mit dem Briefkopf oben.</p>
          <div class="zeilen" id="absender-liste">${absenderZeilenHtml()}</div>
          <div class="knopfreihe"><button type="button" class="knopf" id="absender-neu">+ Absender hinzufügen</button></div>
        </div>
      </section>

      <section class="flaeche">
        <div class="flaeche__kopf"><h2>Häuser, Wohnungen &amp; Mieter</h2></div>
        <div class="flaeche__inhalt">
          <p>Häuser, Wohnungen, Kostenträger und neue Mietparteien anlegen und ändern.</p>
          <a class="knopf" href="#/stammdaten">Öffnen</a>
        </div>
      </section>

      <section class="flaeche">
        <div class="flaeche__kopf"><h2>Dokumentenablage</h2></div>
        <div class="flaeche__inhalt">
          <p>Ordner für Rechnungen, Verträge &amp; Co. (für alle Häuser gleich). Die KI legt nur in diese Ordner ab.</p>
          <label class="checkfeld"><input type="checkbox" id="auto-ablage" ${p.auto_ablage === false ? "" : "checked"}>
            Gesendetes automatisch ablegen (E-Mails, Briefe, Aufträge – Name nach Schema, Ordner schlägt die KI vor)</label>
          <div class="knopfreihe">
            <button type="button" class="knopf" id="ordner-bearbeiten">Ordner bearbeiten</button>
            <button type="button" class="knopf" id="zip-alle">Alle Dokumente als ZIP (Sicherung)</button>
          </div>
        </div>
      </section>

      <section class="flaeche">
        <div class="flaeche__kopf"><h2>Briefvorlagen</h2></div>
        <div class="flaeche__inhalt">
          <p>Mahnungen, Nachweis an Kostenträger und Antwortschreiben als Word-Vorlagen. Eigene Vorlagen können hochgeladen werden.</p>
          <a class="knopf" href="#/vorlagen">Vorlagen ansehen</a>
        </div>
      </section>

      <details class="flaeche ausklapp" ${ki.ki && ki.versand ? "" : "open"}>
        <summary>Einrichtung (Technik)</summary>
        <div class="flaeche__inhalt">
          <ul class="statusliste">
            ${status(ki.ki, "KI", ki.ki ? `eingerichtet (${esc(ki.modell)})` : "fehlt noch. In Supabase das Secret ANTHROPIC_API_KEY eintragen.")}
            ${status(ki.versand, "E-Mail-Versand", ki.versand ? `eingerichtet, Absender ${esc(ki.absender)}` : "fehlt noch (Secrets RESEND_API_KEY und VERSAND_ABSENDER). Bis dahin öffnet „Senden“ das eigene E-Mail-Programm.")}
            ${status(ki.webhook_signatur, "Signaturprüfung Posteingang", ki.webhook_signatur ? "aktiv" : "aus (optional, Secret RESEND_WEBHOOK_SECRET)")}
          </ul>
          ${ki.fehler ? `<p class="formfehler">Status nicht abrufbar: ${esc(ki.fehler)}</p>` : ""}
          <form id="postfachformular">
            <label class="feld"><span>Adresse des Postfachs</span>
              <input type="email" name="adresse" value="${esc(pf?.adresse || "")}" placeholder="z. B. verwaltung@xyz.resend.app">
              <span class="feldhinweis feldhinweis--leise">Mails an diese Adresse landen im Postfach der App.</span></label>
            <label class="feld"><span>Webhook-Adresse (beim E-Mail-Dienst eintragen)</span>
              <span class="kopierfeld"><input readonly value="${esc(webhook)}" id="webhook" spellcheck="false">
                <button type="button" class="knopf knopf--klein" id="kopieren">Kopieren</button></span>
              <span class="feldhinweis feldhinweis--leise">Enthält einen geheimen Schlüssel. Nicht weitergeben.</span></label>
            <div class="knopfreihe">
              <button class="knopf knopf--primaer" type="submit">Speichern</button>
              <button type="button" class="knopf knopf--gefahr" id="token-neu">Neuen Schlüssel erzeugen</button>
            </div>
          </form>
        </div>
      </details>
    </div>`;

  const speichernMit = (formId, felder, meldung) => {
    $(formId).addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const werte = Object.fromEntries(felder.map((k) => [k, String(fd.get(k) || "").trim() || null]));
      try {
        zustand.profil = await db.speichereProfil(werte);
        melde(meldung, "ok");
      } catch (err) { melde(err.message, "fehler"); }
    });
  };
  $("#ordner-bearbeiten").addEventListener("click", () => ablage.ordnerBearbeiten());
  const unterschriftNeu = () => {
    $("#unterschrift-bereich").outerHTML = unterschrift.unterschriftBereichHtml();
    unterschrift.verbindeUnterschrift(unterschriftNeu);
  };
  unterschrift.verbindeUnterschrift(unterschriftNeu);
  const absenderNeuZeichnen = () => {
    $("#absender-liste").innerHTML = absenderZeilenHtml();
    for (const b of $$("[data-absender]")) b.addEventListener("click", () => absenderDialog(absenderListe().find((a) => a.id === b.dataset.absender), absenderNeuZeichnen));
  };
  $("#absender-neu").addEventListener("click", () => absenderDialog(null, absenderNeuZeichnen));
  absenderNeuZeichnen();
  $("#zip-alle").addEventListener("click", () => ablage.zipExport({}));
  $("#auto-ablage").addEventListener("change", async (e) => {
    try {
      zustand.profil = await db.speichereProfil({ auto_ablage: e.target.checked });
      melde(e.target.checked ? "Gesendetes wird automatisch abgelegt." : "Automatisches Ablegen ist aus.", "ok");
    } catch (err) {
      e.target.checked = !e.target.checked;
      melde(err.message, "fehler");
    }
  });
  speichernMit("#profilformular", ["firma", "inhaber", "strasse", "plz", "ort", "telefon", "email", "web"], "Briefkopf gespeichert.");
  speichernMit("#antwortformular", ["ki_tonfall", "email_signatur", "antwort_email"], "Gespeichert.");

  $("#postfachformular").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await db.speicherePostfach({ adresse: String(new FormData(e.currentTarget).get("adresse") || "").trim() || null });
      melde("Gespeichert.", "ok");
    } catch (err) { melde(err.message, "fehler"); }
  });
  $("#kopieren").addEventListener("click", async () => {
    const feld = $("#webhook");
    try {
      await navigator.clipboard.writeText(feld.value);
      melde("Adresse kopiert.", "ok");
    } catch {
      feld.select();
      melde("Bitte die markierte Adresse kopieren.", "info");
    }
  });
  $("#token-neu").addEventListener("click", async () => {
    const ok = await frage("Neuen Schlüssel erzeugen?",
      "<p>Die bisherige Webhook-Adresse funktioniert danach nicht mehr. Die neue Adresse muss beim E-Mail-Dienst eingetragen werden.</p>",
      "Neu erzeugen", { gefahr: true });
    if (!ok) return;
    try {
      await db.erneuerePostfachToken();
      melde("Neuer Schlüssel erzeugt.", "ok");
      await zeigeEinstellungen();
    } catch (err) { melde(err.message, "fehler"); }
  });
}
