// Chat: Fragen an die App („Wer ist im Rückstand?“, „Wer macht die Heizung in der Lindenstraße?“)
// Die KI liest mit Roberts Login. Sie ändert nichts selbst: Aktionen kommen als Vorschlag und laufen erst per Klick.
import * as db from "./daten.js";
import { datumDE } from "./dokumente.js";
import { $, esc, melde, zustand, heuteISO, herunterladen, objektVon } from "./helfer.js";
import { ICON_KI, mikroKnopf, verbindeDiktat, stoppeDiktat, geheZu } from "./ui.js";
import { aufgabeDialog } from "./start.js";
import * as ablage from "./ablage.js";

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
    .replace(/\[([^\]\n]{1,120})\]\((#\/(?:mieter|kontakt|kontakte|objekt|objekte|ablage|postfach|wissen|uebersicht|handwerker)(?:\/[A-Za-z0-9-]{1,60})?)\)/g,
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
          ${b.aktionen?.length ? `<div class="chat__aktionen">${b.aktionen.map((a, j) => vorschlagHtml(a, i, j)).join("")}</div>` : ""}
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

// ---------------------------------------------------------------------------
// Vorschläge der KI als kleine Karten: Annehmen (speichert direkt), Ändern (vorbelegter Dialog), Ablehnen.
// Nichts passiert ohne Klick. a.status: "gespeichert" | "abgelehnt" | undefined
// ---------------------------------------------------------------------------
const ART_NAME = { notiz: "To-do", wissen: "Wissen", entwurf: "Schreiben", oeffnen: "Öffnen", pdf: "PDF" };
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
    : "";
  let knoepfe = "";
  if (a.status === "gespeichert") {
    knoepfe = `<span class="chatvorschlag__status chatvorschlag__status--ok">${a.statusText || "Gespeichert"}</span>`;
  } else if (a.status === "abgelehnt") {
    knoepfe = `<span class="chatvorschlag__status">Abgelehnt</span>${k("zurueck", "Doch anzeigen", "knopf--leise")}`;
  } else if (a.art === "notiz" || a.art === "wissen") {
    knoepfe = k("annehmen", "Annehmen", "knopf--primaer") + k("aendern", "Ändern") + k("ablehnen", "Ablehnen", "knopf--leise");
  } else if (a.art === "entwurf") {
    knoepfe = k("oeffnen", "Schreiben öffnen", "knopf--primaer") + k("ablehnen", "Ablehnen", "knopf--leise");
  } else if (a.art === "pdf") {
    knoepfe = k("ansehen", "Ansehen") + k("laden", "Herunterladen") + k("ablage", "In Ablage", "knopf--primaer") + k("ablehnen", "Ablehnen", "knopf--leise");
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
      ${detail && detail !== a.beschriftung ? `<span class="leise">${esc(detail)}</span>` : ""}</div>
    ${nameFeld}
    <div class="chatvorschlag__knoepfe">${knoepfe}</div>
  </div>`;
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

async function behandle(a, op, knopf) {
  const d = a.daten || {};
  const dlg = $("#chat");
  const neuLaden = () => geheZu(location.hash || "#/uebersicht");
  try {
    switch (op) {
      case "neuladen": return location.reload();
      case "ablehnen": return setze(a, "abgelehnt");
      case "zurueck": return setze(a, undefined);
      case "annehmen":
        knopf.disabled = true;
        if (a.art === "notiz") {
          await db.speichereAufgabe(null, {
            titel: d.titel, notiz: d.notiz || null, faellig_am: d.faellig_am || null,
            mieter_id: d.mieter_id || null, objekt_id: d.objekt_id || null, kontakt_id: d.kontakt_id || null,
          });
          setze(a, "gespeichert", d.faellig_am ? `Gespeichert, Wiedervorlage ${tag(d.faellig_am)}` : "Gespeichert in den To-dos");
        } else if (a.art === "wissen") {
          await db.speichereWissen(null, { titel: d.titel, inhalt: d.inhalt, ordner: d.ordner || "Sonstiges", objekt_id: d.objekt_id || null, aktiv: true });
          setze(a, "gespeichert", "Im Wissen gespeichert");
        }
        neuLaden();
        return;
      case "aendern": {
        const fertig = (text) => () => { setze(a, "gespeichert", text); neuLaden(); };
        if (a.art === "notiz") {
          return aufgabeDialog({ titel: d.titel, notiz: d.notiz, faellig_am: d.faellig_am, mieter_id: d.mieter_id, objekt_id: d.objekt_id, kontakt_id: d.kontakt_id },
            { nachher: fertig("Geändert gespeichert") });
        }
        if (a.art === "wissen") {
          return ablage.bearbeiteWissen({ titel: d.titel, inhalt: d.inhalt, ordner: d.ordner, objekt_id: d.objekt_id, aktiv: true },
            { nachher: fertig("Geändert gespeichert"), hinweis: "Vorschlag aus dem Chat. Bitte prüfen und speichern." });
        }
        return;
      }
      case "oeffnen":
        if (a.art === "entwurf") {
          zustand.vorbelegung = { nachricht_id: d.nachricht_id || null, anweisung: d.anweisung || "" };
          dlg.close();
          melde("Anweisung eingetragen. Mit „Entwurf mit KI“ den Entwurf erstellen.", "info");
          return geheZu(d.nachricht_id ? `#/postfach/${d.nachricht_id}` : d.kontakt_id ? `#/schreiben/k-${d.kontakt_id}` : d.mieter_id ? `#/schreiben/${d.mieter_id}` : "#/schreiben");
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

