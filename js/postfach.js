// Postfach, KI-Entwürfe, Wissen und Einstellungen
// Grundsatz: Die KI schreibt nur Entwürfe. Verschickt wird ausschließlich per Klick.
import * as db from "./daten.js";
import { antwortDaten, briefanrede, fuelleVorlage, vorlagenFehler, datumDE, mieterName } from "./dokumente.js";
import { zeigeDokument } from "./vorschau.js";
import {
  $, $$, esc, melde, dialogFormular, frage, dateiTeil, heuteISO,
  zustand, wohnungVon, objektVon, kostentraegerVon,
} from "./helfer.js";

import {
  ICON_MIKRO, ICON_KI, ICON_KAMERA, istEmail, kurz, norm, anschriftAnrede, zeitDE, datumZeit, geheZu,
  mieterListe, ortVon, mieterOptionen, mikroKnopf, verbindeDiktat, stoppeDiktat, wachsen, wartehinweis, beschaeftigt,
} from "./ui.js";
import * as ablage from "./ablage.js";
import { drucke } from "./ui.js";
import { aufgabeDialog, fristVon } from "./start.js";

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

  inhalt().innerHTML = `
    <div class="kopf">
      <div><h1>Postfach</h1>
        <p>${pf?.adresse ? `Eingang: <strong class="umbruch">${esc(pf.adresse)}</strong>` : "Anfragen von Mietern, Ämtern und Interessenten"}</p></div>
      <div class="knopfreihe">
        <label class="knopf">${ICON_KAMERA} Foto / PDF<input type="file" accept="image/*,application/pdf" id="foto" hidden></label>
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
  $("#foto").addEventListener("change", (e) => { const d = e.target.files[0]; e.target.value = ""; ablage.erfasse(d); });
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
    <label class="feld"><span>Mietpartei</span><select name="mieter_id">${mieterOptionen(mieterL, null)}</select></label>
    <label class="feld"><span>Von (wenn keine Mietpartei)</span><input name="absender" placeholder="Name"></label>
    <label class="feld"><span>Betreff</span><input name="betreff" required placeholder="z. B. Anruf: Wasserhahn tropft"></label>
    <label class="feld"><span>Was wurde gesagt?</span>
      <span class="diktat"><textarea name="text" rows="5" required></textarea>${mikroKnopf()}</span></label>
    <div class="knopfreihe">
      <button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button>
      <button class="knopf knopf--primaer" value="ok">Ins Postfach</button>
    </div>`, { breit: true, vorbereiten: verbindeDiktat });
  if (!daten) return;
  const m = mieterL.find((x) => x.id === daten.get("mieter_id"));
  try {
    const n = await db.neueNachricht({
      quelle: "notiz",
      status: "offen",
      mieter_id: m?.id || null,
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
function antwortEintrag(a) {
  const art = a.art === "auftrag"
    ? `Auftrag an ${a.empfaenger_name || a.empfaenger_email || "Handwerker"}${a.status === "gesendet" ? " (E-Mail)" : " (gedruckt)"}`
    : a.status === "gesendet" ? `E-Mail an ${a.empfaenger_email || "?"}` : "Als Brief erstellt";
  const wann = a.gesendet_am || a.aktualisiert_am || a.erstellt_am;
  return `
    <details class="antwort">
      <summary><span class="antwort__art">${esc(art)}</span><span class="leise">${esc(datumZeit(wann))}</span></summary>
      <div class="antwort__text"><strong>${esc(a.betreff)}</strong>\n\n${esc(a.text)}</div>
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

export async function zeigeNachricht(id) {
  let [n, mieterL, antworten] = await Promise.all([
    db.ladeNachricht(id), mieterListe(), db.ladeAntworten({ nachrichtId: id }), ladeKiStatus(),
  ]);
  if (n.status === "neu") {
    n = await db.aendereNachricht(id, { status: "offen" }).catch(() => n);
    aktualisiereZaehler();
  }
  const mieter = n.mieter_id ? await db.ladeMieter(n.mieter_id).catch(() => null) : null;
  const entwurf = antworten.find((a) => a.status === "entwurf" && a.art !== "auftrag") || null;
  const auftraege = antworten.filter((a) => a.status === "entwurf" && a.art === "auftrag");
  const fertige = antworten.filter((a) => a.status !== "entwurf");
  const w = mieter && wohnungVon(mieter.wohnung_id);
  const o = w && objektVon(w.objekt_id);
  const absender = [n.absender_name, n.absender_email ? `<${n.absender_email}>` : ""].filter(Boolean).join(" ") || "Unbekannt";
  const anhaenge = n.anhaenge || [];
  const bilder = anhaenge.filter((a) => a.pfad && istBild(a));
  const pdfs = anhaenge.filter((a) => a.pfad && a.typ === "application/pdf");
  const ohne = anhaenge.filter((a) => !a.pfad);
  const erledigt = n.status === "erledigt" || n.status === "beantwortet";
  const vorbelegt = zustand.vorbelegung?.nachricht_id === id ? zustand.vorbelegung.anweisung : null;
  zustand.vorbelegung = null;

  inhalt().innerHTML = `
    <a class="zurueck" href="#/postfach">Zum Postfach</a>
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
        ${fertige.length ? `<section class="flaeche"><div class="flaeche__kopf"><h2>Bisher erledigt</h2></div>${fertige.map(antwortEintrag).join("")}</section>` : ""}
      </div>
      <div class="stapel">
        ${fristHtml(n)}
        <section class="flaeche" id="einordnung">${einordnungHtml(n)}</section>
        <section class="flaeche">
          <div class="flaeche__kopf"><h2>Mietpartei</h2></div>
          <div class="flaeche__inhalt">
            ${mieter ? `
              <p class="mieterkarte"><a class="name" href="#/mieter/${esc(mieter.id)}">${esc(mieterName(mieter))}</a>
                <span class="leise">${esc([o?.bezeichnung, w?.bezeichnung].filter(Boolean).join(", "))}</span></p>
              <p class="leise">${esc(ZUORDNUNG[n.zuordnung] || "")}</p>`
              : `<p class="leise">Keiner Mietpartei zugeordnet. Die KI kennt dann nur das allgemeine Wissen.</p>`}
            <label class="feld feld--eng"><span>${mieter ? "Andere Mietpartei wählen" : "Mietpartei zuordnen"}</span>
              <select id="zuordnung">${mieterOptionen(mieterL, n.mieter_id)}</select></label>
          </div>
        </section>
        <section class="flaeche">
          <div class="flaeche__inhalt knopfreihe knopfreihe--senkrecht">
            <button type="button" class="knopf" id="handwerker">Handwerker beauftragen</button>
            <button type="button" class="knopf" id="wiedervorlage">Wiedervorlage / Notiz</button>
            ${erledigt
              ? `<button type="button" class="knopf" id="wiederoffen">Wieder öffnen</button>`
              : `<button type="button" class="knopf" id="erledigt">Erledigt, keine Antwort nötig</button>`}
          </div>
        </section>
      </div>
    </div>`;

  const neu = () => zeigeNachricht(id);
  baueEntwurf($("#entwurf"), { nachricht: n, mieter, antwort: entwurf, anweisung: vorbelegt, nachEnde: neu });
  for (const a of auftraege) {
    baueEntwurf($(`[data-auftrag="${a.id}"]`), { nachricht: n, mieter, antwort: a, auftrag: true, hinweise: hinweisSpeicher.get(a.id), nachEnde: neu });
    hinweisSpeicher.delete(a.id);
  }

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
  $("#zuordnung").addEventListener("change", async (e) => {
    const v = e.target.value || null;
    try {
      await db.aendereNachricht(id, { mieter_id: v, zuordnung: v ? "manuell" : null });
      melde(v ? "Mietpartei zugeordnet." : "Zuordnung entfernt.", "ok");
      await neu();
    } catch (err) {
      melde(err.message, "fehler");
    }
  });
  $("#handwerker").addEventListener("click", () => auftragStarten(n, mieter, bilder, o));
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
    <label class="feld"><span>Wer soll kommen?</span><select name="dienstleister_id" required>
      ${passend.map((d) => `<option value="${esc(d.id)}">${esc(d.name)}${d.gewerk ? " – " + esc(d.gewerk) : ""}${d.email ? "" : " (keine E-Mail)"}</option>`).join("")}
    </select></label>
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
    const a = await db.speichereAntwort(null, {
      art: "auftrag", nachricht_id: n.id, mieter_id: mieter?.id || null, dienstleister_id: d.id,
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
  let antwort = k.antwort;
  const kiDa = !!zustand.ki?.ki;
  const standardAn = k.nachricht?.absender_email || k.dienstleister?.email || k.mieter?.email || "";
  const signatur = signaturText();
  const platzhalter = k.nachricht
    ? "z. B. „Handwerker ist beauftragt, meldet sich bis Freitag.“ Leer lassen: Die KI antwortet anhand des Wissens."
    : k.dienstleister
    ? "z. B. „Angebot für den Anstrich im Treppenhaus anfragen, Besichtigung nächste Woche möglich.“"
    : "z. B. „Frau Huber an die Mülltrennung erinnern, freundlich.“ oder „Termin zur Wohnungsbesichtigung am 3.11. um 10 Uhr ankündigen.“";

  el.innerHTML = `
    <section class="flaeche entwurf">
      <div class="flaeche__kopf"><h2>${k.auftrag ? `Auftrag an ${esc(antwort.empfaenger_name || "Handwerker")}` : k.nachricht ? "Antwort" : "Schreiben"}</h2>
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
          <div class="formraster formraster--zwei">
            <label class="feld"><span>An (E-Mail)</span><input type="email" name="an" value="${esc(antwort?.empfaenger_email || standardAn)}" placeholder="name@beispiel.de" autocomplete="off"></label>
            <label class="feld"><span>Betreff</span><input name="betreff" value="${esc(antwort?.betreff || "")}"></label>
          </div>
          <label class="feld"><span>Text</span><textarea name="text" rows="10" class="entwurf__text">${esc(antwort?.text || "")}</textarea></label>
          <p class="signatur">Wird automatisch angefügt:<br>Mit freundlichen Grüßen<br>${esc(signatur).replace(/\n/g, "<br>")}${briefkopfText() ? `<br><span class="signatur__kopf">${esc(briefkopfText())}</span>` : ""}</p>
          <div class="ueberarbeiten" ${k.auftrag ? "hidden" : ""}>
            <label class="feld"><span>Änderungswunsch an die KI</span>
              <span class="diktat"><input name="aenderung" placeholder="z. B. kürzer, oder: Termin Dienstag 10 Uhr nennen" autocomplete="off">${mikroKnopf()}</span></label>
            <button type="button" class="knopf" data-k="ueberarbeiten">${ICON_KI} Überarbeiten</button>
          </div>
          <div class="entwurf__aktionen">
            <button type="button" class="knopf knopf--primaer" data-k="senden">Per E-Mail senden</button>
            ${k.auftrag ? `<button type="button" class="knopf" data-k="drucken">Drucken</button>` : `<button type="button" class="knopf" data-k="brief">Als Brief</button>`}
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
  }
  function zeigeHinweise(liste) {
    hinweisBox.hidden = !liste?.length;
    hinweisBox.innerHTML = liste?.length
      ? `<strong>Bitte vor dem Senden prüfen:</strong><ul>${liste.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>`
      : "";
  }

  async function speichere(extra = {}) {
    const v = werte();
    antwort = await db.speichereAntwort(antwort?.id, {
      nachricht_id: k.nachricht?.id || null,
      mieter_id: k.mieter?.id || null,
      empfaenger_email: v.an || null,
      empfaenger_name: k.auftrag ? antwort.empfaenger_name : k.dienstleister ? k.dienstleister.name : k.nachricht?.absender_name || (k.mieter ? mieterName(k.mieter) : null),
      ...(k.dienstleister ? { dienstleister_id: k.dienstleister.id } : {}),
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

  async function alsGesendetMarkieren(an, kanal) {
    await db.speichereAntwort(antwort.id, { status: kanal === "druck" ? "als_brief" : "gesendet", gesendet_am: new Date().toISOString(), empfaenger_email: an || antwort.empfaenger_email || null });
    if (k.nachricht && !k.auftrag) await db.aendereNachricht(k.nachricht.id, { status: "beantwortet" });
    if (k.mieter) {
      await db.protokolliereVorgang({
        mieter_id: k.mieter.id, typ: k.auftrag ? "auftrag" : "antwort",
        titel: k.auftrag ? `Auftrag an ${antwort.empfaenger_name || "Handwerker"}: ${werte().betreff || "Auftrag"}` : `E-Mail: ${werte().betreff || "Antwort"}`,
        details: { antwort_id: antwort.id, an, kanal },
      });
    }
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
              dienstleister_id: k.dienstleister?.id || null, objekt_id: k.objektId?.() || null,
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
        await druckeAuftrag({ an: antwort.empfaenger_name, betreff: v.betreff, text: v.text, signatur, fotos: urls.filter(Boolean) });
      });
      if (await frage("Gedruckt?", "<p>Dann wird der Auftrag im Verlauf vermerkt.</p>", "Ja, vermerken")) {
        try {
          await alsGesendetMarkieren(null, "druck");
          melde("Auftrag vermerkt.", "ok");
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
            dienstleister_id: k.dienstleister?.id || null, objekt_id: k.objektId?.() || null,
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
      const anrede = k.dienstleister ? "Sehr geehrte Damen und Herren," : k.mieter ? briefanrede(k.mieter) + "," : "Guten Tag,";
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
      const v = werte();
      if (!istEmail(v.an)) { feld("an").focus(); return melde("Bitte eine gültige E-Mail-Adresse eintragen.", "fehler"); }
      if (!v.text.trim()) return melde("Der Text ist leer.", "fehler");
      try { await speichere(); } catch (err) { return melde(err.message, "fehler"); }
      const voll = `${v.text.trim()}\n\nMit freundlichen Grüßen\n${signatur}`;

      const anzahlFotos = k.auftrag ? (antwort.anhaenge || []).length : 0;
      if (zustand.ki?.versand) {
        const ok = await frage("E-Mail jetzt senden?", `
          <p>An <strong>${esc(v.an)}</strong><br>Betreff: ${esc(v.betreff || "Ihre Nachricht")}${anzahlFotos ? `<br>Anhang: ${anzahlFotos} ${anzahlFotos === 1 ? "Foto" : "Fotos"}` : ""}</p>
          <div class="mailvorschau">${esc(voll)}</div>
          <p class="leise">Absender: ${esc(zustand.ki.absender || "")}${zustand.profil?.antwort_email ? `. Antworten gehen an ${esc(zustand.profil.antwort_email)}.` : ""}
            Unter der Signatur steht der Briefkopf (Firma, Anschrift, Kontakt aus den Einstellungen).</p>`,
        "Jetzt senden");
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
        if (erfolg) { melde(`E-Mail an ${v.an} gesendet.`, "ok"); return k.nachEnde(); }
        if (erfolg === null) return;
      }

      // Rückfall: Das eigene E-Mail-Programm öffnen
      const ok = await frage("Im E-Mail-Programm öffnen", `
        <p>Der direkte Versand aus der App ist noch nicht eingerichtet. Die E-Mail öffnet sich in Ihrem E-Mail-Programm.
        Dort prüfen und abschicken.</p>${anzahlFotos ? `<p><strong>Die Fotos bitte im E-Mail-Programm selbst anhängen</strong> (oder „Drucken“ nutzen).</p>` : ""}`, "E-Mail-Programm öffnen");
      if (!ok) return;
      window.location.href = `mailto:${encodeURIComponent(v.an)}?subject=${encodeURIComponent(v.betreff)}&body=${encodeURIComponent(voll)}`;
      await new Promise((r) => setTimeout(r, 600));
      if (await frage("Abgeschickt?", `<p>Wenn die E-Mail raus ist, wird ${k.auftrag ? "der Auftrag im Verlauf vermerkt" : "die Nachricht als beantwortet markiert"}.</p>`, k.auftrag ? "Ja, vermerken" : "Ja, als beantwortet markieren")) {
        try {
          await alsGesendetMarkieren(v.an, "email-programm");
          melde("Als beantwortet markiert.", "ok");
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
      let bytes, dateiname;
      const ergebnis = await beschaeftigt(el, knopf, "Wird vorbereitet …", async () => {
        try {
          if (!zustand.vorlagen?.some((x) => x.schluessel === "antwort")) zustand.vorlagen = await db.ladeVorlagen();
          const vorlage = zustand.vorlagen.find((x) => x.schluessel === "antwort");
          if (!vorlage) throw new Error("Die Vorlage „Antwortschreiben“ fehlt.");
          const w = k.mieter && wohnungVon(k.mieter.wohnung_id);
          const o = w && objektVon(w.objekt_id);
          const datei = await db.ladeVorlagenDatei(vorlage);
          try {
            bytes = fuelleVorlage(datei, antwortDaten({
              profil: zustand.profil || {}, mieter: k.mieter, wohnung: w || {}, objekt: o || {},
              empfaenger: empf, betreff: v.betreff, text: v.text,
            }));
          } catch (err) {
            throw new Error("Die Vorlage enthält einen Fehler: " + vorlagenFehler(err));
          }
          dateiname = `${heuteISO()}_Schreiben_${dateiTeil(k.mieter?.nachname || empf.name || "Empfaenger")}.docx`;
          return true;
        } catch (err) {
          melde(err.message, "fehler");
          return false;
        }
      });
      if (!ergebnis) return;
      const vorgangId = crypto.randomUUID();
      const anrede = v.text.split(/\n/)[0] || "Guten Tag,";
      const gespeichert = await zeigeDokument({
        titel: v.betreff || "Schreiben",
        untertitel: `An ${empf.name}`,
        bytes,
        dateiname,
        hinweis: k.mieter
          ? "Noch nicht gespeichert. Beim Herunterladen, Drucken oder Versenden wird der Brief in der Akte abgelegt."
          : "Beim Herunterladen, Drucken oder Versenden wird das Schreiben als erledigt vermerkt.",
        email: { an: v.an, betreff: v.betreff, text: `${anrede}\n\nim Anhang erhalten Sie unser Schreiben.\n\nMit freundlichen Grüßen\n${signatur}` },
        melde,
        vorAbschluss: async () => {
          if (k.mieter) {
            await db.archiviereSchreiben({
              vorgangId, mieterId: k.mieter.id, bytes,
              vorgang: { typ: "antwort", titel: `Brief: ${v.betreff || "Schreiben"}`, details: { antwort_id: antwort.id, datei: dateiname } },
            });
          }
          await db.speichereAntwort(antwort.id, { status: "als_brief" });
          if (k.nachricht) await db.aendereNachricht(k.nachricht.id, { status: "beantwortet" });
          const h = $("#dialog [data-v=hinweis]");
          if (h) h.textContent = k.mieter ? "In der Akte gespeichert." : "Vermerkt.";
        },
      });
      if (gespeichert) {
        melde("Brief erstellt und vermerkt.", "ok");
        k.nachEnde();
      }
    },
  };

  for (const b of $$("[data-k]", el)) {
    b.addEventListener("click", () => aktionen[b.dataset.k](b));
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
    const kt = kostentraegerVon(m.kostentraeger_id);
    if (kt) {
      vorschlaege.push({
        wert: "kt", label: `Kostenträger: ${kt.name}`, name: kt.name, zusatz: kt.abteilung || "",
        strasse: kt.strasse || "", plz_ort: [kt.plz, kt.ort].filter(Boolean).join(" "),
      });
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
  // ziel: Mieter-ID oder „d-<ID>“ für einen Handwerker/Dienstleister
  let mieterId = ziel && !ziel.startsWith("d-") ? ziel : null;
  let dienstId = ziel?.startsWith("d-") ? ziel.slice(2) : null;
  let antwort = null;
  if (antwortId) {
    antwort = await db.ladeAntwort(antwortId);
    if (antwort.nachricht_id) return geheZu(`#/postfach/${antwort.nachricht_id}`);
    mieterId = antwort.mieter_id;
    dienstId = antwort.dienstleister_id || null;
  }
  const [mieterL, alleDienst] = await Promise.all([mieterListe(), db.ladeDienstleister().catch(() => []), ladeKiStatus()]);
  const dienstL = alleDienst.filter((d) => d.aktiv || d.id === dienstId);
  const dienstleister = dienstId ? dienstL.find((d) => d.id === dienstId) || null : null;
  const mieter = !dienstleister && mieterId ? await db.ladeMieter(mieterId).catch(() => null) : null;
  const entwuerfe = (await db.ladeAntworten({ mieterId: mieter?.id || null, anzahl: 30 }).catch(() => []))
    .filter((a) => a.status === "entwurf" && !a.nachricht_id && a.art !== "auftrag" && a.id !== antwort?.id && (mieter || !a.mieter_id));
  const w = mieter && wohnungVon(mieter.wohnung_id);
  const o = w && objektVon(w.objekt_id);
  const kt = mieter && kostentraegerVon(mieter.kostentraeger_id);
  const zurueck = mieter ? `#/mieter/${mieter.id}` : dienstleister?.objekt_id ? `#/objekt/${dienstleister.objekt_id}` : "#/postfach";
  const dienstOptionen = `<option value="">Keiner</option>` + dienstL.map((d) =>
    `<option value="${esc(d.id)}" ${d.id === dienstleister?.id ? "selected" : ""}>${esc(d.name)}${d.gewerk ? " – " + esc(d.gewerk) : ""}</option>`).join("");

  inhalt().innerHTML = `
    <a class="zurueck" href="${esc(zurueck)}">${mieter ? "Zur Akte" : dienstleister?.objekt_id ? "Zum Haus" : "Zum Postfach"}</a>
    <div class="kopf"><div><h1>${antwort ? "Entwurf" : "Neues Schreiben"}</h1>
      <p>Sagen oder tippen Sie, was drinstehen soll. Die KI entwirft das Schreiben ${dienstleister ? "an den Handwerker mit dem Wissen zum Haus" : "mit den Daten der Mietpartei und dem Wissen"}.</p></div></div>
    ${kiBanner()}
    <div class="akte">
      <div class="stapel"><div id="entwurf"></div></div>
      <div class="stapel">
        <section class="flaeche">
          <div class="flaeche__kopf"><h2>An wen?</h2></div>
          <div class="flaeche__inhalt">
            <label class="feld"><span>Mietpartei</span><select id="empf-mieter" ${antwort ? "disabled" : ""}>${mieterOptionen(mieterL, mieter?.id || null, "Keine (z. B. Interessent)")}</select></label>
            <label class="feld feld--eng"><span>Handwerker / Dienstleister</span><select id="empf-dienst" ${antwort ? "disabled" : ""}>${dienstOptionen}</select></label>
            ${mieter ? `<dl class="datenliste datenliste--abstand">
                <dt>Wohnung</dt><dd>${esc([o?.bezeichnung, w?.bezeichnung].filter(Boolean).join(", ") || "–")}</dd>
                <dt>E-Mail</dt><dd>${esc(mieter.email || "–")}</dd>
                ${kt ? `<dt>Kostenträger</dt><dd>${esc(kt.name)}</dd>` : ""}
              </dl>`
            : dienstleister ? `<dl class="datenliste datenliste--abstand">
                ${dienstleister.gewerk ? `<dt>Gewerk</dt><dd>${esc(dienstleister.gewerk)}</dd>` : ""}
                <dt>E-Mail</dt><dd>${dienstleister.email ? esc(dienstleister.email) : `<span class="betrag--offen">keine hinterlegt</span>`}</dd>
                ${dienstleister.telefon ? `<dt>Telefon</dt><dd><a href="tel:${esc(String(dienstleister.telefon).replace(/[^\d+]/g, ""))}">${esc(dienstleister.telefon)}</a></dd>` : ""}
              </dl>
              <label class="feld feld--eng feld--oben"><span>Betrifft Haus (optional)</span><select id="empf-haus">
                <option value="">–</option>
                ${zustand.stamm.objekte.map((x) => `<option value="${esc(x.id)}" ${x.id === dienstleister.objekt_id ? "selected" : ""}>${esc(x.bezeichnung)}</option>`).join("")}
              </select></label>
              <p class="leise">Die KI bekommt keine Daten von Mietern, nur Haus und Wissen.</p>`
            : `<p class="leise">Ohne Auswahl nutzt die KI nur das allgemeine Wissen.</p>`}
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
  zustand.vorbelegung = null;
  baueEntwurf($("#entwurf"), {
    nachricht: null, mieter, dienstleister, antwort, anweisung: vorbelegt,
    objektId: () => $("#empf-haus")?.value || null,
    nachEnde: () => geheZu(zurueck),
  });
  if (dienstleister && !dienstleister.email && !antwort) melde("Für diesen Handwerker ist keine E-Mail hinterlegt. Bitte im Feld „An“ eintragen oder als Brief drucken.", "info");
  $("#empf-mieter").addEventListener("change", (e) => geheZu(e.target.value ? `#/schreiben/${e.target.value}` : "#/schreiben"));
  $("#empf-dienst").addEventListener("change", (e) => geheZu(e.target.value ? `#/schreiben/d-${e.target.value}` : "#/schreiben"));
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

      <section class="flaeche">
        <div class="flaeche__kopf"><h2>Dokumentenablage</h2></div>
        <div class="flaeche__inhalt">
          <p>Ordner für Rechnungen, Verträge &amp; Co. (für alle Häuser gleich). Die KI legt nur in diese Ordner ab.</p>
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
  $("#zip-alle").addEventListener("click", () => ablage.zipExport({}));
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
