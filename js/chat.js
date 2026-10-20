// Chat: Fragen an die App („Wer ist im Rückstand?“, „Wer macht die Heizung in der Lindenstraße?“)
// Die KI liest mit Roberts Login. Sie ändert nichts selbst: Aktionen kommen als Vorschlag und laufen erst per Klick.
import * as db from "./daten.js";
import { $, esc, melde, zustand } from "./helfer.js";
import { ICON_KI, mikroKnopf, verbindeDiktat, stoppeDiktat, geheZu } from "./ui.js";
import { aufgabeDialog } from "./start.js";
import { bearbeiteWissen } from "./ablage.js";

const VORSCHLAEGE = [
  "Was ist heute wichtig?",
  "Wer ist im Rückstand?",
  "Welche Fristen stehen an?",
  "Wer macht die Heizung in der Lindenstraße?",
];
const verlauf = []; // { rolle: "robert" | "ki" | "fehler", text, aktionen? }
let laeuft = false;
let eingerichtet = false;

const ZIELE = { mieter: "#/mieter/", kontakt: "#/kontakt/", objekt: "#/objekt/", nachricht: "#/postfach/" };

// Sichere Darstellung: erst alles maskieren, dann nur fett, Listen und App-interne Links erlauben
function formatiere(text) {
  const zeile = (z) => esc(z)
    .replace(/\[([^\]\n]{1,120})\]\((#\/(?:mieter|objekt|postfach|wissen|uebersicht)(?:\/[A-Za-z0-9-]{1,60})?)\)/g,
      (_, t, href) => `<a href="${href}" data-chat-link>${t}</a>`)
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
    <form class="chat__eingabe" id="chat-form">
      <span class="diktat"><textarea name="frage" rows="1" maxlength="2000" placeholder="Frage stellen oder diktieren …" aria-label="Frage"></textarea>${mikroKnopf()}</span>
      <button class="knopf knopf--primaer" type="submit">Senden</button>
    </form>
    <p class="chat__hinweis">Die KI liest nur und ändert nichts. Vorschläge führen Sie selbst per Klick aus. Bankdaten sieht sie nicht.</p>`;
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
    if (e.target.closest("[data-chat-link]") && window.matchMedia("(max-width: 900px)").matches) dlg.close();
    const akt = e.target.closest("[data-vorschlag]");
    if (akt) {
      const [i, j] = akt.dataset.vorschlag.split(":").map(Number);
      fuehreAus(verlauf[i]?.aktionen?.[j]);
    }
  });
  dlg.addEventListener("close", stoppeDiktat);
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
          ${b.aktionen?.length ? `<div class="chat__aktionen"><span class="leise">Vorschlag:</span>
            ${b.aktionen.map((a, j) => `<button type="button" class="knopf knopf--klein" data-vorschlag="${i}:${j}">${esc(a.beschriftung)}</button>`).join("")}</div>` : ""}
        </div>`;
      }).join("") + (laeuft ? `<div class="chat__antwort chat__denkt"><span class="kreisel" aria-hidden="true"></span> sucht in der App …</div>` : "")
    : `<div class="chat__leer">
        <p>Fragen Sie nach Mietern, Häusern, Nachrichten, Fristen oder Wissen. Die Antworten kommen aus der App.</p>
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
      verlauf: verlauf.filter((b) => b.rolle !== "fehler").slice(-12).map(({ rolle, text: t }) => ({ rolle, text: t })),
    });
    verlauf.push({ rolle: "ki", text: r.text || "Dazu habe ich keine Antwort gefunden.", aktionen: Array.isArray(r.aktionen) ? r.aktionen : [] });
  } catch (err) {
    verlauf.push({ rolle: "fehler", text: "Das hat nicht geklappt: " + err.message });
  } finally {
    laeuft = false;
    zeichne();
  }
}

// Vorschläge der KI: immer mit einem eigenen Schritt, in dem Robert prüft und bestätigt
async function fuehreAus(a) {
  if (!a) return;
  const d = a.daten || {};
  const dlg = $("#chat");
  const neuLaden = () => geheZu(location.hash || "#/uebersicht");
  switch (a.art) {
    case "notiz":
      return aufgabeDialog({ titel: d.titel, notiz: d.notiz, faellig_am: d.faellig_am, mieter_id: d.mieter_id, objekt_id: d.objekt_id, kontakt_id: d.kontakt_id }, { nachher: neuLaden });
    case "wissen":
      return bearbeiteWissen({ titel: d.titel, inhalt: d.inhalt, ordner: d.ordner, objekt_id: d.objekt_id, aktiv: true },
        { nachher: neuLaden, hinweis: "Vorschlag aus dem Chat. Bitte prüfen und speichern." });
    case "entwurf":
      zustand.vorbelegung = { nachricht_id: d.nachricht_id || null, anweisung: d.anweisung || "" };
      dlg.close();
      melde("Anweisung eingetragen. Mit „Entwurf mit KI“ den Entwurf erstellen.", "info");
      return geheZu(d.nachricht_id ? `#/postfach/${d.nachricht_id}` : `#/schreiben/${d.mieter_id}`);
    case "oeffnen":
      dlg.close();
      return geheZu(ZIELE[d.ziel] ? ZIELE[d.ziel] + d.id : d.ziel === "wissen" ? "#/wissen" : "#/postfach");
  }
}

export function oeffneChat() {
  if (!eingerichtet) einrichten();
  const dlg = $("#chat");
  zeichne();
  if (!dlg.open) dlg.showModal();
  if (!zustand.ki?.ki) {
    $("#chat-verlauf").insertAdjacentHTML("afterbegin", `<div class="chat__fehler">Die KI ist noch nicht eingerichtet. Ohne sie kann der Chat nicht antworten.</div>`);
  }
  $("#chat-form").frage.focus();
}

