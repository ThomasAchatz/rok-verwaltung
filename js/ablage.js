// Ablage: Fotos/PDFs erfassen (ins Postfach oder als Dokument), Dokumente je Haus, Wissen, Handwerker
// Die KI liest und schlägt Ablage, Namen und Ordner vor. Abgelegt wird erst nach „Ablegen“.
import * as db from "./daten.js";
import { datumDE, mieterName } from "./dokumente.js";
import { $, $$, esc, melde, dialogFormular, frage, heuteISO, dateiTeil, herunterladen, zustand, objektVon, wohnungVon } from "./helfer.js";
import {
  ICON_KI, istEmail, norm, geheZu, mieterListe, mieterOptionen, betrifftOptionen, betrifftAus, mikroKnopf, verbindeDiktat, wartehinweis, verkleinere, alsBase64,
  suchauswahlHtml, verbindeSuchauswahl,
} from "./ui.js";
import { textPdf } from "./pdf.js";
import { officeText } from "./officetext.js";
import { istZip, zipImport } from "./zipimport.js";

export const DOKUMENT_ORDNER = [
  "Rechnungen", "Verträge", "Versorger", "Versicherungen", "Behörden & Steuern", "Handwerker & Angebote", "Mietverhältnisse", "Sonstiges",
];
export const DOKUMENT_ARTEN = ["Rechnung", "Vertrag", "Mietvertrag", "Kündigung", "Bescheid", "Abrechnung", "Angebot", "Mahnung", "Brief", "E-Mail", "Auftrag", "Protokoll", "Notiz", "Schriftverkehr", "Sonstiges"];
export const DOCX_TYP = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const XLSX_TYP = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const ENDUNG = { "application/pdf": "pdf", "image/png": "png", "image/webp": "webp", "image/jpeg": "jpg", [DOCX_TYP]: "docx", [XLSX_TYP]: "xlsx" };
const anzeigbar = (typ) => typ === "application/pdf" || /^image\//.test(typ || "");
/** Kennzeichen für die Liste: [Text, CSS-Klasse] */
export const symbolVon = (typ) =>
  typ === "application/pdf" ? ["PDF", ""] : typ === DOCX_TYP ? ["Word", "dok__icon--word"] : typ === XLSX_TYP ? ["Excel", "dok__icon--excel"] : ["Foto", "dok__icon--bild"];
export const WISSEN_ORDNER = [
  "Abläufe & Hausordnung", "Heizung", "Wasser & Sanitär", "Strom", "Schlüssel & Schließanlage", "Zähler", "Dach & Fassade",
  "Dienstleister & Verträge", "Sonstiges",
];
const GEWERKE = ["Heizung & Sanitär", "Elektro", "Hausmeister", "Schlüssel & Schließanlage", "Maler", "Dach", "Reinigung", "Garten", "Schädlingsbekämpfung"];
const MAX_DATEI = 15 * 1024 * 1024;
const MAX_PDF_KI = 8 * 1024 * 1024;

const optionen = (liste, gewaehlt) => liste.map((x) => `<option ${x === gewaehlt ? "selected" : ""}>${esc(x)}</option>`).join("");
// Unterordner werden mit „/“ gespeichert und mit „›“ angezeigt
export const ordnerAnzeige = (n) => String(n || "").split("/").map((t) => t.trim()).join(" › ");
const ordnerOptionen = (liste, gewaehlt) => {
  const alle = gewaehlt && !liste.includes(gewaehlt) ? [...liste, gewaehlt] : liste;
  return alle.map((x) => `<option value="${esc(x)}" ${x === gewaehlt ? "selected" : ""}>${esc(ordnerAnzeige(x))}</option>`).join("");
};

/**
 * Aktuelle Ordnerliste der Ablage (aus der Datenbank, „Sonstiges“ immer dabei).
 * Zwei Bereiche: „haus“ = in jedem Haus gleich (Standard), „allgemein“ = frei angelegte Ordner unter Allgemein.
 */
export async function ordnerListe(neu = false, bereich = "haus") {
  if (!zustand.dokOrdner || neu) {
    try {
      const alle = await db.ladeDokumentOrdner();
      const vonBereich = (b) => alle.filter((o) => (o.bereich || "haus") === b);
      zustand.dokOrdnerZeilen = vonBereich("haus");
      zustand.dokOrdnerZeilenAllgemein = vonBereich("allgemein");
      zustand.dokOrdnerAuto = new Map(zustand.dokOrdnerZeilen.filter((o) => o.automatik).map((o) => [o.name, o.automatik]));
      const namen = zustand.dokOrdnerZeilen.map((o) => o.name);
      zustand.dokOrdner = namen.length ? (namen.includes("Sonstiges") ? namen : [...namen, "Sonstiges"]) : DOKUMENT_ORDNER;
      zustand.dokOrdnerAllgemein = [...zustand.dokOrdnerZeilenAllgemein.map((o) => o.name).filter((n) => n !== "Sonstiges"), "Sonstiges"];
    } catch {
      zustand.dokOrdner = DOKUMENT_ORDNER;
      zustand.dokOrdnerAllgemein = ["Sonstiges"];
    }
  }
  return bereich === "allgemein" ? zustand.dokOrdnerAllgemein : zustand.dokOrdner;
}
/** Ordnerliste passend zum Haus (null/leer = Allgemein); ordnerListe() muss vorher geladen sein */
export const ordnerFuer = (objektId) => (objektId ? zustand.dokOrdner : zustand.dokOrdnerAllgemein) || ["Sonstiges"];
/** Ordner, der zum Haus passt: sonst „Sonstiges“ (z. B. Hausordner der KI für eine Datei unter Allgemein) */
export const passenderOrdner = (name, objektId) => {
  const liste = ordnerFuer(objektId);
  if (!name) return "Sonstiges";
  if (liste.includes(name)) return name;
  // Unterordner eines vorhandenen Ordners (z. B. „03_Vermietung/EG rechts - Wolf“) dürfen bleiben
  return liste.some((n) => n !== "Sonstiges" && name.startsWith(n + "/")) ? name : "Sonstiges";
};
// Auswahl „Ordner“ im Dialog folgt dem gewählten Haus (Allgemein hat eigene Ordner)
function verbindeOrdnerWahl(form) {
  const haus = $("[name=objekt_id]", form), wahl = $("select[name=ordner]", form);
  if (!haus || !wahl) return;
  // Wunsch (KI-Vorschlag oder eigene Wahl) merken, damit er beim Hin- und Herwechseln des Hauses wiederkommt
  let wunsch = wahl.dataset.wunsch || wahl.value;
  wahl.addEventListener("change", (e) => { if (e.isTrusted) wunsch = wahl.value; });
  const fuellen = () => {
    const objektId = haus.value || null;
    const neu = passenderOrdner(wunsch, objektId) !== "Sonstiges" || wunsch === "Sonstiges" ? passenderOrdner(wunsch, objektId) : passenderOrdner(wahl.value, objektId);
    wahl.innerHTML = ordnerOptionen(ordnerFuer(objektId), neu);
    wahl.dispatchEvent(new Event("change", { bubbles: true }));
  };
  haus.addEventListener("change", fuellen);
}
const endungVon = (d) => ENDUNG[d.typ] || "jpg";
// Dateiname zum Speichern: Name aus der Ablage, nur Zeichen, die überall erlaubt sind
const sichererDateiname = (s) => String(s || "Dokument").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 150) || "Dokument";
const hausOptionen = (gewaehlt, leer = "Allgemein (kein bestimmtes Haus)") =>
  `<option value="">${esc(leer)}</option>` +
  zustand.stamm.objekte.map((o) => `<option value="${esc(o.id)}" ${o.id === gewaehlt ? "selected" : ""}>${esc(o.bezeichnung)}</option>`).join("");

/** Kurzname eines Hauses für Dateinamen: „Lindenstraße 14“ → „Lindenstr14“ */
export function objektKurz(o) {
  if (!o) return "Allgemein";
  return dateiTeil(String(o.strasse || o.bezeichnung || "").replace(/stra(ß|ss)e/gi, "str")).replace(/-/g, "");
}
// Dateiname nach Roberts Schema: Datum_Kürzel Ort_Straße Hausnummer_Dokumentart_Details
// z. B. „261019_SR_Königsberger Str. 19_Rechnung_Sanitär Gruber_102,89“
const datumKurz = (iso) => (/^\d{4}-\d{2}-\d{2}/.test(iso || "") ? iso.slice(2, 4) + iso.slice(5, 7) + iso.slice(8, 10) : "");
export const strasseKurz = (s) => String(s || "").replace(/([Ss])tra(ß|ss)e\b\.?/g, "$1tr.").replace(/tr\.(?=\d)/g, "tr. ");
const namensTeil = (s) => String(s || "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim();
export function dokumentTitel({ datum, objekt, art, details }) {
  const haus = objekt ? [objekt.kuerzel, strasseKurz(objekt.strasse || objekt.bezeichnung)] : ["Allgemein"];
  return [datumKurz(datum), ...haus, art, details].map(namensTeil).filter(Boolean).join("_").slice(0, 160);
}

// Mietpartei für Details und Wohnungsordner
const mieterVon = (id) => (id ? (zustand.mieterKurz || []).find((m) => m.id === id) || null : null);
// Bei diesen Arten gehört der Name der Mietpartei nicht in den Dateinamen (z. B. Handwerkerrechnung)
const OHNE_MIETERNAME = ["Rechnung", "Angebot", "Abrechnung", "Auftrag", "Vertrag"];
/**
 * Details für den Dateinamen: Thema_Wohnung_Name_Betrag, z. B. „Wasserschaden_WHG 1_2430,31“ oder „WHG 08_Meier“.
 * ki: { thema, firma, betrag, wohnungId } aus dem Vorschlag der KI; die Mietpartei kommt aus der Auswahl im Dialog.
 */
/** Wohnung der KI nur, wenn sie zum gewählten Haus gehört (objektId undefined = Haus egal) */
const passendeWohnung = (wohnungId, objektId) => {
  const w = wohnungVon(wohnungId || null);
  return w && objektId !== undefined && w.objekt_id !== (objektId || null) ? null : w;
};
export function detailsVorschlag({ mieterId = null, art = null, ki = {}, objektId = undefined } = {}) {
  const m = mieterVon(mieterId);
  const w = m?.wohnung_id ? wohnungVon(m.wohnung_id) : passendeWohnung(ki.wohnungId, objektId);
  const name = m && !OHNE_MIETERNAME.includes(art) ? m.nachname : null;
  // Ohne Thema: bei Rechnungen u. Ä. die Firma, sonst nur, wenn sonst gar nichts im Namen stünde
  const vorne = ki.thema || (!name && (OHNE_MIETERNAME.includes(art) || !w) ? ki.firma : null);
  return [vorne, w?.bezeichnung, name, ki.betrag].map(namensTeil).filter(Boolean).join("_").slice(0, 80);
}

/** Automatische Unterordner: „je Jahr“ (Jahr des Dokuments) oder „je Wohnung“ (Wohnung - Nachname) */
export const ordnerAutomatik = (name) => zustand.dokOrdnerAuto?.get(name) || null;
export function zielOrdner(basis, { datum = null, mieterId = null, wohnungId = null, objektId = undefined } = {}) {
  // Unter „Allgemein“ (objektId null) gibt es keine automatischen Unterordner
  const art = objektId === null ? null : ordnerAutomatik(basis);
  if (art === "jahr") {
    const jahr = String(datum || heuteISO()).slice(0, 4);
    return /^\d{4}$/.test(jahr) ? `${basis}/${jahr}` : basis;
  }
  if (art !== "wohnung") return basis;
  const m = mieterVon(mieterId);
  const w = m?.wohnung_id ? wohnungVon(m.wohnung_id) : passendeWohnung(wohnungId, objektId);
  const teil = [w?.bezeichnung, m?.nachname].filter(Boolean).join(" - ").replace(/\//g, "-").trim();
  return teil ? `${basis}/${teil}` : basis;
}

/** Haus der Mietpartei (über die Wohnung) */
const hausVonMieter = (m) => (m?.wohnung_id ? wohnungVon(m.wohnung_id)?.objekt_id || null : null);

// Name nach dem Schema, bis Robert ihn selbst ändert; Details folgen der Mietpartei; Zielordner wird angezeigt.
// Das Haus folgt der gewählten Mietpartei; passen beide nicht zusammen, steht ein Hinweis da.
function verbindeNamen(bereich, { ki = {} } = {}) {
  const feld = (n) => $(`[name=${n}]`, bereich);
  const titel = feld("titel"), details = feld("details");
  let titelVonHand = false, detailsVonHand = false;
  const hausWahl = () => feld("objekt_id").value || null;
  verbindeOrdnerWahl(bereich);
  const pruefeHaus = () => {
    const hinweis = $("[data-mieter-hinweis]", bereich);
    if (!hinweis) return;
    const m = mieterVon(feld("mieter_id")?.value || null);
    const haus = hausVonMieter(m);
    hinweis.textContent = m && haus && haus !== hausWahl()
      ? `Achtung: ${[m.vorname, m.nachname].filter(Boolean).join(" ")} wohnt in ${objektVon(haus)?.bezeichnung || "einem anderen Haus"}, nicht im gewählten Haus.`
      : "";
  };
  const setze = () => {
    pruefeHaus();
    if (!titelVonHand) {
      titel.value = dokumentTitel({
        datum: feld("datum").value, objekt: objektVon(feld("objekt_id").value), art: feld("art").value, details: details.value,
      });
    }
    const hinweis = $("[data-zielordner]", bereich);
    if (hinweis && feld("ordner")) {
      const ziel = zielOrdner(feld("ordner").value, { datum: feld("datum").value, mieterId: feld("mieter_id")?.value || null, wohnungId: ki.wohnungId, objektId: hausWahl() });
      hinweis.textContent = ziel !== feld("ordner").value ? `Landet in: ${ordnerAnzeige(ziel)}` : "";
    }
  };
  titel.addEventListener("input", () => { titelVonHand = true; });
  details.addEventListener("input", () => { detailsVonHand = true; setze(); });
  const neueDetails = () => {
    if (!detailsVonHand) details.value = detailsVorschlag({ mieterId: feld("mieter_id")?.value || null, art: feld("art").value, ki, objektId: hausWahl() });
    setze();
  };
  // Mietpartei gewählt → Haus folgt
  feld("mieter_id")?.addEventListener("change", () => {
    const haus = hausVonMieter(mieterVon(feld("mieter_id").value || null));
    if (haus && haus !== hausWahl()) {
      feld("objekt_id").value = haus;
      feld("objekt_id").dispatchEvent(new Event("change", { bubbles: true })); // Ordnerliste folgt dem Haus
      return;
    }
    neueDetails();
  });
  feld("art").addEventListener("change", neueDetails);
  feld("objekt_id").addEventListener("change", neueDetails);
  for (const n of ["datum", "ordner"]) feld(n)?.addEventListener("change", setze);
  // Startwerte: Details mit dem gewählten Haus abgleichen (Wohnung der KI aus einem anderen Haus fällt weg)
  if (!detailsVonHand) details.value = detailsVorschlag({ mieterId: feld("mieter_id")?.value || null, art: feld("art").value, ki, objektId: hausWahl() });
  setze();
}

async function istPdfDatei(datei) {
  const kopf = new Uint8Array(await datei.slice(0, 5).arrayBuffer());
  return String.fromCharCode(...kopf) === "%PDF-";
}

// ---------------------------------------------------------------------------
// Ablagefläche: Dateien hineinziehen oder auswählen (wie ein Upload-Feld).
// Ist eine Fläche auf der Seite, nimmt die ganze Seite Dateien an; sonst öffnet der Browser
// fallengelassene Dateien nicht versehentlich.
// ---------------------------------------------------------------------------
const DATEI_TYPEN = "image/*,application/pdf,.docx,.xlsx," + DOCX_TYP + "," + XLSX_TYP + ",.zip,application/zip";
const ICON_PLUS_GROSS = `<svg viewBox="0 0 24 24" width="30" height="30"><path fill="currentColor" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm4 18H6V4h7v5h5v11zM11 18h2v-4h3l-4-4-4 4h3v4z"/></svg>`;
const flaechenOptionen = new WeakMap();
export function ablegeflaecheHtml({ text = "Dateien hierher ziehen", klein = false } = {}) {
  return `
    <label class="ablegeflaeche ${klein ? "ablegeflaeche--klein" : ""}" data-ablegeflaeche>
      <input type="file" accept="${DATEI_TYPEN}" multiple hidden>
      <span class="ablegeflaeche__symbol" aria-hidden="true">${ICON_PLUS_GROSS}</span>
      <span class="ablegeflaeche__text"><strong class="nur-maus">${esc(text)}</strong> <span class="nur-breit nur-maus">oder</span>
        <span class="knopf knopf--klein ablegeflaeche__knopf">Dateien auswählen</span></span>
      <span class="ablegeflaeche__hinweis leise">Fotos, PDF, Word, Excel · auch mehrere · Die KI benennt sie nach dem Ablage-Schema und schlägt den Ordner vor.
        Eine ZIP mit fertiger Ordnerstruktur wird 1:1 übernommen.</span>
    </label>`;
}
/** optionen wie bei erfasseAlle: { objektId, nurAblage } */
export function verbindeAblegeflaeche(el, optionen = {}) {
  if (!el) return;
  flaechenOptionen.set(el, optionen);
  const input = $("input[type=file]", el);
  input.addEventListener("change", () => { const d = [...input.files]; input.value = ""; verteile(d, optionen); });
}
// ZIP-Dateien gehen in den ZIP-Import (Ordner 1:1), alles andere einzeln zur KI
async function verteile(dateien, optionen = {}) {
  const zips = dateien.filter(istZip);
  const rest = dateien.filter((d) => !istZip(d));
  for (const z of zips) await zipImport(z, { objektId: optionen.objektId, nachher: (neu) => optionen.nachZip?.(neu) });
  if (rest.length) await erfasseAlle(rest, optionen);
}
const hatDateien = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
const aktiveFlaeche = () => $("[data-ablegeflaeche]");
let ziehTiefe = 0;
// Ohne Ablagefläche (z. B. Übersicht, Postfach): ganze Seite nimmt die Dateien an, die KI entscheidet Postfach oder Ablage
const markiere = (an) => {
  const el = aktiveFlaeche();
  if (el) el.classList.toggle("ablegeflaeche--aktiv", an);
  document.body.classList.toggle("datei-ueber", an && !el && !$("dialog[open]") && !$("#app")?.hidden);
};
document.addEventListener("dragenter", (e) => { if (hatDateien(e)) { ziehTiefe++; markiere(true); } });
document.addEventListener("dragleave", (e) => { if (hatDateien(e) && --ziehTiefe <= 0) { ziehTiefe = 0; markiere(false); } });
document.addEventListener("dragover", (e) => {
  if (!hatDateien(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = !$("dialog[open]") && !$("#app")?.hidden ? "copy" : "none";
});
document.addEventListener("drop", (e) => {
  if (!hatDateien(e)) return;
  e.preventDefault();
  ziehTiefe = 0; markiere(false);
  const el = aktiveFlaeche();
  if ($("dialog[open]")) return;
  if ($("#app")?.hidden) return; // nicht angemeldet
  const dateien = [...e.dataTransfer.files];
  if (dateien.length) verteile(dateien, (el && flaechenOptionen.get(el)) || {});
});

// ---------------------------------------------------------------------------
// Mehrere Dateien nacheinander erfassen (je Datei ein Dialog), am Ende einmal weiter
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Anhänge für E-Mails: Dateien aus der Ablage (Bucket „dokumente“) als { bucket, pfad, name, groesse, dokument_id }
// ---------------------------------------------------------------------------
export function anhangVonDokument(d) {
  const endung = ENDUNG[d.typ] || String(d.pfad || "").split(".").pop() || "pdf";
  const titel = String(d.titel || "Dokument").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").trim().slice(0, 150) || "Dokument";
  return { bucket: "dokumente", pfad: d.pfad, name: `${titel}.${endung}`, groesse: d.groesse || null, dokument_id: d.id };
}
/** Dokument aus der Ablage suchen und wählen (Suchfeld über alle Häuser und „Allgemein“). Liefert den Anhang oder null. */
export async function dokumentWaehlen({ objektId = null } = {}) {
  const liste = await db.ladeDokumente({}).catch(() => []);
  if (!liste.length) { melde("In der Ablage liegen noch keine Dateien.", "info"); return null; }
  const haus = (id) => (id ? objektVon(id)?.bezeichnung || "Haus" : "Allgemein");
  // Dateien des betroffenen Hauses zuerst
  const sortiert = [...liste].sort((a, b) => (b.objekt_id === objektId) - (a.objekt_id === objektId) || haus(a.objekt_id).localeCompare(haus(b.objekt_id)));
  const eintraege = sortiert.map((d) => ({
    wert: d.id, name: d.titel || "(ohne Namen)", gruppe: haus(d.objekt_id),
    zusatz: [ordnerAnzeige(d.ordner), d.datum ? datumDE(d.datum) : ""].filter(Boolean).join(" · "),
  }));
  const daten = await dialogFormular(`
    <h2>Datei aus der Ablage anhängen</h2>
    ${suchauswahlHtml({ label: "Datei suchen", placeholder: "Name, Ordner oder Haus …", name: "dokument" })}
    <p class="oz-fehler" data-fehler role="alert" hidden></p>
    <div class="knopfreihe">
      <button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button>
      <button class="knopf knopf--primaer" value="ok">Anhängen</button>
    </div>`, {
    breit: true,
    vorbereiten: (form) => {
      verbindeSuchauswahl($(".suchauswahl", form), eintraege);
      form.addEventListener("submit", (e) => {
        if (e.submitter?.value !== "ok" || form.dokument.value) return;
        e.preventDefault();
        const p = $("[data-fehler]", form);
        p.textContent = "Bitte eine Datei aus der Liste wählen."; p.hidden = false;
      });
    },
  });
  const id = daten?.get("dokument");
  const d = id ? liste.find((x) => x.id === id) : null;
  return d ? anhangVonDokument(d) : null;
}

export async function erfasseAlle(dateien, optionen = {}) {
  const liste = [...(dateien || [])].filter(Boolean);
  if (liste.length <= 1) return erfasse(liste[0], optionen);
  let ziel = null, abgelegt = 0;
  for (let i = 0; i < liste.length; i++) {
    const r = await erfasse(liste[i], { ...optionen, nr: i + 1, von: liste.length, weiter: false });
    if (r?.abbruch) break;
    if (r?.ziel) { ziel = r.ziel; if (r.abgelegt) abgelegt++; }
  }
  if (abgelegt > 1) melde(`${abgelegt} Dateien abgelegt.`, "ok");
  if (ziel) geheZu(ziel);
}

// ---------------------------------------------------------------------------
// Foto, PDF, Word oder Excel erfassen: die KI liest, schlägt Ablage, Ordner und Dateinamen vor
// objektId: Haus vorbelegen (null = Allgemein), nurAblage: kein Postfach (z. B. auf der Seite eines Hauses)
// nr/von: Position bei mehreren Dateien; weiter: false = nicht selbst weiterspringen (Rückgabe { ziel })
// ablageZiel: (objektId) => Seite nach dem Ablegen (Standard: Seite des Hauses)
// ---------------------------------------------------------------------------
export async function erfasse(datei, { objektId, nurAblage = false, nr = 1, von = 1, weiter = true, ablageZiel = null } = {}) {
  if (!datei) return null;
  const vorname = von > 1 ? `„${datei.name || "Datei"}“: ` : "";
  if (datei.size > MAX_DATEI) { melde(vorname + "Die Datei ist zu groß (höchstens 15 MB).", "fehler"); return null; }
  const pdf = datei.type === "application/pdf" || /\.pdf$/i.test(datei.name || "");
  // Word/Excel vom Gerät: nur in die Ablage; die KI liest den Text
  const office = /\.docx$/i.test(datei.name || "") || datei.type === DOCX_TYP ? DOCX_TYP
    : /\.xlsx$/i.test(datei.name || "") || datei.type === XLSX_TYP ? XLSX_TYP : null;
  if (office) nurAblage = true;
  if (!pdf && !office && !/^image\//.test(datei.type || "") && !/\.(jpe?g|png|webp|heic)$/i.test(datei.name || "")) {
    melde(vorname + "Dieses Dateiformat geht nicht. Möglich sind Fotos, PDF, Word (.docx) und Excel (.xlsx).", "fehler");
    return null;
  }
  let blob, base64 = null, vorschau = null;
  try {
    if (office) {
      const kopf = new Uint8Array(await datei.slice(0, 2).arrayBuffer());
      if (kopf[0] !== 0x50 || kopf[1] !== 0x4b) return melde(vorname + "Die Datei ist beschädigt oder kein echtes Word/Excel-Dokument.", "fehler");
      blob = new Blob([datei], { type: office });
    } else if (pdf) {
      if (!(await istPdfDatei(datei))) return melde(vorname + "Das ist keine gültige PDF-Datei.", "fehler");
      blob = new Blob([datei], { type: "application/pdf" });
      if (blob.size <= MAX_PDF_KI) base64 = await alsBase64(blob);
    } else {
      const bild = await verkleinere(datei, 2000);
      ({ blob, base64 } = bild);
      vorschau = bild.url;
    }
  } catch (err) {
    return melde(vorname + "Die Datei konnte nicht gelesen werden: " + err.message, "fehler");
  }

  let erkannt = {};
  let kiHinweis = zustand.ki?.ki ? "Bitte die Angaben eintragen." : "Die KI ist noch nicht eingerichtet. Bitte die Angaben selbst eintragen.";
  if (zustand.ki?.ki && (base64 || office)) {
    const was = office === XLSX_TYP ? "die Excel-Datei" : office ? "das Word-Dokument" : pdf ? "das PDF" : "das Foto";
    const warte = wartehinweis(`Die KI liest ${was} …`);
    try {
      const dateiname = String(datei.name || "").slice(0, 150) || null;
      let anfrage = null;
      if (office) {
        const art = office === XLSX_TYP ? "excel" : "word";
        const text = await officeText(blob, art).catch(() => "");
        if (text.trim()) anfrage = { aktion: "brief_lesen", datei_text: { text, art }, dateiname };
        else kiHinweis = "In der Datei steht kein lesbarer Text. Bitte die Angaben eintragen.";
      } else {
        anfrage = { aktion: "brief_lesen", bild: { daten: base64, typ: pdf ? "application/pdf" : "image/jpeg" }, dateiname };
      }
      if (anfrage) {
        erkannt = await db.funktion("ki", anfrage);
        if (erkannt.lesbar === false) melde("Schwer lesbar. Bitte die Angaben prüfen.", "info");
      }
    } catch (err) {
      melde(err.message, "fehler");
    } finally {
      await warte.ende();
    }
  } else if (zustand.ki?.ki && pdf) {
    kiHinweis = "Das PDF ist zu groß für die KI. Bitte die Angaben selbst eintragen.";
  }
  const vonKi = !!erkannt.betreff;

  const [mieterL, ordnerL] = await Promise.all([mieterListe(), ordnerListe()]);
  const ziel = nurAblage ? "dokument" : erkannt.eingang === "anfrage" ? "anfrage" : erkannt.eingang ? "dokument" : "anfrage";
  // Haus: von der Seite vorgegeben, sonst das Haus der erkannten Mietpartei, sonst der Vorschlag der KI
  const hausStart = objektId !== undefined ? objektId : hausVonMieter(mieterVon(erkannt.mieter_id)) || erkannt.objekt_id || null;
  const datumStart = erkannt.datum || heuteISO();
  const absenderStart = erkannt.absender_kurz || erkannt.absender_name || "";
  const kiTeile = { thema: erkannt.thema || null, firma: absenderStart || null, betrag: erkannt.betrag || null, wohnungId: erkannt.wohnung_id || null };
  const [symbol, symbolKlasse] = symbolVon(office || (pdf ? "application/pdf" : "image/jpeg"));
  const artStart = erkannt.art || "Sonstiges";
  const name = norm(erkannt.absender_name);
  const mieterVermutet = erkannt.mieter_id ||
    (name ? mieterL.find((m) => name.includes(norm(m.nachname)) && (!m.vorname || name.includes(norm(m.vorname))))?.id : null) || null;
  // Fürs Postfach: Mietpartei – oder das ganze Haus, wenn die KI nur das Haus erkennt
  const betrifftStart = mieterVermutet || (erkannt.objekt_id ? `h:${erkannt.objekt_id}` : null);

  const daten = await dialogFormular(`
    <h2>${office ? "Datei ablegen" : pdf ? "PDF erfassen" : "Foto erfassen"}${von > 1 ? ` <span class="leise">(${nr} von ${von})</span>` : ""}</h2>
    ${vorschau ? `<img class="fotovorschau" src="${vorschau}" alt="Vorschau">` : `<p class="dateizeile"><span class="dok__icon ${symbolKlasse}">${symbol}</span> ${esc(datei.name || "Dokument")} <span class="leise">(${(blob.size / 1048576).toFixed(1).replace(".", ",")} MB)</span></p>`}
    <p class="leise">${vonKi ? "Von der KI gelesen: Ordner, Art und Dateiname sind Vorschläge. Bitte kurz prüfen." : esc(kiHinweis)}</p>
    ${nurAblage ? "" : `
    <div class="wahl" role="radiogroup" aria-label="Wohin damit?">
      <label><input type="radio" name="ziel" value="anfrage" ${ziel === "anfrage" ? "checked" : ""}> <span><strong>Ins Postfach</strong><br><span class="leise">Jemand will etwas, braucht eine Antwort</span></span></label>
      <label><input type="radio" name="ziel" value="dokument" ${ziel === "dokument" ? "checked" : ""}> <span><strong>In die Ablage</strong><br><span class="leise">Rechnung, Vertrag, Bescheid …</span></span></label>
    </div>`}
    <fieldset class="gruppe" data-ziel="dokument">
      <div class="formraster formraster--zwei">
        <label class="feld"><span>Haus</span><select name="objekt_id">${hausOptionen(hausStart)}</select></label>
        <label class="feld"><span>Mietpartei (optional)</span><select name="mieter_id">${mieterOptionen(mieterL, erkannt.mieter_id || null)}</select>
          <span class="feldhinweis feldhinweis--warn" data-mieter-hinweis></span></label>
        <label class="feld"><span>Ordner</span><select name="ordner" data-wunsch="${esc(erkannt.ordner || "")}">${ordnerOptionen(ordnerFuer(hausStart), passenderOrdner(erkannt.ordner, hausStart))}</select>
          <span class="feldhinweis feldhinweis--leise" data-zielordner></span></label>
        <label class="feld"><span>Art</span><select name="art">${optionen(DOKUMENT_ARTEN, artStart)}</select></label>
        <label class="feld"><span>Details (für den Namen)</span><input name="details" value="${esc(detailsVorschlag({ mieterId: erkannt.mieter_id || null, art: artStart, ki: kiTeile }))}" maxlength="80" placeholder="z. B. Wasserschaden_WHG 1_2430,31"></label>
        <label class="feld"><span>Datum des Schreibens</span><input type="date" name="datum" value="${esc(datumStart)}" required></label>
      </div>
      <label class="feld"><span>Dateiname</span><input name="titel" required maxlength="160" spellcheck="false">
        ${vonKi ? `<span class="feldhinweis feldhinweis--leise">Vorschlag der KI nach dem Ablage-Schema, änderbar</span>` : ""}</label>
      <label class="feld"><span>Kurz zusammengefasst</span><textarea name="zusammenfassung" rows="2">${esc(erkannt.zusammenfassung || "")}</textarea></label>
    </fieldset>
    ${nurAblage ? "" : `
    <fieldset class="gruppe" data-ziel="anfrage">
      <label class="feld"><span>Absender</span><input name="absender_voll" value="${esc(erkannt.absender_name || "")}"></label>
      <label class="feld"><span>Betrifft</span><select name="betrifft">${betrifftOptionen(mieterL, betrifftStart)}</select>
        <span class="feldhinweis feldhinweis--leise">Eine Mietpartei oder das ganze Haus (z. B. wenn unklar ist, wer es war)</span></label>
      <label class="feld"><span>Betreff</span><input name="betreff" required value="${esc(erkannt.betreff || "")}"></label>
      <label class="feld"><span>Text</span>
        <span class="diktat"><textarea name="text" rows="7">${esc(erkannt.text || "")}</textarea>${mikroKnopf()}</span></label>
    </fieldset>`}
    <div class="knopfreihe">
      ${nr < von ? `<button class="knopf" value="stopp" formnovalidate>Alle abbrechen</button>` : ""}
      <button class="knopf" value="abbrechen" formnovalidate>${nr < von ? "Überspringen" : "Abbrechen"}</button>
      <button class="knopf knopf--primaer" value="ok" data-sichtbar="dokument">Ablegen</button>
      ${nurAblage ? "" : `<button class="knopf knopf--primaer" value="ok" data-sichtbar="anfrage">Ins Postfach</button>`}
    </div>`, {
    breit: true,
    vorbereiten: (form) => {
      verbindeDiktat(form);
      const zeige = () => {
        const z = nurAblage ? "dokument" : form.querySelector("[name=ziel]:checked")?.value || "anfrage";
        for (const f of $$("fieldset[data-ziel]", form)) { f.disabled = f.dataset.ziel !== z; f.hidden = f.disabled; }
        for (const k of $$("[data-sichtbar]", form)) k.hidden = k.dataset.sichtbar !== z;
      };
      for (const r of $$("[name=ziel]", form)) r.addEventListener("change", zeige);
      zeige();
      verbindeNamen($("fieldset[data-ziel=dokument]", form), { ki: kiTeile });
    },
  });
  if (vorschau) setTimeout(() => URL.revokeObjectURL(vorschau), 5000);
  if (!daten) return null;
  if (daten.get("_aktion") === "stopp") return { abbruch: true };
  // Ziel anspringen (einzelne Datei) oder an erfasseAlle zurückgeben
  const fertig = (ziel, abgelegt = false) => {
    if (weiter) geheZu(ziel);
    return { ziel, abgelegt };
  };

  const typ = office || (pdf ? "application/pdf" : "image/jpeg");
  const endung = ENDUNG[typ];
  if (nurAblage || daten.get("ziel") === "dokument") {
    const objekt_id = daten.get("objekt_id") || null;
    try {
      const neu = await db.legeDokumentAb({
        objekt_id,
        mieter_id: daten.get("mieter_id") || null,
        ordner: zielOrdner(daten.get("ordner"), { datum: daten.get("datum"), mieterId: daten.get("mieter_id") || null, wohnungId: kiTeile.wohnungId, objektId: daten.get("objekt_id") || null }),
        art: daten.get("art"),
        absender: erkannt.absender_name || erkannt.absender_kurz || null,
        details: String(daten.get("details") || "").trim() || null,
        datum: daten.get("datum") || null,
        titel: String(daten.get("titel") || "").trim(),
        zusammenfassung: String(daten.get("zusammenfassung") || "").trim() || null,
        pfad: `${objekt_id || "allgemein"}/${crypto.randomUUID()}.${endung}`,
        typ, groesse: blob.size,
      }, blob);
      zustand.zuletztAbgelegt = neu?.id || null;
      melde(von > 1 ? `Abgelegt: ${String(daten.get("titel") || "").trim()}` : "Abgelegt.", "ok");
      return { ...fertig(ablageZiel ? ablageZiel(objekt_id) : `#/objekt/${objekt_id || "allgemein"}`, true), dokument: neu };
    } catch (err) {
      melde(err.message, "fehler");
    }
    return null;
  }

  // Ins Postfach
  const betrifft = betrifftAus(daten.get("betrifft"));
  const m = mieterL.find((x) => x.id === betrifft.mieter_id);
  try {
    const n = await db.neueNachricht({
      quelle: "brief",
      status: "offen",
      absender_name: String(daten.get("absender_voll") || "").trim() || (m ? mieterName(m) : null),
      absender_email: istEmail(erkannt.absender_email) ? erkannt.absender_email : m?.email || null,
      mieter_id: m?.id || null,
      objekt_id: betrifft.objekt_id,
      zuordnung: m ? "manuell" : null,
      betreff: String(daten.get("betreff") || "").trim(),
      text: String(daten.get("text") || "").trim(),
    });
    const pfad = `${n.id}/1_brief.${endung}`;
    try {
      await db.ladeFotoHoch(pfad, blob);
      await db.aendereNachricht(n.id, { anhaenge: [{ name: `Brief.${endung}`, typ, groesse: blob.size, pfad }] });
    } catch (err) {
      melde(err.message, "fehler");
    }
    if (zustand.ki?.ki) {
      const warte = wartehinweis("Die KI ordnet die Nachricht ein …");
      try { await db.funktion("ki", { aktion: "einordnen", nachricht_id: n.id }); }
      catch (err) { melde("Einordnen nicht möglich: " + err.message, "fehler"); }
      finally { await warte.ende(); }
    }
    return fertig(`#/postfach/${n.id}`);
  } catch (err) {
    melde(err.message, "fehler");
  }
  return null;
}

// ---------------------------------------------------------------------------
// Listen (für die Seite eines Hauses und die Wissen-Seite)
// ---------------------------------------------------------------------------
function nachOrdner(liste, reihenfolge, { unbekannteBehalten = false } = {}) {
  const gruppen = new Map(reihenfolge.map((o) => [o, []]));
  for (const x of liste) {
    const k = gruppen.has(x.ordner) || (unbekannteBehalten && x.ordner) ? x.ordner : "Sonstiges";
    if (!gruppen.has(k)) gruppen.set(k, []);
    gruppen.get(k).push(x);
  }
  // Position: eigener Platz in der Liste, sonst hinter dem längsten bekannten Oberordner
  const platz = (k) => {
    let i = reihenfolge.indexOf(k);
    if (i >= 0) return [i, 0, ""];
    const teile = k.split("/");
    for (let n = teile.length - 1; n > 0; n--) {
      i = reihenfolge.indexOf(teile.slice(0, n).join("/"));
      if (i >= 0) return [i, 1, k];
    }
    return [reihenfolge.length, 1, k];
  };
  return [...gruppen.entries()].filter(([, l]) => l.length).sort(([a], [b]) => {
    const [x, y] = [platz(a), platz(b)];
    return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2], "de", { numeric: true });
  });
}

/** Ein Dokument als Knopf (öffnet über verbindeListen) */
export const dokKnopf = (d) => `
        <button type="button" class="dok" data-dok="${esc(d.id)}">
          <span class="dok__icon ${symbolVon(d.typ)[1]}">${symbolVon(d.typ)[0]}</span>
          <span class="dok__text"><span class="dok__titel">${esc(d.titel).replace(/_/g, "_<wbr>")}</span>
            <span class="leise">${esc([d.datum ? datumDE(d.datum) : "", d.art, d.zusammenfassung].filter(Boolean).join(" · "))}</span></span>
        </button>`;
export function dokumentListe(liste, { leer = "Keine Dokumente." } = {}) {
  if (!liste.length) return `<div class="leer">${esc(leer)}</div>`;
  return nachOrdner(liste, zustand.dokOrdner || DOKUMENT_ORDNER, { unbekannteBehalten: true }).map(([ordner, l]) => `
    <div class="ordner"><h3 class="ordner__titel">${esc(ordnerAnzeige(ordner))} <span class="leise">${l.length}</span></h3>
      ${l.map(dokKnopf).join("")}
    </div>`).join("");
}

export function wissenListe(liste, { leer = "Noch kein Wissen zu diesem Haus. Einfach einsprechen, was wichtig ist." } = {}) {
  if (!liste.length) return `<div class="leer">${esc(leer)}</div>`;
  return nachOrdner(liste, WISSEN_ORDNER).map(([ordner, l]) => `
    <div class="ordner"><h3 class="ordner__titel">${esc(ordner)} <span class="leise">${l.length}</span></h3>
      <div class="wissensliste">${l.map((w) => `
        <button type="button" class="wissen ${w.aktiv ? "" : "wissen--aus"}" data-wissen="${esc(w.id)}">
          <span class="wissen__titel">${esc(w.titel)}${w.aktiv ? "" : ` <span class="marker marker--leise">ausgeschaltet</span>`}</span>
          <span class="wissen__text">${esc(w.inhalt)}</span>
        </button>`).join("")}</div>
    </div>`).join("");
}

export function dienstleisterListe(liste, { leer = "Noch keine Handwerker eingetragen." } = {}) {
  if (!liste.length) return `<div class="leer">${esc(leer)}</div>`;
  return `<div class="zeilen">${liste.map((d) => `
    <div class="dienst ${d.aktiv ? "" : "dienst--aus"}">
      <button type="button" class="dienst__haupt" data-dienst="${esc(d.id)}">
        <span class="dienst__name">${esc(d.name)}</span>
        <span class="leise">${esc([d.gewerk, d.objekt_id ? objektVon(d.objekt_id)?.bezeichnung : "alle Häuser", d.aktiv ? "" : "ausgeschaltet"].filter(Boolean).join(" · "))}</span>
      </button>
      ${d.telefon ? `<a class="knopf knopf--klein" href="tel:${esc(String(d.telefon).replace(/[^\d+]/g, ""))}">${esc(d.telefon)}</a>` : ""}
    </div>`).join("")}</div>`;
}

export function verbindeListen(root, { dokumente = [], wissen = [], dienstleister = [], objektId, nachher }) {
  for (const b of $$("[data-dok]", root)) b.addEventListener("click", () => oeffneDokument(dokumente.find((d) => d.id === b.dataset.dok), { nachher }));
  for (const b of $$("[data-wissen]", root)) b.addEventListener("click", () => bearbeiteWissen(wissen.find((w) => w.id === b.dataset.wissen), { nachher }));
  for (const b of $$("[data-dienst]", root)) b.addEventListener("click", () => bearbeiteDienstleister(dienstleister.find((d) => d.id === b.dataset.dienst), { nachher, objektId }));
}

// ---------------------------------------------------------------------------
// Ein Dokument ansehen und bearbeiten
// ---------------------------------------------------------------------------
export async function oeffneDokument(d, { nachher = () => {} } = {}) {
  if (!d) return;
  const [mieterL, ordnerL] = await Promise.all([mieterListe(), ordnerListe()]);
  const pdf = d.typ === "application/pdf";
  const bild = /^image\//.test(d.typ || "");
  const daten = await dialogFormular(`
    <h2 class="umbruch">${esc(d.titel)}</h2>
    ${bild ? `<a data-ansehen target="_blank" rel="noopener"><img class="fotovorschau" alt="Dokument"></a>` : ""}
    ${d.zusammenfassung ? `<p>${esc(d.zusammenfassung)}</p>` : ""}
    <p class="leise">${esc(ordnerAnzeige(d.ordner))}${d.objekt_id ? ` · ${esc(objektVon(d.objekt_id)?.bezeichnung || "")}` : " · Allgemein"}</p>
    <p class="knopfreihe">
      ${anzeigbar(d.typ) ? `<a class="knopf knopf--klein" data-ansehen target="_blank" rel="noopener">${pdf ? "PDF öffnen" : "In voller Größe"}</a>` : ""}
      <a class="knopf knopf--klein" data-laden>Herunterladen</a>
    </p>
    <details class="ausklapp ausklapp--innen"><summary>Angaben ändern</summary>
      <div class="formraster formraster--zwei">
        <label class="feld breit"><span>Name</span><input name="titel" required maxlength="160" value="${esc(d.titel)}"></label>
        <label class="feld"><span>Haus</span><select name="objekt_id">${hausOptionen(d.objekt_id)}</select></label>
        <label class="feld"><span>Mietpartei</span><select name="mieter_id">${mieterOptionen(mieterL, d.mieter_id)}</select></label>
        <label class="feld"><span>Ordner</span><select name="ordner">${ordnerOptionen(ordnerFuer(d.objekt_id), d.ordner)}</select></label>
        <label class="feld"><span>Art</span><select name="art">${optionen(DOKUMENT_ARTEN, d.art || "Sonstiges")}</select></label>
        <label class="feld"><span>Datum</span><input type="date" name="datum" value="${esc(d.datum || "")}"></label>
        <label class="feld"><span>Absender</span><input name="absender" value="${esc(d.absender || "")}"></label>
      </div>
    </details>
    <div class="knopfreihe">
      <button class="knopf knopf--gefahr knopf--links" value="loeschen" formnovalidate>Löschen</button>
      <button class="knopf" value="abbrechen" formnovalidate>Schließen</button>
      <button class="knopf knopf--primaer" value="ok">Speichern</button>
    </div>`, {
    breit: true,
    vorbereiten: async (form) => {
      verbindeOrdnerWahl(form);
      try {
        const [ansehen, laden] = await Promise.all([db.dateiAdresse("dokumente", d.pfad), db.dateiAdresse("dokumente", d.pfad, { download: `${sichererDateiname(d.titel)}.${endungVon(d)}` })]);
        for (const a of $$("[data-ansehen]", form)) a.href = ansehen;
        $("[data-laden]", form).href = laden;
        const img = $("img", form);
        if (img) img.src = ansehen;
      } catch (err) { melde(err.message, "fehler"); }
    },
  });
  if (!daten) return;
  try {
    if (daten.get("_aktion") === "loeschen") {
      if (!(await frage("Dokument löschen?", `<p>„${esc(d.titel)}“ wird endgültig gelöscht.</p>`, "Löschen", { gefahr: true }))) return;
      await db.loescheDokument(d);
      melde("Dokument gelöscht.", "ok");
    } else {
      await db.aendereDokument(d.id, {
        titel: String(daten.get("titel")).trim() || d.titel,
        objekt_id: daten.get("objekt_id") || null,
        mieter_id: daten.get("mieter_id") || null,
        ordner: daten.get("ordner") === d.ordner ? d.ordner
          : zielOrdner(daten.get("ordner"), { datum: daten.get("datum") || d.datum, mieterId: daten.get("mieter_id") || null, objektId: daten.get("objekt_id") || null }),
        art: daten.get("art"),
        datum: daten.get("datum") || null,
        absender: String(daten.get("absender") || "").trim() || null,
      });
      melde("Gespeichert.", "ok");
    }
    nachher();
  } catch (err) {
    melde(err.message, "fehler");
  }
}

// ---------------------------------------------------------------------------
// Wissen
// ---------------------------------------------------------------------------
export async function zeigeWissen() {
  const [liste, dienstleister] = await Promise.all([db.ladeWissen(), db.ladeDienstleister().catch(() => [])]);
  const gruppen = [{ titel: "Gilt für alle Häuser", id: null }, ...zustand.stamm.objekte.map((o) => ({ titel: o.bezeichnung, id: o.id }))];
  $("#inhalt").innerHTML = `
    <div class="kopf">
      <div><h1>Wissen</h1>
        <p>Das weiß die KI, wenn sie Antworten entwirft: Abläufe, Technik, Ansprechpartner. Je konkreter, desto besser.</p></div>
      <div class="knopfreihe">
        <button type="button" class="knopf knopf--primaer" id="sprechen">${ICON_KI} Einsprechen</button>
        <button type="button" class="knopf" id="tippen">Eintrag tippen</button>
      </div>
    </div>
    <div class="banner banner--leise">Bitte keine Bankdaten und nichts Persönliches über einzelne Mieter eintragen. Das holt sich die KI aus der Akte, die IBAN bekommt sie nie.</div>
    <div class="stapel">
      ${gruppen.map((g, i) => {
        const eintraege = liste.filter((w) => (w.objekt_id || null) === g.id);
        return `<details class="flaeche ausklapp" ${i === 0 ? "open" : ""}>
          <summary>${esc(g.titel)} (${eintraege.length})</summary>
          ${wissenListe(eintraege, { leer: "Noch keine Einträge." })}
        </details>`;
      }).join("")}
      <details class="flaeche ausklapp">
        <summary>Handwerker &amp; Dienstleister (${dienstleister.length})</summary>
        ${dienstleisterListe(dienstleister)}
        <div class="flaeche__fuss"><button type="button" class="knopf knopf--klein" id="dienst-neu">Hinzufügen</button></div>
      </details>
    </div>`;
  const nachher = () => zeigeWissen();
  verbindeListen($("#inhalt"), { wissen: liste, dienstleister, nachher });
  $("#sprechen").addEventListener("click", () => wissenEinsprechen({ nachher }));
  $("#tippen").addEventListener("click", () => bearbeiteWissen(null, { nachher }));
  $("#dienst-neu").addEventListener("click", () => bearbeiteDienstleister(null, { nachher }));
}

/** Wissenseintrag bearbeiten; w ohne id = neuer Eintrag (auch vorbelegt, z. B. von der KI) */
export async function bearbeiteWissen(w, { nachher = () => {}, hinweis = "" } = {}) {
  w = w || {};
  const neu = !w.id;
  const daten = await dialogFormular(`
    <h2>${neu ? "Neuer Eintrag" : "Eintrag bearbeiten"}</h2>
    ${hinweis ? `<p class="ki-vorschlag">${esc(hinweis)}</p>` : ""}
    <label class="feld"><span>Titel</span><input name="titel" required maxlength="150" value="${esc(w.titel || "")}" placeholder="z. B. Heizung Lindenstraße: Druck nachfüllen"></label>
    <div class="formraster formraster--zwei">
      <label class="feld"><span>Gilt für</span><select name="objekt_id">${hausOptionen(w.objekt_id || null, "Alle Häuser")}</select></label>
      <label class="feld"><span>Ordner</span><select name="ordner">${optionen(WISSEN_ORDNER, w.ordner || "Sonstiges")}</select></label>
    </div>
    <label class="feld"><span>Inhalt</span>
      <span class="diktat"><textarea name="inhalt" rows="8" required placeholder="z. B. Druck an der Heizung soll zwischen 1,2 und 1,8 bar liegen. Nachfüllen: Hahn links unten, Schlauch hängt daneben.">${esc(w.inhalt || "")}</textarea>${mikroKnopf()}</span></label>
    <label class="checkfeld"><input type="checkbox" name="aktiv" ${w.aktiv === false ? "" : "checked"}> Aktiv (die KI nutzt diesen Eintrag)</label>
    <div class="knopfreihe">
      ${neu ? "" : `<button class="knopf knopf--gefahr knopf--links" value="loeschen" formnovalidate>Löschen</button>`}
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
      await db.speichereWissen(w.id, {
        titel: String(daten.get("titel")).trim(),
        inhalt: String(daten.get("inhalt")).trim(),
        objekt_id: daten.get("objekt_id") || null,
        ordner: daten.get("ordner"),
        aktiv: daten.get("aktiv") === "on",
      });
      melde("Gespeichert.", "ok");
    }
    nachher();
  } catch (err) {
    melde(err.message, "fehler");
  }
}

/** Wissen frei einsprechen; die KI macht daraus einen Eintrag mit Haus und Ordner (zum Prüfen) */
export async function wissenEinsprechen({ objektId = null, nachher = () => {} } = {}) {
  const kiDa = !!zustand.ki?.ki;
  const daten = await dialogFormular(`
    <h2>Wissen einsprechen</h2>
    <p class="leise">Einfach erzählen, z. B. „In der Lindenstraße ist der Heizungskeller hinter der zweiten Tür links, Schlüssel hängt beim Hausmeister.“
      ${kiDa ? "Die KI macht daraus einen sauberen Eintrag und schlägt Haus und Ordner vor." : ""}</p>
    <label class="feld"><span>Was soll die App wissen?</span>
      <span class="diktat"><textarea name="text" rows="7" required></textarea>${mikroKnopf()}</span></label>
    <div class="knopfreihe">
      <button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button>
      <button class="knopf knopf--primaer" value="ok">${kiDa ? `${ICON_KI} Ordnen lassen` : "Weiter"}</button>
    </div>`, {
    breit: true,
    vorbereiten: (form) => {
      verbindeDiktat(form);
      if (window.SpeechRecognition || window.webkitSpeechRecognition) setTimeout(() => $("[data-diktat]", form)?.click(), 150);
    },
  });
  if (!daten) return;
  const text = String(daten.get("text") || "").trim();
  if (!text) return;
  if (!kiDa) return bearbeiteWissen({ inhalt: text, objekt_id: objektId, ordner: "Sonstiges" }, { nachher });
  const warte = wartehinweis("Die KI ordnet das Wissen …");
  let r = null;
  try {
    r = await db.funktion("ki", { aktion: "wissen_ordnen", text, objekt_id: objektId });
  } catch (err) {
    melde(err.message, "fehler");
  } finally {
    await warte.ende();
  }
  return bearbeiteWissen(r ? { ...r, aktiv: true } : { inhalt: text, objekt_id: objektId }, {
    nachher, hinweis: r ? "Von der KI geordnet. Bitte prüfen und speichern." : "",
  });
}

// ---------------------------------------------------------------------------
// Handwerker und Dienstleister
// ---------------------------------------------------------------------------
export async function bearbeiteDienstleister(d, { nachher = () => {}, objektId = null } = {}) {
  d = d || { objekt_id: objektId };
  const neu = !d.id;
  const daten = await dialogFormular(`
    <h2>${neu ? "Handwerker hinzufügen" : esc(d.name)}</h2>
    <div class="formraster formraster--zwei">
      <label class="feld"><span>Name / Firma</span><input name="name" required maxlength="120" value="${esc(d.name || "")}"></label>
      <label class="feld"><span>Gewerk</span><input name="gewerk" list="gewerke" maxlength="60" value="${esc(d.gewerk || "")}" placeholder="z. B. Heizung &amp; Sanitär"></label>
      <label class="feld"><span>Telefon</span><input name="telefon" type="tel" maxlength="40" value="${esc(d.telefon || "")}"></label>
      <label class="feld"><span>E-Mail (für Aufträge)</span><input name="email" type="email" maxlength="120" value="${esc(d.email || "")}"></label>
      <label class="feld breit"><span>Zuständig für</span><select name="objekt_id">${hausOptionen(d.objekt_id || null, "Alle Häuser")}</select></label>
    </div>
    <datalist id="gewerke">${GEWERKE.map((g) => `<option value="${esc(g)}">`).join("")}</datalist>
    <label class="feld"><span>Notiz (z. B. Notdienst, Ansprechpartner)</span><textarea name="notiz" rows="2">${esc(d.notiz || "")}</textarea></label>
    <label class="checkfeld"><input type="checkbox" name="aktiv" ${d.aktiv === false ? "" : "checked"}> Aktiv (wird der KI und bei Aufträgen angeboten)</label>
    <div class="knopfreihe">
      ${neu ? "" : `<button class="knopf knopf--gefahr knopf--links" value="loeschen" formnovalidate>Löschen</button>`}
      <button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button>
      ${neu ? "" : `<button class="knopf" value="schreiben" formnovalidate>Schreiben</button>`}
      <button class="knopf knopf--primaer" value="ok">Speichern</button>
    </div>`, { breit: true });
  if (!daten) return;
  if (daten.get("_aktion") === "schreiben") return geheZu(`#/schreiben/d-${d.id}`);
  let gespeichert = null;
  try {
    if (daten.get("_aktion") === "loeschen") {
      if (!(await frage("Löschen?", `<p>„${esc(d.name)}“ wird aus der Liste gelöscht.</p>`, "Löschen", { gefahr: true }))) return;
      await db.loescheDienstleister(d.id);
      melde("Gelöscht.", "ok");
    } else {
      const email = String(daten.get("email") || "").trim();
      if (email && !istEmail(email)) return melde("Die E-Mail-Adresse sieht nicht richtig aus.", "fehler");
      gespeichert = await db.speichereDienstleister(d.id, {
        name: String(daten.get("name")).trim(),
        gewerk: String(daten.get("gewerk") || "").trim() || null,
        telefon: String(daten.get("telefon") || "").trim() || null,
        email: email || null,
        objekt_id: daten.get("objekt_id") || null,
        notiz: String(daten.get("notiz") || "").trim() || null,
        aktiv: daten.get("aktiv") === "on",
      });
      melde("Gespeichert.", "ok");
    }
    nachher(gespeichert);
  } catch (err) {
    melde(err.message, "fehler");
  }
}

// ---------------------------------------------------------------------------
// Ordner der Ablage bearbeiten (gilt für alle Häuser)
// Oben „Neuen Ordner anlegen“ mit „Einsortieren in“ (wie im Mail-Programm), darunter die Ordner als Baum.
// Geändert wird erst mit „Speichern“.
// ---------------------------------------------------------------------------
const ordnerName = (s) => String(s || "").split("/").map((t) => t.trim().replace(/\s+/g, " ")).filter(Boolean).join("/").slice(0, 80);
const ordnerTeil = (s) => String(s || "").replace(/\//g, "-").replace(/\s+/g, " ").trim().slice(0, 60);
// Sieht ein Name aus wie ein Wohnungsordner („Wohnung 1 - Meier“, „WHG 3“, „EG links“)?
export const wieWohnung = (s) => /^(wohnung|whg\.?|we)\s*\d+/i.test(String(s).trim()) || /^(eg|og|dg|\d+\.\s*og)\b/i.test(String(s).trim()) || /(dach|erd)geschoss/i.test(s);
const ICON_ORDNER_KLEIN = `<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z"/></svg>`;

/**
 * Ordner bearbeiten. bereich „haus“: Ordner, die es in jedem Haus gleich gibt;
 * „allgemein“: frei angelegte Ordner nur unter Allgemein (ohne Vorgabe, ohne automatische Unterordner).
 */
export async function ordnerBearbeiten({ nachher = () => {}, bereich = "haus" } = {}) {
  const allgemein = bereich === "allgemein";
  await ordnerListe(true);
  const zeilen = (allgemein ? zustand.dokOrdnerZeilenAllgemein : zustand.dokOrdnerZeilen) || [];
  const roh = zeilen.filter((o) => o.name !== "Sonstiges");
  const namenAlle = new Set(zeilen.map((o) => o.name));
  const anzahl = {};
  // Nur Dokumente des Bereichs zählen (Allgemein = ohne Haus)
  const doks = (await db.ladeDokumente(allgemein ? { objektId: null } : {}).catch(() => [])).filter((d) => allgemein || d.objekt_id);
  // Dokumente in automatischen Unterordnern (z. B. „04_Betriebskosten/2026“) zählen beim Ordner darüber mit
  for (const d of doks) {
    let k = d.ordner;
    while (k && !namenAlle.has(k) && k.includes("/")) k = k.slice(0, k.lastIndexOf("/"));
    anzahl[k] = (anzahl[k] || 0) + 1;
  }

  // Modell: jede Zeile kennt ihren Eltern-Ordner; der volle Name ergibt sich daraus
  let zaehler = 0;
  const liste = roh.map((o) => ({
    key: `k${zaehler++}`, id: o.id, alt: o.name, teil: o.name, eltern: null,
    automatik: o.automatik || null, vorher: o.automatik || null, weg: false, neu: false, zahl: anzahl[o.name] || 0,
  }));
  const nachAlt = new Map(liste.map((x) => [x.alt, x]));
  for (const x of liste) {
    let p = x.alt;
    while (p.includes("/")) {
      p = p.slice(0, p.lastIndexOf("/"));
      if (nachAlt.has(p)) { x.eltern = nachAlt.get(p).key; x.teil = x.alt.slice(p.length + 1); break; }
    }
  }
  const nachKey = (k) => liste.find((x) => x.key === k) || null;
  const voll = (x) => (x.eltern ? `${voll(nachKey(x.eltern))}/` : "") + ordnerTeil(x.teil);
  const kinder = (k) => liste.filter((x) => x.eltern === k);
  const nachkommen = (k) => kinder(k).flatMap((x) => [x, ...nachkommen(x.key)]);
  const baum = (k = null, tiefe = 0, nurAktiv = false) =>
    kinder(k).filter((x) => !nurAktiv || !x.weg).flatMap((x) => [{ x, tiefe }, ...baum(x.key, tiefe + 1, nurAktiv)]);
  const wohnungsOrdner = () => liste.find((x) => !x.eltern && !x.weg && x.automatik === "wohnung");

  const warnungVon = (x, wo = wohnungsOrdner()) => !allgemein && !x.weg && wieWohnung(x.teil) && !(x.eltern && nachKey(x.eltern)?.automatik === "wohnung")
    ? `Sieht aus wie ein Wohnungsordner. Die entstehen${wo ? ` unter „${esc(ordnerTeil(wo.teil))}“` : ""} automatisch aus den Mietparteien. Diesen Ordner am besten löschen.` : "";
  const zeileHtml = ({ x, tiefe }) => {
    const elternWeg = x.eltern && nachKey(x.eltern)?.weg;
    const wo = wohnungsOrdner();
    const hinweise = [];
    if (!tiefe && !x.weg && x.automatik === "wohnung") hinweise.push(`Wohnungsordner („Wohnung - Nachname“) legt die App hier automatisch an, sobald etwas für eine Mietpartei abgelegt wird. Nicht von Hand anlegen.`);
    if (!tiefe && !x.weg && x.automatik === "jahr") hinweise.push(`Jahresordner (z. B. ${new Date().getFullYear()}) legt die App hier automatisch an.`);
    const warnung = warnungVon(x, wo);
    return `
      <div class="oz ${tiefe ? "oz--unter" : ""} ${x.weg ? "oz--weg" : ""} ${x.neu ? "oz--neu" : ""}" data-key="${x.key}" data-alt="${esc(x.alt || "")}" style="--tiefe:${tiefe}">
        <div class="oz__zeile">
          <span class="oz__symbol">${ICON_ORDNER_KLEIN}</span>
          <input class="oz__name" value="${esc(x.teil)}" maxlength="60" aria-label="Name des Ordners" autocomplete="off" ${x.weg ? "disabled" : ""}>
          ${x.zahl ? `<span class="leise oz__zahl">${x.zahl} Dok.</span>` : ""}
          ${x.neu ? `<span class="marker marker--neu">neu</span>` : ""}
        </div>
        <div class="oz__knoepfe">
          ${x.weg ? (elternWeg ? `<span class="leise">wird mit gelöscht</span>`
            : `<span class="leise">wird gelöscht${x.zahl ? `, ${x.zahl} Dok. kommen nach „Sonstiges“` : ""}</span>
               <button type="button" class="knopf knopf--klein" data-weg>Doch behalten</button>`) : `
            <button type="button" class="knopf knopf--klein" data-unter>+ Unterordner</button>
            <button type="button" class="knopf knopf--klein" data-schritt="-1" aria-label="Nach oben">↑</button>
            <button type="button" class="knopf knopf--klein" data-schritt="1" aria-label="Nach unten">↓</button>
            <button type="button" class="knopf knopf--klein knopf--gefahr" data-weg aria-label="Ordner löschen">✕</button>`}
        </div>
        ${!tiefe && !x.weg && !allgemein ? `
        <select class="oz__auto" aria-label="Automatische Unterordner">
          <option value="">ohne automatische Unterordner</option>
          <option value="jahr" ${x.automatik === "jahr" ? "selected" : ""}>automatisch je Jahr (2025, 2026 …)</option>
          <option value="wohnung" ${x.automatik === "wohnung" ? "selected" : ""}>automatisch je Wohnung (Wohnung - Nachname)</option>
        </select>` : ""}
        ${hinweise.map((h) => `<p class="oz__hinweis">${h}</p>`).join("")}
        ${warnung ? `<p class="oz__hinweis oz__hinweis--warn">${warnung}</p>` : ""}
      </div>`;
  };

  let ergebnis = null, formular = null;
  const zeichne = (fokusKey = null) => {
    const form = formular;
    const zeilenHtml = baum().map(zeileHtml).join("");
    $(".ozliste", form).innerHTML = (allgemein && !zeilenHtml ? `<p class="leise oz-leer">Noch keine Ordner. Oben einfach einen anlegen.</p>` : zeilenHtml) +
      (allgemein && !anzahl.Sonstiges ? "" : `
      <div class="oz oz--fest" style="--tiefe:0"><div class="oz__zeile"><span class="oz__symbol">${ICON_ORDNER_KLEIN}</span>
        <input value="Sonstiges" readonly tabindex="-1" aria-label="Sonstiges (immer da)">
        ${anzahl.Sonstiges ? `<span class="leise oz__zahl">${anzahl.Sonstiges} Dok.</span>` : ""}</div>
        <div class="oz__knoepfe"><span class="leise">immer da, für alles ohne passenden Ordner</span></div></div>`);
    auswahlNeu();
    if (fokusKey) {
      const z = $(`.oz[data-key="${fokusKey}"]`, form);
      z?.scrollIntoView({ block: "nearest" });
    }
  };
  // Auswahl „Einsortieren in“ neu füllen (gewählten Ordner behalten)
  const auswahlNeu = () => {
    const sel = $("[data-neu-eltern]", formular);
    const vorher = sel.value;
    sel.innerHTML = `<option value="">Oberste Ebene (Hauptordner)</option>` +
      baum(null, 0, true).map(({ x, tiefe }) => `<option value="${x.key}">${"\u00a0".repeat(4 * (tiefe + 1))}${esc(ordnerTeil(x.teil) || "(ohne Namen)")}</option>`).join("");
    sel.value = nachKey(vorher) && !nachKey(vorher).weg ? vorher : "";
    neuHinweis();
  };
  // Nach dem Umbenennen nur die Warnung der Zeile anpassen (nicht neu zeichnen, sonst geht ein Klick verloren)
  const warnungNeu = (x) => {
    const z = $(`.oz[data-key="${x.key}"]`, formular);
    if (!z) return;
    const text = warnungVon(x);
    let p = $(".oz__hinweis--warn", z);
    if (!text) return p?.remove();
    if (!p) { p = document.createElement("p"); p.className = "oz__hinweis oz__hinweis--warn"; z.append(p); }
    p.innerHTML = text;
  };
  // Hinweis unter „Neuen Ordner anlegen“: wo landet er, passt das?
  const neuHinweis = (text = null, art = "") => {
    const form = formular;
    const h = $("[data-neu-hinweis]", form);
    const name = ordnerTeil($("[data-neu-name]", form).value);
    const eltern = nachKey($("[data-neu-eltern]", form).value);
    const wo = wohnungsOrdner();
    if (text) { h.textContent = text; h.className = `feldhinweis ${art}`; return; }
    if (allgemein) {
      h.textContent = name ? `Wird angelegt als: ${ordnerAnzeige((eltern ? voll(eltern) + "/" : "") + name)} (nur unter Allgemein)` : "Gilt nur unter Allgemein, nicht in den Häusern.";
      h.className = "feldhinweis feldhinweis--leise";
    } else if (name && wieWohnung(name)) {
      h.textContent = `Wohnungsordner bitte nicht von Hand anlegen: Sie entstehen${wo ? ` unter „${ordnerTeil(wo.teil)}“` : ""} automatisch, sobald etwas für eine Mietpartei abgelegt wird. Wohnungen und Mietparteien legt man unter Mieter → „Häuser & Wohnungen“ an.`;
      h.className = "feldhinweis feldhinweis--warn";
    } else if (eltern?.automatik === "wohnung") {
      h.textContent = `In „${ordnerTeil(eltern.teil)}“ entstehen die Wohnungsordner automatisch. Hier nur Ordner anlegen, die in jedem Haus gleich sind (z. B. Auszüge).`;
      h.className = "feldhinweis";
    } else {
      h.textContent = name ? `Wird angelegt als: ${ordnerAnzeige((eltern ? voll(eltern) + "/" : "") + name)} (in jedem Haus)` : "Gilt für alle Häuser.";
      h.className = "feldhinweis feldhinweis--leise";
    }
  };
  const hinzufuegen = () => {
    const form = formular;
    const feld = $("[data-neu-name]", form);
    const teil = ordnerTeil(feld.value);
    const elternKey = $("[data-neu-eltern]", form).value || null;
    if (!teil) { feld.focus(); return neuHinweis("Bitte zuerst einen Namen eingeben.", "feldhinweis--warn"); }
    const name = (elternKey ? voll(nachKey(elternKey)) + "/" : "") + teil;
    const vorhanden = liste.filter((x) => !x.weg).map((x) => voll(x).toLowerCase());
    if (vorhanden.includes(name.toLowerCase()) || name.toLowerCase() === "sonstiges") {
      return neuHinweis(`„${ordnerAnzeige(name)}“ gibt es schon.`, "feldhinweis--warn");
    }
    const x = { key: `k${zaehler++}`, id: null, alt: null, teil, eltern: elternKey, automatik: null, vorher: null, weg: false, neu: true, zahl: 0 };
    // hinter dem letzten Unterordner des Eltern-Ordners einsortieren
    const letzte = elternKey ? [nachKey(elternKey), ...nachkommen(elternKey)].at(-1) : null;
    if (letzte) liste.splice(liste.indexOf(letzte) + 1, 0, x); else liste.push(x);
    feld.value = "";
    zeichne(x.key);
    neuHinweis(`„${ordnerAnzeige(name)}“ ist vorgemerkt. Mit „Speichern“ übernehmen.`, "feldhinweis--ok");
    feld.focus();
  };

  const daten = await dialogFormular(`
    ${allgemein
      ? `<h2>Ordner unter „Allgemein“</h2>
    <p class="leise">Hier gibt es keine Vorgabe: Lege die Ordner an, die du brauchst. Sie gelten <strong>nur unter Allgemein</strong>, nicht in den Häusern.</p>`
      : `<h2>Ordner der Ablage</h2>
    <p class="leise">Diese Ordner gibt es in <strong>jedem Haus</strong> gleich. Die KI legt Dateien nur hier ab.</p>`}
    <fieldset class="ordner-neu">
      <legend>Neuen Ordner anlegen</legend>
      <div class="ordner-neu__zeile">
        <label class="feld"><span>Name</span><input data-neu-name maxlength="60" placeholder="z. B. Kautionen" autocomplete="off"></label>
        <label class="feld"><span>Einsortieren in</span><select data-neu-eltern></select></label>
        <button type="button" class="knopf" data-neu-hinzu>Hinzufügen</button>
      </div>
      <p class="feldhinweis feldhinweis--leise" data-neu-hinweis></p>
    </fieldset>
    <h3 class="ordner-titel">Vorhandene Ordner</h3>
    <div class="ozliste"></div>
    <p class="leise">Umbenennen: einfach den Namen ändern. Unterordner wandern beim Verschieben und Umbenennen mit, Dokumente auch.</p>
    <p class="oz-fehler" data-fehler role="alert" hidden></p>
    <div class="knopfreihe">
      <button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button>
      <button class="knopf knopf--primaer" value="ok">Speichern</button>
    </div>`, {
    breit: true,
    vorbereiten: (form) => {
      formular = form;
      zeichne();
      const neuName = $("[data-neu-name]", form);
      neuName.addEventListener("input", () => neuHinweis());
      neuName.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); hinzufuegen(); } });
      $("[data-neu-eltern]", form).addEventListener("change", () => neuHinweis());
      $("[data-neu-hinzu]", form).addEventListener("click", hinzufuegen);
      const ozliste = $(".ozliste", form);
      ozliste.addEventListener("input", (e) => {
        const x = nachKey(e.target.closest(".oz")?.dataset.key);
        if (x && e.target.classList.contains("oz__name")) x.teil = e.target.value;
      });
      ozliste.addEventListener("change", (e) => {
        const x = nachKey(e.target.closest(".oz")?.dataset.key);
        if (!x) return;
        if (e.target.classList.contains("oz__auto")) { x.automatik = e.target.value || null; zeichne(x.key); }
        if (e.target.classList.contains("oz__name")) { warnungNeu(x); auswahlNeu(); }
      });
      // Enter im Namensfeld soll nicht den Dialog schließen
      ozliste.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && e.target.classList.contains("oz__name")) { e.preventDefault(); e.target.blur(); }
      });
      ozliste.addEventListener("click", (e) => {
        const x = nachKey(e.target.closest(".oz")?.dataset.key);
        if (!x) return;
        if (e.target.closest("[data-unter]")) {
          $("[data-neu-eltern]", form).value = x.key;
          neuHinweis();
          $(".ordner-neu", form).scrollIntoView({ block: "nearest" });
          neuName.focus();
          return;
        }
        const schritt = e.target.closest("[data-schritt]");
        if (schritt) {
          const geschwister = kinder(x.eltern);
          const i = geschwister.indexOf(x), j = i + Number(schritt.dataset.schritt);
          if (j < 0 || j >= geschwister.length) return;
          const a = liste.indexOf(x), b = liste.indexOf(geschwister[j]);
          [liste[a], liste[b]] = [liste[b], liste[a]];
          zeichne(x.key);
          $(`.oz[data-key="${x.key}"] [data-schritt="${schritt.dataset.schritt}"]`, form)?.focus();
          return;
        }
        if (e.target.closest("[data-weg]")) {
          if (x.neu) {
            for (const y of [x, ...nachkommen(x.key)]) liste.splice(liste.indexOf(y), 1);
          } else {
            const weg = !x.weg;
            for (const y of [x, ...nachkommen(x.key)]) y.weg = weg;
          }
          zeichne(x.key);
        }
      });
      // Vor dem Schließen prüfen, damit nichts verloren geht
      form.addEventListener("submit", (e) => {
        if (e.submitter?.value !== "ok") return;
        const aktiv = baum(null, 0, true).map(({ x }) => x);
        const namen = aktiv.map(voll);
        let fehler = "";
        if (aktiv.some((x) => !ordnerTeil(x.teil))) fehler = "Bitte keinen Ordner ohne Namen speichern.";
        else if (namen.some((n) => n.toLowerCase() === "sonstiges")) fehler = "„Sonstiges“ gibt es schon.";
        else if (new Set(namen.map((n) => n.toLowerCase())).size !== namen.length) fehler = "Jeder Ordnername darf nur einmal vorkommen (innerhalb desselben Ordners).";
        const feldFehler = $("[data-fehler]", form);
        feldFehler.textContent = fehler;
        feldFehler.hidden = !fehler;
        if (fehler) { e.preventDefault(); return; }
        ergebnis = aktiv.map((x, i) => ({ ...x, name: voll(x), reihenfolge: (i + 1) * 10 }));
      });
    },
  });
  if (!daten || !ergebnis) return;
  const bleiben = ergebnis.filter((o) => !o.neu);
  const neue = ergebnis.filter((o) => o.neu);
  const loeschen = liste.filter((o) => o.weg && !o.neu);
  const betroffen = loeschen.reduce((s, o) => s + o.zahl, 0);
  if (betroffen && !(await frage("Ordner löschen?",
    `<p>${betroffen} ${betroffen === 1 ? "Dokument liegt" : "Dokumente liegen"} in ${loeschen.length === 1 ? "diesem Ordner" : "diesen Ordnern"}.
      Sie werden nach „Sonstiges“ verschoben, nichts wird gelöscht.</p>`, "Löschen und verschieben"))) return;
  const warte = wartehinweis("Ordner werden gespeichert …");
  try {
    for (const o of loeschen) {
      await db.verschiebeDokumente(o.alt, "Sonstiges", { flach: true, ausser: bleiben.map((x) => x.alt), allgemein });
      await db.loescheDokumentOrdner(o.id);
    }
    // Erst die Oberordner (kürzere Namen), damit Unterordner-Dokumente nicht doppelt verschoben werden
    for (const o of [...bleiben].sort((a, b) => a.alt.length - b.alt.length)) {
      const felder = { name: o.name, reihenfolge: o.reihenfolge };
      if (o.automatik !== o.vorher) felder.automatik = o.automatik || null;
      await db.speichereDokumentOrdner(o.id, felder);
      if (o.name !== o.alt) await db.verschiebeDokumente(o.alt, o.name, { allgemein });
    }
    for (const o of neue) {
      await db.speichereDokumentOrdner(null, { name: o.name, reihenfolge: o.reihenfolge, bereich, ...(o.automatik && !allgemein ? { automatik: o.automatik } : {}) });
    }
    await ordnerListe(true);
    melde("Ordner gespeichert.", "ok");
  } catch (err) {
    melde(/duplicate|unique/i.test(err.message) ? "Diesen Ordnernamen gibt es schon." : err.message, "fehler");
  } finally {
    await warte.ende();
  }
  nachher();
}

// ---------------------------------------------------------------------------
// Ablage als ZIP herunterladen (je Haus oder alles), mit Ordnern und sauberen Namen
// objektId: Haus-ID, null = Allgemein, undefined = alle Häuser
// ---------------------------------------------------------------------------
export async function zipExport({ objektId } = {}) {
  if (!window.JSZip) return melde("ZIP ist in diesem Browser nicht verfügbar.", "fehler");
  const alle = objektId === undefined;
  const docs = await db.ladeDokumente(alle ? {} : { objektId }).catch((err) => { melde(err.message, "fehler"); return null; });
  if (!docs) return;
  if (!docs.length) return melde("Hier liegen noch keine Dokumente.", "info");
  const warte = wartehinweis(`Lade ${docs.length} Dokumente …`);
  const text = $("#dialog .warten p");
  const zip = new window.JSZip();
  const vergeben = new Set();
  const fehlen = [];
  const csv = [["Pfad im ZIP", "Name", "Haus", "Ordner", "Art", "Datum", "Absender", "Zusammenfassung"]];
  const teil = (s) => sichererDateiname(s).replace(/\.+$/, "");
  try {
    for (const [i, d] of docs.entries()) {
      if (text) text.textContent = `Lade Dokument ${i + 1} von ${docs.length} …`;
      const haus = d.objekt_id ? objektVon(d.objekt_id)?.bezeichnung || "Haus" : "Allgemein";
      const ordner = String(d.ordner || "Sonstiges").split("/").map(teil).join("/");
      let pfad = `${alle ? teil(haus) + "/" : ""}${ordner}/${teil(d.titel)}`;
      let name = `${pfad}.${endungVon(d)}`;
      for (let n = 2; vergeben.has(name.toLowerCase()); n++) name = `${pfad}_${n}.${endungVon(d)}`;
      vergeben.add(name.toLowerCase());
      try {
        zip.file(name, await db.ladeDokumentDatei(d.pfad));
        csv.push([name, d.titel, haus, d.ordner, d.art || "", d.datum || "", d.absender || "", d.zusammenfassung || ""]);
      } catch {
        fehlen.push(d.titel);
      }
    }
    const zelle = (v) => `"${String(v).replace(/"/g, '""')}"`;
    zip.file("Inhaltsverzeichnis.csv", "﻿" + csv.map((z) => z.map(zelle).join(";")).join("\r\n"));
    if (fehlen.length) zip.file("Nicht geladen.txt", fehlen.join("\r\n"));
    if (text) text.textContent = "Packe das ZIP …";
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
    const wofuer = alle ? "Alle" : objektId ? objektKurz(objektVon(objektId)) : "Allgemein";
    herunterladen(blob, `${heuteISO()}_Ablage_${wofuer}.zip`, "application/zip");
    melde(fehlen.length ? `ZIP erstellt, ${fehlen.length} Datei(en) fehlten.` : "ZIP erstellt.", fehlen.length ? "info" : "ok");
  } catch (err) {
    melde("ZIP fehlgeschlagen: " + err.message, "fehler");
  } finally {
    await warte.ende();
  }
}

// ---------------------------------------------------------------------------
// Aus der App ablegen: E-Mails, Notizen und Gesendetes landen als Dokument in der Ablage
// Ein Eintrag beschreibt, was abgelegt wird:
// {
//   quelle: { nachricht_id?, antwort_id?, aufgabe_id?, vorgang_id? },  Verknüpfung (zeigt „In der Ablage“)
//   richtung: "eingang" | "ausgang" | "notiz",
//   art: "E-Mail" | "Brief" | "Auftrag" | "Notiz" …,  artFest: true = Art nicht von der KI ändern lassen
//   datum, objektId, mieterId,
//   gegenueber: voller Name (Absender bzw. Empfänger), gegenueberKurz: fester Kurzname (z. B. Nachname)
//   kiText: { titel, text },          was die KI für den Ordner-Vorschlag sieht (ohne IBAN, das prüft auch der Server)
//   zusammenfassung,
//   datei: async () => ({ blob, typ }), die Datei (PDF aus Text oder das Word-Schreiben)
//   anhaenge: [{ name, typ, pfad }],  Anhänge im Bucket „eingang“ (nur beim Ablegen von Hand wählbar)
//   beschreibung: kurzer Text im Dialog, z. B. „Die E-Mail wird als PDF abgelegt.“
// }
// ---------------------------------------------------------------------------
function ordnerOhneKi(liste, e) {
  const finde = (re) => liste.find((o) => re.test(o));
  if (e.art === "Auftrag") return finde(/instandhalt|handwerk|auftr/i) || "Sonstiges";
  if (e.mieterId) return finde(/vermietung|mietverh|mieter/i) || "Sonstiges";
  return "Sonstiges";
}

async function vorschlagFuer(e) {
  await ordnerListe();
  const liste = ordnerFuer(e.objektId || null); // ohne Haus: nur die Ordner unter „Allgemein“
  const ersatz = { ordner: ordnerOhneKi(liste, e), art: e.art || "Sonstiges", gegenueber_kurz: null, zusammenfassung: "", vonKi: false };
  if (!zustand.ki?.ki) return ersatz;
  try {
    const r = await db.funktion("ki", {
      aktion: "ablage_vorschlag", titel: e.kiText?.titel || "", text: e.kiText?.text || "", richtung: e.richtung, art: e.art || null,
      gegenueber: e.gegenueber || null, mieter_id: e.mieterId || null, objekt_id: e.objektId || null,
    });
    return {
      ordner: liste.includes(r.ordner) ? r.ordner : ersatz.ordner,
      art: e.artFest ? e.art : DOKUMENT_ARTEN.includes(r.art) ? r.art : ersatz.art,
      gegenueber_kurz: r.gegenueber_kurz || null,
      thema: r.thema || null,
      betrag: r.betrag || null,
      wohnung_id: r.wohnung_id || null,
      zusammenfassung: r.zusammenfassung || "",
      vonKi: true,
    };
  } catch {
    return ersatz;
  }
}

const kurzName = (e, v) => String(e.gegenueberKurz || v.gegenueber_kurz || e.gegenueber || "").trim().slice(0, 40);
// e.thema: fester Titel aus der App (z. B. eine Liste aus dem Chat) hat Vorrang vor dem Thema der KI
const kiTeileVon = (e, v) => ({ thema: e.thema || v.thema || null, firma: kurzName(e, v) || null, betrag: v.betrag || null, wohnungId: v.wohnung_id || null });

async function legeEintragAb(e, f) {
  const { blob, typ } = await e.datei();
  const objekt_id = f.objekt_id || null;
  return db.legeDokumentAb({
    objekt_id,
    mieter_id: f.mieter_id || null,
    nachricht_id: e.quelle?.nachricht_id || null,
    antwort_id: e.quelle?.antwort_id || null,
    aufgabe_id: e.quelle?.aufgabe_id || null,
    vorgang_id: e.quelle?.vorgang_id || null,
    verlauf_id: e.quelle?.verlauf_id || null,
    ordner: f.ordner,
    art: f.art || null,
    absender: f.absender || null,
    details: f.details || null,
    datum: f.datum || null,
    titel: f.titel,
    zusammenfassung: f.zusammenfassung || null,
    pfad: `${objekt_id || "allgemein"}/${crypto.randomUUID()}.${ENDUNG[typ] || "pdf"}`,
    typ, groesse: blob.size,
  }, blob);
}

// Anhänge einer Nachricht (Bucket „eingang“) als eigene Dokumente in denselben Ordner kopieren
async function legeAnhaengeAb(e, f, haupt) {
  let fehler = 0;
  for (const [i, a] of (e.anhaenge || []).filter((x) => x.pfad).entries()) {
    try {
      const roh = await db.ladeEingangDatei(a.pfad);
      const typ = ENDUNG[a.typ] ? a.typ : ENDUNG[roh.type] ? roh.type : null;
      if (!typ) { fehler++; continue; }
      await legeEintragAb({ ...e, datei: async () => ({ blob: new Blob([roh], { type: typ }), typ }) }, {
        ...f, titel: `${f.titel}_Anlage${i + 1}`.slice(0, 160),
        zusammenfassung: `Anlage „${a.name || "Datei"}“ zu ${haupt.titel}`.slice(0, 300),
      });
    } catch {
      fehler++;
    }
  }
  if (fehler) melde(`${fehler} Anhang/Anhänge konnten nicht abgelegt werden.`, "fehler");
}

/** Meldung „Abgelegt in …“ mit Knopf zum Ändern */
export function zeigeAblageMeldung(doc, { nachher = () => {} } = {}) {
  if (!doc) return;
  melde(`Abgelegt in „${ordnerAnzeige(doc.ordner)}“: ${doc.titel}`, "ok", {
    dauer: 12000,
    aktion: {
      text: "Ändern",
      beiKlick: () => {
        const dlg = $("#dialog");
        if (dlg.open) dlg.close();
        setTimeout(() => oeffneDokument(doc, { nachher }), 0);
      },
    },
  });
}

/**
 * Gesendetes automatisch ablegen (Name nach Schema, Ordner von der KI vorgeschlagen).
 * Abschaltbar in den Einstellungen. Liefert das Dokument oder null; Fehler stören den Versand nicht.
 */
/** Name, Ordner und Details nach Roberts Schema berechnen (Ordner, Thema, Betrag, Wohnung schlägt die KI vor) */
export async function nameVorschlag(e) {
  const [v] = await Promise.all([vorschlagFuer(e), zustand.mieterKurz ? null : mieterListe().catch(() => null)]);
  const datum = e.datum || heuteISO();
  const ki = kiTeileVon(e, v);
  const details = detailsVorschlag({ mieterId: e.mieterId, art: v.art, ki, objektId: e.objektId || null });
  return {
    v, datum, details, art: v.art, vonKi: v.vonKi,
    titel: dokumentTitel({ datum, objekt: objektVon(e.objektId), art: v.art, details }),
    ordner: zielOrdner(v.ordner, { datum, mieterId: e.mieterId, wohnungId: ki.wohnungId, objektId: e.objektId || null }),
  };
}

/**
 * Gesendetes automatisch ablegen (Name nach Schema, Ordner von der KI vorgeschlagen).
 * vorgabe: { aus, titel, vorschlag } aus dem Bestätigungsdialog (Name dort sichtbar und änderbar).
 * Abschaltbar in den Einstellungen. Liefert das Dokument oder null; Fehler stören den Versand nicht.
 */
export async function automatischAblegen(e, { meldung = true, nachher = () => {}, vorgabe = null, immer = false } = {}) {
  if ((!immer && zustand.profil?.auto_ablage === false) || vorgabe?.aus) return null;
  try {
    const r = await (vorgabe?.vorschlag || nameVorschlag(e));
    const doc = await legeEintragAb(e, {
      objekt_id: e.objektId, mieter_id: e.mieterId, ordner: r.ordner, art: r.art,
      absender: e.gegenueber || kurzName(e, r.v), details: r.details, datum: r.datum,
      titel: namensTeil(vorgabe?.titel || "") || r.titel,
      zusammenfassung: e.zusammenfassung || r.v.zusammenfassung,
    });
    if (meldung) zeigeAblageMeldung(doc, { nachher });
    return doc;
  } catch (err) {
    melde("Gesendet, aber nicht abgelegt: " + err.message, "fehler");
    return null;
  }
}

// ---------------------------------------------------------------------------
// Dateiname im Bestätigungsdialog: sichtbar und änderbar, die KI füllt ihn vor
// ---------------------------------------------------------------------------
export function ablageBlockHtml({ titel = "Wird abgelegt als", immer = false } = {}) {
  if (!immer && zustand.profil?.auto_ablage === false) return "";
  return `
    <div class="ablageblock" data-ablage>
      <label class="feld"><span>${esc(titel)}</span>
        <input name="ablage_titel" maxlength="160" spellcheck="false" autocomplete="off" placeholder="Die KI schlägt den Namen vor …">
        <span class="feldhinweis feldhinweis--leise" data-ablage-info>Name nach eurem Schema wird erstellt …</span></label>
      <label class="checkfeld checkfeld--klein"><input type="checkbox" name="ablage_an" checked> In der Ablage speichern</label>
    </div>`;
}
/** Füllt den Namen, sobald der Vorschlag da ist (außer Robert hat schon selbst getippt). Liefert die Vorschlags-Promise. */
export function verbindeAblageBlock(form, e) {
  const feld = $("[name=ablage_titel]", form);
  if (!feld) return null;
  let vonHand = false;
  feld.addEventListener("input", () => { vonHand = true; });
  const vorschlag = nameVorschlag(e);
  vorschlag.then((r) => {
    if (!vonHand) feld.value = r.titel;
    const info = $("[data-ablage-info]", form);
    if (info) info.textContent = `Ordner: ${ordnerAnzeige(r.ordner)}${r.vonKi ? " · Vorschlag der KI, änderbar" : ""}`;
  }).catch(() => {
    const info = $("[data-ablage-info]", form);
    if (info) info.textContent = "Kein Vorschlag möglich, bitte selbst benennen.";
  });
  return vorschlag;
}
export function ablageVorgabe(daten, vorschlag) {
  if (!vorschlag) return { aus: true };
  return { aus: !daten.get("ablage_an"), titel: String(daten.get("ablage_titel") || "").trim() || null, vorschlag };
}
/** Rückfrage (wie frage()) mit Dateiname-Feld; liefert null bei Abbruch, sonst { vorgabe } */
export async function frageMitAblage(titel, html, jaText, e) {
  let vorschlag = null;
  const daten = await dialogFormular(`
    <h2>${esc(titel)}</h2>
    ${html}
    ${ablageBlockHtml()}
    <div class="knopfreihe">
      <button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button>
      <button class="knopf knopf--primaer" value="ok">${esc(jaText)}</button>
    </div>`, { breit: true, vorbereiten: (form) => { vorschlag = verbindeAblageBlock(form, e); } });
  if (!daten) return null;
  return { vorgabe: ablageVorgabe(daten, vorschlag) };
}

/** Von Hand ablegen: Dialog mit Vorschlag (Ordner von der KI, Name nach Schema) */
export async function inAblageDialog(e, { nachher = () => {}, schon = [] } = {}) {
  const warte = zustand.ki?.ki ? wartehinweis("Die KI sucht den passenden Ordner …") : null;
  let v, mieterL, ordnerL;
  try {
    [v, mieterL, ordnerL] = await Promise.all([vorschlagFuer(e), mieterListe(), ordnerListe()]);
  } finally {
    await warte?.ende();
  }
  const mitAnhang = (e.anhaenge || []).filter((a) => a.pfad);
  const datum = e.datum || heuteISO();
  const daten = await dialogFormular(`
    <h2>In die Ablage</h2>
    ${e.beschreibung ? `<p class="leise">${esc(e.beschreibung)}</p>` : ""}
    ${schon.length ? `<p class="leise">Schon abgelegt als „${esc(schon[0].titel)}“ (${esc(ordnerAnzeige(schon[0].ordner))}). Es kommt eine weitere Fassung dazu.</p>` : ""}
    <div class="formraster formraster--zwei">
      <label class="feld"><span>Ordner</span><select name="ordner" data-wunsch="${esc(v.ordner || "")}">${ordnerOptionen(ordnerFuer(e.objektId || null), passenderOrdner(v.ordner, e.objektId || null))}</select>
        ${v.vonKi ? `<span class="feldhinweis">Vorschlag der KI</span>` : ""}
        <span class="feldhinweis feldhinweis--leise" data-zielordner></span></label>
      <label class="feld"><span>Haus</span><select name="objekt_id">${hausOptionen(e.objektId || null)}</select></label>
      <label class="feld"><span>Mietpartei (optional)</span><select name="mieter_id">${mieterOptionen(mieterL, e.mieterId || null)}</select>
        <span class="feldhinweis feldhinweis--warn" data-mieter-hinweis></span></label>
      <label class="feld"><span>Art</span><select name="art">${optionen(DOKUMENT_ARTEN, v.art)}</select></label>
      <label class="feld"><span>Details (für den Namen)</span>
        <input name="details" value="${esc(detailsVorschlag({ mieterId: e.mieterId, art: v.art, ki: kiTeileVon(e, v) }))}" maxlength="80"></label>
      <label class="feld"><span>Datum</span><input type="date" name="datum" value="${esc(datum)}" required></label>
    </div>
    <label class="feld"><span>Dateiname</span><input name="titel" required maxlength="160" spellcheck="false"></label>
    <label class="feld"><span>Kurz zusammengefasst</span><textarea name="zusammenfassung" rows="2">${esc(e.zusammenfassung || v.zusammenfassung || "")}</textarea></label>
    ${mitAnhang.length ? `<label class="checkfeld"><input type="checkbox" name="anhaenge" checked> Anhänge mit ablegen (${mitAnhang.length}: ${esc(mitAnhang.map((a) => a.name || "Datei").join(", "))})</label>` : ""}
    <div class="knopfreihe">
      <button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button>
      <button class="knopf knopf--primaer" value="ok">Ablegen</button>
    </div>`, { breit: true, vorbereiten: (form) => verbindeNamen(form, { ki: kiTeileVon(e, v) }) });
  if (!daten) return null;
  const f = {
    objekt_id: daten.get("objekt_id") || null,
    mieter_id: daten.get("mieter_id") || null,
    ordner: zielOrdner(daten.get("ordner"), { datum: daten.get("datum"), mieterId: daten.get("mieter_id") || null, wohnungId: v.wohnung_id || null, objektId: daten.get("objekt_id") || null }),
    art: daten.get("art"),
    absender: e.gegenueber || kurzName(e, v) || null,
    details: String(daten.get("details") || "").trim() || null,
    datum: daten.get("datum") || null,
    titel: String(daten.get("titel") || "").trim(),
    zusammenfassung: String(daten.get("zusammenfassung") || "").trim() || null,
  };
  const warte2 = wartehinweis("Wird abgelegt …");
  try {
    const doc = await legeEintragAb(e, f);
    if (daten.get("anhaenge")) await legeAnhaengeAb(e, f, doc);
    await warte2.ende();
    zeigeAblageMeldung(doc, { nachher });
    nachher();
    return doc;
  } catch (err) {
    await warte2.ende();
    melde("Ablegen nicht möglich: " + err.message, "fehler");
    return null;
  }
}

/** Kleiner Hinweis „In der Ablage: Ordner · Name“ (Klick öffnet das Dokument) */
export function abgelegtHtml(docs) {
  if (!docs?.length) return "";
  const d = docs[0];
  return `<span class="abgelegt">In der Ablage: <button type="button" data-abgelegt="${esc(d.id)}">${esc(ordnerAnzeige(d.ordner))} · ${esc(d.titel)}</button>${docs.length > 1 ? ` <span>+${docs.length - 1}</span>` : ""}</span>`;
}
export function verbindeAbgelegt(root, docs, { nachher = () => {} } = {}) {
  for (const b of $$("[data-abgelegt]", root)) b.addEventListener("click", () => oeffneDokument(docs.find((d) => d.id === b.dataset.abgelegt), { nachher }));
}

/** PDF aus Text bauen (für E-Mails, Aufträge, Notizen) */
export function pdfEintrag({ titel, angaben, text, abschnitte, kopf, fuss = null }) {
  return async () => {
    const bytes = textPdf({
      kopf, titel, angaben, text, abschnitte,
      fuss: fuss || `Abgelegt am ${datumDE(new Date())} aus der Verwaltungs-App`,
    });
    return { blob: new Blob([bytes], { type: "application/pdf" }), typ: "application/pdf" };
  };
}
