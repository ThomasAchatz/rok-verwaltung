// Kleiner PDF-Schreiber für reinen Text (E-Mails, Notizen, Aufträge) – ohne Bibliothek.
// Schrift: Helvetica / Helvetica-Bold aus dem PDF-Standard (WinAnsi: Umlaute, ß, €, „“, – sind dabei).
// Zeichen außerhalb davon (z. B. Emojis) werden durch „?“ ersetzt.

// Zeichenbreiten (1/1000 em) für die Codes 32–255 in WinAnsi, aus den Adobe-AFM-Dateien
const BREITEN = {
  normal: "278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,761,556,0,222,556,333,1000,556,556,333,1000,667,333,1000,0,611,0,0,222,222,333,333,350,556,1000,333,1000,500,333,944,0,500,667,278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,333,400,584,333,333,333,556,537,278,333,333,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,584,611,556,556,556,556,500,556,500",
  fett: "278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,761,556,0,278,556,500,1000,556,556,333,1000,667,333,1000,0,611,0,0,278,278,500,500,350,556,1000,333,1000,556,333,944,0,500,667,278,333,556,556,556,556,280,556,333,737,370,556,584,333,737,333,400,584,333,333,333,611,556,278,333,333,365,556,834,834,834,611,722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,611,611,611,611,611,611,611,584,611,611,611,611,611,556,611,556",
};
const W = Object.fromEntries(Object.entries(BREITEN).map(([k, v]) => [k, v.split(",").map(Number)]));

// Unicode → WinAnsi (0x80–0x9F weichen von Latin-1 ab)
const SONDER = {
  "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87, "ˆ": 0x88, "‰": 0x89, "Š": 0x8a, "‹": 0x8b,
  "Œ": 0x8c, "Ž": 0x8e, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "˜": 0x98, "™": 0x99,
  "š": 0x9a, "›": 0x9b, "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f,
};
const ERSATZ = { "\t": "    ", " ": " ", " ": " ", "​": "", "‐": "-", "‑": "-", "−": "-", "→": "->" };

/** Text in WinAnsi-Codes umwandeln */
export function winAnsi(text) {
  const codes = [];
  for (const z of String(text ?? "").normalize("NFC")) {
    const e = ERSATZ[z];
    if (e !== undefined) { codes.push(...winAnsi(e)); continue; }
    const c = z.codePointAt(0);
    if (SONDER[z]) codes.push(SONDER[z]);
    else if ((c >= 32 && c < 127) || (c >= 0xa0 && c <= 0xff)) codes.push(c);
    else if (c >= 0x1f000 || (c >= 0x2600 && c < 0x2800) || c === 0xfe0f) continue; // Emojis weglassen
    else codes.push(63); // ?
  }
  return codes;
}

const breite = (codes, schrift, groesse) => codes.reduce((s, c) => s + (W[schrift][c - 32] || 556), 0) * groesse / 1000;

// Eine Zeile in mehrere umbrechen (an Leerzeichen, zu lange Wörter hart)
function umbrechen(codes, schrift, groesse, max) {
  if (!codes.length) return [[]];
  const zeilen = [];
  let zeile = [];
  const woerter = [];
  let wort = [];
  for (const c of codes) {
    if (c === 32) { woerter.push(wort); wort = []; } else wort.push(c);
  }
  woerter.push(wort);
  for (const w of woerter) {
    const kandidat = zeile.length ? [...zeile, 32, ...w] : w;
    if (breite(kandidat, schrift, groesse) <= max) { zeile = kandidat; continue; }
    if (zeile.length) zeilen.push(zeile);
    // Wort länger als die Zeile: hart teilen
    let rest = w;
    while (breite(rest, schrift, groesse) > max) {
      let n = rest.length;
      while (n > 1 && breite(rest.slice(0, n), schrift, groesse) > max) n--;
      zeilen.push(rest.slice(0, n));
      rest = rest.slice(n);
    }
    zeile = rest;
  }
  zeilen.push(zeile);
  return zeilen;
}

const pdfText = (codes) =>
  "(" + codes.map((c) => (c === 40 || c === 41 || c === 92 ? "\\" + String.fromCharCode(c) : c < 32 || c > 126 ? "\\" + c.toString(8).padStart(3, "0") : String.fromCharCode(c))).join("") + ")";
const hexUtf16 = (s) => "<FEFF" + [...String(s)].map((z) => {
  const c = z.codePointAt(0);
  if (c > 0xffff) { const v = c - 0x10000; return ((0xd800 + (v >> 10)).toString(16) + (0xdc00 + (v & 0x3ff)).toString(16)).toUpperCase(); }
  return c.toString(16).padStart(4, "0").toUpperCase();
}).join("") + ">";

/**
 * Erzeugt ein PDF (A4) aus Text.
 * @param {object} o
 * @param {string[]} [o.kopf]   kleine graue Zeilen oben (z. B. Briefkopf)
 * @param {string} o.titel      fette Überschrift
 * @param {Array<[string,string]>} [o.angaben]  z. B. [["Von", "…"], ["An", "…"], ["Datum", "…"]]
 * @param {string} o.text       Haupttext (Zeilenumbrüche bleiben erhalten)
 * @param {Array<{titel: string, text?: string, bloecke?: Array}>} [o.abschnitte]  weitere Abschnitte mit Zwischenüberschrift.
 *   Statt text auch bloecke (gegliedert): { art: "text", text } | { art: "unter", titel } | { art: "liste", punkte: [string | { titel, text }] }
 *   | { art: "tabelle", zeilen: [[label, wert]] } | { art: "hinweis", text }. Mit o.nummern werden die Abschnitte nummeriert.
 * @param {string} [o.fuss]     Fußzeile auf jeder Seite (dazu „Seite x von y“)
 * @returns {Uint8Array}
 */
export function textPdf(o) {
  const B = 595.28, H = 841.89, RAND = 56, UNTEN = 64;
  const breiteText = B - 2 * RAND;
  const seiten = [];
  let ops = [], y = H - RAND;
  const neueSeite = () => { if (ops.length) seiten.push(ops); ops = []; y = H - RAND; };
  const platz = (h) => { if (y - h < UNTEN) neueSeite(); };
  const zeile = (codes, { x = RAND, schrift = "normal", groesse = 10.5, grau = false }) => {
    ops.push(`BT /${schrift === "fett" ? "F2" : "F1"} ${groesse} Tf ${grau ? "0.42 0.45 0.5 rg" : "0.1 0.12 0.16 rg"} ${x.toFixed(2)} ${y.toFixed(2)} Td ${pdfText(codes)} Tj ET`);
  };
  const absatz = (text, { schrift = "normal", groesse = 10.5, grau = false, x = RAND, max = breiteText, abstand = 1.42 } = {}) => {
    const lh = groesse * abstand;
    for (const roh of String(text ?? "").replace(/\r\n?/g, "\n").split("\n")) {
      for (const z of umbrechen(winAnsi(roh), schrift, groesse, max)) {
        platz(lh);
        y -= lh;
        zeile(z, { x, schrift, groesse, grau });
      }
    }
  };
  const linie = () => { platz(10); y -= 6; ops.push(`0.82 0.84 0.88 RG 0.6 w ${RAND} ${y.toFixed(2)} m ${B - RAND} ${y.toFixed(2)} l S`); y -= 4; };

  if (o.kopf?.length) { absatz(o.kopf.filter(Boolean).join("\n"), { groesse: 8.5, grau: true, abstand: 1.3 }); linie(); y -= 8; }
  absatz(o.titel || "Dokument", { schrift: "fett", groesse: 14, abstand: 1.3 });
  y -= 6;
  const LABEL = 78;
  for (const [label, wert] of (o.angaben || []).filter(([, w]) => w)) {
    const zeilen = String(wert).split("\n").flatMap((t) => umbrechen(winAnsi(t), "normal", 9.5, breiteText - LABEL));
    zeilen.forEach((z, i) => {
      platz(13.5);
      y -= 13.5;
      if (i === 0) zeile(winAnsi(label), { schrift: "fett", groesse: 9.5, grau: true });
      zeile(z, { x: RAND + LABEL, groesse: 9.5 });
    });
  }
  if (o.angaben?.length) linie();
  y -= 6;
  absatz(o.text || "");
  // Gegliederte Bausteine
  const TINTE = "0.12 0.25 0.45";
  const fettZeile = (text, { groesse = 11, farbe = TINTE, x = RAND, max = breiteText } = {}) => {
    for (const z of umbrechen(winAnsi(text), "fett", groesse, max)) {
      platz(groesse * 1.5);
      y -= groesse * 1.4;
      ops.push(`BT /F2 ${groesse} Tf ${farbe} rg ${x.toFixed(2)} ${y.toFixed(2)} Td ${pdfText(z)} Tj ET`);
    }
  };
  const tabelle = (zeilen) => {
    const LB = 150;
    for (const [label, wert] of zeilen.filter(([, w]) => w != null && String(w).trim())) {
      const links = umbrechen(winAnsi(label), "fett", 9.5, LB - 8);
      const rechts = String(wert).split("\n").flatMap((t) => umbrechen(winAnsi(t), "normal", 10, breiteText - LB));
      const n = Math.max(links.length, rechts.length);
      platz(n * 14 + 4);
      for (let i = 0; i < n; i++) {
        y -= 14;
        if (links[i]) zeile(links[i], { schrift: "fett", groesse: 9.5, grau: true });
        if (rechts[i]) zeile(rechts[i], { x: RAND + LB, groesse: 10 });
      }
      y -= 2;
      ops.push(`0.9 0.91 0.93 RG 0.4 w ${RAND} ${(y + 1).toFixed(2)} m ${B - RAND} ${(y + 1).toFixed(2)} l S`);
    }
    y -= 4;
  };
  const liste = (punkte) => {
    const EIN = 14;
    for (const p of punkte) {
      const titel = typeof p === "object" && p ? p.titel : null;
      const text = typeof p === "object" && p ? p.text : p;
      platz(16);
      y -= 2;
      const start = y;
      if (titel) fettZeile(titel, { groesse: 10, farbe: "0.1 0.12 0.16", x: RAND + EIN, max: breiteText - EIN });
      if (text) absatz(text, { x: RAND + EIN, max: breiteText - EIN, groesse: 10 });
      // Punkt auf Höhe der ersten Zeile
      const yPunkt = start - (titel ? 10 * 1.4 : 10 * 1.42);
      ops.push(`BT /F1 10 Tf ${TINTE} rg ${(RAND + 3).toFixed(2)} ${yPunkt.toFixed(2)} Td ${pdfText([0x95])} Tj ET`);
      y -= 3;
    }
    y -= 2;
  };
  let nr = 0;
  for (const a of o.abschnitte || []) {
    const bloecke = Array.isArray(a?.bloecke) ? a.bloecke.filter(Boolean) : null;
    if (!a || (!a.text && !bloecke?.length)) continue;
    y -= 14;
    platz(70); // Überschrift nie allein am Seitenende
    nr++;
    fettZeile(o.nummern ? `${nr}. ${a.titel}` : a.titel, { groesse: bloecke ? 13 : 11 });
    if (bloecke) { y -= 6; ops.push(`0.62 0.7 0.82 RG 0.8 w ${RAND} ${y.toFixed(2)} m ${B - RAND} ${y.toFixed(2)} l S`); y -= 8; }
    else y -= 2;
    if (!bloecke) { absatz(a.text); continue; }
    for (const b of bloecke) {
      if (b.art === "unter") { y -= 6; platz(50); fettZeile(b.titel, { groesse: 10.5, farbe: "0.1 0.12 0.16" }); y -= 2; }
      else if (b.art === "tabelle") tabelle(b.zeilen || []);
      else if (b.art === "liste") liste((b.punkte || []).filter(Boolean));
      else if (b.art === "hinweis") { y -= 2; absatz(b.text, { groesse: 8.5, grau: true, abstand: 1.35 }); y -= 2; }
      else { absatz(b.text); y -= 4; }
    }
  }
  neueSeite();

  // Fußzeile mit Seitenzahl
  seiten.forEach((s, i) => {
    const t = winAnsi(`${o.fuss ? o.fuss + "  ·  " : ""}Seite ${i + 1} von ${seiten.length}`);
    s.push(`BT /F1 7.5 Tf 0.42 0.45 0.5 rg ${RAND} 36 Td ${pdfText(t)} Tj ET`);
  });

  // Objekte zusammensetzen
  const obj = [];
  const neu = (inhalt) => { obj.push(inhalt); return obj.length; };
  const katalog = neu(null), seitenBaum = neu(null);
  const f1 = neu("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const f2 = neu("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const kinder = seiten.map((s) => {
    const strom = s.join("\n");
    const inhalt = neu(`<< /Length ${strom.length} >>\nstream\n${strom}\nendstream`);
    return neu(`<< /Type /Page /Parent ${seitenBaum} 0 R /MediaBox [0 0 ${B} ${H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${inhalt} 0 R >>`);
  });
  obj[katalog - 1] = `<< /Type /Catalog /Pages ${seitenBaum} 0 R >>`;
  obj[seitenBaum - 1] = `<< /Type /Pages /Kids [${kinder.map((k) => `${k} 0 R`).join(" ")}] /Count ${kinder.length} >>`;
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, "0");
  const info = neu(`<< /Title ${hexUtf16(o.titel || "Dokument")} /Producer (ROK Verwaltung) /CreationDate (D:${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}) >>`);

  // Alle Inhalte sind reines ASCII: Länge in Zeichen = Länge in Bytes
  let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets = [];
  obj.forEach((inhalt, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${inhalt}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${obj.length + 1}\n0000000000 65535 f \n` + offsets.map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${obj.length + 1} /Root ${katalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(pdf, (z) => z.charCodeAt(0) & 0xff);
}
