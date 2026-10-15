// Postfach, KI-Entwürfe, Wissen und Einstellungen
// Grundsatz: Die KI schreibt nur Entwürfe. Verschickt wird ausschließlich per Klick.
import * as db from "./daten.js";
import { antwortDaten, briefanrede, fuelleVorlage, vorlagenFehler, datumDE, mieterName } from "./dokumente.js";
import { zeigeDokument } from "./vorschau.js";
import {
  $, $$, esc, melde, dialogFormular, frage, dateiTeil, heuteISO,
  zustand, wohnungVon, objektVon, kostentraegerVon,
} from "./helfer.js";

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

const ICON_MIKRO = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/></svg>`;
const ICON_KI = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M11 2l1.9 5.6L18.5 9.5l-5.6 1.9L11 17l-1.9-5.6L3.5 9.5l5.6-1.9zM18.5 13.5l.95 2.55 2.55.95-2.55.95-.95 2.55-.95-2.55L15 17l2.55-.95z"/></svg>`;
const ICON_KAMERA = `<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M9 3 7.2 5H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3.2L15 3H9zm3 5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9zm0 2a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"/></svg>`;

const istEmail = (s) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(String(s || ""));
const kurz = (t, n) => {
  const s = String(t || "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
};
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const anschriftAnrede = (m) => (m.anrede === "Herr" ? "Herrn " : m.anrede === "Frau" ? "Frau " : "");

function zeitDE(iso) {
  if (!iso) return "";
  const d = new Date(iso), jetzt = new Date();
  if (d.toDateString() === jetzt.toDateString()) return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) + " Uhr";
  if (d.getFullYear() === jetzt.getFullYear()) return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" }).replace(/\.?$/, ".");
  return datumDE(iso);
}
const datumZeit = (iso) =>
  new Date(iso).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) + " Uhr";

function signaturText() {
  const p = zustand.profil || {};
  return (p.email_signatur || "").trim() || [p.inhaber, p.firma].filter(Boolean).join("\n");
}

// Navigation auch dann auslösen, wenn die Adresse schon stimmt (Seite neu aufbauen)
function geheZu(hash) {
  if (location.hash === hash) window.dispatchEvent(new HashChangeEvent("hashchange"));
  else location.hash = hash;
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
// Mietparteien (für Auswahllisten)
// ---------------------------------------------------------------------------
async function mieterListe() {
  zustand.mieterKurz = await db.ladeMieterKurz();
  return zustand.mieterKurz;
}
function ortVon(m) {
  const w = wohnungVon(m.wohnung_id);
  const o = w && objektVon(w.objekt_id);
  return o ? `${o.strasse || o.bezeichnung}, ${w.bezeichnung}` : "";
}
function mieterOptionen(liste, gewaehlt, leer = "Keine Mietpartei") {
  return `<option value="">${esc(leer)}</option>` + liste.map((m) => {
    const ort = ortVon(m);
    return `<option value="${esc(m.id)}" ${m.id === gewaehlt ? "selected" : ""}>${esc(mieterName(m))}${ort ? " – " + esc(ort) : ""}</option>`;
  }).join("");
}

// ---------------------------------------------------------------------------
// Diktat (Spracherkennung des Browsers). Auf dem iPhone geht auch das Mikrofon der Tastatur.
// ---------------------------------------------------------------------------
const Erkennung = window.SpeechRecognition || window.webkitSpeechRecognition;
let diktat = null;

const mikroKnopf = () =>
  `<button type="button" class="mikro" data-diktat aria-pressed="false" title="Diktieren" aria-label="Diktieren">${ICON_MIKRO}</button>`;

export function stoppeDiktat() {
  try { diktat?.erkennung.stop(); } catch { /* schon beendet */ }
}
window.addEventListener("hashchange", stoppeDiktat);
document.getElementById("dialog")?.addEventListener("close", stoppeDiktat);

export function verbindeDiktat(root) {
  for (const knopf of $$("[data-diktat]", root)) {
    const feld = knopf.parentElement.querySelector("textarea, input");
    if (!Erkennung || !feld) { knopf.hidden = true; continue; }
    knopf.addEventListener("click", () => {
      if (diktat?.knopf === knopf) return stoppeDiktat();
      stoppeDiktat();
      starteDiktat(knopf, feld);
    });
  }
}

function starteDiktat(knopf, feld) {
  const erkennung = new Erkennung();
  erkennung.lang = "de-DE";
  erkennung.continuous = true;
  erkennung.interimResults = true;
  const anfang = feld.value.trim() ? feld.value.replace(/\s*$/, " ") : "";
  erkennung.onresult = (e) => {
    let gesagt = "";
    for (let i = 0; i < e.results.length; i++) gesagt += e.results[i][0].transcript;
    feld.value = anfang + gesagt.trim();
    feld.dispatchEvent(new Event("input", { bubbles: true }));
  };
  erkennung.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      melde("Bitte den Zugriff aufs Mikrofon erlauben. Alternativ das Mikrofon der Tastatur nutzen.", "fehler");
    } else if (e.error !== "aborted" && e.error !== "no-speech") {
      melde("Diktat nicht möglich (" + e.error + "). Alternativ das Mikrofon der Tastatur nutzen.", "fehler");
    }
  };
  erkennung.onend = () => {
    knopf.classList.remove("mikro--an");
    knopf.setAttribute("aria-pressed", "false");
    if (diktat?.erkennung === erkennung) diktat = null;
  };
  try {
    erkennung.start();
  } catch (err) {
    return melde("Diktat nicht möglich: " + err.message, "fehler");
  }
  diktat = { knopf, erkennung };
  knopf.classList.add("mikro--an");
  knopf.setAttribute("aria-pressed", "true");
  feld.focus();
}

// Textfelder wachsen mit dem Inhalt
function wachsen(feld) {
  const anpassen = () => {
    feld.style.height = "auto";
    feld.style.height = Math.min(feld.scrollHeight + 2, 900) + "px";
  };
  feld.addEventListener("input", anpassen);
  requestAnimationFrame(anpassen);
  return anpassen;
}

// Kurzer Wartehinweis als Dialog (z. B. während die KI einen Brief liest)
function wartehinweis(text) {
  const dlg = $("#dialog");
  dlg.innerHTML = `<div class="warten"><span class="kreisel" aria-hidden="true"></span><p>${esc(text)}</p></div>`;
  dlg.showModal();
  // Wartet auf das close-Ereignis, damit es nicht beim nächsten Dialog ankommt
  return {
    ende: () => new Promise((fertig) => {
      if (!dlg.open) return fertig();
      dlg.addEventListener("close", () => fertig(), { once: true });
      dlg.close();
    }),
  };
}

// Knopf zeigt „arbeitet“, alle Knöpfe im Bereich sind solange gesperrt
async function beschaeftigt(bereich, knopf, text, arbeit) {
  const knoepfe = $$("button", bereich).filter((b) => !b.disabled);
  const vorher = knopf.innerHTML;
  knoepfe.forEach((b) => (b.disabled = true));
  knopf.innerHTML = `<span class="kreisel" aria-hidden="true"></span> ${esc(text)}`;
  try {
    return await arbeit();
  } finally {
    knoepfe.forEach((b) => (b.disabled = false));
    knopf.innerHTML = vorher;
  }
}

// ---------------------------------------------------------------------------
// Zeile im Postfach
// ---------------------------------------------------------------------------
function marken(n, { mitStatus = true } = {}) {
  return [
    n.status === "neu" ? `<span class="marker marker--neu">neu</span>` : "",
    n.ki_dringlichkeit === "hoch" ? `<span class="marker marker--offen">dringend</span>` : "",
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

// Für die Übersicht
export async function uebersichtPostfach() {
  try {
    const [liste, mieterL] = await Promise.all([db.ladeNachrichten({ status: FILTER.offen, anzahl: 50 }), mieterListe()]);
    const namen = Object.fromEntries(mieterL.map((m) => [m.id, mieterName(m)]));
    const neu = liste.filter((n) => n.status === "neu").length;
    return `
      <section class="flaeche">
        <div class="flaeche__kopf"><h2>Postfach</h2>
          <a class="leise" href="#/postfach">${liste.length ? `${liste.length} offen${neu ? `, davon ${neu} neu` : ""}` : "Zum Postfach"}</a></div>
        ${liste.length
          ? `<div class="posts">${liste.slice(0, 4).map((n) => nachrichtZeile(n, namen)).join("")}</div>
             ${liste.length > 4 ? `<div class="flaeche__fuss"><a href="#/postfach">Alle ${liste.length} offenen Nachrichten ansehen</a></div>` : ""}`
          : `<div class="leer">Keine offenen Nachrichten.</div>`}
      </section>`;
  } catch (err) {
    console.warn("Postfach:", err);
    return "";
  }
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
        <label class="knopf">${ICON_KAMERA} Brief fotografieren<input type="file" accept="image/*" id="foto" hidden></label>
        <button type="button" class="knopf" id="notiz">Notiz / Anruf</button>
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
  $("#foto").addEventListener("change", (e) => { const d = e.target.files[0]; e.target.value = ""; briefFotografieren(d); });
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
    <h2>Notiz oder Anruf erfassen</h2>
    <p class="leise">Zum Beispiel ein Anruf oder ein Gespräch im Treppenhaus. Danach können Sie wie auf eine E-Mail antworten.</p>
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
// Brief fotografieren: Foto verkleinern, von der KI abschreiben lassen, ins Postfach
// ---------------------------------------------------------------------------
const alsBase64 = (blob) => new Promise((ok, fehler) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(",")[1]);
  r.onerror = () => fehler(r.error);
  r.readAsDataURL(blob);
});

function verkleinere(datei, max = 1568) {
  return new Promise((ok, fehler) => {
    const url = URL.createObjectURL(datei);
    const bild = new Image();
    bild.onload = () => {
      const f = Math.min(1, max / Math.max(bild.naturalWidth, bild.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(bild.naturalWidth * f);
      c.height = Math.round(bild.naturalHeight * f);
      c.getContext("2d").drawImage(bild, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob(async (blob) => {
        if (!blob) return fehler(new Error("Umwandlung fehlgeschlagen"));
        ok({ blob, base64: await alsBase64(blob), url: URL.createObjectURL(blob) });
      }, "image/jpeg", 0.85);
    };
    bild.onerror = () => { URL.revokeObjectURL(url); fehler(new Error("Bildformat wird nicht unterstützt")); };
    bild.src = url;
  });
}

async function briefFotografieren(datei) {
  if (!datei) return;
  let bild;
  try {
    bild = await verkleinere(datei);
  } catch (err) {
    return melde("Das Foto konnte nicht gelesen werden: " + err.message, "fehler");
  }
  let erkannt = {};
  if (zustand.ki?.ki) {
    const warte = wartehinweis("Die KI liest den Brief …");
    try {
      erkannt = await db.funktion("ki", { aktion: "brief_lesen", bild: { daten: bild.base64, typ: "image/jpeg" } });
      if (erkannt.lesbar === false) melde("Der Brief war schwer lesbar. Bitte den Text prüfen.", "info");
    } catch (err) {
      melde(err.message, "fehler");
    } finally {
      await warte.ende();
    }
  }
  const mieterL = await mieterListe();
  const name = norm(erkannt.absender_name);
  const vermutet = name
    ? mieterL.find((m) => name.includes(norm(m.nachname)) && (!m.vorname || name.includes(norm(m.vorname))))
    : null;

  const daten = await dialogFormular(`
    <h2>Brief ins Postfach</h2>
    <img class="fotovorschau" src="${bild.url}" alt="Foto des Briefs">
    <p class="leise">${zustand.ki?.ki ? "Von der KI abgeschrieben. Bitte kurz prüfen." : "Die KI ist noch nicht eingerichtet. Bitte das Wichtigste selbst eintragen."}</p>
    <label class="feld"><span>Absender</span><input name="absender" value="${esc(erkannt.absender_name || "")}"></label>
    <label class="feld"><span>Mietpartei</span><select name="mieter_id">${mieterOptionen(mieterL, vermutet?.id || null)}</select></label>
    <label class="feld"><span>Betreff</span><input name="betreff" required value="${esc(erkannt.betreff || "")}"></label>
    <label class="feld"><span>Text</span>
      <span class="diktat"><textarea name="text" rows="8">${esc(erkannt.text || "")}</textarea>${mikroKnopf()}</span></label>
    <div class="knopfreihe">
      <button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button>
      <button class="knopf knopf--primaer" value="ok">Ins Postfach</button>
    </div>`, { breit: true, vorbereiten: verbindeDiktat });
  setTimeout(() => URL.revokeObjectURL(bild.url), 5000);
  if (!daten) return;

  const m = mieterL.find((x) => x.id === daten.get("mieter_id"));
  try {
    const n = await db.neueNachricht({
      quelle: "brief",
      status: "offen",
      absender_name: String(daten.get("absender")).trim() || (m ? mieterName(m) : null),
      absender_email: istEmail(erkannt.absender_email) ? erkannt.absender_email : (m?.email || null),
      mieter_id: m?.id || null,
      zuordnung: m ? "manuell" : null,
      betreff: String(daten.get("betreff")).trim(),
      text: String(daten.get("text")).trim(),
    });
    const pfad = `${n.id}.jpg`;
    try {
      await db.ladeFotoHoch(pfad, bild.blob);
      await db.aendereNachricht(n.id, { anhaenge: [{ name: "Foto des Briefs.jpg", typ: "image/jpeg", pfad }] });
    } catch (err) {
      melde(err.message, "fehler");
    }
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
  const art = a.status === "gesendet" ? `E-Mail an ${a.empfaenger_email || "?"}` : "Als Brief erstellt";
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
      <button type="button" class="knopf knopf--klein" id="einordnen" ${kiDa ? "" : "disabled"}>${ICON_KI} ${n.ki_am ? "Neu einordnen" : "Mit KI einordnen"}</button>
    </div>`;
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
  const entwurf = antworten.find((a) => a.status === "entwurf") || null;
  const fertige = antworten.filter((a) => a.status !== "entwurf");
  const w = mieter && wohnungVon(mieter.wohnung_id);
  const o = w && objektVon(w.objekt_id);
  const absender = [n.absender_name, n.absender_email ? `<${n.absender_email}>` : ""].filter(Boolean).join(" ") || "Unbekannt";
  const foto = (n.anhaenge || []).find((a) => a.pfad);
  const andere = (n.anhaenge || []).filter((a) => !a.pfad);
  const erledigt = n.status === "erledigt" || n.status === "beantwortet";

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
            ${foto ? `<a class="fotolink" data-foto="${esc(foto.pfad)}" target="_blank" rel="noopener"><img class="fotovorschau" alt="Foto des Briefs"></a>` : ""}
            ${andere.length ? `<p class="leise anhaenge">Anhänge: ${andere.map((a) => esc(a.name || "Datei")).join(", ")}
              <br>(Die Dateien selbst liegen beim E-Mail-Dienst und werden noch nicht in die App übernommen.)</p>` : ""}
          </div>
        </section>
        <div id="entwurf"></div>
        ${fertige.length ? `<section class="flaeche"><div class="flaeche__kopf"><h2>Bisherige Antworten</h2></div>${fertige.map(antwortEintrag).join("")}</section>` : ""}
      </div>
      <div class="stapel">
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
          <div class="flaeche__inhalt knopfreihe">
            ${erledigt
              ? `<button type="button" class="knopf" id="wiederoffen">Wieder öffnen</button>`
              : `<button type="button" class="knopf" id="erledigt">Erledigt, keine Antwort nötig</button>`}
          </div>
        </section>
      </div>
    </div>`;

  baueEntwurf($("#entwurf"), { nachricht: n, mieter, antwort: entwurf, nachEnde: () => zeigeNachricht(id) });

  if (foto) {
    db.fotoAdresse(foto.pfad).then((url) => {
      const a = $(`[data-foto]`);
      if (!a) return;
      a.href = url;
      $("img", a).src = url;
    }).catch(() => {});
  }
  $("#einordnen").addEventListener("click", (e) =>
    beschaeftigt($("#einordnung"), e.currentTarget, "KI ordnet ein …", async () => {
      try {
        await db.funktion("ki", { aktion: "einordnen", nachricht_id: id });
        await zeigeNachricht(id);
      } catch (err) {
        melde(err.message, "fehler");
      }
    }));
  $("#zuordnung").addEventListener("change", async (e) => {
    const v = e.target.value || null;
    try {
      await db.aendereNachricht(id, { mieter_id: v, zuordnung: v ? "manuell" : null });
      melde(v ? "Mietpartei zugeordnet." : "Zuordnung entfernt.", "ok");
      await zeigeNachricht(id);
    } catch (err) {
      melde(err.message, "fehler");
    }
  });
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
      await zeigeNachricht(id);
    } catch (err) { melde(err.message, "fehler"); }
  });
}

// ---------------------------------------------------------------------------
// Entwurf: Anweisung (tippen oder diktieren) → KI-Entwurf → bearbeiten → senden oder als Brief
// k = { nachricht, mieter, antwort, nachEnde }
// ---------------------------------------------------------------------------
function baueEntwurf(el, k) {
  let antwort = k.antwort;
  const kiDa = !!zustand.ki?.ki;
  const standardAn = k.nachricht?.absender_email || k.mieter?.email || "";
  const signatur = signaturText();
  const platzhalter = k.nachricht
    ? "z. B. „Handwerker ist beauftragt, meldet sich bis Freitag.“ Leer lassen: Die KI antwortet anhand des Wissens."
    : "z. B. „Frau Huber an die Mülltrennung erinnern, freundlich.“ oder „Termin zur Wohnungsbesichtigung am 3.11. um 10 Uhr ankündigen.“";

  el.innerHTML = `
    <section class="flaeche entwurf">
      <div class="flaeche__kopf"><h2>${k.nachricht ? "Antwort" : "Schreiben"}</h2>
        ${antwort ? `<span class="marker marker--messing">Entwurf gespeichert</span>` : ""}</div>
      <div class="flaeche__inhalt">
        <label class="feld"><span>${k.nachricht ? "Was soll in der Antwort stehen? (optional)" : "Was soll im Schreiben stehen?"}</span>
          <span class="diktat"><textarea name="anweisung" rows="3" placeholder="${esc(platzhalter)}">${esc(antwort?.anweisung || "")}</textarea>${mikroKnopf()}</span></label>
        <div class="knopfreihe">
          <button type="button" class="knopf knopf--ki" data-k="entwerfen" ${kiDa ? "" : `aria-disabled="true"`}>${ICON_KI} ${antwort ? "Neu entwerfen" : "Entwurf mit KI"}</button>
          ${antwort ? "" : `<button type="button" class="knopf" data-k="selbst">Selbst schreiben</button>`}
        </div>
        <div class="entwurf__editor" data-teil="editor" ${antwort ? "" : "hidden"}>
          <div class="ki-hinweise" data-teil="hinweise" hidden></div>
          <div class="formraster formraster--zwei">
            <label class="feld"><span>An (E-Mail)</span><input type="email" name="an" value="${esc(antwort?.empfaenger_email || standardAn)}" placeholder="name@beispiel.de" autocomplete="off"></label>
            <label class="feld"><span>Betreff</span><input name="betreff" value="${esc(antwort?.betreff || "")}"></label>
          </div>
          <label class="feld"><span>Text</span><textarea name="text" rows="10" class="entwurf__text">${esc(antwort?.text || "")}</textarea></label>
          <p class="signatur">Wird automatisch angefügt:<br>Mit freundlichen Grüßen<br>${esc(signatur).replace(/\n/g, "<br>")}</p>
          <div class="ueberarbeiten">
            <label class="feld"><span>Änderungswunsch an die KI</span>
              <span class="diktat"><input name="aenderung" placeholder="z. B. kürzer, oder: Termin Dienstag 10 Uhr nennen" autocomplete="off">${mikroKnopf()}</span></label>
            <button type="button" class="knopf" data-k="ueberarbeiten">${ICON_KI} Überarbeiten</button>
          </div>
          <div class="entwurf__aktionen">
            <button type="button" class="knopf knopf--primaer" data-k="senden">Per E-Mail senden</button>
            <button type="button" class="knopf" data-k="brief">Als Brief</button>
            <button type="button" class="knopf" data-k="speichern">Entwurf speichern</button>
            <button type="button" class="knopf knopf--leise knopf--gefahr" data-k="verwerfen">Verwerfen</button>
          </div>
          <p class="leise entwurf__hinweis">Nichts geht automatisch raus. Erst „Per E-Mail senden“ oder „Als Brief“ verlässt die App.</p>
        </div>
      </div>
    </section>`;

  const feld = (name) => el.querySelector(`[name="${name}"]`);
  const editor = el.querySelector('[data-teil="editor"]');
  const hinweisBox = el.querySelector('[data-teil="hinweise"]');
  verbindeDiktat(el);
  const textGroesse = wachsen(feld("text"));
  wachsen(feld("anweisung"));

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
      empfaenger_name: k.nachricht?.absender_name || (k.mieter ? mieterName(k.mieter) : null),
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
    await db.speichereAntwort(antwort.id, { status: "gesendet", gesendet_am: new Date().toISOString(), empfaenger_email: an });
    if (k.nachricht) await db.aendereNachricht(k.nachricht.id, { status: "beantwortet" });
    if (k.mieter) {
      await db.protokolliereVorgang({
        mieter_id: k.mieter.id, typ: "antwort", titel: `E-Mail: ${werte().betreff || "Antwort"}`,
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
          const r = await db.funktion("ki", {
            aktion: "entwurf", nachricht_id: k.nachricht?.id || null, mieter_id: k.mieter?.id || null, anweisung: v.anweisung || null,
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
      const anrede = k.mieter ? briefanrede(k.mieter) + "," : "Guten Tag,";
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

      if (zustand.ki?.versand) {
        const ok = await frage("E-Mail jetzt senden?", `
          <p>An <strong>${esc(v.an)}</strong><br>Betreff: ${esc(v.betreff || "Ihre Nachricht")}</p>
          <div class="mailvorschau">${esc(voll)}</div>
          <p class="leise">Absender: ${esc(zustand.ki.absender || "")}${zustand.profil?.antwort_email ? `. Antworten gehen an ${esc(zustand.profil.antwort_email)}.` : ""}</p>`,
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
        Dort prüfen und abschicken.</p>`, "E-Mail-Programm öffnen");
      if (!ok) return;
      window.location.href = `mailto:${encodeURIComponent(v.an)}?subject=${encodeURIComponent(v.betreff)}&body=${encodeURIComponent(voll)}`;
      await new Promise((r) => setTimeout(r, 600));
      if (await frage("Abgeschickt?", "<p>Wenn die E-Mail raus ist, wird die Nachricht als beantwortet markiert.</p>", "Ja, als beantwortet markieren")) {
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

// Anschrift für den Brief wählen (Mietpartei, Kostenträger, Absender oder frei)
async function empfaengerDialog(k) {
  const vorschlaege = [];
  const m = k.mieter;
  let standard = null;
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
export async function zeigeNeuesSchreiben(mieterId = null, antwortId = null) {
  let antwort = null;
  if (antwortId) {
    antwort = await db.ladeAntwort(antwortId);
    if (antwort.nachricht_id) return geheZu(`#/postfach/${antwort.nachricht_id}`);
    mieterId = antwort.mieter_id;
  }
  const [mieterL] = await Promise.all([mieterListe(), ladeKiStatus()]);
  const mieter = mieterId ? await db.ladeMieter(mieterId).catch(() => null) : null;
  const entwuerfe = (await db.ladeAntworten({ mieterId: mieter?.id || null, anzahl: 30 }).catch(() => []))
    .filter((a) => a.status === "entwurf" && !a.nachricht_id && a.id !== antwort?.id && (mieter || !a.mieter_id));
  const w = mieter && wohnungVon(mieter.wohnung_id);
  const o = w && objektVon(w.objekt_id);
  const kt = mieter && kostentraegerVon(mieter.kostentraeger_id);

  inhalt().innerHTML = `
    <a class="zurueck" href="${mieter ? `#/mieter/${esc(mieter.id)}` : "#/postfach"}">${mieter ? "Zur Akte" : "Zum Postfach"}</a>
    <div class="kopf"><div><h1>${antwort ? "Entwurf" : "Neues Schreiben"}</h1>
      <p>Sagen oder tippen Sie, was drinstehen soll. Die KI entwirft das Schreiben mit den Daten der Mietpartei und dem Wissen.</p></div></div>
    ${kiBanner()}
    <div class="akte">
      <div class="stapel"><div id="entwurf"></div></div>
      <div class="stapel">
        <section class="flaeche">
          <div class="flaeche__kopf"><h2>An wen?</h2></div>
          <div class="flaeche__inhalt">
            <label class="feld feld--eng"><span>Mietpartei</span><select id="empf-mieter" ${antwort ? "disabled" : ""}>${mieterOptionen(mieterL, mieter?.id || null, "Keine (z. B. Interessent)")}</select></label>
            ${mieter ? `<dl class="datenliste">
                <dt>Wohnung</dt><dd>${esc([o?.bezeichnung, w?.bezeichnung].filter(Boolean).join(", ") || "–")}</dd>
                <dt>E-Mail</dt><dd>${esc(mieter.email || "–")}</dd>
                ${kt ? `<dt>Kostenträger</dt><dd>${esc(kt.name)}</dd>` : ""}
              </dl>`
              : `<p class="leise">Ohne Mietpartei nutzt die KI nur das allgemeine Wissen.</p>`}
          </div>
        </section>
        ${entwuerfe.length ? `
        <section class="flaeche">
          <div class="flaeche__kopf"><h2>Weitere Entwürfe</h2></div>
          <div class="zeilen">${entwuerfe.map((a) => `<a class="entwurfzeile" href="#/entwurf/${esc(a.id)}">
            <span>${esc(a.betreff || "(ohne Betreff)")}</span><span class="leise">${esc(zeitDE(a.aktualisiert_am))}</span></a>`).join("")}</div>
        </section>` : ""}
      </div>
    </div>`;

  baueEntwurf($("#entwurf"), {
    nachricht: null, mieter, antwort,
    nachEnde: () => geheZu(mieter ? `#/mieter/${mieter.id}` : "#/postfach"),
  });
  $("#empf-mieter").addEventListener("change", (e) => geheZu(e.target.value ? `#/schreiben/${e.target.value}` : "#/schreiben"));
}

// ---------------------------------------------------------------------------
// Wissen
// ---------------------------------------------------------------------------
export async function zeigeWissen() {
  const liste = await db.ladeWissen();
  const gruppen = [{ titel: "Gilt für alle Objekte", objekt_id: null }, ...zustand.stamm.objekte.map((o) => ({ titel: o.bezeichnung, objekt_id: o.id }))];
  inhalt().innerHTML = `
    <div class="kopf">
      <div><h1>Wissen</h1>
        <p>Das weiß die KI, wenn sie Antworten entwirft: Abläufe, Ansprechpartner, Hausordnung. Je konkreter, desto besser die Entwürfe.</p></div>
      <button type="button" class="knopf knopf--primaer" id="wissen-neu">Neuer Eintrag</button>
    </div>
    <div class="banner banner--leise">Bitte keine Bankdaten und nichts über einzelne Mieter eintragen. Das holt sich die KI aus der Akte, die IBAN bekommt sie nie.</div>
    <div class="stapel">
      ${gruppen.map((g) => {
        const eintraege = liste.filter((w) => (w.objekt_id || null) === g.objekt_id);
        if (!eintraege.length && g.objekt_id) return "";
        return `
          <section class="flaeche">
            <div class="flaeche__kopf"><h2>${esc(g.titel)}</h2><span class="leise">${eintraege.length} ${eintraege.length === 1 ? "Eintrag" : "Einträge"}</span></div>
            ${eintraege.length
              ? `<div class="wissensliste">${eintraege.map((w) => `
                  <button type="button" class="wissen ${w.aktiv ? "" : "wissen--aus"}" data-wissen="${esc(w.id)}">
                    <span class="wissen__titel">${esc(w.titel)}${w.aktiv ? "" : ` <span class="marker marker--leise">ausgeschaltet</span>`}</span>
                    <span class="wissen__text">${esc(w.inhalt)}</span>
                  </button>`).join("")}</div>`
              : `<div class="leer">Noch keine Einträge.</div>`}
          </section>`;
      }).join("")}
    </div>`;

  $("#wissen-neu").addEventListener("click", () => bearbeiteWissen(null));
  for (const b of $$("[data-wissen]")) b.addEventListener("click", () => bearbeiteWissen(liste.find((w) => w.id === b.dataset.wissen)));
}

async function bearbeiteWissen(w) {
  const daten = await dialogFormular(`
    <h2>${w ? "Eintrag bearbeiten" : "Neuer Eintrag"}</h2>
    <label class="feld"><span>Titel</span><input name="titel" required value="${esc(w?.titel || "")}" placeholder="z. B. Schlüsseldienst"></label>
    <label class="feld"><span>Gilt für</span><select name="objekt_id">
      <option value="">Alle Objekte</option>
      ${zustand.stamm.objekte.map((o) => `<option value="${esc(o.id)}" ${o.id === w?.objekt_id ? "selected" : ""}>${esc(o.bezeichnung)}</option>`).join("")}
    </select></label>
    <label class="feld"><span>Inhalt</span>
      <span class="diktat"><textarea name="inhalt" rows="8" required placeholder="z. B. Schlüsseldienst Muster, Tel. 0123 4567. Kosten trägt der Mieter, wenn er den Schlüssel verloren hat.">${esc(w?.inhalt || "")}</textarea>${mikroKnopf()}</span></label>
    <label class="checkfeld"><input type="checkbox" name="aktiv" ${w?.aktiv === false ? "" : "checked"}> Aktiv (die KI nutzt diesen Eintrag)</label>
    <div class="knopfreihe">
      ${w ? `<button class="knopf knopf--gefahr knopf--links" value="loeschen" formnovalidate>Löschen</button>` : ""}
      <button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button>
      <button class="knopf knopf--primaer" value="ok">Speichern</button>
    </div>`, { breit: true, vorbereiten: verbindeDiktat });
  if (!daten) return;
  try {
    if (daten.get("_aktion") === "loeschen") {
      if (!(await frage("Eintrag löschen?", `<p>„${esc(w.titel)}“ wird gelöscht.</p>`, "Löschen", { gefahr: true }))) return;
      await db.loescheWissen(w.id);
      melde("Eintrag gelöscht.", "ok");
    } else {
      await db.speichereWissen(w?.id, {
        titel: String(daten.get("titel")).trim(),
        inhalt: String(daten.get("inhalt")).trim(),
        objekt_id: daten.get("objekt_id") || null,
        aktiv: daten.get("aktiv") === "on",
      });
      melde("Gespeichert.", "ok");
    }
    await zeigeWissen();
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
