// Chat: Fragen an die App („Wer ist im Rückstand?“, „Wer macht die Heizung in der Lindenstraße?“)
// Die KI liest mit Roberts Login. Sie ändert nichts selbst: Aktionen kommen als Vorschlag und laufen erst per Klick.
import * as db from "./daten.js";
import { datumDE, mieterName } from "./dokumente.js";
import { $, esc, melde, zustand, heuteISO, herunterladen, objektVon, dialogFormular, frage } from "./helfer.js";
import {
  ICON_KI, mikroKnopf, verbindeDiktat, stoppeDiktat, geheZu, istEmail, mieterListe, ortVon, alsBase64,
  suchauswahlHtml, verbindeSuchauswahl,
} from "./ui.js";
import { aufgabeDialog } from "./start.js";
import * as ablage from "./ablage.js";
import { kontakteListe, kontaktName, kontaktDialog } from "./kontakte.js";
import * as vorgaenge from "./vorgaenge.js";

const VORSCHLAEGE = [
  "Was ist heute wichtig?",
  "Wer ist im Rückstand?",
  "Welche Fristen stehen an?",
  "Wer macht die Heizung in der Lindenstraße?",
];
const verlauf = []; // { rolle: "robert" | "ki" | "fehler", text, aktionen? }
let laeuft = false;
let eingerichtet = false;
// Schalter „Mit Internet“ (pro Gerät gemerkt)
let internet = false;
try { internet = localStorage.getItem("chat-internet") === "1"; } catch { /* ohne Speicher: aus */ }

// Links aus dem Chat: im Browser in einem neuen Tab (der Chat bleibt offen), in der installierten App im selben Fenster
const alsApp = () => window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
const linkZiel = () => (alsApp() ? "" : ` target="_blank" rel="noopener"`);
const ZIELE = { mieter: "#/mieter/", kontakt: "#/kontakt/", objekt: "#/objekt/", nachricht: "#/postfach/" };

// Sichere Darstellung: erst alles maskieren, dann nur fett, Listen und App-interne Links erlauben
function formatiere(text) {
  const zeile = (z) => esc(z)
    .replace(/\[([^\]\n]{1,120})\]\((#\/(?:mieter|kontakt|kontakte|objekt|objekte|ablage|postfach|wissen|uebersicht|handwerker|thema|entwurf|auftrag|recherche)(?:\/[A-Za-z0-9-]{1,60})?)\)/g,
      (_, t, href) => `<a href="${href}" data-chat-link${linkZiel()}>${t}</a>`)
    .replace(/\*\*([^*\n]{1,200})\*\*/g, "<strong>$1</strong>");
  const bloecke = [];
  let liste = null, absatz = [];
  const absatzEnde = () => { if (absatz.length) bloecke.push(`<p>${absatz.join("<br>")}</p>`); absatz = []; };
  const listeEnde = () => { if (liste) bloecke.push(`<ul>${liste.join("")}</ul>`); liste = null; };
  for (const z of String(text).split("\n")) {
    const punkt = z.match(/^\s*(?:[-•*]|\d+\.)\s+(.*)$/);
    if (punkt) { absatzEnde(); (liste ||= []).push(`<li>${zeile(punkt[1])}</li>`); }
    else if (!z.trim()) { absatzEnde(); listeEnde(); }
    else { listeEnde(); absatz.push(zeile(z)); }
  }
  absatzEnde(); listeEnde();
  return bloecke.join("");
}

// Quellen aus dem Internet (nur http/https, öffnen immer in einem neuen Tab)
function quellenHtml(quellen) {
  const ok = (Array.isArray(quellen) ? quellen : []).filter((q) => typeof q?.url === "string" && /^https?:\/\/[^\s<>"]+$/i.test(q.url)).slice(0, 12);
  if (!ok.length) return "";
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
  return `<div class="chat__quellen"><span class="leise">Quellen:</span> ${ok.map((q) => `<a href="${esc(q.url)}" target="_blank" rel="noopener noreferrer" title="${esc(q.titel || "")}">${esc(host(q.url))}</a>`).join(" · ")}</div>`;
}

function einrichten() {
  const dlg = $("#chat");
  dlg.innerHTML = `
    <div class="chat__kopf">
      <h2>${ICON_KI} Fragen an die App</h2>
      <span class="knopfreihe">
        <button type="button" class="knopf knopf--leise knopf--klein" data-chat="neu">Neu</button>
        <button type="button" class="knopf knopf--leise knopf--klein" data-chat="zu" aria-label="Schließen">Schließen</button>
      </span>
    </div>
    <div class="chat__verlauf" id="chat-verlauf" aria-live="polite"></div>
    <div class="chat__modus" role="radiogroup" aria-label="Woher kommen die Antworten?">
      <label><input type="radio" name="chat-modus" value="app" ${internet ? "" : "checked"}> Nur App</label>
      <label><input type="radio" name="chat-modus" value="internet" ${internet ? "checked" : ""}> Mit Internet</label>
    </div>
    <form class="chat__eingabe" id="chat-form">
      <span class="diktat"><textarea name="frage" rows="1" maxlength="2000" placeholder="Frage stellen oder diktieren …" aria-label="Frage"></textarea>${mikroKnopf()}</span>
      <button class="knopf knopf--primaer" type="submit">Senden</button>
    </form>
    <p class="chat__hinweis">Die KI ändert nichts von selbst. Vorschläge (auch geänderte Telefonnummern oder E-Mails) führen Sie per Klick aus. Bankdaten sieht sie nicht.</p>`;
  const form = $("#chat-form");
  const feld = form.frage;
  verbindeDiktat(form);
  const groesse = () => { feld.style.height = "auto"; feld.style.height = Math.min(feld.scrollHeight + 2, 160) + "px"; };
  feld.addEventListener("input", groesse);
  feld.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    stoppeDiktat();
    const text = feld.value;
    feld.value = "";
    groesse();
    sende(text);
  });
  dlg.addEventListener("click", (e) => {
    const knopf = e.target.closest("[data-chat]");
    if (knopf?.dataset.chat === "zu") dlg.close();
    if (knopf?.dataset.chat === "neu") { verlauf.length = 0; zeichne(); feld.focus(); }
    const frage = e.target.closest("[data-frage]");
    if (frage) sende(frage.dataset.frage);
    const l = e.target.closest("[data-chat-link]");
    if (l && !l.target && window.matchMedia("(max-width: 900px)").matches) dlg.close();
    const akt = e.target.closest("[data-vorschlag]");
    if (akt) {
      const [i, j, op] = akt.dataset.vorschlag.split(":");
      const a = verlauf[Number(i)]?.aktionen?.[Number(j)];
      if (a) behandle(a, op, akt);
    }
  });
  // Dateiname der PDF merken (bleibt beim Neuzeichnen erhalten)
  dlg.addEventListener("input", (e) => {
    const f = e.target.closest("[data-pdfname]");
    if (!f) return;
    const [i, j] = f.dataset.pdfname.split(":").map(Number);
    const a = verlauf[i]?.aktionen?.[j];
    if (a) a.dateiname = f.value;
  });
  dlg.addEventListener("close", stoppeDiktat);
  for (const r of dlg.querySelectorAll("[name=chat-modus]")) {
    r.addEventListener("change", () => {
      internet = r.value === "internet" && r.checked;
      try { localStorage.setItem("chat-internet", internet ? "1" : "0"); } catch { /* egal */ }
      zeichne();
    });
  }
  eingerichtet = true;
}

function zeichne() {
  const el = $("#chat-verlauf");
  if (!el) return;
  el.innerHTML = verlauf.length
    ? verlauf.map((b, i) => {
        if (b.rolle === "robert") return `<div class="chat__frage">${esc(b.text)}</div>`;
        if (b.rolle === "fehler") return `<div class="chat__fehler">${esc(b.text)}</div>`;
        return `<div class="chat__antwort">${formatiere(b.text)}
          ${quellenHtml(b.quellen)}
          ${b.aktionen?.length ? `<div class="chat__aktionen">${b.aktionen.map((a, j) => vorschlagHtml(a, i, j)).join("")}</div>` : ""}
        </div>`;
      }).join("") + (laeuft ? `<div class="chat__antwort chat__denkt"><span class="kreisel" aria-hidden="true"></span> ${internet ? "sucht in der App und im Internet …" : "sucht in der App …"}</div>` : "")
    : `<div class="chat__leer">
        <p>${internet ? "Fragen Sie nach Mietern, Häusern, Fristen – oder nach Dingen außerhalb der App (Mietspiegel, Rechtslage, Firmen an einem Ort). Für Fragen außerhalb der App sucht die KI im Internet und nennt die Quellen; Namen und Daten aus der App gehen nicht ins Internet."
          : "Fragen Sie nach Mietern, Häusern, Nachrichten, Fristen oder Wissen. Die Antworten kommen aus der App."}</p>
        <div class="chat__chips">${VORSCHLAEGE.map((v) => `<button type="button" class="reiter__knopf" data-frage="${esc(v)}">${esc(v)}</button>`).join("")}</div>
      </div>`;
  el.scrollTop = el.scrollHeight;
}

async function sende(text) {
  text = String(text || "").trim().slice(0, 2000);
  if (!text || laeuft) return;
  if (!zustand.ki?.ki) return melde("Die KI ist noch nicht eingerichtet (Einstellungen).", "fehler");
  verlauf.push({ rolle: "robert", text });
  laeuft = true;
  zeichne();
  try {
    const r = await db.funktion("ki", {
      aktion: "chat",
      internet,
      verlauf: verlauf.filter((b) => b.rolle !== "fehler").slice(-12).map(({ rolle, text: t }) => ({ rolle, text: t })),
    });
    verlauf.push({ rolle: "ki", text: r.text || "Dazu habe ich keine Antwort gefunden.", aktionen: Array.isArray(r.aktionen) ? r.aktionen : [], quellen: Array.isArray(r.quellen) ? r.quellen : [] });
  } catch (err) {
    verlauf.push({ rolle: "fehler", text: "Das hat nicht geklappt: " + err.message });
  } finally {
    laeuft = false;
    zeichne();
  }
}

// ---------------------------------------------------------------------------
// Vorschläge der KI als kleine Karten: Annehmen (speichert direkt), Ändern (vorbelegter Dialog), Ablehnen.
// Nichts passiert ohne Klick. a.status: "gespeichert" | "abgelehnt" | undefined
// ---------------------------------------------------------------------------
const ART_NAME = { standort: "Standort-Check", notiz: "To-do", wissen: "Wissen", entwurf: "Schreiben", auftrag: "Handwerkerauftrag", oeffnen: "Öffnen", pdf: "PDF", kontakt: "Neuer Kontakt", handwerker: "Neuer Handwerker", stammdaten: "Stammdaten ändern" };
// Stammdaten-Karte: welche Felder heißen wie (der Server lässt nur diese zu)
const FELD_NAME = { anrede: "Anrede", vorname: "Vorname", nachname: "Nachname", name: "Name", firma: "Firma", rolle: "Rolle", telefon: "Telefon", email: "E-Mail", adresse: "Adresse", gewerk: "Gewerk" };
const ZIEL_TABELLE = { mieter: "mieter", kontakt: "kontakt", handwerker: "handwerker" };
function aenderungHtml(d) {
  const zeilen = Object.entries(d.felder || {}).map(([k, neu]) => {
    const alt = d.vorher?.[k];
    return `<li><span class="leise">${esc(FELD_NAME[k] || k)}:</span> ${alt ? `<s>${esc(alt)}</s> → ` : ""}<strong>${neu ? esc(neu) : "(leer)"}</strong></li>`;
  });
  if (d.bewohner_neu) zeilen.push(`<li><span class="leise">Weitere Bewohner:</span> <strong>+ ${esc(d.bewohner_neu)}</strong></li>`);
  return `<ul class="chatvorschlag__aenderung">${zeilen.join("")}</ul>`;
}
const tag = (iso) => (iso ? datumDE(iso) : "");

function pdfName(a) {
  if (a.dateiname == null) {
    a.dateiname = ablage.dokumentTitel({ datum: heuteISO(), objekt: objektVon(a.daten?.objekt_id), art: null, details: a.daten?.titel || "Liste" });
  }
  return a.dateiname;
}

function vorschlagHtml(a, i, j) {
  const d = a.daten || {};
  const k = (op, text, extra = "") => `<button type="button" class="knopf knopf--klein ${extra}" data-vorschlag="${i}:${j}:${op}">${text}</button>`;
  const detail = a.art === "notiz" ? [d.titel, d.faellig_am ? `fällig ${tag(d.faellig_am)}` : ""].filter(Boolean).join(" · ")
    : a.art === "wissen" ? [d.titel, d.ordner].filter(Boolean).join(" · ")
    : a.art === "pdf" ? `${d.titel} · ${d.abschnitte?.length || 0} ${d.abschnitte?.length === 1 ? "Abschnitt" : "Abschnitte"}`
    : a.art === "kontakt" ? [kontaktName(d), d.vorname || d.nachname ? d.firma : "", d.rolle, d.telefon, d.email,
        d.geburtstag_tag ? `Geburtstag ${d.geburtstag_tag}.${d.geburtstag_monat}.${d.geburtsjahr || ""}` : ""].filter(Boolean).join(" · ")
    : a.art === "handwerker" ? [d.name, d.gewerk, d.telefon, d.email, d.objekt_id ? objektVon(d.objekt_id)?.bezeichnung || "" : "alle Häuser"].filter(Boolean).join(" · ")
    : a.art === "standort" ? [d.ort, d.adresse, d.objektart, d.einheiten && `${d.einheiten} Einheiten`, d.wohnflaeche && `${d.wohnflaeche} m²`, d.kaufpreis && `Kaufpreis ${Number(d.kaufpreis).toLocaleString("de-DE")} €`].filter(Boolean).join(" · ")
    : a.art === "auftrag" ? [d.art === "angebot" ? "Angebote einholen" : "Direkt beauftragen", d.haus, d.ort, (d.handwerker || []).join(", ") || "Handwerker in der Maske wählen",
        d.frist ? `bis ${tag(d.frist)}` : ""].filter(Boolean).join(" · ")
    : a.art === "entwurf" && d.anhaenge?.length ? `${d.anhaenge.length === 1 ? "Anhang" : "Anhänge"}: ${d.anhaenge.map((x) => x.titel || "Datei").join(", ")}`
    : "";
  let knoepfe = "";
  if (a.status === "gespeichert") {
    knoepfe = `<span class="chatvorschlag__status chatvorschlag__status--ok">${a.statusText || "Gespeichert"}</span>${a.href ? `<a class="knopf knopf--klein knopf--leise" href="${esc(a.href)}" data-chat-link>Öffnen</a>` : ""}`;
  } else if (a.status === "gespeichert_rueck") {
    knoepfe = `<span class="chatvorschlag__status chatvorschlag__status--ok">${a.statusText || "Gespeichert"}</span>${a.href ? `<a class="knopf knopf--klein knopf--leise" href="${esc(a.href)}" data-chat-link>Öffnen</a>` : ""}${k("rueck", "Rückgängig", "knopf--leise")}`;
  } else if (a.status === "rueckgaengig") {
    knoepfe = `<span class="chatvorschlag__status">Rückgängig gemacht, alte Werte wiederhergestellt</span>`;
  } else if (a.status === "abgelehnt") {
    knoepfe = `<span class="chatvorschlag__status">Abgelehnt</span>${k("zurueck", "Doch anzeigen", "knopf--leise")}`;
  } else if (a.art === "notiz" || a.art === "wissen" || a.art === "kontakt" || a.art === "handwerker") {
    knoepfe = k("annehmen", "Annehmen", "knopf--primaer") + k("aendern", "Ändern") + k("ablehnen", "Ablehnen", "knopf--leise");
  } else if (a.art === "stammdaten") {
    knoepfe = k("annehmen", "Übernehmen", "knopf--primaer") + k("aendern", "Ändern") + k("ablehnen", "Ablehnen", "knopf--leise");
  } else if (a.art === "entwurf") {
    // An einen Kontakt/Handwerker, der in derselben Antwort erst angelegt wird: Knopf erst danach
    const neu = neuerEmpfaenger(a);
    knoepfe = d.empfaenger_neu && !neu?.zielId
      ? `<span class="chatvorschlag__status">Erst ${d.empfaenger_neu === "handwerker" ? "den Handwerker" : "den Kontakt"} oben anlegen</span>` + k("ablehnen", "Ablehnen", "knopf--leise")
      : k("oeffnen", "Schreiben öffnen", "knopf--primaer") + k("ablehnen", "Ablehnen", "knopf--leise");
  } else if (a.art === "standort") {
    knoepfe = k("standort", "Standort-Check öffnen", "knopf--primaer") + k("ablehnen", "Ablehnen", "knopf--leise");
  } else if (a.art === "auftrag") {
    knoepfe = k("auftrag", "Auftrag anlegen", "knopf--primaer") + k("ablehnen", "Ablehnen", "knopf--leise");
  } else if (a.art === "pdf") {
    knoepfe = k("ansehen", "Ansehen") + k("laden", "Herunterladen") + k("mail", "Per E-Mail", "knopf--primaer") + k("ablage", "In Ablage") +
      k("ablehnen", "Ablehnen", "knopf--leise");
  } else if (a.art === "oeffnen") {
    knoepfe = k("oeffnen", esc(a.beschriftung));
  } else {
    // Vorschlag, den diese Version noch nicht kennt (Server ist neuer als die App)
    knoepfe = `<span class="chatvorschlag__status">Diese Version der App kennt den Vorschlag noch nicht.</span>${k("neuladen", "App neu laden", "knopf--primaer")}`;
  }
  const nameFeld = a.art === "pdf" && a.status !== "abgelehnt"
    ? `<label class="feld chatvorschlag__name"><span>Dateiname</span>
        <span class="namefeld"><input data-pdfname="${i}:${j}" value="${esc(pdfName(a))}" maxlength="160" autocomplete="off" spellcheck="false"><span class="namefeld__endung">.pdf</span></span></label>`
    : "";
  return `<div class="chatvorschlag" data-art="${esc(a.art)}" ${a.status ? `data-status="${esc(a.status)}"` : ""}>
    <div class="chatvorschlag__text"><span class="chatvorschlag__art">${ART_NAME[a.art] || "Vorschlag"}</span>
      ${a.art === "oeffnen" ? "" : `<strong>${esc(a.beschriftung)}</strong>`}
      ${detail && detail !== a.beschriftung ? `<span class="leise">${esc(detail)}</span>` : ""}
      ${a.art === "stammdaten" ? `<span class="leise">${esc(d.name || "")}</span>${aenderungHtml(d)}` : ""}</div>
    ${nameFeld}
    <div class="chatvorschlag__knoepfe">${knoepfe}</div>
  </div>`;
}

/** Karte „Neuer Kontakt/Handwerker“ aus derselben Antwort, an den ein vorgeschlagenes Schreiben gehen soll */
function neuerEmpfaenger(a) {
  const art = a.daten?.empfaenger_neu;
  if (!art) return null;
  const antwort = verlauf.find((b) => b.aktionen?.includes(a));
  return antwort?.aktionen.find((x) => x !== a && (x.urArt || x.art) === art) || null;
}

function setze(a, status, statusText = "") {
  a.status = status;
  a.statusText = statusText;
  zeichne();
}

// Inhalt der PDF (eigene Datei, nichts davon geht an die KI zurück)
function pdfDatei(a) {
  const d = a.daten || {};
  const p = zustand.profil || {};
  return ablage.pdfEintrag({
    kopf: [p.firma || p.inhaber].filter(Boolean),
    titel: d.titel || "Übersicht",
    angaben: [["Stand", datumDE(new Date())], ["Haus", objektVon(d.objekt_id)?.bezeichnung || ""]],
    text: d.einleitung || "",
    abschnitte: d.abschnitte || [],
    fuss: `Erstellt am ${datumDE(new Date())} mit der Verwaltungs-App`,
  });
}
const sauber = (s) => String(s || "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 160) || "Liste";

function pdfAblageEintrag(a) {
  const d = a.daten || {};
  return {
    quelle: {},
    richtung: "notiz",
    art: null, artFest: false,
    datum: heuteISO(),
    objektId: d.objekt_id || null,
    mieterId: d.mieter_id || null,
    gegenueber: "",
    thema: String(d.titel || "").slice(0, 60),
    kiText: { titel: d.titel || "", text: [d.einleitung, ...(d.abschnitte || []).map((x) => `${x.titel}: ${x.text}`)].filter(Boolean).join("\n").slice(0, 6000) },
    beschreibung: "Die Liste aus dem Chat wird als PDF abgelegt.",
    datei: pdfDatei(a),
  };
}

// Neuer Kontakt / Handwerker aus dem Chat: nur bekannte Felder übernehmen
const kontaktFelder = (d) => ({
  vorname: d.vorname || null, nachname: d.nachname || null, firma: d.firma || null, rolle: d.rolle || null,
  telefon: d.telefon || null, email: d.email || null, adresse: d.adresse || null, notiz: d.notiz || null,
  geburtstag_tag: d.geburtstag_tag || null, geburtstag_monat: d.geburtstag_monat || null, geburtsjahr: d.geburtsjahr || null,
});
const handwerkerFelder = (d) => ({
  name: d.name, gewerk: d.gewerk || null, telefon: d.telefon || null, email: d.email || null,
  objekt_id: d.objekt_id || null, notiz: d.notiz || null, aktiv: true,
});
const gleich = (x, y) => !!x && !!y && String(x).trim().toLowerCase() === String(y).trim().toLowerCase();
/** Gibt es den schon? Dann den vorhandenen Eintrag liefern (Kontakt bzw. Handwerker) */
async function vorhandener(a) {
  const d = a.daten || {};
  if (a.art === "kontakt") {
    const liste = await kontakteListe(true);
    const name = kontaktName(d);
    return liste.find((k) => gleich(k.email, d.email) || (d.nachname && gleich(k.nachname, d.nachname) && (!d.vorname || gleich(k.vorname, d.vorname)))
      || (d.firma && gleich(k.firma, d.firma) && (!d.nachname || !k.nachname)) || (name && gleich(kontaktName(k), name))) || null;
  }
  const liste = await db.ladeDienstleister().catch(() => []);
  return liste.find((x) => gleich(x.name, d.name) || gleich(x.email, d.email)) || null;
}
// Felder, die beim Ergänzen eines vorhandenen Eintrags übernommen werden (nur neue, nicht leere Angaben)
const ERGAENZ_FELDER = { kontakt: ["vorname", "nachname", "firma", "rolle", "telefon", "email", "adresse"], handwerker: ["name", "gewerk", "telefon", "email"] };
function ergaenzung(a, x) {
  const d = a.daten || {};
  const felder = {}, vorher = {};
  for (const k of ERGAENZ_FELDER[a.art]) {
    const neu = String(d[k] ?? "").trim();
    if (!neu || gleich(neu, x[k])) continue;
    felder[k] = k === "email" ? neu.toLowerCase() : neu;
    vorher[k] = x[k] ?? null;
  }
  return { felder, vorher };
}
/**
 * Neuer Kontakt/Handwerker aus dem Chat, den es schon gibt: fragen, ob ergänzt oder neu angelegt werden soll.
 * Liefert "neu" (anlegen), "fertig" (vorhandener ergänzt oder nichts zu tun) oder null (abgebrochen).
 */
async function doppeltFragen(a) {
  const x = await vorhandener(a);
  if (!x) return "neu";
  const name = a.art === "kontakt" ? kontaktName(x) : x.name;
  const { felder, vorher } = ergaenzung(a, x);
  const zeilen = Object.entries(felder).map(([k, neu]) => `<li><span class="leise">${esc(FELD_NAME[k] || k)}:</span> ${vorher[k] ? `<s>${esc(vorher[k])}</s> → ` : ""}<strong>${esc(neu)}</strong></li>`);
  const daten = await dialogFormular(`
    <h2>„${esc(name)}“ gibt es schon</h2>
    ${zeilen.length
      ? `<p>Soll der vorhandene Eintrag ergänzt werden?</p><ul class="chatvorschlag__aenderung">${zeilen.join("")}</ul>`
      : `<p class="leise">Die Angaben stehen dort schon so. Es gibt nichts zu ergänzen.</p>`}
    <div class="knopfreihe">
      <button class="knopf knopf--links" value="neu">Trotzdem neu anlegen</button>
      <button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button>
      <button class="knopf knopf--primaer" value="ergaenzen">${zeilen.length ? "Vorhandenen ergänzen" : "Vorhandenen öffnen"}</button>
    </div>`, { breit: true });
  const wahl = daten?.get("_aktion");
  if (wahl === "neu") return "neu";
  if (wahl !== "ergaenzen") return null;
  // Karte wird zur „Stammdaten ändern“-Karte des vorhandenen Eintrags (mit Rückgängig)
  const ziel = a.art === "kontakt" ? "kontakt" : "handwerker";
  const link = ziel === "kontakt" ? `#/kontakt/${x.id}` : "#/handwerker";
  a.zielId = x.id;
  a.urArt = a.art;
  if (!zeilen.length) {
    a.href = link;
    setze(a, "gespeichert", "Schon vorhanden, nichts geändert");
    return "fertig";
  }
  a.art = "stammdaten";
  a.beschriftung = `${name} ergänzen`;
  a.daten = { ziel, id: x.id, felder, vorher, name, link, bewohner_neu: null };
  await stammdatenSpeichern(a, felder, null);
  setze(a, "gespeichert_rueck", "Vorhandenen Eintrag ergänzt");
  return "fertig";
}

// ---------------------------------------------------------------------------
// Stammdaten ändern (nur nach Klick): speichern, im Verlauf festhalten, „Rückgängig“ stellt die alten Werte wieder her
// ---------------------------------------------------------------------------
const STAMM_SPEICHERN = {
  mieter: (id, f) => db.speichereMieter(id, f),
  kontakt: (id, f) => db.speichereKontakt(id, f),
  handwerker: (id, f) => db.speichereDienstleister(id, f),
};
const verlaufZiel = (d) => (d.ziel === "mieter" ? { mieter_id: d.id } : d.ziel === "kontakt" ? { kontakt_id: d.id } : null);
function bewohnerNeu(alt, plus) {
  return [String(alt || "").trim(), String(plus || "").trim()].filter(Boolean).join("\n") || null;
}
async function stammdatenSpeichern(a, felder, bewohner) {
  const d = a.daten;
  const aenderung = { ...felder };
  if (bewohner) aenderung.weitere_bewohner = bewohnerNeu(d.bewohner_vorher, bewohner);
  if (!Object.keys(aenderung).length) throw new Error("Nichts zu ändern.");
  await STAMM_SPEICHERN[ZIEL_TABELLE[d.ziel]](d.id, aenderung);
  const text = [
    ...Object.entries(felder).map(([k, neu]) => `${FELD_NAME[k] || k}: ${d.vorher?.[k] || "(leer)"} → ${neu || "(leer)"}`),
    ...(bewohner ? [`Weitere Bewohner: + ${bewohner}`] : []),
  ].join("; ");
  const ziel = verlaufZiel(d);
  a.verlaufId = ziel ? (await db.speichereVerlauf(null, { ...ziel, art: "notiz", datum: heuteISO(), text: `Stammdaten geändert (Chat): ${text}` }).catch(() => null))?.id || null : null;
  a.gespeichert = { felder, bewohner };
  a.href = d.link || null;
  if (d.ziel === "mieter") await mieterListe().catch(() => null);
  if (d.ziel === "kontakt") await kontakteListe(true).catch(() => null);
}
async function stammdatenZurueck(a) {
  const d = a.daten;
  const alt = {};
  for (const k of Object.keys(a.gespeichert?.felder || {})) alt[k] = d.vorher?.[k] ?? null;
  if (a.gespeichert?.bewohner) alt.weitere_bewohner = d.bewohner_vorher ?? null;
  await STAMM_SPEICHERN[ZIEL_TABELLE[d.ziel]](d.id, alt);
  if (a.verlaufId) await db.loescheVerlauf(a.verlaufId).catch(() => null);
  if (d.ziel === "mieter") await mieterListe().catch(() => null);
  if (d.ziel === "kontakt") await kontakteListe(true).catch(() => null);
}
// „Ändern“: neue Werte vor dem Speichern anpassen
async function stammdatenDialog(a) {
  const d = a.daten;
  const felder = Object.keys(d.felder || {});
  const daten = await dialogFormular(`
    <h2>Stammdaten ändern</h2>
    <p class="leise">${esc(d.name || "")}</p>
    ${felder.map((k) => k === "anrede"
      ? `<label class="feld"><span>Anrede</span><select name="f_anrede">${["Herr", "Frau", "Divers", "Firma"].map((x) => `<option ${x === d.felder.anrede ? "selected" : ""}>${x}</option>`).join("")}</select></label>`
      : `<label class="feld"><span>${esc(FELD_NAME[k] || k)}${d.vorher?.[k] ? ` <span class="leise">(bisher: ${esc(d.vorher[k])})</span>` : ""}</span>
          <input name="f_${esc(k)}" value="${esc(d.felder[k] || "")}" ${k === "email" ? `type="email"` : k === "telefon" ? `type="tel"` : ""} maxlength="200"></label>`).join("")}
    ${d.bewohner_neu != null ? `<label class="feld"><span>Weitere Bewohner: hinzufügen</span><input name="bewohner" value="${esc(d.bewohner_neu || "")}" maxlength="200"></label>` : ""}
    <p class="oz-fehler" data-fehler role="alert" hidden></p>
    <div class="knopfreihe">
      <button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button>
      <button class="knopf knopf--primaer" value="ok">Speichern</button>
    </div>`, {
    vorbereiten: (form) => form.addEventListener("submit", (e) => {
      if (e.submitter?.value !== "ok") return;
      const mail = form.f_email?.value.trim();
      const fehler = mail && !istEmail(mail) ? "Bitte eine gültige E-Mail-Adresse eingeben."
        : (form.f_nachname && !form.f_nachname.value.trim()) || (form.f_name && !form.f_name.value.trim()) ? "Der Name darf nicht leer sein." : "";
      const p = $("[data-fehler]", form);
      p.textContent = fehler; p.hidden = !fehler;
      if (fehler) e.preventDefault();
    }),
  });
  if (!daten) return null;
  const neu = {};
  for (const k of felder) {
    const w = String(daten.get(`f_${k}`) ?? "").trim();
    const wert = k === "email" ? w.toLowerCase() || null : w || null;
    if (wert !== (d.vorher?.[k] ?? null)) neu[k] = wert;
  }
  return { felder: neu, bewohner: String(daten.get("bewohner") || "").trim() || null };
}

async function behandle(a, op, knopf) {
  const d = a.daten || {};
  const dlg = $("#chat");
  const neuLaden = () => geheZu(location.hash || "#/uebersicht");
  try {
    switch (op) {
      case "neuladen": return location.reload();
      case "standort": {
        // Maske vorausgefüllt; die Recherche startet erst mit Roberts Klick
        zustand.rechercheVorgabe = { ...d };
        dlg.close();
        a.href = "#/recherche";
        setze(a, "gespeichert", "Geöffnet");
        geheZu("#/recherche");
        return;
      }
      case "auftrag": {
        // Maske „Handwerker beauftragen“ vorausgefüllt; gesendet wird erst nach Prüfen des Entwurfs
        dlg.close();
        const { anfrageDialog } = await import("./handwerker.js");
        const neu = await anfrageDialog({
          art: d.art === "angebot" ? "angebot" : "auftrag", objektId: d.objekt_id || null, mieterId: d.mieter_id || null,
          dienstleisterIds: d.dienstleister_ids || [], titel: d.titel || "", beschreibung: d.beschreibung || "", frist: d.frist || null,
        });
        if (neu?.id) { a.href = `#/auftrag/${neu.id}`; setze(a, "gespeichert", "Auftrag angelegt"); }
        return;
      }
      case "ablehnen": return setze(a, "abgelehnt");
      case "zurueck": return setze(a, undefined);
      case "rueck":
        knopf.disabled = true;
        await stammdatenZurueck(a);
        setze(a, "rueckgaengig");
        neuLaden();
        return;
      case "annehmen":
        knopf.disabled = true;
        if (a.art === "stammdaten") {
          await stammdatenSpeichern(a, d.felder || {}, d.bewohner_neu || null);
          setze(a, "gespeichert_rueck", "Gespeichert");
          neuLaden();
          return;
        }
        if (a.art === "notiz") {
          await db.speichereAufgabe(null, {
            titel: d.titel, notiz: d.notiz || null, faellig_am: d.faellig_am || null,
            mieter_id: d.mieter_id || null, objekt_id: d.objekt_id || null, kontakt_id: d.kontakt_id || null,
          });
          setze(a, "gespeichert", d.faellig_am ? `Gespeichert, Wiedervorlage ${tag(d.faellig_am)}` : "Gespeichert in den To-dos");
        } else if (a.art === "wissen") {
          await db.speichereWissen(null, { titel: d.titel, inhalt: d.inhalt, ordner: d.ordner || "Sonstiges", objekt_id: d.objekt_id || null, aktiv: true });
          setze(a, "gespeichert", "Im Wissen gespeichert");
        } else if (a.art === "kontakt") {
          const weiter = await doppeltFragen(a);
          if (weiter !== "neu") { knopf.disabled = false; if (weiter) neuLaden(); return; }
          const k = await db.speichereKontakt(null, kontaktFelder(d));
          await kontakteListe(true);
          a.zielId = k.id;
          a.href = `#/kontakt/${k.id}`;
          setze(a, "gespeichert", "Kontakt angelegt");
        } else if (a.art === "handwerker") {
          const weiter = await doppeltFragen(a);
          if (weiter !== "neu") { knopf.disabled = false; if (weiter) neuLaden(); return; }
          const h = await db.speichereDienstleister(null, handwerkerFelder(d));
          a.zielId = h?.id || null;
          a.href = "#/handwerker";
          setze(a, "gespeichert", "Handwerker angelegt");
        }
        neuLaden();
        return;
      case "aendern": {
        const fertig = (text) => () => { setze(a, "gespeichert", text); neuLaden(); };
        if (a.art === "stammdaten") {
          const neu = await stammdatenDialog(a);
          if (!neu) return;
          await stammdatenSpeichern(a, neu.felder, neu.bewohner);
          setze(a, "gespeichert_rueck", "Geändert gespeichert");
          neuLaden();
          return;
        }
        if (a.art === "notiz") {
          return aufgabeDialog({ titel: d.titel, notiz: d.notiz, faellig_am: d.faellig_am, mieter_id: d.mieter_id, objekt_id: d.objekt_id, kontakt_id: d.kontakt_id },
            { nachher: fertig("Geändert gespeichert") });
        }
        if (a.art === "kontakt") {
          return kontaktDialog(kontaktFelder(d), { nachher: (k) => { a.zielId = k?.id || null; a.href = k?.id ? `#/kontakt/${k.id}` : null; setze(a, "gespeichert", "Kontakt angelegt"); neuLaden(); } });
        }
        if (a.art === "handwerker") {
          return ablage.bearbeiteDienstleister({ ...handwerkerFelder(d), id: null }, { nachher: (h) => { a.zielId = h?.id || null; a.href = "#/handwerker"; setze(a, "gespeichert", "Handwerker angelegt"); neuLaden(); } });
        }
        if (a.art === "wissen") {
          return ablage.bearbeiteWissen({ titel: d.titel, inhalt: d.inhalt, ordner: d.ordner, objekt_id: d.objekt_id, aktiv: true },
            { nachher: fertig("Geändert gespeichert"), hinweis: "Vorschlag aus dem Chat. Bitte prüfen und speichern." });
        }
        return;
      }
      case "oeffnen":
        if (a.art === "entwurf") {
          const z = { ...d };
          // Empfänger, der erst in dieser Antwort angelegt (oder ergänzt) wurde
          if (d.empfaenger_neu) {
            const neu = neuerEmpfaenger(a);
            if (!neu?.zielId) return melde(`Bitte erst ${d.empfaenger_neu === "handwerker" ? "den Handwerker" : "den Kontakt"} anlegen.`, "info");
            if (d.empfaenger_neu === "handwerker") z.dienstleister_id = neu.zielId; else z.kontakt_id = neu.zielId;
          }
          // Dateien aus der Ablage als Anhang vorbelegen (im Schreiben sichtbar und entfernbar)
          if (d.anhaenge?.length) {
            knopf.disabled = true;
            const docs = await db.ladeDokumenteIds(d.anhaenge.map((x) => x.id));
            zustand.anhangVorgabe = docs.filter((x) => x.pfad).map(ablage.anhangVonDokument);
          }
          zustand.vorbelegung = { nachricht_id: z.nachricht_id || null, anweisung: z.anweisung || "" };
          dlg.close();
          melde(`Anweisung${zustand.anhangVorgabe?.length ? " und Anhang" : ""} eingetragen. Mit „Entwurf mit KI“ den Entwurf erstellen.`, "info");
          if (z.objekt_id) zustand.hausVorgabe = z.objekt_id;
          return geheZu(z.nachricht_id ? `#/postfach/${z.nachricht_id}`
            : z.dienstleister_id ? `#/schreiben/d-${z.dienstleister_id}`
            : z.kontakt_id ? `#/schreiben/k-${z.kontakt_id}`
            : z.kostentraeger_id ? `#/schreiben/t-${z.kostentraeger_id}${z.mieter_id ? "." + z.mieter_id : ""}`
            : z.mieter_id ? `#/schreiben/${z.mieter_id}` : "#/schreiben");
        }
        dlg.close();
        return geheZu(ZIELE[d.ziel] ? ZIELE[d.ziel] + d.id : d.ziel === "wissen" ? "#/wissen" : "#/postfach");
      case "ansehen": {
        const { blob } = await pdfDatei(a)();
        const url = URL.createObjectURL(blob);
        const fenster = window.open(url, "_blank");
        if (!fenster) herunterladen(await blob.arrayBuffer(), `${sauber(pdfName(a))}.pdf`, "application/pdf");
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        return;
      }
      case "laden": {
        const { blob } = await pdfDatei(a)();
        herunterladen(await blob.arrayBuffer(), `${sauber(pdfName(a))}.pdf`, "application/pdf");
        return;
      }
      case "mail": return await pdfPerMail(a, knopf);
      case "ablage": {
        // Der Ablage-Dialog zeigt den Namen nach eurem Schema (änderbar), Ordner schlägt die KI vor
        const e = pdfAblageEintrag(a);
        await ablage.inAblageDialog(e, { nachher: () => { setze(a, "gespeichert", "In der Ablage gespeichert"); } });
        return;
      }
    }
  } catch (err) {
    if (knopf) knopf.disabled = false;
    melde(err.message, "fehler");
  }
}

// ---------------------------------------------------------------------------
// PDF aus dem Chat per E-Mail: Empfänger suchen (Adresse wird übernommen), Text prüfen, Senden per Klick
// ---------------------------------------------------------------------------
async function empfaengerListe() {
  const [mieterL, dienstL, kontaktL] = await Promise.all([
    mieterListe().catch(() => []), db.ladeDienstleister().catch(() => []), kontakteListe(true).catch(() => []),
  ]);
  const p = zustand.profil || {};
  const eigene = [...new Set([p.email, p.antwort_email].filter(istEmail))];
  return [
    ...eigene.map((m) => ({ wert: `ich:${m}`, name: "An mich selbst", zusatz: m, gruppe: "Eigene Adresse", email: m, ziel: {} })),
    ...mieterL.map((m) => ({ wert: m.id, name: mieterName(m), zusatz: ortVon(m), gruppe: "Mietparteien", email: m.email, ziel: { mieter_id: m.id } })),
    ...dienstL.filter((d) => d.aktiv !== false).map((d) => ({ wert: `d-${d.id}`, name: d.name, zusatz: d.gewerk || "", gruppe: "Handwerker", email: d.email, ziel: { dienstleister_id: d.id } })),
    ...kontaktL.map((x) => ({
      wert: `k-${x.id}`, name: kontaktName(x), zusatz: [x.vorname || x.nachname ? x.firma : "", x.rolle].filter(Boolean).join(" · "),
      gruppe: "Sonstige", email: x.email, ziel: { kontakt_id: x.id },
    })),
    ...(zustand.stamm?.kostentraeger || []).map((x) => ({ wert: `t-${x.id}`, name: x.name, zusatz: x.abteilung || "", gruppe: "Kostenträger", email: x.email, ziel: { kostentraeger_id: x.id } })),
  ];
}

async function pdfPerMail(a, knopf) {
  const d = a.daten || {};
  if (knopf) knopf.disabled = true;
  let eintraege;
  try { eintraege = await empfaengerListe(); } finally { if (knopf) knopf.disabled = false; }
  let gewaehlt = null;
  const titel = d.titel || "Übersicht";
  const auto = zustand.profil?.auto_ablage !== false;
  const daten = await dialogFormular(`
    <h2>PDF per E-Mail senden</h2>
    ${suchauswahlHtml({ label: "An wen?", placeholder: "Name, Firma oder Amt suchen …", inline: true })}
    <label class="feld"><span>E-Mail-Adresse</span><input name="an" type="email" required maxlength="200" autocomplete="off" spellcheck="false" placeholder="wird bei der Auswahl übernommen"></label>
    <p class="feldhinweis" data-mail-hinweis hidden></p>
    <label class="feld"><span>Betreff</span><input name="betreff" required maxlength="200" value="${esc(titel)}"></label>
    <label class="feld"><span>Text</span><textarea name="text" rows="5" maxlength="4000">Guten Tag,

anbei erhalten Sie „${esc(titel)}“ als PDF.</textarea></label>
    <label class="feld"><span>Anhang (Dateiname)</span>
      <span class="namefeld"><input name="dateiname" required maxlength="160" spellcheck="false" autocomplete="off" value="${esc(pdfName(a))}"><span class="namefeld__endung">.pdf</span></span></label>
    <label class="checkfeld checkfeld--klein"><input type="checkbox" name="ablegen" ${auto ? "checked" : ""}> Zusätzlich in der Ablage speichern (unter diesem Namen)</label>
    <p class="leise">Gruß, Signatur und Briefkopf werden angefügt. Bitte prüfen, ob der Empfänger alle Angaben in der PDF sehen darf
      (z. B. Daten anderer Mietparteien).</p>
    <div class="knopfreihe">
      <button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button>
      <button class="knopf knopf--primaer" value="senden">${zustand.ki?.versand ? "Jetzt senden" : "Weiter"}</button>
    </div>`, {
    breit: true,
    vorbereiten: (form) => {
      const hinweis = $("[data-mail-hinweis]", form);
      verbindeSuchauswahl($(".suchauswahl", form), eintraege, (e) => {
        gewaehlt = e;
        form.an.value = istEmail(e.email) ? e.email : "";
        hinweis.hidden = istEmail(e.email);
        hinweis.textContent = istEmail(e.email) ? "" : `Für ${e.name} ist keine E-Mail-Adresse hinterlegt. Bitte eintragen.`;
        (istEmail(e.email) ? form.betreff : form.an).focus();
      });
      // Eine von Hand geänderte Adresse gehört nicht mehr sicher zur Auswahl
      form.an.addEventListener("input", () => { if (gewaehlt && form.an.value.trim().toLowerCase() !== String(gewaehlt.email || "").toLowerCase()) gewaehlt = { ...gewaehlt, ziel: {}, name: null }; });
    },
  });
  if (!daten) return;
  const an = String(daten.get("an") || "").trim();
  if (!istEmail(an)) return melde("Bitte eine gültige E-Mail-Adresse eintragen.", "fehler");
  const betreff = String(daten.get("betreff") || titel).trim();
  const text = String(daten.get("text") || "").trim();
  a.dateiname = String(daten.get("dateiname") || "").trim() || pdfName(a);
  const dateiname = `${sauber(a.dateiname)}.pdf`;
  const ablegen = daten.get("ablegen") === "on";
  const ziel = gewaehlt?.ziel || {};
  const name = gewaehlt?.name && gewaehlt.gruppe !== "Eigene Adresse" ? gewaehlt.name : null;

  const { blob } = await pdfDatei(a)();
  if (!zustand.ki?.versand) {
    // Ohne Versand aus der App: PDF speichern, E-Mail-Programm öffnen, Anhang dort selbst anfügen
    const ok = await frage("Im E-Mail-Programm öffnen", `<p>Der direkte Versand aus der App ist noch nicht eingerichtet.
      Die PDF wird heruntergeladen und Ihr E-Mail-Programm öffnet sich. <strong>Bitte die PDF dort selbst anhängen.</strong></p>`, "Weiter");
    if (!ok) return;
    herunterladen(await blob.arrayBuffer(), dateiname, "application/pdf");
    const voll = `${text}\n\nMit freundlichen Grüßen\n${zustand.profil?.email_signatur || [zustand.profil?.inhaber, zustand.profil?.firma].filter(Boolean).join("\n")}`;
    window.location.href = `mailto:${encodeURIComponent(an)}?subject=${encodeURIComponent(betreff)}&body=${encodeURIComponent(voll)}`;
    if (ablegen) await ablage.automatischAblegen({ ...pdfAblageEintrag(a), gegenueber: name || "" }, { vorgabe: { titel: a.dateiname }, immer: true });
    return setze(a, "gespeichert", `Im E-Mail-Programm an ${an} geöffnet`);
  }
  if (blob.size > 6_000_000) return melde("Die PDF ist zu groß für den Versand (max. 6 MB).", "fehler");
  melde("Wird gesendet …", "info");
  // Als Antwort speichern, damit es im Verlauf (Akte, Kontakt, Vorgang) steht
  const themaId = await vorgaenge.neuesThema({
    betreff, an, mieterId: ziel.mieter_id, kontaktId: ziel.kontakt_id, dienstleisterId: ziel.dienstleister_id,
    kostentraegerId: ziel.kostentraeger_id, objektId: d.objekt_id || null,
  }).catch(() => null);
  const antwort = await db.speichereAntwort(null, {
    thema_id: themaId, mieter_id: ziel.mieter_id || null, dienstleister_id: ziel.dienstleister_id || null,
    kontakt_id: ziel.kontakt_id || null, kostentraeger_id: ziel.kostentraeger_id || null,
    empfaenger_email: an, empfaenger_name: name, betreff, text, anweisung: "PDF aus dem Chat",
  });
  try {
    await db.funktion("versand", { antwort_id: antwort.id, an, anhang: { dateiname, daten: await alsBase64(blob) } });
  } catch (err) {
    melde(`${err.message} Der Text liegt als Entwurf unter „Neues Schreiben“.`, "fehler");
    return;
  }
  if (ziel.kontakt_id) {
    await db.speichereVerlauf(null, { kontakt_id: ziel.kontakt_id, art: "email", datum: heuteISO(), text: `E-Mail mit PDF gesendet: ${betreff}` }).catch(() => null);
  }
  melde(`E-Mail mit „${dateiname}“ an ${an} gesendet.`, "ok");
  setze(a, "gespeichert", `Per E-Mail an ${name || an} gesendet`);
  if (ablegen) await ablage.automatischAblegen({ ...pdfAblageEintrag(a), gegenueber: name || "" }, { vorgabe: { titel: a.dateiname }, immer: true });
}

export function oeffneChat(frage = "") {
  if (!eingerichtet) einrichten();
  const dlg = $("#chat");
  zeichne();
  if (!dlg.open) dlg.showModal();
  if (!zustand.ki?.ki) {
    $("#chat-verlauf").insertAdjacentHTML("afterbegin", `<div class="chat__fehler">Die KI ist noch nicht eingerichtet. Ohne sie kann der Chat nicht antworten.</div>`);
  }
  const form = $("#chat-form");
  form.frage.focus();
  // Aus der Suchleiste oben: Frage gleich stellen
  if (String(frage).trim() && !laeuft) {
    form.frage.value = String(frage).trim();
    form.requestSubmit();
  }
}

