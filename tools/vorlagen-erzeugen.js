// Erzeugt die Standard-Briefvorlagen (.docx) mit Platzhaltern für docxtemplater.
// Aufruf:  node tools/vorlagen-erzeugen.js   (benötigt das npm-Paket "docx")
// Die Platzhalter-Syntax ist {feld}, Schleifen {#posten}…{/posten},
// Bedingungen {#feld}…{/feld} (nur wenn gefüllt) bzw. {^feld}…{/feld} (nur wenn leer).

const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType,
  BorderStyle, ShadingType, AlignmentType, Header, Footer, TabStopType, Tab,
} = require("docx");

const FARBE = "1F3A5F";      // Dunkelblau (Briefkopf)
const AKZENT = "B08D57";     // Messing/Gold (Linie)
const GRAU = "5A6270";
const SCHRIFT = "Arial";
const BREITE = 9354;         // A4 minus Ränder (25 mm links, 20 mm rechts) in DXA

const keineRahmen = {
  top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
};

const t = (text, opts = {}) => new TextRun({ text, font: SCHRIFT, size: 21, ...opts });
// Text nach einem Tabulator (für rechtsbündige bzw. eingerückte Spalten)
const tt = (text, opts = {}) => new TextRun({ children: [new Tab(), text], font: SCHRIFT, size: 21, ...opts });
const p = (kinder, opts = {}) =>
  new Paragraph({ children: Array.isArray(kinder) ? kinder : [t(kinder)], spacing: { after: 120, line: 276 }, ...opts });
// Absätze, die nur erscheinen, wenn "feld" gefüllt ist. Die Tag-Absätze selbst
// entfernt docxtemplater (Option paragraphLoop), sodass keine Leerzeilen bleiben.
const wenn = (feld, ...absaetze) => [
  new Paragraph({ spacing: { after: 0 }, children: [t("{#" + feld + "}")] }),
  ...absaetze,
  new Paragraph({ spacing: { after: 0 }, children: [t("{/" + feld + "}")] }),
];
const leer = () => new Paragraph({ children: [t("")], spacing: { after: 0 } });

function zelle(kinder, breite, opts = {}) {
  return new TableCell({
    width: { size: breite, type: WidthType.DXA },
    borders: keineRahmen,
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    children: kinder,
    ...opts,
  });
}

function briefkopf() {
  // Zweispaltige Tabelle statt Tabstopps: wird in Word und in der Browser-Vorschau gleich dargestellt
  const rechts = (text) => new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { after: 0 }, children: [t(text, { size: 16, color: GRAU })] });
  return new Header({
    children: [
      new Table({
        width: { size: BREITE, type: WidthType.DXA },
        columnWidths: [4354, 5000],
        borders: keineRahmen,
        rows: [new TableRow({ children: [
          zelle([
            new Paragraph({ spacing: { after: 0 }, children: [t("{v_firma}", { bold: true, size: 36, color: FARBE })] }),
            new Paragraph({ spacing: { after: 0 }, children: [t("Immobilienverwaltung", { size: 16, color: GRAU, characterSpacing: 20 })] }),
          ], 4354),
          zelle([
            new Paragraph({ spacing: { after: 0 }, children: [t("")] }),
            rechts("{v_strasse} · {v_plz} {v_ort}"),
            rechts("Tel. {v_telefon} · {v_email} · {v_web}"),
          ], 5000),
        ] })],
      }),
      new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: AKZENT, space: 1 } },
        spacing: { after: 0 },
        children: [t("", { size: 4 })],
      }),
    ],
  });
}

function fusszeile() {
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: "C9CED6", space: 4 } },
        children: [
          t("{v_firma} · Inhaber: {v_inhaber} · {v_strasse} · {v_plz} {v_ort} · {v_telefon} · {v_email}", {
            size: 14, color: GRAU,
          }),
        ],
      }),
    ],
  });
}

// Absenderzeile + Anschrift links, Infoblock rechts
function anschriftUndInfo(infoZeilen) {
  const links = [
    new Paragraph({
      spacing: { after: 120 },
      children: [t("{v_firma} · {v_strasse} · {v_plz} {v_ort}", { size: 14, color: GRAU, underline: {} })],
    }),
    new Paragraph({ spacing: { after: 0 }, children: [t("{empf_name}")] }),
    ...wenn("empf_zusatz", new Paragraph({ spacing: { after: 0 }, children: [t("{empf_zusatz}")] })),
    new Paragraph({ spacing: { after: 0 }, children: [t("{empf_strasse}")] }),
    new Paragraph({ spacing: { after: 0 }, children: [t("{empf_plz_ort}")] }),
  ];
  // Dritter Eintrag (optional): Zeile nur zeigen, wenn dieses Feld gefüllt ist
  const rechts = infoZeilen.flatMap(([label, wert, feld]) => {
    const zeile = new Paragraph({
      spacing: { after: 20 },
      tabStops: [{ type: TabStopType.LEFT, position: 1300 }],
      children: [t(label, { size: 17, color: GRAU }), tt(wert, { size: 17 })],
    });
    return feld ? wenn(feld, zeile) : [zeile];
  });
  return new Table({
    width: { size: BREITE, type: WidthType.DXA },
    columnWidths: [5054, 4300],
    borders: keineRahmen,
    rows: [new TableRow({ children: [zelle(links, 5054), zelle([leer(), ...rechts], 4300)] })],
  });
}

function postenTabelle() {
  const spalten = [2300, 5054, 2000];
  const rahmen = (farbe = "C9CED6") => ({
    top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    bottom: { style: BorderStyle.SINGLE, size: 4, color: farbe },
  });
  const z = (text, breite, opts = {}, runOpts = {}) =>
    new TableCell({
      width: { size: breite, type: WidthType.DXA },
      borders: rahmen(opts.rahmenFarbe),
      shading: opts.fill ? { type: ShadingType.CLEAR, color: "auto", fill: opts.fill } : undefined,
      margins: { top: 30, bottom: 30, left: 100, right: 100 },
      children: [new Paragraph({ alignment: opts.align, spacing: { after: 0 }, children: [t(text, runOpts)] })],
    });
  return new Table({
    width: { size: BREITE, type: WidthType.DXA },
    columnWidths: spalten,
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          z("Monat", spalten[0], { fill: "EEF1F5", rahmenFarbe: FARBE }, { bold: true, size: 19 }),
          z("Position", spalten[1], { fill: "EEF1F5", rahmenFarbe: FARBE }, { bold: true, size: 19 }),
          z("Betrag", spalten[2], { fill: "EEF1F5", rahmenFarbe: FARBE, align: AlignmentType.RIGHT }, { bold: true, size: 19 }),
        ],
      }),
      new TableRow({
        children: [
          z("{#posten}{monat}", spalten[0], {}, { size: 19 }),
          z("{bezeichnung}", spalten[1], {}, { size: 19 }),
          z("{betrag}{/posten}", spalten[2], { align: AlignmentType.RIGHT }, { size: 19 }),
        ],
      }),
      new TableRow({
        children: [
          z("", spalten[0], { rahmenFarbe: "FFFFFF" }),
          z("Summe offen", spalten[1], { rahmenFarbe: "FFFFFF" }, { bold: true }),
          z("{summe}", spalten[2], { align: AlignmentType.RIGHT, rahmenFarbe: "FFFFFF" }, { bold: true }),
        ],
      }),
    ],
  });
}

function kontoBox(einleitung) {
  const zeile = (label, wert) =>
    new Paragraph({
      spacing: { after: 20 },
      tabStops: [{ type: TabStopType.LEFT, position: 2200 }],
      children: [t(label, { size: 19, color: GRAU }), tt(wert, { size: 19, bold: label === "IBAN" })],
    });
  return new Table({
    width: { size: BREITE, type: WidthType.DXA },
    columnWidths: [BREITE],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: BREITE, type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, color: "auto", fill: "F6F3EC" },
            borders: {
              top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              left: { style: BorderStyle.SINGLE, size: 18, color: AKZENT },
            },
            margins: { top: 110, bottom: 110, left: 220, right: 200 },
            children: [
              new Paragraph({ spacing: { after: 60 }, children: [t(einleitung, { size: 19 })] }),
              zeile("Kontoinhaber", "{konto_inhaber}"),
              zeile("IBAN", "{konto_iban}"),
              zeile("BIC", "{konto_bic}"),
              zeile("Bank", "{konto_bank}"),
              zeile("Verwendungszweck", "{verwendungszweck}"),
            ],
          }),
        ],
      }),
    ],
  });
}

function gruss() {
  return [
    p("Mit freundlichen Grüßen", { spacing: { before: 160, after: 480 }, keepNext: true, keepLines: true }),
    new Paragraph({ spacing: { after: 0 }, keepNext: true, children: [t("{v_inhaber}")] }),
    new Paragraph({ spacing: { after: 0 }, children: [t("{v_firma}", { color: GRAU, size: 19 })] }),
  ];
}

function brief(inhalt) {
  return new Document({
    creator: "ROK Verwaltung",
    styles: { default: { document: { run: { font: SCHRIFT, size: 21 } } } },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 1950, bottom: 1200, left: 1418, right: 1134, header: 650, footer: 550 },
          },
        },
        headers: { default: briefkopf() },
        footers: { default: fusszeile() },
        children: inhalt,
      },
    ],
  });
}

const abstand = (nach = 240) => new Paragraph({ spacing: { after: nach }, children: [t("")] });
const betreff = (text) => p([t(text, { bold: true, size: 23, color: FARBE })], { spacing: { before: 400, after: 240 } });

// ---------------------------------------------------------------------------
// 1. Mahnung
// ---------------------------------------------------------------------------
const mahnung1 = brief([
  anschriftUndInfo([
    ["Datum", "{datum}"],
    ["Mietobjekt", "{objekt_strasse}"],
    ["Wohnung", "{wohnung}"],
  ]),
  betreff("Zahlungserinnerung – offene Mietzahlungen"),
  p("{briefanrede},"),
  p("bei der Durchsicht Ihres Mietkontos haben wir festgestellt, dass die folgenden Beträge für Ihre Wohnung {wohnung}, {objekt_adresse}, noch nicht bei uns eingegangen sind:"),
  postenTabelle(),
  abstand(120),
  p("Sicher handelt es sich um ein Versehen. Bitte überweisen Sie den offenen Betrag von {summe} bis spätestens {frist}."),
  kontoBox("Bitte verwenden Sie ausschließlich Ihr persönliches Mietkonto:"),
  abstand(120),
  p("Sollten Sie die Zahlung inzwischen veranlasst haben, betrachten Sie dieses Schreiben bitte als gegenstandslos. Falls es Ihnen gerade schwerfällt, den Betrag auf einmal zu begleichen, melden Sie sich bitte bei uns – gemeinsam finden wir eine Lösung."),
  ...wenn("kostentraeger_name", p("Sofern Ihre Unterkunftskosten vom {kostentraeger_name} übernommen werden, klären Sie den Vorgang bitte auch mit Ihrer zuständigen Sachbearbeitung.")),
  ...gruss(),
]);

// ---------------------------------------------------------------------------
// 2. Mahnung
// ---------------------------------------------------------------------------
const mahnung2 = brief([
  anschriftUndInfo([
    ["Datum", "{datum}"],
    ["Mietobjekt", "{objekt_strasse}"],
    ["Wohnung", "{wohnung}"],
  ]),
  betreff("2. Mahnung – Mietrückstand"),
  p("{briefanrede},"),
  p("{#letzte_mahnung_datum}trotz unserer Zahlungserinnerung vom {letzte_mahnung_datum}{/letzte_mahnung_datum}{^letzte_mahnung_datum}trotz unserer vorangegangenen Zahlungserinnerung{/letzte_mahnung_datum} sind die folgenden Beträge weiterhin offen:"),
  postenTabelle(),
  abstand(120),
  p([
    t("Wir fordern Sie hiermit auf, den Gesamtbetrag von "),
    t("{summe}", { bold: true }),
    t(" bis spätestens "),
    t("{frist}", { bold: true }),
    t(" zu überweisen."),
  ]),
  kontoBox("Zahlung ausschließlich auf Ihr persönliches Mietkonto:"),
  abstand(120),
  p("Ein Mietrückstand in dieser Höhe belastet das Mietverhältnis erheblich. Sollte der Betrag nicht fristgerecht eingehen, behalten wir uns weitere rechtliche Schritte ausdrücklich vor."),
  ...wenn("kostentraeger_name", p("Sofern Ihre Unterkunftskosten vom {kostentraeger_name} übernommen werden, setzen Sie sich bitte umgehend mit Ihrer zuständigen Sachbearbeitung in Verbindung.")),
  p("Wenn Sie den Betrag nicht vollständig zahlen können, sprechen Sie uns bitte vor Ablauf der Frist an."),
  ...gruss(),
]);

// ---------------------------------------------------------------------------
// Nachweis an Kostenträger (Jobcenter / Sozialamt)
// ---------------------------------------------------------------------------
const nachweis = brief([
  anschriftUndInfo([
    ["Datum", "{datum}"],
    ["Ihr Zeichen", "{aktenzeichen}"],
    ["Mietpartei", "{mieter_name}"],
    ["Mietobjekt", "{objekt_strasse}"],
    ["Wohnung", "{wohnung}"],
  ]),
  betreff("Mietrückstand {mieter_name} ({aktenzeichen}) – Mitteilung und Bitte um Prüfung"),
  p("Sehr geehrte Damen und Herren,"),
  p("an {mieter_name} vermieten wir seit {mietbeginn} die Wohnung {wohnung} in {objekt_adresse}. Die folgenden mietvertraglich vereinbarten Beträge sind fällig geworden, bis heute jedoch nicht bei uns eingegangen:"),
  postenTabelle(),
  abstand(120),
  ...wenn("hat_nebenleistungen", p("Die Pauschalen für Strom und Internet sind Bestandteil des Mietvertrags. Die Leistungen wurden im gesamten genannten Zeitraum bereitgestellt; der Vertrag kann bei Bedarf vorgelegt werden.")),
  ...wenn("mahnung_datum", p("Eine schriftliche Zahlungserinnerung an die Mietpartei erfolgte am {mahnung_datum}.")),
  p("Wir bitten Sie, den Sachverhalt zu prüfen und – soweit die Voraussetzungen vorliegen – die Kosten der Unterkunft künftig direkt an uns zu zahlen. Zahlungen erbitten wir auf das folgende Mietkonto:"),
  kontoBox("Mietkonto für dieses Mietverhältnis:"),
  abstand(120),
  p("Für Rückfragen stehen wir Ihnen gerne zur Verfügung."),
  ...gruss(),
]);

// ---------------------------------------------------------------------------
// Antwortschreiben (Text aus dem Postfach bzw. vom KI-Entwurf)
// {#absaetze}{absatz}{/absaetze}: jeder Absatz des Entwurfs wird ein eigener Absatz.
// Der erste Absatz ist die Anrede.
// ---------------------------------------------------------------------------
const antwort = brief([
  anschriftUndInfo([
    ["Datum", "{datum}"],
    ["Mietobjekt", "{objekt_strasse}", "objekt_strasse"],
    ["Wohnung", "{wohnung}", "wohnung"],
  ]),
  betreff("{betreff}"),
  ...wenn("absaetze", p("{absatz}")),
  ...gruss(),
]);

const ziel = path.join(__dirname, "..", "vorlagen");
fs.mkdirSync(ziel, { recursive: true });
(async () => {
  for (const [name, doc] of [["mahnung_1", mahnung1], ["mahnung_2", mahnung2], ["nachweis_jobcenter", nachweis], ["antwort", antwort]]) {
    fs.writeFileSync(path.join(ziel, name + ".docx"), await Packer.toBuffer(doc));
    console.log("geschrieben:", name + ".docx");
  }
})();
