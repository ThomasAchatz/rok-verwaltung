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

/** Befüllt eine .docx-Vorlage und gibt die Bytes des fertigen Dokuments zurück. */
export function fuelleVorlage(arrayBuffer, daten) {
  const zip = new globalThis.PizZip(arrayBuffer);
  const doc = new globalThis.Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => "",
  });
  doc.render(daten);
  return doc.getZip().generate({
    type: "uint8array",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    compression: "DEFLATE",
  });
}

/** Lesbare Fehlermeldung aus einem docxtemplater-Fehler. */
export function vorlagenFehler(err) {
  const einzel = err?.properties?.errors;
  if (Array.isArray(einzel) && einzel.length) {
    return einzel.map((e) => e.properties?.explanation || e.message).join(" · ");
  }
  return err?.message || String(err);
}
