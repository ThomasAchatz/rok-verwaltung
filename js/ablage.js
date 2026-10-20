// Ablage: Fotos/PDFs erfassen (ins Postfach oder als Dokument), Dokumente je Haus, Wissen, Handwerker
// Die KI liest und schlägt Ablage, Namen und Ordner vor. Abgelegt wird erst nach „Ablegen“.
import * as db from "./daten.js";
import { datumDE, mieterName } from "./dokumente.js";
import { $, $$, esc, melde, dialogFormular, frage, heuteISO, dateiTeil, herunterladen, zustand, objektVon, wohnungVon } from "./helfer.js";
import {
  ICON_KI, istEmail, norm, geheZu, mieterListe, mieterOptionen, mikroKnopf, verbindeDiktat, wartehinweis, verkleinere, alsBase64,
} from "./ui.js";
import { textPdf } from "./pdf.js";

export const DOKUMENT_ORDNER = [
  "Rechnungen", "Verträge", "Versorger", "Versicherungen", "Behörden & Steuern", "Handwerker & Angebote", "Mietverhältnisse", "Sonstiges",
];
export const DOKUMENT_ARTEN = ["Rechnung", "Vertrag", "Mietvertrag", "Kündigung", "Bescheid", "Abrechnung", "Angebot", "Mahnung", "Brief", "E-Mail", "Auftrag", "Protokoll", "Notiz", "Sonstiges"];
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

/** Aktuelle Ordnerliste der Ablage (aus der Datenbank, „Sonstiges“ immer dabei) */
export async function ordnerListe(neu = false) {
  if (!zustand.dokOrdner || neu) {
    try {
      zustand.dokOrdnerZeilen = await db.ladeDokumentOrdner();
      zustand.dokOrdnerAuto = new Map(zustand.dokOrdnerZeilen.filter((o) => o.automatik).map((o) => [o.name, o.automatik]));
      const namen = zustand.dokOrdnerZeilen.map((o) => o.name);
      zustand.dokOrdner = namen.length ? (namen.includes("Sonstiges") ? namen : [...namen, "Sonstiges"]) : DOKUMENT_ORDNER;
    } catch {
      zustand.dokOrdner = DOKUMENT_ORDNER;
    }
  }
  return zustand.dokOrdner;
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
export function detailsVorschlag({ mieterId = null, art = null, ki = {} } = {}) {
  const m = mieterVon(mieterId);
  const w = wohnungVon(m?.wohnung_id || ki.wohnungId || null);
  const name = m && !OHNE_MIETERNAME.includes(art) ? m.nachname : null;
  // Ohne Thema: bei Rechnungen u. Ä. die Firma, sonst nur, wenn sonst gar nichts im Namen stünde
  const vorne = ki.thema || (!name && (OHNE_MIETERNAME.includes(art) || !w) ? ki.firma : null);
  return [vorne, w?.bezeichnung, name, ki.betrag].map(namensTeil).filter(Boolean).join("_").slice(0, 80);
}

/** Automatische Unterordner: „je Jahr“ (Jahr des Dokuments) oder „je Wohnung“ (Wohnung - Nachname) */
export const ordnerAutomatik = (name) => zustand.dokOrdnerAuto?.get(name) || null;
export function zielOrdner(basis, { datum = null, mieterId = null, wohnungId = null } = {}) {
  const art = ordnerAutomatik(basis);
  if (art === "jahr") {
    const jahr = String(datum || heuteISO()).slice(0, 4);
    return /^\d{4}$/.test(jahr) ? `${basis}/${jahr}` : basis;
  }
  if (art !== "wohnung") return basis;
  const m = mieterVon(mieterId);
  const w = wohnungVon(m?.wohnung_id || wohnungId);
  const teil = [w?.bezeichnung, m?.nachname].filter(Boolean).join(" - ").replace(/\//g, "-").trim();
  return teil ? `${basis}/${teil}` : basis;
}

// Name nach dem Schema, bis Robert ihn selbst ändert; Details folgen der Mietpartei; Zielordner wird angezeigt
function verbindeNamen(bereich, { ki = {} } = {}) {
  const feld = (n) => $(`[name=${n}]`, bereich);
  const titel = feld("titel"), details = feld("details");
  let titelVonHand = false, detailsVonHand = false;
  const setze = () => {
    if (!titelVonHand) {
      titel.value = dokumentTitel({
        datum: feld("datum").value, objekt: objektVon(feld("objekt_id").value), art: feld("art").value, details: details.value,
      });
    }
    const hinweis = $("[data-zielordner]", bereich);
    if (hinweis && feld("ordner")) {
      const ziel = zielOrdner(feld("ordner").value, { datum: feld("datum").value, mieterId: feld("mieter_id")?.value || null, wohnungId: ki.wohnungId });
      hinweis.textContent = ziel !== feld("ordner").value ? `Landet in: ${ordnerAnzeige(ziel)}` : "";
    }
  };
  titel.addEventListener("input", () => { titelVonHand = true; });
  details.addEventListener("input", () => { detailsVonHand = true; setze(); });
  const neueDetails = () => {
    if (!detailsVonHand) details.value = detailsVorschlag({ mieterId: feld("mieter_id")?.value || null, art: feld("art").value, ki });
    setze();
  };
  feld("mieter_id")?.addEventListener("change", neueDetails);
  feld("art").addEventListener("change", neueDetails);
  for (const n of ["datum", "objekt_id", "ordner"]) feld(n)?.addEventListener("change", setze);
  setze();
}

async function istPdfDatei(datei) {
  const kopf = new Uint8Array(await datei.slice(0, 5).arrayBuffer());
  return String.fromCharCode(...kopf) === "%PDF-";
}

// ---------------------------------------------------------------------------
// Foto oder PDF erfassen
// objektId: Haus vorbelegen (null = Allgemein), nurAblage: kein Postfach (z. B. auf der Seite eines Hauses)
// ---------------------------------------------------------------------------
export async function erfasse(datei, { objektId, nurAblage = false } = {}) {
  if (!datei) return;
  if (datei.size > MAX_DATEI) return melde("Die Datei ist zu groß (höchstens 15 MB).", "fehler");
  const pdf = datei.type === "application/pdf" || /\.pdf$/i.test(datei.name || "");
  // Word/Excel vom Gerät: ohne KI, nur in die Ablage
  const office = /\.docx$/i.test(datei.name || "") || datei.type === DOCX_TYP ? DOCX_TYP
    : /\.xlsx$/i.test(datei.name || "") || datei.type === XLSX_TYP ? XLSX_TYP : null;
  if (office) nurAblage = true;
  if (!pdf && !office && !/^image\//.test(datei.type || "") && !/\.(jpe?g|png|webp|heic)$/i.test(datei.name || "")) {
    return melde("Dieses Dateiformat geht nicht. Möglich sind Fotos, PDF, Word (.docx) und Excel (.xlsx).", "fehler");
  }
  let blob, base64 = null, vorschau = null;
  try {
    if (office) {
      const kopf = new Uint8Array(await datei.slice(0, 2).arrayBuffer());
      if (kopf[0] !== 0x50 || kopf[1] !== 0x4b) return melde("Die Datei ist beschädigt oder kein echtes Word/Excel-Dokument.", "fehler");
      blob = new Blob([datei], { type: office });
    } else if (pdf) {
      if (!(await istPdfDatei(datei))) return melde("Das ist keine gültige PDF-Datei.", "fehler");
      blob = new Blob([datei], { type: "application/pdf" });
      if (blob.size <= MAX_PDF_KI) base64 = await alsBase64(blob);
    } else {
      const bild = await verkleinere(datei, 2000);
      ({ blob, base64 } = bild);
      vorschau = bild.url;
    }
  } catch (err) {
    return melde("Die Datei konnte nicht gelesen werden: " + err.message, "fehler");
  }

  let erkannt = {};
  if (zustand.ki?.ki && base64) {
    const warte = wartehinweis(pdf ? "Die KI liest das PDF …" : "Die KI liest das Foto …");
    try {
      erkannt = await db.funktion("ki", { aktion: "brief_lesen", bild: { daten: base64, typ: pdf ? "application/pdf" : "image/jpeg" } });
      if (erkannt.lesbar === false) melde("Schwer lesbar. Bitte die Angaben prüfen.", "info");
    } catch (err) {
      melde(err.message, "fehler");
    } finally {
      await warte.ende();
    }
  } else if (zustand.ki?.ki && pdf) {
    melde("Das PDF ist zu groß für die KI. Bitte die Angaben selbst eintragen.", "info");
  }

  const [mieterL, ordnerL] = await Promise.all([mieterListe(), ordnerListe()]);
  const ziel = nurAblage ? "dokument" : erkannt.eingang === "anfrage" ? "anfrage" : erkannt.eingang ? "dokument" : "anfrage";
  const hausStart = objektId !== undefined ? objektId : erkannt.objekt_id || null;
  const datumStart = erkannt.datum || heuteISO();
  const absenderStart = erkannt.absender_kurz || erkannt.absender_name || "";
  const kiTeile = { thema: erkannt.thema || null, firma: absenderStart || null, betrag: erkannt.betrag || null, wohnungId: erkannt.wohnung_id || null };
  const [symbol, symbolKlasse] = symbolVon(office || (pdf ? "application/pdf" : "image/jpeg"));
  const artStart = erkannt.art || "Sonstiges";
  const name = norm(erkannt.absender_name);
  const mieterVermutet = erkannt.mieter_id ||
    (name ? mieterL.find((m) => name.includes(norm(m.nachname)) && (!m.vorname || name.includes(norm(m.vorname))))?.id : null) || null;

  const daten = await dialogFormular(`
    <h2>${office ? "Datei ablegen" : pdf ? "PDF erfassen" : "Foto erfassen"}</h2>
    ${vorschau ? `<img class="fotovorschau" src="${vorschau}" alt="Vorschau">` : `<p class="dateizeile"><span class="dok__icon ${symbolKlasse}">${symbol}</span> ${esc(datei.name || "Dokument")} <span class="leise">(${(blob.size / 1048576).toFixed(1).replace(".", ",")} MB)</span></p>`}
    <p class="leise">${erkannt.betreff ? "Von der KI gelesen. Bitte kurz prüfen." : office ? "Word- und Excel-Dateien liest die KI nicht. Bitte die Angaben eintragen." : zustand.ki?.ki ? "Bitte die Angaben eintragen." : "Die KI ist noch nicht eingerichtet. Bitte die Angaben selbst eintragen."}</p>
    ${nurAblage ? "" : `
    <div class="wahl" role="radiogroup" aria-label="Wohin damit?">
      <label><input type="radio" name="ziel" value="anfrage" ${ziel === "anfrage" ? "checked" : ""}> <span><strong>Ins Postfach</strong><br><span class="leise">Jemand will etwas, braucht eine Antwort</span></span></label>
      <label><input type="radio" name="ziel" value="dokument" ${ziel === "dokument" ? "checked" : ""}> <span><strong>In die Ablage</strong><br><span class="leise">Rechnung, Vertrag, Bescheid …</span></span></label>
    </div>`}
    <fieldset class="gruppe" data-ziel="dokument">
      <div class="formraster formraster--zwei">
        <label class="feld"><span>Haus</span><select name="objekt_id">${hausOptionen(hausStart)}</select></label>
        <label class="feld"><span>Mietpartei (optional)</span><select name="mieter_id">${mieterOptionen(mieterL, erkannt.mieter_id || null)}</select></label>
        <label class="feld"><span>Ordner</span><select name="ordner">${ordnerOptionen(ordnerL, ordnerL.includes(erkannt.ordner) ? erkannt.ordner : "Sonstiges")}</select>
          <span class="feldhinweis feldhinweis--leise" data-zielordner></span></label>
        <label class="feld"><span>Art</span><select name="art">${optionen(DOKUMENT_ARTEN, artStart)}</select></label>
        <label class="feld"><span>Details (für den Namen)</span><input name="details" value="${esc(detailsVorschlag({ mieterId: erkannt.mieter_id || null, art: artStart, ki: kiTeile }))}" maxlength="80" placeholder="z. B. Wasserschaden_WHG 1_2430,31"></label>
        <label class="feld"><span>Datum des Schreibens</span><input type="date" name="datum" value="${esc(datumStart)}" required></label>
      </div>
      <label class="feld"><span>Dateiname</span><input name="titel" required maxlength="160" spellcheck="false"></label>
      <label class="feld"><span>Kurz zusammengefasst</span><textarea name="zusammenfassung" rows="2">${esc(erkannt.zusammenfassung || "")}</textarea></label>
    </fieldset>
    ${nurAblage ? "" : `
    <fieldset class="gruppe" data-ziel="anfrage">
      <label class="feld"><span>Absender</span><input name="absender_voll" value="${esc(erkannt.absender_name || "")}"></label>
      <label class="feld"><span>Mietpartei</span><select name="mieter_id">${mieterOptionen(mieterL, mieterVermutet)}</select></label>
      <label class="feld"><span>Betreff</span><input name="betreff" required value="${esc(erkannt.betreff || "")}"></label>
      <label class="feld"><span>Text</span>
        <span class="diktat"><textarea name="text" rows="7">${esc(erkannt.text || "")}</textarea>${mikroKnopf()}</span></label>
    </fieldset>`}
    <div class="knopfreihe">
      <button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button>
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
  if (!daten) return;

  const typ = office || (pdf ? "application/pdf" : "image/jpeg");
  const endung = ENDUNG[typ];
  if (nurAblage || daten.get("ziel") === "dokument") {
    const objekt_id = daten.get("objekt_id") || null;
    try {
      await db.legeDokumentAb({
        objekt_id,
        mieter_id: daten.get("mieter_id") || null,
        ordner: zielOrdner(daten.get("ordner"), { datum: daten.get("datum"), mieterId: daten.get("mieter_id") || null, wohnungId: kiTeile.wohnungId }),
        art: daten.get("art"),
        absender: erkannt.absender_name || erkannt.absender_kurz || null,
        details: String(daten.get("details") || "").trim() || null,
        datum: daten.get("datum") || null,
        titel: String(daten.get("titel") || "").trim(),
        zusammenfassung: String(daten.get("zusammenfassung") || "").trim() || null,
        pfad: `${objekt_id || "allgemein"}/${crypto.randomUUID()}.${endung}`,
        typ, groesse: blob.size,
      }, blob);
      melde("Abgelegt.", "ok");
      geheZu(`#/objekt/${objekt_id || "allgemein"}`);
    } catch (err) {
      melde(err.message, "fehler");
    }
    return;
  }

  // Ins Postfach
  const m = mieterL.find((x) => x.id === daten.get("mieter_id"));
  try {
    const n = await db.neueNachricht({
      quelle: "brief",
      status: "offen",
      absender_name: String(daten.get("absender_voll") || "").trim() || (m ? mieterName(m) : null),
      absender_email: istEmail(erkannt.absender_email) ? erkannt.absender_email : m?.email || null,
      mieter_id: m?.id || null,
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
    geheZu(`#/postfach/${n.id}`);
  } catch (err) {
    melde(err.message, "fehler");
  }
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

export function dokumentListe(liste, { leer = "Keine Dokumente." } = {}) {
  if (!liste.length) return `<div class="leer">${esc(leer)}</div>`;
  return nachOrdner(liste, zustand.dokOrdner || DOKUMENT_ORDNER, { unbekannteBehalten: true }).map(([ordner, l]) => `
    <div class="ordner"><h3 class="ordner__titel">${esc(ordnerAnzeige(ordner))} <span class="leise">${l.length}</span></h3>
      ${l.map((d) => `
        <button type="button" class="dok" data-dok="${esc(d.id)}">
          <span class="dok__icon ${symbolVon(d.typ)[1]}">${symbolVon(d.typ)[0]}</span>
          <span class="dok__text"><span class="dok__titel">${esc(d.titel).replace(/_/g, "_<wbr>")}</span>
            <span class="leise">${esc([d.datum ? datumDE(d.datum) : "", d.art, d.zusammenfassung].filter(Boolean).join(" · "))}</span></span>
        </button>`).join("")}
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
        <label class="feld"><span>Ordner</span><select name="ordner">${ordnerOptionen(ordnerL, d.ordner)}</select></label>
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
          : zielOrdner(daten.get("ordner"), { datum: daten.get("datum") || d.datum, mieterId: daten.get("mieter_id") || null }),
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
  try {
    if (daten.get("_aktion") === "loeschen") {
      if (!(await frage("Löschen?", `<p>„${esc(d.name)}“ wird aus der Liste gelöscht.</p>`, "Löschen", { gefahr: true }))) return;
      await db.loescheDienstleister(d.id);
      melde("Gelöscht.", "ok");
    } else {
      const email = String(daten.get("email") || "").trim();
      if (email && !istEmail(email)) return melde("Die E-Mail-Adresse sieht nicht richtig aus.", "fehler");
      await db.speichereDienstleister(d.id, {
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
    nachher();
  } catch (err) {
    melde(err.message, "fehler");
  }
}

// ---------------------------------------------------------------------------
// Ordner der Ablage bearbeiten (gilt für alle Häuser)
// ---------------------------------------------------------------------------
const ordnerName = (s) => String(s || "").split("/").map((t) => t.trim().replace(/\s+/g, " ")).filter(Boolean).join("/").slice(0, 80);

export async function ordnerBearbeiten({ nachher = () => {} } = {}) {
  await ordnerListe(true);
  const zeilen = (zustand.dokOrdnerZeilen || []).filter((o) => o.name !== "Sonstiges");
  const namenAlle = new Set((zustand.dokOrdnerZeilen || []).map((o) => o.name));
  const anzahl = {};
  // Dokumente in automatischen Unterordnern (z. B. „04_Betriebskosten/2026“) zählen beim Hauptordner mit
  for (const d of await db.ladeDokumente({}).catch(() => [])) {
    let k = d.ordner;
    while (k && !namenAlle.has(k) && k.includes("/")) k = k.slice(0, k.lastIndexOf("/"));
    anzahl[k] = (anzahl[k] || 0) + 1;
  }
  const zeile = (o) => `
    <div class="ordnerzeile ${o.name.includes("/") ? "ordnerzeile--unter" : ""}" data-id="${esc(o.id)}" data-alt="${esc(o.name)}">
      <input value="${esc(o.name)}" maxlength="80" aria-label="Ordnername" autocomplete="off">
      <span class="leise ordnerzeile__zahl">${anzahl[o.name] ? `${anzahl[o.name]} Dok.` : ""}</span>
      <button type="button" class="knopf knopf--klein" data-schritt="-1" aria-label="Nach oben">↑</button>
      <button type="button" class="knopf knopf--klein" data-schritt="1" aria-label="Nach unten">↓</button>
      <button type="button" class="knopf knopf--klein knopf--gefahr" data-weg aria-label="Löschen">✕</button>
      <select class="ordnerzeile__auto" aria-label="Automatische Unterordner">
        <option value="">ohne automatische Unterordner</option>
        <option value="jahr" ${o.automatik === "jahr" ? "selected" : ""}>Unterordner je Jahr (z. B. 2026)</option>
        <option value="wohnung" ${o.automatik === "wohnung" ? "selected" : ""}>Unterordner je Wohnung (Wohnung - Name)</option>
      </select>
    </div>`;
  let ergebnis = null;
  const daten = await dialogFormular(`
    <h2>Ordner der Ablage</h2>
    <p class="leise">Gilt für alle Häuser. Unterordner mit „/“ schreiben, z. B. „07_Verträge/Strom“.
      Die KI wählt beim Ablegen aus genau dieser Liste. Ordner „je Jahr“ oder „je Wohnung“ bekommen ihre Unterordner automatisch.</p>
    <div class="ordnerliste">${zeilen.map(zeile).join("")}
      <div class="ordnerzeile ordnerzeile--fest"><input value="Sonstiges" readonly tabindex="-1" aria-label="Sonstiges (immer da)">
        <span class="leise ordnerzeile__zahl">${anzahl.Sonstiges ? `${anzahl.Sonstiges} Dok.` : ""}</span><span class="leise">immer da</span></div>
    </div>
    <label class="feld"><span>Neue Ordner (einer pro Zeile)</span><textarea name="neu" rows="2" placeholder="z. B. Versorger/Strom"></textarea></label>
    <div class="knopfreihe">
      <button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button>
      <button class="knopf knopf--primaer" value="ok">Speichern</button>
    </div>`, {
    breit: true,
    vorbereiten: (form) => {
      const liste = $(".ordnerliste", form);
      liste.addEventListener("click", (e) => {
        const z = e.target.closest(".ordnerzeile");
        if (!z) return;
        const schritt = e.target.closest("[data-schritt]");
        if (schritt) {
          const nachbar = schritt.dataset.schritt === "-1" ? z.previousElementSibling : z.nextElementSibling;
          if (nachbar && !nachbar.classList.contains("ordnerzeile--fest")) {
            schritt.dataset.schritt === "-1" ? nachbar.before(z) : nachbar.after(z);
          }
        }
        if (e.target.closest("[data-weg]")) {
          const weg = z.classList.toggle("ordnerzeile--weg");
          $("input", z).disabled = weg;
          e.target.closest("[data-weg]").textContent = weg ? "↺" : "✕";
          e.target.closest("[data-weg]").setAttribute("aria-label", weg ? "Doch behalten" : "Löschen");
        }
      });
      form.addEventListener("submit", () => {
        ergebnis = $$(".ordnerzeile[data-id]", form).map((z, i) => ({
          id: z.dataset.id, alt: z.dataset.alt, name: ordnerName($("input", z).value),
          weg: z.classList.contains("ordnerzeile--weg"), reihenfolge: (i + 1) * 10,
          automatik: $(".ordnerzeile__auto", z)?.value || null,
          vorher: zeilen.find((o) => o.id === z.dataset.id)?.automatik || null,
        }));
      });
    },
  });
  if (!daten || !ergebnis) return;
  const neue = String(daten.get("neu") || "").split(/\n+/).map(ordnerName).filter(Boolean);
  const bleiben = ergebnis.filter((o) => !o.weg);
  // Wird ein Oberordner umbenannt, wandern seine Unterordner mit (sofern sie nicht selbst geändert wurden)
  for (const o of bleiben.filter((x) => x.name !== x.alt)) {
    for (const u of bleiben) {
      if (u !== o && u.name === u.alt && u.alt.startsWith(o.alt + "/")) u.name = o.name + u.alt.slice(o.alt.length);
    }
  }
  const namen = [...bleiben.map((o) => o.name), ...neue];
  if (namen.some((n) => !n)) return melde("Bitte keinen Ordner ohne Namen speichern.", "fehler");
  if (namen.some((n) => n.toLowerCase() === "sonstiges")) return melde("„Sonstiges“ gibt es schon.", "fehler");
  if (new Set(namen.map((n) => n.toLowerCase())).size !== namen.length) return melde("Jeder Ordnername darf nur einmal vorkommen.", "fehler");
  const loeschen = ergebnis.filter((o) => o.weg);
  const betroffen = loeschen.reduce((s, o) => s + (anzahl[o.alt] || 0), 0);
  if (betroffen && !(await frage("Ordner löschen?",
    `<p>${betroffen} ${betroffen === 1 ? "Dokument liegt" : "Dokumente liegen"} in ${loeschen.length === 1 ? "diesem Ordner" : "diesen Ordnern"}.
      Sie werden nach „Sonstiges“ verschoben, nichts wird gelöscht.</p>`, "Löschen und verschieben"))) return;
  const warte = wartehinweis("Ordner werden gespeichert …");
  try {
    for (const o of loeschen) {
      await db.verschiebeDokumente(o.alt, "Sonstiges", { flach: true, ausser: bleiben.map((x) => x.alt) });
      await db.loescheDokumentOrdner(o.id);
    }
    // Erst die Oberordner (kürzere Namen), damit Unterordner-Dokumente nicht doppelt verschoben werden
    for (const o of [...bleiben].sort((a, b) => a.alt.length - b.alt.length)) {
      const felder = { name: o.name, reihenfolge: o.reihenfolge };
      if (o.automatik !== o.vorher) felder.automatik = o.automatik || null;
      await db.speichereDokumentOrdner(o.id, felder);
      if (o.name !== o.alt) await db.verschiebeDokumente(o.alt, o.name);
    }
    let r = (bleiben.length + 1) * 10;
    for (const n of neue) await db.speichereDokumentOrdner(null, { name: n, reihenfolge: (r += 10) });
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
  const liste = await ordnerListe();
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
const kiTeileVon = (e, v) => ({ thema: v.thema || null, firma: kurzName(e, v) || null, betrag: v.betrag || null, wohnungId: v.wohnung_id || null });

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
  const details = detailsVorschlag({ mieterId: e.mieterId, art: v.art, ki });
  return {
    v, datum, details, art: v.art, vonKi: v.vonKi,
    titel: dokumentTitel({ datum, objekt: objektVon(e.objektId), art: v.art, details }),
    ordner: zielOrdner(v.ordner, { datum, mieterId: e.mieterId, wohnungId: ki.wohnungId }),
  };
}

/**
 * Gesendetes automatisch ablegen (Name nach Schema, Ordner von der KI vorgeschlagen).
 * vorgabe: { aus, titel, vorschlag } aus dem Bestätigungsdialog (Name dort sichtbar und änderbar).
 * Abschaltbar in den Einstellungen. Liefert das Dokument oder null; Fehler stören den Versand nicht.
 */
export async function automatischAblegen(e, { meldung = true, nachher = () => {}, vorgabe = null } = {}) {
  if (zustand.profil?.auto_ablage === false || vorgabe?.aus) return null;
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
export function ablageBlockHtml({ titel = "Wird abgelegt als" } = {}) {
  if (zustand.profil?.auto_ablage === false) return "";
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
      <label class="feld"><span>Ordner</span><select name="ordner">${ordnerOptionen(ordnerL, v.ordner)}</select>
        ${v.vonKi ? `<span class="feldhinweis">Vorschlag der KI</span>` : ""}
        <span class="feldhinweis feldhinweis--leise" data-zielordner></span></label>
      <label class="feld"><span>Haus</span><select name="objekt_id">${hausOptionen(e.objektId || null)}</select></label>
      <label class="feld"><span>Mietpartei (optional)</span><select name="mieter_id">${mieterOptionen(mieterL, e.mieterId || null)}</select></label>
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
    ordner: zielOrdner(daten.get("ordner"), { datum: daten.get("datum"), mieterId: daten.get("mieter_id") || null, wohnungId: v.wohnung_id || null }),
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
export function pdfEintrag({ titel, angaben, text, abschnitte, kopf }) {
  return async () => {
    const bytes = textPdf({
      kopf, titel, angaben, text, abschnitte,
      fuss: `Abgelegt am ${datumDE(new Date())} aus der Verwaltungs-App`,
    });
    return { blob: new Blob([bytes], { type: "application/pdf" }), typ: "application/pdf" };
  };
}
