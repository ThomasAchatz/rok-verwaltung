// Briefdaten zusammenstellen und Word-Vorlagen befüllen.
// Läuft im Browser (PizZip/Docxtemplater aus vendor/docx-vendor.min.js als globale
// Variablen) und zum Testen auch in Node (dort werden die Globals vorher gesetzt).

const ARTEN_REIHENFOLGE = ["kaltmiete", "nebenkosten", "strom", "internet", "sonstiges"];

export const euro = (betrag) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(Number(betrag) || 0);

export const datumDE = (wert) => {
  if (!wert) return "";
  const d = typeof wert === "string" ? new Date(wert.length === 10 ? wert + "T12:00:00" : wert) : wert;
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
};

export const monatDE = (wert) => {
  const d = new Date(String(wert).slice(0, 10) + "T12:00:00");
  return d.toLocaleDateString("de-DE", { month: "long", year: "numeric" });
};

export const ibanFormat = (iban) => (iban || "").replace(/\s+/g, "").replace(/(.{4})/g, "$1 ").trim();

export function briefanrede(m) {
  if (m.anrede === "Herr") return `Sehr geehrter Herr ${m.nachname}`;
  if (m.anrede === "Frau") return `Sehr geehrte Frau ${m.nachname}`;
  if (m.anrede === "Firma") return "Sehr geehrte Damen und Herren";
  return `Guten Tag ${[m.vorname, m.nachname].filter(Boolean).join(" ")}`;
}

export const mieterName = (m) => [m.vorname, m.nachname].filter(Boolean).join(" ");

const anschriftAnrede = (m) => (m.anrede === "Herr" ? "Herrn " : m.anrede === "Frau" ? "Frau " : "");

const plusTage = (tage, ab = new Date()) => {
  const d = new Date(ab);
  d.setDate(d.getDate() + tage);
  return d;
};

/**
 * Baut das Datenobjekt für eine Vorlage.
 * @param {string} typ        'mahnung_1' | 'mahnung_2' | 'nachweis_jobcenter'
 * @param {object} ctx        { profil, mieter, wohnung, objekt, kostentraeger, posten, vorgaenge, heute }
 *                            posten: offene Forderungen des Mieters; vorgaenge: bisherige Vorgänge
 */
export function briefDaten(typ, ctx) {
  const { profil, mieter, wohnung = {}, objekt = {}, kostentraeger = null, posten = [], vorgaenge = [] } = ctx;
  const heute = ctx.heute ? new Date(ctx.heute) : new Date();

  const sortiert = [...posten].sort(
    (a, b) =>
      String(a.monat).localeCompare(String(b.monat)) ||
      ARTEN_REIHENFOLGE.indexOf(a.art) - ARTEN_REIHENFOLGE.indexOf(b.art)
  );
  const summe = sortiert.reduce((s, f) => s + Number(f.betrag || 0), 0);

  const letzteMahnung = vorgaenge
    .filter((v) => v.typ === "mahnung_1" || v.typ === "mahnung_2")
    .sort((a, b) => String(b.erstellt_am).localeCompare(String(a.erstellt_am)))[0];
  const letzteErsteMahnung = vorgaenge
    .filter((v) => v.typ === "mahnung_1")
    .sort((a, b) => String(b.erstellt_am).localeCompare(String(a.erstellt_am)))[0];

  const objektAdresse = [objekt.strasse, [objekt.plz, objekt.ort].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const name = mieterName(mieter);

  const daten = {
    // Vermieter / Briefkopf
    v_firma: profil.firma || "",
    v_inhaber: profil.inhaber || "",
    v_strasse: profil.strasse || "",
    v_plz: profil.plz || "",
    v_ort: profil.ort || "",
    v_telefon: profil.telefon || "",
    v_email: profil.email || "",
    v_web: profil.web || "",
    // Briefkopf-Zusatz, Fußzeile und Zeile unter dem Gruß (bei privatem Absender ohne Firma)
    v_untertitel: profil.privat ? "" : profil.untertitel ?? "Immobilienverwaltung",
    v_fusszeile: fusszeileVon(profil),
    v_gruss_firma: profil.privat ? "" : profil.firma || "",
    // Stelle für die Unterschrift (wird in fuelleVorlage durch das Bild ersetzt oder entfernt)
    v_unterschrift: UNTERSCHRIFT_MARKE,
    // Daten
    datum: datumDE(heute),
    frist: datumDE(plusTage(typ === "mahnung_2" ? 7 : 14, heute)),
    // Mieter / Objekt
    mieter_name: name,
    mieter_vorname: mieter.vorname || "",
    mieter_nachname: mieter.nachname || "",
    briefanrede: briefanrede(mieter),
    objekt: objekt.bezeichnung || "",
    objekt_adresse: objektAdresse,
    objekt_strasse: objekt.strasse || "",
    wohnung: wohnung.bezeichnung || "",
    mietbeginn: datumDE(mieter.mietbeginn),
    // Kostenträger
    kostentraeger_name: kostentraeger ? kostentraeger.name : "",
    aktenzeichen: mieter.aktenzeichen || "",
    // Mietkonto
    konto_inhaber: mieter.mietkonto_inhaber || "",
    konto_iban: ibanFormat(mieter.mietkonto_iban),
    konto_bic: mieter.mietkonto_bic || "",
    konto_bank: mieter.mietkonto_bank || "",
    verwendungszweck: `Miete ${mieter.nachname}, ${objekt.bezeichnung || ""} ${wohnung.bezeichnung || ""}`.trim(),
    // Posten
    posten: sortiert.map((f) => ({
      monat: monatDE(f.monat),
      bezeichnung: f.bezeichnung || f.art,
      betrag: euro(f.betrag),
    })),
    summe: euro(summe),
    summe_zahl: summe,
    hat_nebenleistungen: sortiert.some((f) => f.art === "strom" || f.art === "internet"),
    letzte_mahnung_datum: letzteErsteMahnung ? datumDE(letzteErsteMahnung.erstellt_am) : "",
    mahnung_datum: letzteMahnung ? datumDE(letzteMahnung.erstellt_am) : "",
  };

  if (typ === "nachweis_jobcenter" && kostentraeger) {
    daten.empf_name = kostentraeger.name;
    daten.empf_zusatz = kostentraeger.abteilung || "";
    daten.empf_strasse = kostentraeger.strasse || "";
    daten.empf_plz_ort = [kostentraeger.plz, kostentraeger.ort].filter(Boolean).join(" ");
    daten.verwendungszweck = `KdU ${name}, ${mieter.aktenzeichen || ""}`.trim();
  } else {
    daten.empf_name = anschriftAnrede(mieter) + name;
    daten.empf_zusatz = wohnung.bezeichnung ? `Wohnung ${wohnung.bezeichnung}` : "";
    daten.empf_strasse = objekt.strasse || "";
    daten.empf_plz_ort = [objekt.plz, objekt.ort].filter(Boolean).join(" ");
  }
  return daten;
}

/**
 * Datenobjekt für die Vorlage „Antwortschreiben“.
 * @param {object} ctx { profil, mieter?, wohnung?, objekt?, empfaenger: {name, zusatz, strasse, plz_ort}, betreff, text }
 *   text: Anrede und Absätze (durch Leerzeilen getrennt), ohne Gruß und Unterschrift
 */
/** Fußzeile im Brief: Firma · Inhaber · Anschrift · Telefon · E-Mail (privat ohne Firma/Inhaber) */
function fusszeileVon(p) {
  const teile = p.privat
    ? [p.inhaber || p.firma, p.strasse, [p.plz, p.ort].filter(Boolean).join(" "), p.telefon, p.email]
    : [p.firma, p.inhaber ? `Inhaber: ${p.inhaber}` : "", p.strasse, [p.plz, p.ort].filter(Boolean).join(" "), p.telefon, p.email];
  return teile.map((x) => String(x || "").trim()).filter(Boolean).join(" · ");
}

/**
 * Profil für Briefe und Signatur mit gewähltem Absender (z. B. „Privat“).
 * absender: { bezeichnung, name, strasse, plz, ort, telefon, email, signatur } oder null (= Firma)
 */
export function profilFuer(profil, absender) {
  if (!absender) return profil || {};
  return {
    ...profil, privat: true,
    firma: absender.name || "", inhaber: absender.name || "",
    strasse: absender.strasse || "", plz: absender.plz || "", ort: absender.ort || "",
    telefon: absender.telefon || "", email: absender.email || "", web: "",
    email_signatur: absender.signatur || absender.name || "",
  };
}

export function antwortDaten(ctx) {
  const { profil, mieter = null, wohnung = {}, objekt = {}, empfaenger = {}, betreff = "", text = "" } = ctx;
  const basis = briefDaten("antwort", {
    profil, mieter: mieter || { nachname: "" }, wohnung: mieter ? wohnung : {}, objekt: mieter ? objekt : {}, heute: ctx.heute,
  });
  return {
    ...basis,
    empf_name: empfaenger.name || "",
    empf_zusatz: empfaenger.zusatz || "",
    empf_strasse: empfaenger.strasse || "",
    empf_plz_ort: empfaenger.plz_ort || "",
    betreff,
    absaetze: String(text).replace(/\r/g, "").split(/\n[ \t]*\n/).map((a) => a.trim()).filter(Boolean).map((absatz) => ({ absatz })),
  };
}

/** Liefert alle Platzhalter einer Vorlage (zur Anzeige / Prüfung). */
export function platzhalterAus(arrayBuffer) {
  const zip = new globalThis.PizZip(arrayBuffer);
  const xml = Object.keys(zip.files)
    .filter((n) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(n))
    .map((n) => zip.file(n).asText().replace(/<[^>]+>/g, ""))
    .join(" ");
  return [...new Set([...xml.matchAll(/\{([#^/]?)([a-z_0-9]+)\}/gi)].map((m) => m[2]))].sort();
}

/**
 * Befüllt eine .docx-Vorlage und gibt die Bytes des fertigen Dokuments zurück.
 * opt.unterschrift: { png: Uint8Array } setzt das Bild an die Stelle {v_unterschrift}
 * (ohne diese Stelle unter „Mit freundlichen Grüßen“). Danach steht in opt.platziert, ob es geklappt hat.
 */
export function fuelleVorlage(arrayBuffer, daten, opt = {}) {
  const zip = new globalThis.PizZip(arrayBuffer);
  const doc = new globalThis.Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => "",
  });
  doc.render(daten);
  const fertig = doc.getZip();
  opt.platziert = setzeUnterschrift(fertig, opt.unterschrift?.png || null);
  return fertig.generate({
    type: "uint8array",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    compression: "DEFLATE",
  });
}

// ---------------------------------------------------------------------------
// Unterschrift als Bild in den Brief
// ---------------------------------------------------------------------------
export const UNTERSCHRIFT_MARKE = "[[UNTERSCHRIFT]]";
const UNTERSCHRIFT_REL = "rIdRokUnterschrift";
const EMU_CM = 360000;

/** Breite/Höhe aus dem PNG-Kopf (IHDR) */
export function pngGroesse(png) {
  const b = png instanceof Uint8Array ? png : new Uint8Array(png);
  if (b.length < 24 || b[0] !== 0x89 || b[1] !== 0x50 || b[2] !== 0x4e || b[3] !== 0x47) return null;
  const zahl = (i) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
  const breite = zahl(16), hoehe = zahl(20);
  return breite && hoehe ? { breite, hoehe } : null;
}

/** Größe im Brief: 5 cm breit, höchstens 1,8 cm hoch */
export function unterschriftMasse(breite, hoehe) {
  let b = 5 * EMU_CM;
  let h = Math.round((b * hoehe) / breite);
  const maxH = 1.8 * EMU_CM;
  if (h > maxH) { b = Math.round((b * maxH) / h); h = maxH; }
  return { cx: Math.round(b), cy: Math.round(h) };
}

function bildLauf(cx, cy) {
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>` +
    `<wp:docPr id="7301" name="Unterschrift" descr="Unterschrift"/>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="unterschrift.png"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${UNTERSCHRIFT_REL}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

/**
 * Setzt die Unterschrift (PNG) in word/document.xml eines PizZip-Archivs oder entfernt die Stelle (png = null).
 * Liefert true, wenn das Bild eingesetzt wurde.
 */
export function setzeUnterschrift(zip, png) {
  const datei = zip.file("word/document.xml");
  if (!datei) return false;
  let xml = datei.asText();
  const lauf = /<w:r(?:\s[^>]*)?>(?:(?!<\/w:r>)[\s\S])*?\[\[UNTERSCHRIFT\]\](?:(?!<\/w:r>)[\s\S])*?<\/w:r>/;
  const masse = png && pngGroesse(png);
  if (!masse) {
    xml = xml.split(UNTERSCHRIFT_MARKE).join("");
    zip.file("word/document.xml", xml);
    return false;
  }
  const { cx, cy } = unterschriftMasse(masse.breite, masse.hoehe);
  let platziert = false;
  if (lauf.test(xml)) {
    xml = xml.replace(lauf, bildLauf(cx, cy));
    platziert = true;
  } else {
    // Eigene Vorlage ohne {v_unterschrift}: unter den Absatz mit „Grüßen“ setzen
    const i = Math.max(xml.lastIndexOf("Grüßen"), xml.lastIndexOf("Grüße"));
    const ende = i >= 0 ? xml.indexOf("</w:p>", i) : -1;
    if (ende >= 0) {
      xml = xml.slice(0, ende + 6) + `<w:p><w:pPr><w:keepNext/><w:spacing w:before="0" w:after="0"/></w:pPr>${bildLauf(cx, cy)}</w:p>` + xml.slice(ende + 6);
      platziert = true;
    }
  }
  xml = xml.split(UNTERSCHRIFT_MARKE).join("");
  if (!platziert) { zip.file("word/document.xml", xml); return false; }
  // Namensräume am Wurzelelement sicherstellen
  const wurzel = xml.match(/<w:document\b[^>]*>/)?.[0];
  if (wurzel) {
    let neu = wurzel;
    if (!/xmlns:wp=/.test(neu)) neu = neu.replace(/>$/, ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">');
    if (!/xmlns:r=/.test(neu)) neu = neu.replace(/>$/, ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">');
    xml = xml.replace(wurzel, neu);
  }
  zip.file("word/document.xml", xml);
  zip.file("word/media/rok_unterschrift.png", png);
  const relPfad = "word/_rels/document.xml.rels";
  let rels = zip.file(relPfad)?.asText() ||
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  if (!rels.includes(`Id="${UNTERSCHRIFT_REL}"`)) {
    rels = rels.replace("</Relationships>",
      `<Relationship Id="${UNTERSCHRIFT_REL}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/rok_unterschrift.png"/></Relationships>`);
  }
  zip.file(relPfad, rels);
  const typen = zip.file("[Content_Types].xml");
  if (typen) {
    const t = typen.asText();
    if (!/Extension="png"/i.test(t)) zip.file("[Content_Types].xml", t.replace("</Types>", '<Default Extension="png" ContentType="image/png"/></Types>'));
  }
  return true;
}

/** Lesbare Fehlermeldung aus einem docxtemplater-Fehler. */
export function vorlagenFehler(err) {
  const einzel = err?.properties?.errors;
  if (Array.isArray(einzel) && einzel.length) {
    return einzel.map((e) => e.properties?.explanation || e.message).join(" · ");
  }
  return err?.message || String(err);
}
