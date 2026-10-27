// Text aus Word (.docx) und Excel (.xlsx) im Browser auslesen, damit die KI die Datei einordnen kann.
// Nutzt JSZip (vendor/jszip.min.js). Nur reiner Text ohne Formatierung, Länge begrenzt.
// Bankverbindungen entfernt der Server, bevor der Text an die KI geht.
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const S = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const MAX_ZEICHEN = 20000;
const MAX_TEIL = 25 * 1024 * 1024; // entpackte Größe je XML-Teil (Schutz vor aufgeblähten Dateien)

async function xml(zip, pfad) {
  const f = zip.file(pfad);
  if (!f) return null;
  if ((f._data?.uncompressedSize || 0) > MAX_TEIL) return null;
  const doc = new DOMParser().parseFromString(await f.async("string"), "application/xml");
  return doc.getElementsByTagName("parsererror").length ? null : doc;
}

// Word: Absätze als Zeilen, Tabulatoren und Zeilenumbrüche bleiben erhalten
function absaetze(doc) {
  const zeilen = [];
  for (const p of doc.getElementsByTagNameNS(W, "p")) {
    let s = "";
    for (const k of p.getElementsByTagNameNS(W, "*")) {
      if (k.localName === "t") s += k.textContent;
      else if (k.localName === "tab") s += "\t";
      else if (k.localName === "br" || k.localName === "cr") s += "\n";
    }
    zeilen.push(s);
  }
  return zeilen.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function wordText(zip) {
  const haupt = await xml(zip, "word/document.xml");
  if (!haupt) return "";
  // Kopfzeilen enthalten oft den Absender: hilft beim Einordnen
  const kopf = [];
  for (const pfad of Object.keys(zip.files).filter((p) => /^word\/header\d*\.xml$/.test(p)).sort()) {
    const d = await xml(zip, pfad);
    const t = d ? absaetze(d) : "";
    if (t && !kopf.includes(t)) kopf.push(t);
  }
  const text = absaetze(haupt);
  return (kopf.length ? `[Kopfzeile]\n${kopf.join("\n")}\n\n` : "") + text;
}

// Excel: je Blatt die Zeilen, Zellen mit Tabulator getrennt
const spalteNr = (ref) => {
  const b = /^[A-Z]+/.exec(ref || "")?.[0] || "";
  let n = 0;
  for (const z of b) n = n * 26 + (z.charCodeAt(0) - 64);
  return n - 1;
};
const texteVon = (el) =>
  [...el.getElementsByTagNameNS(S, "t")].filter((t) => t.parentNode?.localName !== "rPh").map((t) => t.textContent).join("");

async function excelText(zip) {
  const geteilt = [];
  const ss = await xml(zip, "xl/sharedStrings.xml");
  if (ss) for (const si of ss.getElementsByTagNameNS(S, "si")) geteilt.push(texteVon(si));

  // Blätter in der Reihenfolge der Arbeitsmappe, mit Namen
  const [wb, rels] = await Promise.all([xml(zip, "xl/workbook.xml"), xml(zip, "xl/_rels/workbook.xml.rels")]);
  const ziele = new Map();
  if (rels) for (const r of rels.getElementsByTagName("Relationship")) ziele.set(r.getAttribute("Id"), r.getAttribute("Target") || "");
  const pfadVon = (t) => (t.startsWith("/") ? t.slice(1) : "xl/" + t.replace(/^\.\//, ""));
  let blaetter = wb
    ? [...wb.getElementsByTagNameNS(S, "sheet")]
      .map((b) => ({ name: b.getAttribute("name") || "", pfad: pfadVon(ziele.get(b.getAttributeNS(R, "id")) || "") }))
      .filter((b) => zip.file(b.pfad))
    : [];
  if (!blaetter.length) {
    blaetter = Object.keys(zip.files).filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/.test(p))
      .sort((a, b) => parseInt(a.replace(/\D/g, ""), 10) - parseInt(b.replace(/\D/g, ""), 10))
      .map((pfad, i) => ({ name: `Blatt ${i + 1}`, pfad }));
  }

  const teile = [];
  let laenge = 0;
  for (const b of blaetter) {
    if (laenge > MAX_ZEICHEN) break;
    const doc = await xml(zip, b.pfad);
    if (!doc) continue;
    const zeilen = [];
    for (const row of doc.getElementsByTagNameNS(S, "row")) {
      const zellen = [];
      let naechste = 0;
      for (const c of row.getElementsByTagNameNS(S, "c")) {
        const nr = c.getAttribute("r") ? spalteNr(c.getAttribute("r")) : naechste;
        naechste = nr + 1;
        if (nr > 200) continue;
        const typ = c.getAttribute("t");
        const v = c.getElementsByTagNameNS(S, "v")[0]?.textContent ?? "";
        const wert = typ === "s" ? geteilt[Number(v)] ?? ""
          : typ === "inlineStr" ? texteVon(c)
          : typ === "b" ? (v === "1" ? "WAHR" : "FALSCH")
          : v;
        zellen[nr] = String(wert).replace(/[\t\r\n]+/g, " ").trim();
      }
      const zeile = Array.from(zellen, (z) => z || "").join("\t").replace(/\t+$/, "");
      if (zeile.trim()) {
        zeilen.push(zeile);
        laenge += zeile.length + 1;
        if (laenge > MAX_ZEICHEN) break;
      }
    }
    if (zeilen.length) teile.push(`## ${b.name}\n${zeilen.join("\n")}`);
  }
  return teile.join("\n\n");
}

/**
 * Zellen einer Excel-Datei als Raster: [{ name, zeilen: [[wert, …], …] }]. Zahlen kommen als Number,
 * Text als String, leere Zellen als "". Für den Zahlungsimport (immocloud-Mietübersicht).
 */
export async function excelZellen(blob) {
  if (!window.JSZip) throw new Error("Excel-Leser nicht geladen");
  const zip = await window.JSZip.loadAsync(blob);
  const geteilt = [];
  const ss = await xml(zip, "xl/sharedStrings.xml");
  if (ss) for (const si of ss.getElementsByTagNameNS(S, "si")) geteilt.push(texteVon(si));
  const [wb, rels] = await Promise.all([xml(zip, "xl/workbook.xml"), xml(zip, "xl/_rels/workbook.xml.rels")]);
  const ziele = new Map();
  if (rels) for (const r of rels.getElementsByTagName("Relationship")) ziele.set(r.getAttribute("Id"), r.getAttribute("Target") || "");
  const pfadVon = (t) => (t.startsWith("/") ? t.slice(1) : "xl/" + t.replace(/^\.\//, ""));
  let blaetter = wb
    ? [...wb.getElementsByTagNameNS(S, "sheet")]
      .map((b) => ({ name: b.getAttribute("name") || "", pfad: pfadVon(ziele.get(b.getAttributeNS(R, "id")) || "") }))
      .filter((b) => zip.file(b.pfad))
    : [];
  if (!blaetter.length) {
    blaetter = Object.keys(zip.files).filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/.test(p)).sort()
      .map((pfad, i) => ({ name: `Blatt ${i + 1}`, pfad }));
  }
  const ergebnis = [];
  for (const b of blaetter.slice(0, 30)) {
    const doc = await xml(zip, b.pfad);
    if (!doc) continue;
    const zeilen = [];
    let zeileNr = 0;
    for (const row of doc.getElementsByTagNameNS(S, "row")) {
      const r = Number(row.getAttribute("r")) - 1;
      zeileNr = Number.isInteger(r) && r >= 0 ? r : zeileNr;
      if (zeileNr > 5000) break;
      const zellen = [];
      let naechste = 0;
      for (const c of row.getElementsByTagNameNS(S, "c")) {
        const nr = c.getAttribute("r") ? spalteNr(c.getAttribute("r")) : naechste;
        naechste = nr + 1;
        if (nr > 60) continue;
        const typ = c.getAttribute("t");
        const v = c.getElementsByTagNameNS(S, "v")[0]?.textContent ?? "";
        zellen[nr] = typ === "s" ? String(geteilt[Number(v)] ?? "").trim()
          : typ === "inlineStr" ? texteVon(c).trim()
          : typ === "str" || typ === "b" || typ === "e" ? String(v).trim()
          : v === "" ? "" : Number.isFinite(Number(v)) ? Number(v) : String(v);
      }
      zeilen[zeileNr] = Array.from(zellen, (z) => (z === undefined ? "" : z));
      zeileNr++;
    }
    ergebnis.push({ name: b.name, zeilen: Array.from(zeilen, (z) => z || []) });
  }
  return ergebnis;
}

/** Liest den Text einer Word- oder Excel-Datei. art: "word" | "excel". Gibt "" zurück, wenn nichts lesbar ist. */
export async function officeText(blob, art) {
  if (!window.JSZip) throw new Error("ZIP-Bibliothek fehlt");
  const zip = await window.JSZip.loadAsync(blob);
  const text = art === "excel" ? await excelText(zip) : await wordText(zip);
  return text.slice(0, MAX_ZEICHEN);
}
