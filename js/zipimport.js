// ZIP mit fertiger Ordnerstruktur hochladen: Ordner und Dateinamen werden 1:1 übernommen (keine KI, schnell).
// Oberste Ordner, die wie ein Haus heißen („MS_Am Mühlbach 3“, „Lindenstraße 14“), gehen in dieses Haus;
// sonst gilt die ZIP für das gewählte Haus. Danach optional „Für die KI erschließen“: die KI liest jede Datei
// einmal und speichert eine kurze Inhaltsangabe (Name und Ordner bleiben).
import * as db from "./daten.js";
import { $, esc, melde, dialogFormular, zustand, objektVon } from "./helfer.js";
import { ICON_KI, norm, alsBase64, verkleinere } from "./ui.js";
// Achtung Kreis-Import (ablage.js lädt diese Datei): Werte aus ablage.js erst in Funktionen benutzen
import { DOKUMENT_ARTEN, ordnerListe, ordnerAnzeige } from "./ablage.js";

const DOCX_TYP = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_TYP = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
import { officeText } from "./officetext.js";

const TYPEN = {
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  docx: DOCX_TYP, xlsx: XLSX_TYP,
};
const MAX_BYTES = 15 * 1024 * 1024;
const UEBERSPRINGEN = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini|~\$[^/]*|\.[^/]*)$|(^|\/)__MACOSX\//i;

export const istZip = (datei) => /\.zip$/i.test(datei?.name || "") || /zip/.test(datei?.type || "");

// --- Häuser in Ordnernamen erkennen -------------------------------------------------
const glatt = (s) => norm(s).replace(/straße|strasse/g, "str").replace(/[^a-z0-9]+/g, " ").trim();
export function hausFuer(name) {
  const n = ` ${glatt(name)} `;
  if (!n.trim()) return null;
  const treffer = zustand.stamm.objekte.filter((o) => {
    const str = glatt(o.strasse || "");
    const bez = glatt(o.bezeichnung || "");
    return (str && n.includes(` ${str} `)) || (bez && n.trim() === bez) || (bez.length > 6 && n.includes(` ${bez} `));
  });
  if (treffer.length === 1) return treffer[0];
  // Kürzel nur, wenn eindeutig und zusammen mit dem Straßennamen nicht schon gezählt
  const k = zustand.stamm.objekte.filter((o) => o.kuerzel && n.startsWith(` ${glatt(o.kuerzel)} `));
  return treffer.length > 1 ? null : k.length === 1 ? k[0] : null;
}

// --- Datum und Art aus dem Dateinamen ------------------------------------------------
function datumAus(name, zipDatum) {
  const m = String(name).match(/^(\d{2})(\d{2})(\d{2})[_ -]/);
  if (m) {
    const iso = `20${m[1]}-${m[2]}-${m[3]}`;
    if (!Number.isNaN(new Date(iso + "T12:00:00").getTime()) && Number(m[2]) >= 1 && Number(m[2]) <= 12 && Number(m[3]) <= 31) return iso;
  }
  const m2 = String(name).match(/(20\d{2})[-_.](\d{2})[-_.](\d{2})/);
  if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;
  return zipDatum ? new Date(zipDatum).toLocaleDateString("sv-SE") : null;
}
function artAus(name) {
  const teile = String(name).split(/[_\-\s.]+/).map((t) => norm(t));
  return DOKUMENT_ARTEN.find((a) => teile.includes(norm(a))) || "Sonstiges";
}

// --- ZIP lesen und planen --------------------------------------------------------------
/**
 * Liest die ZIP und plant den Import.
 * objektId: undefined = Übersicht (Häuser aus den Ordnernamen), null = Allgemein, sonst das Haus der Seite
 */
export async function planeZip(datei, { objektId = undefined } = {}) {
  if (!window.JSZip) throw new Error("ZIP ist in diesem Browser nicht verfügbar.");
  const zip = await window.JSZip.loadAsync(datei);
  let eintraege = Object.values(zip.files).filter((f) => !f.dir && !UEBERSPRINGEN.test(f.name));
  let pfade = eintraege.map((f) => f.name.replace(/\\/g, "/").replace(/^\/+/, "").split("/").filter(Boolean));
  // Eine gemeinsame Hülle („Ablage/…“ oder „Lindenstraße 14/…“) abziehen, wenn sie kein Haus ist
  while (pfade.length && pfade.every((p) => p.length > 1 && p[0] === pfade[0][0]) && !hausFuer(pfade[0][0])) {
    pfade = pfade.map((p) => p.slice(1));
  }
  // Häuser in der obersten Ebene?
  const oben = [...new Set(pfade.filter((p) => p.length > 1).map((p) => p[0]))];
  const hausVonOben = new Map(oben.map((n) => [n, hausFuer(n)]).filter(([, h]) => h));
  const hausModus = hausVonOben.size > 0 && (objektId === undefined || [...hausVonOben.values()].every((h) => h.id === objektId));

  // Zwei getrennte Ordnerlisten: Häuser (gleich in jedem Haus) und Allgemein (frei, ohne Automatik)
  await ordnerListe(true);
  const bereiche = {
    haus: { vorhanden: new Map((zustand.dokOrdnerZeilen || []).map((o) => [norm(o.name), o])), auto: zustand.dokOrdnerAuto || new Map(), neu: new Set() },
    allgemein: { vorhanden: new Map((zustand.dokOrdnerZeilenAllgemein || []).map((o) => [norm(o.name), o])), auto: new Map(), neu: new Set() },
  };
  // Ordnerpfad aus der ZIP auf die Liste des Bereichs abbilden; fehlende Ordner werden vorgemerkt
  const ordnerFuer = (teile, bereich = "haus") => {
    if (!teile.length) return "Sonstiges";
    const { vorhanden, auto, neu } = bereiche[bereich];
    const fertig = [];
    let virtuell = false;
    for (let i = 0; i < teile.length; i++) {
      const name = [...fertig, teile[i].trim()].join("/");
      const da = vorhanden.get(norm(name));
      if (da) { fertig.splice(0, fertig.length, ...da.name.split("/")); continue; }
      const eltern = fertig.join("/");
      if (virtuell || (eltern && auto.get(eltern))) virtuell = true; // Unterordner je Jahr/Wohnung entstehen von selbst
      else if (norm(name) !== norm("Sonstiges")) neu.add(name);
      fertig.push(teile[i].trim());
    }
    return fertig.join("/");
  };

  const dateien = [], uebersprungen = [];
  eintraege.forEach((f, i) => {
    let p = pfade[i];
    let haus = objektId === undefined ? undefined : objektId;
    if (hausModus && p.length > 1 && hausVonOben.has(p[0])) {
      haus = hausVonOben.get(p[0]).id;
      p = p.slice(1);
    }
    const name = p.at(-1);
    const endung = (name.match(/\.([a-z0-9]+)$/i)?.[1] || "").toLowerCase();
    const typ = TYPEN[endung];
    const groesse = f._data?.uncompressedSize ?? null;
    if (!typ) return uebersprungen.push({ name: p.join("/"), grund: endung ? `.${endung} wird nicht unterstützt` : "unbekannter Typ" });
    if (groesse && groesse > MAX_BYTES) return uebersprungen.push({ name: p.join("/"), grund: "größer als 15 MB" });
    dateien.push({
      eintrag: f, typ, endung: endung === "jpeg" ? "jpg" : endung,
      titel: name.replace(/\.[^.]+$/, "").trim().slice(0, 160) || "Datei",
      teile: p.slice(0, -1),
      ordner: ordnerFuer(p.slice(0, -1), haus === null ? "allgemein" : "haus"),
      haus, datum: datumAus(name, f.date), art: artAus(name),
    });
  });
  // Neue Ordner je Bereich erst bestimmen, wenn jedes Haus feststeht (Haus der übrigen Dateien wählt man im Dialog)
  const neueOrdnerFuer = () => {
    for (const b of Object.values(bereiche)) b.neu.clear();
    for (const d of dateien) d.ordner = ordnerFuer(d.teile, d.haus === null ? "allgemein" : "haus");
    return { haus: [...bereiche.haus.neu].sort(), allgemein: [...bereiche.allgemein.neu].sort() };
  };
  const vorab = neueOrdnerFuer();
  return { dateien, uebersprungen, neueOrdner: [...new Set([...vorab.haus, ...vorab.allgemein])].sort(), neueOrdnerFuer, hausModus };
}

// --- Dialog: Vorschau und Import ---------------------------------------------------------
const hausName = (id) => (id === null ? "Allgemein" : objektVon(id)?.bezeichnung || "Allgemein");
const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;

export async function zipImport(datei, { objektId = undefined, nachher = () => {} } = {}) {
  let plan;
  try {
    plan = await planeZip(datei, { objektId });
  } catch (err) {
    return melde("Die ZIP-Datei konnte nicht gelesen werden: " + err.message, "fehler");
  }
  if (!plan.dateien.length) {
    return melde(`In der ZIP sind keine passenden Dateien (Fotos, PDF, Word, Excel).${plan.uebersprungen.length ? ` ${plan.uebersprungen.length} übersprungen.` : ""}`, "fehler");
  }
  const ohneHaus = plan.dateien.filter((d) => d.haus === undefined);
  // Zusammenfassung je Haus und Ordner
  const gruppen = new Map();
  for (const d of plan.dateien) {
    const k = d.haus === undefined ? "?" : d.haus === null ? "null" : d.haus;
    if (!gruppen.has(k)) gruppen.set(k, new Map());
    const g = gruppen.get(k);
    g.set(d.ordner, (g.get(d.ordner) || 0) + 1);
  }
  const hausBlock = ([k, ordner]) => `
    <details class="zip__haus" ${gruppen.size === 1 ? "open" : ""}>
      <summary><strong>${k === "?" ? "Haus wählen (unten)" : esc(hausName(k === "null" ? null : k))}</strong>
        <span class="leise">${plural([...ordner.values()].reduce((s, n) => s + n, 0), "Datei", "Dateien")}</span></summary>
      <ul class="zip__ordner">${[...ordner.entries()].sort().map(([o, n]) => `<li><span>${esc(ordnerAnzeige(o))}</span><span class="leise">${n}</span></li>`).join("")}</ul>
    </details>`;

  const daten = await dialogFormular(`
    <h2>ZIP übernehmen</h2>
    <p>${esc(datei.name)}: ${plural(plan.dateien.length, "Datei", "Dateien")}${plan.hausModus ? `, Häuser aus den Ordnernamen erkannt` : ""}.
      Ordner und Dateinamen werden <strong>1:1 übernommen</strong>.</p>
    <div class="zip__vorschau">${[...gruppen.entries()].map(hausBlock).join("")}</div>
    ${ohneHaus.length ? `<label class="feld"><span>${plan.hausModus ? `Haus für die übrigen ${plural(ohneHaus.length, "Datei", "Dateien")}` : "In welches Haus?"}</span>
      <select name="haus" required>
        <option value="" disabled selected>Bitte wählen …</option>
        ${zustand.stamm.objekte.map((o) => `<option value="${esc(o.id)}">${esc(o.bezeichnung)}</option>`).join("")}
        <option value="allgemein">Allgemein (kein bestimmtes Haus)</option>
      </select></label>` : ""}
    ${plan.neueOrdner.length ? `<p class="feldhinweis feldhinweis--leise">Neue Ordner werden angelegt: ${esc(plan.neueOrdner.slice(0, 8).map(ordnerAnzeige).join(", "))}${plan.neueOrdner.length > 8 ? ` und ${plan.neueOrdner.length - 8} weitere` : ""}.</p>` : ""}
    ${plan.uebersprungen.length ? `<details class="mehr"><summary>${plural(plan.uebersprungen.length, "Datei wird", "Dateien werden")} übersprungen</summary>
      <ul class="zip__ordner">${plan.uebersprungen.slice(0, 50).map((u) => `<li><span>${esc(u.name)}</span><span class="leise">${esc(u.grund)}</span></li>`).join("")}</ul></details>` : ""}
    ${zustand.ki?.ki ? `<label class="checkfeld"><input type="checkbox" name="ki"> ${ICON_KI} Danach gleich für die KI erschließen (liest jede Datei einmal, dauert etwas)</label>` : ""}
    <p class="leise">Dateien, die es im selben Ordner schon gibt, werden übersprungen.</p>
    <div class="knopfreihe">
      <button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button>
      <button class="knopf knopf--primaer" value="ok">${plural(plan.dateien.length, "Datei", "Dateien")} übernehmen</button>
    </div>`, { breit: true });
  if (!daten) return;
  const wahl = daten.get("haus");
  for (const d of ohneHaus) d.haus = wahl === "allgemein" ? null : wahl || null;

  // Neue Ordner anlegen: in Häusern für alle Häuser, unter Allgemein nur dort
  try {
    const neue = plan.neueOrdnerFuer();
    for (const bereich of ["haus", "allgemein"]) {
      const zeilen = (bereich === "haus" ? zustand.dokOrdnerZeilen : zustand.dokOrdnerZeilenAllgemein) || [];
      let platz = zeilen.reduce((m, o) => Math.max(m, Number(o.reihenfolge) || 0), 0);
      for (const name of neue[bereich]) await db.speichereDokumentOrdner(null, { name, reihenfolge: ++platz, bereich });
    }
    if (neue.haus.length || neue.allgemein.length) await ordnerListe(true);
  } catch (err) {
    return melde("Ordner konnten nicht angelegt werden: " + err.message, "fehler");
  }

  // Doppelte vermeiden: gleicher Titel im gleichen Ordner und Haus
  const haeuser = [...new Set(plan.dateien.map((d) => d.haus ?? null))];
  const schon = new Set();
  for (const h of haeuser) {
    for (const d of await db.ladeDokumente({ objektId: h }).catch(() => [])) schon.add(`${d.objekt_id || ""}|${norm(d.ordner)}|${norm(d.titel)}`);
  }

  const fort = fortschritt(`ZIP wird übernommen …`);
  const neu = [], fehler = [];
  let doppelt = 0;
  for (const [i, d] of plan.dateien.entries()) {
    if (fort.abgebrochen) break;
    fort.stand(i + 1, plan.dateien.length, d.titel);
    const key = `${d.haus || ""}|${norm(d.ordner)}|${norm(d.titel)}`;
    if (schon.has(key)) { doppelt++; continue; }
    try {
      const blob = new Blob([await d.eintrag.async("uint8array")], { type: d.typ });
      const doc = await db.legeDokumentAb({
        objekt_id: d.haus || null, mieter_id: null, ordner: d.ordner, art: d.art, absender: null, details: null,
        datum: d.datum, titel: d.titel, zusammenfassung: null,
        pfad: `${d.haus || "allgemein"}/${crypto.randomUUID()}.${d.endung}`, typ: d.typ, groesse: blob.size,
      }, blob);
      schon.add(key);
      neu.push(doc);
    } catch (err) {
      fehler.push(`${d.titel}: ${err.message}`);
    }
  }
  const abgebrochen = fort.abgebrochen;
  await fort.ende();
  melde(`${plural(neu.length, "Datei", "Dateien")} übernommen${doppelt ? `, ${doppelt} schon vorhanden` : ""}${fehler.length ? `, ${fehler.length} mit Fehler` : ""}${abgebrochen ? " (abgebrochen)" : ""}.`,
    fehler.length ? "fehler" : "ok", { dauer: 9000 });
  if (fehler.length) console.warn("ZIP-Import:", fehler);
  if (neu.length && daten.get("ki")) await erschliessen(neu, { frage: false });
  nachher(neu);
}

// --- Fortschritt mit „Abbrechen“ -----------------------------------------------------------
function fortschritt(titel) {
  const dlg = $("#dialog");
  dlg.innerHTML = `<div class="warten fortschritt">
    <span class="kreisel" aria-hidden="true"></span>
    <p data-titel>${esc(titel)}</p>
    <progress max="1" value="0"></progress>
    <p class="leise" data-stand></p>
    <button type="button" class="knopf knopf--klein" data-stopp>Abbrechen</button>
  </div>`;
  const zustandF = { abgebrochen: false };
  const stopp = (e) => { e?.preventDefault?.(); zustandF.abgebrochen = true; $("[data-stand]", dlg).textContent = "Wird nach der aktuellen Datei angehalten …"; };
  dlg.addEventListener("cancel", stopp);
  $("[data-stopp]", dlg).addEventListener("click", stopp);
  dlg.showModal();
  return Object.assign(zustandF, {
    stand(i, n, name) {
      if (zustandF.abgebrochen) return;
      $("progress", dlg).max = n;
      $("progress", dlg).value = i;
      $("[data-stand]", dlg).textContent = `${i} von ${n}: ${name}`;
    },
    ende: () => new Promise((fertig) => {
      dlg.removeEventListener("cancel", stopp);
      if (!dlg.open) return fertig();
      dlg.addEventListener("close", () => fertig(), { once: true });
      dlg.close();
    }),
  });
}

// --- Für die KI erschließen -----------------------------------------------------------------
const NICHT_LESBAR = "(Inhalt für die KI nicht lesbar)";
async function inhaltFuerKi(d) {
  const blob = await db.ladeDokumentDatei(d.pfad);
  if (d.typ === DOCX_TYP || d.typ === XLSX_TYP) {
    const art = d.typ === DOCX_TYP ? "word" : "excel";
    return { datei_text: { text: await officeText(blob, art), art } };
  }
  if (/^image\//.test(d.typ)) {
    const v = await verkleinere(blob);
    return { bild: { daten: v.base64, typ: "image/jpeg" } };
  }
  if (d.typ === "application/pdf") {
    if (blob.size > 8 * 1024 * 1024) throw new Error("PDF zu groß für die KI");
    return { bild: { daten: await alsBase64(blob), typ: "application/pdf" } };
  }
  throw new Error("Dateityp nicht lesbar");
}

/** docs: Liste von Dokumenten (id, titel, ordner, pfad, typ). frage: vorher bestätigen lassen */
export async function erschliessen(docs, { frage = true, nachher = () => {} } = {}) {
  if (!zustand.ki?.ki) return melde("Die KI ist noch nicht eingerichtet.", "fehler");
  if (!docs.length) return melde("Alle Dateien sind schon erschlossen.", "ok");
  if (frage) {
    const ok = await dialogFormular(`
      <h2>${ICON_KI} Für die KI erschließen</h2>
      <p>Die KI liest ${plural(docs.length, "Datei", "Dateien")} einmal und speichert zu jeder eine kurze Inhaltsangabe.
        Namen und Ordner bleiben, wie sie sind.</p>
      <p class="leise">Danach findet der Chat auch Inhalte („Wie hoch war die Rechnung vom Wasserschaden?“). Das dauert etwa ${Math.max(1, Math.round(docs.length * 6 / 60))} Minute(n)
        und kostet etwas KI-Guthaben. Bankverbindungen werden vorher entfernt.</p>
      <div class="knopfreihe">
        <button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button>
        <button class="knopf knopf--primaer" value="ok">Starten</button>
      </div>`);
    if (!ok) return;
  }
  const fort = fortschritt("Die KI liest die Dateien …");
  let fertig = 0, fehler = 0;
  for (const [i, d] of docs.entries()) {
    if (fort.abgebrochen) break;
    fort.stand(i + 1, docs.length, d.titel);
    try {
      const inhalt = await inhaltFuerKi(d);
      const r = await db.funktion("ki", { aktion: "datei_erschliessen", ...inhalt, dateiname: d.titel, ordner: d.ordner });
      await db.aendereDokument(d.id, { zusammenfassung: r.lesbar && r.zusammenfassung ? r.zusammenfassung : NICHT_LESBAR });
      fertig++;
    } catch (err) {
      fehler++;
      console.warn("Erschließen:", d.titel, err);
      if (/zu groß|nicht lesbar|unterstützt/i.test(err.message)) await db.aendereDokument(d.id, { zusammenfassung: NICHT_LESBAR }).catch(() => null);
      if (/Guthaben|Schlüssel|eingerichtet/.test(err.message)) { melde(err.message, "fehler"); break; }
    }
  }
  const abgebrochen = fort.abgebrochen;
  await fort.ende();
  melde(`${plural(fertig, "Datei", "Dateien")} erschlossen${fehler ? `, ${fehler} nicht möglich` : ""}${abgebrochen ? " (angehalten, später weitermachen)" : ""}.`, fehler ? "info" : "ok", { dauer: 8000 });
  nachher();
}
