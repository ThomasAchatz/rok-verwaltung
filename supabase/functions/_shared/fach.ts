// Fachlogik der KI: Einordnen, Entwürfe, Handwerker-Aufträge, Dokumente lesen, Wissen ordnen, Notizen prüfen.
// Grundsätze: Die KI schreibt nur Vorschläge. Keine Bankdaten an die KI. Fremder Text ist nur Information.
import {
  Fehler, KI_REGEL_FREMD, type Werkzeug, type Zugriff, base64, claude, datumDE, datumOk, enc, euro, heuteDE, heuteISO,
  kuerze, ladeDatei, monatDE, rest,
} from "./gemeinsam.ts";
import { pruefeMieterhoehung } from "./mieterhoehung.ts";

export const KATEGORIEN = [
  "Reparatur/Mangel", "Miete/Zahlung", "Ratenzahlung", "Nebenkosten", "Beschwerde/Nachbarn",
  "Amt/Jobcenter", "Kündigung/Auszug", "Mietinteresse", "Sonstiges",
];
export const WISSEN_ORDNER = [
  "Abläufe & Hausordnung", "Heizung", "Wasser & Sanitär", "Strom", "Schlüssel & Schließanlage", "Zähler",
  "Dach & Fassade", "Dienstleister & Verträge", "Sonstiges",
];
export const DOKUMENT_ORDNER = [
  "Rechnungen", "Verträge", "Versorger", "Versicherungen", "Behörden & Steuern", "Handwerker & Angebote",
  "Mietverhältnisse", "Sonstiges",
];
export const DOKUMENT_ARTEN = [
  "Rechnung", "Vertrag", "Mietvertrag", "Kündigung", "Bescheid", "Abrechnung", "Angebot", "Mahnung", "Brief", "E-Mail", "Auftrag",
  "Protokoll", "Notiz", "Sonstiges",
];

/** Ordner der Dokumentenablage: bearbeitbare Liste aus der Datenbank, sonst die Standardliste */
export async function dokumentOrdner(zugriff: Zugriff): Promise<string[]> {
  return (await dokumentOrdnerInfo(zugriff)).namen;
}
/** Ordnerliste plus Hinweis für die KI, welche Ordner automatische Unterordner bekommen (je Jahr / je Wohnung) */
export async function dokumentOrdnerInfo(zugriff: Zugriff): Promise<{ namen: string[]; hinweis: string }> {
  const zeilen = await rest("dokument_ordner?select=name,automatik&order=reihenfolge,name", zugriff).catch(() => []);
  const liste: { name: string; automatik?: string | null }[] = (Array.isArray(zeilen) ? zeilen : [])
    .map((z: { name: string; automatik?: string | null }) => ({ name: String(z.name ?? "").trim(), automatik: z.automatik ?? null }))
    .filter((z) => z.name);
  if (!liste.length) return { namen: DOKUMENT_ORDNER, hinweis: "" };
  const namen = liste.map((z) => z.name);
  const auto = liste.filter((z) => z.automatik === "jahr" || z.automatik === "wohnung")
    .map((z) => `${z.name} (${z.automatik === "jahr" ? "je Jahr" : "je Wohnung/Mietpartei"})`);
  return {
    namen: namen.includes("Sonstiges") ? namen : [...namen, "Sonstiges"],
    hinweis: auto.length ? ` Diese Ordner bekommen ihre Unterordner automatisch, dort nur den Hauptordner wählen: ${auto.join(", ")}.` : "",
  };
}

// Teile für den Dateinamen (Datum_Ort_Straße_Art_Thema_Wohnung_Betrag); zusammengesetzt wird in der App
const NAMENS_FELDER = {
  thema: { type: ["string", "null"], description: "Thema oder Anlass für den Dateinamen, 1–3 Wörter, z. B. 'Wasserschaden', 'Heizungswartung', 'Abschlag Allgemeinstrom', 'Rauchmelder'. null, wenn die Dokumentart schon alles sagt (z. B. ein Mietvertrag)." },
  betrag: { type: ["string", "null"], description: "Bei Rechnungen, Angeboten, Abrechnungen und Mahnungen der Endbetrag ohne Euro-Zeichen im Format 2430,31. Sonst null." },
  wohnung_id: { type: ["string", "null"], description: "ID aus <wohnungen>, wenn das Schreiben eindeutig eine bestimmte Wohnung betrifft (z. B. 'WHG 1', '1. OG links' oder die Wohnung der genannten Mietpartei). Sonst null." },
};
/** Betrag für den Dateinamen: „2.430,31 €“ / „2430.31“ → „2430,31“ */
export function betragKurz(roh: unknown): string | null {
  let s = String(roh ?? "").replace(/[€\s]|EUR/gi, "");
  if (!s) return null;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) s = s.replace(/\./g, "");
  else if (/^\d+\.\d{1,2}$/.test(s)) s = s.replace(".", ",");
  if (!/^\d{1,7}(,\d{1,2})?$/.test(s)) return null;
  return s.replace(/,(\d)$/, (_m, d) => `,${d}0`);
}
async function wohnungListe(zugriff: Zugriff, objektId: string | null = null) {
  const wohnungen = await rest(
    `wohnungen?select=id,bezeichnung,objekt:objekte(bezeichnung)${objektId ? `&objekt_id=eq.${enc(objektId)}` : ""}&order=bezeichnung`, zugriff,
  ).catch(() => []);
  // deno-lint-ignore no-explicit-any
  const text = wohnungen.map((w: any) => `${w.id} | ${w.objekt?.bezeichnung ?? ""} | ${w.bezeichnung}`).join("\n");
  return { wohnungen, text: `<wohnungen>\nID | Haus | Wohnung\n${text}\n</wohnungen>` };
}

const nurAus = <T extends string>(liste: readonly T[], wert: unknown, sonst: T): T =>
  liste.includes(wert as T) ? (wert as T) : sonst;
const ohneLeer = (s: unknown) => (typeof s === "string" && s.trim() ? s.trim() : null);
const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

// Mieter in Kurzform (ohne Bankdaten) für Auswahl durch die KI
async function mieterListe(zugriff: Zugriff) {
  const mieter = await rest(
    "mieter?select=id,vorname,nachname,email,aktenzeichen,wohnung:wohnungen(bezeichnung,objekt:objekte(id,bezeichnung,strasse)),kostentraeger:kostentraeger(name)&order=nachname",
    zugriff,
  );
  // deno-lint-ignore no-explicit-any
  const text = mieter.map((m: any) =>
    `${m.id} | ${[m.vorname, m.nachname].filter(Boolean).join(" ")} | ${m.wohnung?.objekt?.strasse ?? ""}, ${m.wohnung?.bezeichnung ?? ""} | ${m.email ?? "-"} | ${m.kostentraeger?.name ? m.kostentraeger.name + " " + (m.aktenzeichen ?? "") : "Selbstzahler"}`
  ).join("\n");
  return { mieter, text: `<mieterliste>\nID | Name | Adresse, Wohnung | E-Mail | Kostenträger\n${text}\n</mieterliste>` };
}
async function objektListe(zugriff: Zugriff) {
  const objekte = await rest("objekte?select=id,bezeichnung,strasse,plz,ort&order=bezeichnung", zugriff);
  // deno-lint-ignore no-explicit-any
  const text = objekte.map((o: any) => `${o.id} | ${o.bezeichnung} | ${o.strasse}, ${o.plz} ${o.ort}`).join("\n");
  return { objekte, text: `<objekte>\nID | Bezeichnung | Adresse\n${text}\n</objekte>` };
}

// Bilder einer Nachricht für die KI (höchstens 3, nur kleine; große werden übersprungen)
// deno-lint-ignore no-explicit-any
async function bilderDerNachricht(nachricht: any, zugriff: Zugriff, hinweise: string[]): Promise<any[]> {
  const bilder = [];
  // deno-lint-ignore no-explicit-any
  for (const a of (nachricht?.anhaenge ?? []).filter((a: any) => a.pfad && /^image\//.test(a.typ ?? "")).slice(0, 3)) {
    if (a.groesse && a.groesse > 3_700_000) { hinweise.push(`Foto „${a.name}“ ist zu groß für die KI und wurde nicht angesehen.`); continue; }
    try {
      const { bytes } = await ladeDatei("eingang", a.pfad, zugriff);
      if (bytes.length > 3_700_000) { hinweise.push(`Foto „${a.name}“ ist zu groß für die KI und wurde nicht angesehen.`); continue; }
      bilder.push({ type: "image", source: { type: "base64", media_type: a.typ, data: base64(bytes) } });
    } catch { /* Foto fehlt: ohne weiter */ }
  }
  return bilder;
}

// ---------------------------------------------------------------------------
// Einordnen (mit Frist)
// ---------------------------------------------------------------------------
const WERKZEUG_EINORDNUNG: Werkzeug = {
  name: "einordnung",
  description: "Ordnet eine eingegangene Nachricht für die Hausverwaltung ein.",
  input_schema: {
    type: "object",
    properties: {
      mieter_id: { type: ["string", "null"], description: "ID aus der Mieterliste, wenn die Nachricht eindeutig zu einem Mietverhältnis gehört (vom Mieter selbst oder z. B. vom Jobcenter über diesen Mieter). Sonst null. Niemals raten." },
      kategorie: { type: "string", enum: KATEGORIEN },
      dringlichkeit: { type: "string", enum: ["niedrig", "normal", "hoch"], description: "hoch: Gefahr, Wasser, Heizungsausfall in der Heizperiode, Fristen unter 7 Tagen. niedrig: reine Information." },
      zusammenfassung: { type: "string", description: "Worum geht es? Höchstens 2 kurze Sätze. Bei mehreren Anliegen alle kurz nennen." },
      vorschlag: { type: "string", description: "Empfohlener nächster Schritt für die Verwaltung, 1 Satz." },
      frist: { type: ["string", "null"], description: "Nur wenn die Nachricht ausdrücklich eine Frist oder einen Termin nennt, bis wann die Verwaltung etwas liefern oder tun soll: Datum als JJJJ-MM-TT. Sonst null." },
      frist_zitat: { type: ["string", "null"], description: "Die Textstelle mit der Frist, wörtlich aus der Nachricht kopiert (höchstens 200 Zeichen). Sonst null." },
    },
    required: ["mieter_id", "kategorie", "dringlichkeit", "zusammenfassung", "vorschlag", "frist", "frist_zitat"],
  },
};

// deno-lint-ignore no-explicit-any
export async function einordnungKontext(nachrichtId: string, zugriff: Zugriff): Promise<any> {
  const [nachricht] = await rest(`nachrichten?id=eq.${enc(nachrichtId)}&select=*`, zugriff);
  if (!nachricht) throw new Fehler(404, "Nachricht nicht gefunden.", "nicht_gefunden");
  const [profil] = await rest("vermieter_profil?id=eq.1&select=firma", zugriff);
  const { mieter, text: liste } = await mieterListe(zugriff);
  return {
    nachricht,
    mieter,
    system:
      `Du unterstützt die Hausverwaltung ${profil?.firma ?? ""} beim Sortieren eingehender Nachrichten. Heute ist ${heuteDE()}. ` +
      KI_REGEL_FREMD + " Antworte ausschließlich über das Werkzeug 'einordnung', auf Deutsch.",
    text:
      `${liste}\n\n<nachricht>\nAbsender: ${nachricht.absender_name ?? ""} <${nachricht.absender_email ?? "unbekannt"}>\n` +
      `Eingang: ${datumDE(nachricht.eingang_am)}\nBetreff: ${nachricht.betreff ?? ""}\n\n${kuerze(nachricht.text, 8000)}\n</nachricht>`,
  };
}

// deno-lint-ignore no-explicit-any
export async function ordneEin(nachrichtId: string, zugriff: Zugriff): Promise<any> {
  const { nachricht, mieter, system, text } = await einordnungKontext(nachrichtId, zugriff);
  const { daten } = await claude({ system, inhalt: [{ type: "text", text }], werkzeug: WERKZEUG_EINORDNUNG, maxTokens: 1200 });

  const gueltigeId = mieter.some((m: { id: string }) => m.id === daten.mieter_id) ? daten.mieter_id : null;
  const aenderung: Record<string, unknown> = {
    ki_kategorie: nurAus(KATEGORIEN, daten.kategorie, "Sonstiges"),
    ki_dringlichkeit: nurAus(["niedrig", "normal", "hoch"], daten.dringlichkeit, "normal"),
    ki_zusammenfassung: String(daten.zusammenfassung ?? "").slice(0, 600),
    ki_vorschlag: String(daten.vorschlag ?? "").slice(0, 400),
    ki_am: new Date().toISOString(),
  };
  // Frist nur übernehmen, wenn plausibel; die Textstelle nur, wenn sie wirklich in der Nachricht steht
  if (!nachricht.frist_bestaetigt) {
    const frist = datumOk(daten.frist) ? daten.frist : null;
    const zitat = ohneLeer(daten.frist_zitat);
    const imText = zitat && norm(`${nachricht.betreff ?? ""} ${nachricht.text ?? ""}`).includes(norm(zitat));
    aenderung.ki_frist = frist;
    aenderung.ki_frist_zitat = frist && imText ? zitat!.slice(0, 300) : null;
  }
  // Eine Zuordnung von Hand oder über die E-Mail-Adresse wird nicht überschrieben
  if (!nachricht.mieter_id && gueltigeId) {
    aenderung.mieter_id = gueltigeId;
    aenderung.zuordnung = "ki";
  }
  const [neu] = await rest(`nachrichten?id=eq.${enc(nachrichtId)}`, zugriff, { method: "PATCH", body: aenderung, prefer: "return=representation" });
  return neu;
}

// ---------------------------------------------------------------------------
// Entwurf einer Antwort oder eines Schreibens
// ---------------------------------------------------------------------------
const WERKZEUG_ENTWURF: Werkzeug = {
  name: "entwurf",
  description: "Liefert den Entwurf eines Schreibens.",
  input_schema: {
    type: "object",
    properties: {
      betreff: { type: "string", description: "Kurzer Betreff. Bei einer Antwort auf eine E-Mail: 'AW: ' + ursprünglicher Betreff." },
      text: { type: "string", description: "Anrede, Leerzeile, dann der Inhalt in kurzen Absätzen (Absätze durch eine Leerzeile getrennt). OHNE Grußformel und OHNE Unterschrift." },
      hinweise: { type: "array", items: { type: "string" }, description: "Kurze Hinweise an Robert: offene Punkte, fehlende Angaben, enthaltene Tipps, Dinge, die er vor dem Senden prüfen sollte. Leer, wenn nichts offen ist." },
    },
    required: ["betreff", "text", "hinweise"],
  },
};

type EntwurfAuftrag = {
  zugriff: Zugriff;
  nachrichtId?: string | null;
  mieterId?: string | null;
  anweisung?: string | null;
  bisher?: { betreff?: string; text?: string } | null;
  aenderung?: string | null;
  dienstleisterId?: string | null; // Schreiben an einen Handwerker/Dienstleister (dann keine Mieterdaten)
  objektId?: string | null;        // betroffenes Haus (nur bei Schreiben an Handwerker)
};

// deno-lint-ignore no-explicit-any
async function mieterBlock(mieterId: string, zugriff: Zugriff, ohneNachricht: string | null): Promise<{ text: string; objektId: string | null; m: any }> {
  const [m] = await rest(
    `mieter?id=eq.${enc(mieterId)}&select=id,anrede,vorname,nachname,telefon,email,mietbeginn,kaltmiete,nebenkosten_vz,strom_pauschale,internet_pauschale,direktzahlung,` +
      "mietart,vergleichsmiete_qm,letzte_erhoehung_am,kaltmiete_vorher," +
      "wohnung:wohnungen(bezeichnung,flaeche_qm,objekt:objekte(id,bezeichnung,strasse,plz,ort,kappungsgrenze)),kostentraeger:kostentraeger(name)",
    zugriff,
  );
  if (!m) return { text: "", objektId: null, m: null };
  const [offen, vorgaenge, fruehere] = await Promise.all([
    rest(`forderungen?mieter_id=eq.${enc(mieterId)}&bezahlt=is.false&select=monat,bezeichnung,betrag&order=monat`, zugriff),
    rest(`vorgaenge?mieter_id=eq.${enc(mieterId)}&select=titel,erstellt_am&order=erstellt_am.desc&limit=5`, zugriff),
    rest(`nachrichten?mieter_id=eq.${enc(mieterId)}${ohneNachricht ? `&id=neq.${enc(ohneNachricht)}` : ""}&select=eingang_am,betreff,ki_zusammenfassung&order=eingang_am.desc&limit=3`, zugriff),
  ]);
  const summe = offen.reduce((s: number, f: { betrag: number }) => s + Number(f.betrag), 0);
  const monate = [...new Set(offen.map((f: { monat: string }) => monatDE(f.monat)))];
  const o = m.wohnung?.objekt;
  const text =
    "<mieter>\n" +
    `Name: ${m.anrede === "Herr" || m.anrede === "Frau" ? m.anrede + " " : ""}${[m.vorname, m.nachname].filter(Boolean).join(" ")}\n` +
    `Wohnung: ${m.wohnung?.bezeichnung ?? "-"}, ${o ? `${o.strasse}, ${o.plz} ${o.ort} (${o.bezeichnung})` : "-"}\n` +
    `Mietbeginn: ${m.mietbeginn ? datumDE(m.mietbeginn) : "-"}\n` +
    `Monatlich: Kaltmiete ${euro(m.kaltmiete)}, Nebenkosten-Vorauszahlung ${euro(m.nebenkosten_vz)}` +
    `${Number(m.strom_pauschale) ? `, Strompauschale ${euro(m.strom_pauschale)}` : ""}` +
    `${Number(m.internet_pauschale) ? `, Internetpauschale ${euro(m.internet_pauschale)}` : ""}\n` +
    `Kostenträger: ${m.kostentraeger?.name ?? "keiner (Selbstzahler)"}${m.kostentraeger ? `, Direktzahlung an Vermieter: ${m.direktzahlung ? "ja" : "nein"}` : ""}\n` +
    `Offene Posten: ${offen.length ? `${euro(summe)} (${monate.join(", ")})` : "keine"}\n` +
    `Bisherige Schreiben: ${vorgaenge.length ? vorgaenge.map((v: { titel: string; erstellt_am: string }) => `${datumDE(v.erstellt_am)} ${v.titel}`).join("; ") : "keine"}\n` +
    `Frühere Nachrichten: ${fruehere.length ? fruehere.map((n: { eingang_am: string; betreff: string; ki_zusammenfassung: string }) => `${datumDE(n.eingang_am)} „${n.betreff ?? ""}“${n.ki_zusammenfassung ? ": " + n.ki_zusammenfassung : ""}`).join("; ") : "keine"}\n` +
    "</mieter>";
  return { text, objektId: o?.id ?? null, m };
}

async function wissenBlock(objektId: string | null, zugriff: Zugriff): Promise<string> {
  const [wissen, dienstleister] = await Promise.all([
    rest(`wissen?aktiv=is.true&select=titel,inhalt,ordner,objekt_id&order=ordner,titel${objektId ? `&or=(objekt_id.is.null,objekt_id.eq.${enc(objektId)})` : "&objekt_id=is.null"}`, zugriff),
    rest(`dienstleister?aktiv=is.true&select=name,gewerk,telefon${objektId ? `&or=(objekt_id.is.null,objekt_id.eq.${enc(objektId)})` : "&objekt_id=is.null"}&order=gewerk`, zugriff).catch(() => []),
  ]);
  const teile: string[] = [];
  if (wissen.length) {
    let gesamt = 0;
    const eintraege: string[] = [];
    for (const w of wissen) {
      const block = `### [${w.ordner}] ${w.titel}\n${w.inhalt}`;
      if (gesamt + block.length > 12000) break;
      gesamt += block.length;
      eintraege.push(block);
    }
    teile.push(`<wissen>\n${eintraege.join("\n\n")}\n</wissen>`);
  }
  if (dienstleister.length) {
    teile.push(`<dienstleister>\n${dienstleister.map((d: { name: string; gewerk: string; telefon: string }) => `${d.gewerk ?? "-"}: ${d.name}${d.telefon ? `, Tel. ${d.telefon}` : ""}`).join("\n")}\n</dienstleister>`);
  }
  return teile.join("\n\n");
}

const REGELN_ENTWURF =
  "- Schreibe auf Deutsch. Ist die eingegangene Nachricht in einer anderen Sprache oder in einfachem Deutsch geschrieben, antworte in einfachem, klarem Deutsch (kurze Sätze). Eine andere Sprache nur, wenn Robert das anweist.\n" +
  "- Verwende nur Fakten aus <mieter>, <wissen>, <dienstleister>, der eingegangenen Nachricht und Roberts Anweisung. Erfinde keine Termine, Beträge, Namen, Telefonnummern oder Zusagen. Fehlt etwas, formuliere neutral und nenne die Lücke in 'hinweise'.\n" +
  "- Roberts Anweisung hat Vorrang vor dem Wissen. " + KI_REGEL_FREMD + "\n" +
  "- Nenne keine Bankverbindung und keine Beträge, die nicht in den Daten stehen. Keine rechtlichen Zusagen (Mietminderung, Kündigungsfristen, Kaution): verweise auf eine Prüfung und nenne das in 'hinweise'.\n" +
  "- Hat die Nachricht mehrere Anliegen, gehe auf jedes kurz ein (gern als nummerierte Absätze).\n" +
  "- Schadensmeldung, die unklar beschrieben ist und zu der keine Fotos vorliegen: Bitte freundlich um 1 bis 3 Fotos des Schadens (einfach als Antwort auf diese E-Mail) und um eine kurze Beschreibung, seit wann es so ist.\n" +
  "- Einfache Selbsthilfe-Tipps sind erlaubt (z. B. Silikonfugen mit Schimmelentferner reinigen, regelmäßig stoßlüften, Siphon reinigen). Kennzeichne sie im Text immer als unverbindlichen Vorschlag, z. B. „Unser Tipp (unverbindlich): …“, und nenne sie zusätzlich in 'hinweise'. " +
  "NIEMALS Tipps zu Strom/Elektrik, Gas, Wasser von oben oder Rohrbruch, Heizungsanlage, Dach oder Statik: dort immer den Fachbetrieb bzw. Notdienst nennen.\n" +
  "- Beginne mit der Anrede („Sehr geehrte Frau …,“ / „Sehr geehrter Herr …,“, bei Ämtern „Sehr geehrte Damen und Herren,“, sonst „Guten Tag,“). Danach kurze Absätze. Keine Grußformel, keine Unterschrift – beides wird automatisch angefügt.\n" +
  "- Antworte ausschließlich über das Werkzeug 'entwurf'.";

// deno-lint-ignore no-explicit-any
export async function entwurfKontext(o: EntwurfAuftrag): Promise<{ system: string; text: string; mieterId: string | null; bilder: any[]; hinweise: string[] }> {
  const { zugriff } = o;
  const [profil] = await rest("vermieter_profil?id=eq.1&select=firma,inhaber,ki_tonfall", zugriff);
  let nachricht = null;
  if (o.nachrichtId) {
    [nachricht] = await rest(`nachrichten?id=eq.${enc(o.nachrichtId)}&select=*`, zugriff);
    if (!nachricht) throw new Fehler(404, "Nachricht nicht gefunden.", "nicht_gefunden");
  }
  const teile: string[] = [`Heute ist ${heuteDE()}.`];
  let objektId: string | null = null;
  let dienstleister = null;
  if (o.dienstleisterId && !nachricht) {
    [dienstleister] = await rest(`dienstleister?id=eq.${enc(o.dienstleisterId)}&select=name,gewerk`, zugriff);
    if (!dienstleister) throw new Fehler(404, "Handwerker nicht gefunden.", "nicht_gefunden");
    teile.push(`<empfaenger>Handwerker/Dienstleister: ${dienstleister.name}${dienstleister.gewerk ? ` (${dienstleister.gewerk})` : ""}</empfaenger>`);
    if (o.objektId) {
      const [haus] = await rest(`objekte?id=eq.${enc(o.objektId)}&select=id,bezeichnung,strasse,plz,ort`, zugriff);
      if (haus) {
        objektId = haus.id;
        teile.push(`<haus>${haus.bezeichnung}: ${haus.strasse}, ${haus.plz} ${haus.ort}</haus>`);
      }
    }
  }
  // An Handwerker gehen keine Mieterdaten (Miete, Rückstände, Kostenträger)
  const mieterId = dienstleister ? null : o.mieterId ?? nachricht?.mieter_id ?? null;
  if (mieterId) {
    const b = await mieterBlock(mieterId, zugriff, o.nachrichtId ?? null);
    if (b.text) teile.push(b.text);
    objektId = b.objektId;
  }
  const w = await wissenBlock(objektId, zugriff);
  if (w) teile.push(w);

  const hinweise: string[] = [];
  let bilder: unknown[] = [];
  if (nachricht) {
    // deno-lint-ignore no-explicit-any
    const anh = (nachricht.anhaenge ?? []) as any[];
    const fotos = anh.filter((a) => /^image\//.test(a.typ ?? "")).length;
    const pdfs = anh.filter((a) => a.typ === "application/pdf").length;
    teile.push(
      "<eingegangene_nachricht>\n" +
        `Von: ${nachricht.absender_name ?? ""} <${nachricht.absender_email ?? "unbekannt"}>\n` +
        `Eingang: ${datumDE(nachricht.eingang_am)}\nBetreff: ${nachricht.betreff ?? ""}\n` +
        `Anhänge: ${fotos} Foto(s), ${pdfs} PDF(s)${fotos ? " – die Fotos siehst du oben" : ""}\n\n${kuerze(nachricht.text, 8000)}\n` +
        "</eingegangene_nachricht>",
    );
    bilder = await bilderDerNachricht(nachricht, zugriff, hinweise);
  }
  if (o.anweisung?.trim()) teile.push(`<anweisung_von_robert>\n${kuerze(o.anweisung, 3000)}\n</anweisung_von_robert>`);
  if (o.bisher?.text) {
    teile.push(`<bisheriger_entwurf>\nBetreff: ${o.bisher.betreff ?? ""}\n\n${kuerze(o.bisher.text, 6000)}\n</bisheriger_entwurf>`);
    teile.push(`<aenderungswunsch>\n${kuerze(o.aenderung || "Sprachlich glätten.", 2000)}\n</aenderungswunsch>`);
  }
  const aufgabe = o.bisher?.text
    ? "Überarbeite den bisherigen Entwurf genau nach dem Änderungswunsch. Alles andere bleibt, wie es ist."
    : nachricht
    ? "Entwirf eine Antwort auf die eingegangene Nachricht." + (o.anweisung ? " Setze dabei die Anweisung von Robert um." : "")
    : dienstleister
    ? "Entwirf ein Schreiben an den Handwerker/Dienstleister nach der Anweisung von Robert."
    : "Entwirf ein Schreiben nach der Anweisung von Robert.";
  const system =
    `Du schreibst im Namen von ${profil?.inhaber ?? "der Verwaltung"} (${profil?.firma ?? "Hausverwaltung"}) an Mieter, Ämter, Interessenten und Handwerker.\n` +
    `Tonfall: ${profil?.ki_tonfall || "Sie-Form, freundlich, klar und kurz."}\n\nRegeln:\n` + REGELN_ENTWURF +
    (dienstleister
      ? "\n- Dieses Schreiben geht an einen Handwerker/Dienstleister: sachlich und geschäftlich, Anrede „Sehr geehrte Damen und Herren,“. " +
        "Nenne nur, was Robert angibt (Ort, Auftrag, Termin, Kontakt). Keine Angaben zu Mieten, Rückständen, Kostenträgern oder Bankdaten."
      : "");
  // deno-lint-ignore no-explicit-any
  return { system, text: `${teile.join("\n\n")}\n\nAufgabe: ${aufgabe}`, mieterId, bilder: bilder as any[], hinweise };
}

// deno-lint-ignore no-explicit-any
export async function entwirf(o: EntwurfAuftrag): Promise<any> {
  const { system, text, mieterId, bilder, hinweise } = await entwurfKontext(o);
  const { daten, modell } = await claude({ system, inhalt: [...bilder, { type: "text", text }], werkzeug: WERKZEUG_ENTWURF, maxTokens: 3000 });
  return {
    betreff: String(daten.betreff ?? "").slice(0, 200),
    text: String(daten.text ?? "").replace(/\n{3,}/g, "\n\n").trim(),
    hinweise: [...hinweise, ...(Array.isArray(daten.hinweise) ? daten.hinweise.map(String) : [])].slice(0, 8),
    modell,
    mieter_id: mieterId,
  };
}

// ---------------------------------------------------------------------------
// Auftrag an einen Handwerker (Briefing)
// ---------------------------------------------------------------------------
// deno-lint-ignore no-explicit-any
export async function auftrag(o: { zugriff: Zugriff; nachrichtId: string; dienstleisterId?: string | null; anweisung?: string | null }): Promise<any> {
  const { zugriff } = o;
  const [nachricht] = await rest(`nachrichten?id=eq.${enc(o.nachrichtId)}&select=*`, zugriff);
  if (!nachricht) throw new Fehler(404, "Nachricht nicht gefunden.", "nicht_gefunden");
  const [profil] = await rest("vermieter_profil?id=eq.1&select=firma,inhaber,telefon,email", zugriff);
  let dienstleister = null;
  if (o.dienstleisterId) [dienstleister] = await rest(`dienstleister?id=eq.${enc(o.dienstleisterId)}&select=name,gewerk`, zugriff);
  // Nur was der Handwerker braucht: Name, Adresse, Wohnung, Kontakt. Keine Rückstände, kein Kostenträger, keine Bankdaten.
  let ort = "<ort>unbekannt – bitte von Robert ergänzen lassen</ort>";
  if (nachricht.mieter_id) {
    const [m] = await rest(
      `mieter?id=eq.${enc(nachricht.mieter_id)}&select=anrede,vorname,nachname,telefon,email,wohnung:wohnungen(bezeichnung,objekt:objekte(strasse,plz,ort))`,
      zugriff,
    );
    if (m) {
      const ob = m.wohnung?.objekt;
      ort = "<ort>\n" +
        `Adresse: ${ob ? `${ob.strasse}, ${ob.plz} ${ob.ort}` : "-"}, Wohnung ${m.wohnung?.bezeichnung ?? "-"}\n` +
        `Mieter: ${[m.anrede === "Herr" || m.anrede === "Frau" ? m.anrede : "", m.vorname, m.nachname].filter(Boolean).join(" ")}\n` +
        `Telefon Mieter: ${m.telefon || "nicht hinterlegt"}\nE-Mail Mieter: ${m.email || "nicht hinterlegt"}\n</ort>`;
    }
  }
  const hinweise: string[] = [];
  const bilder = await bilderDerNachricht(nachricht, zugriff, hinweise);
  const fotos = (nachricht.anhaenge ?? []).filter((a: { typ?: string }) => /^image\//.test(a.typ ?? "")).length;
  const text = [
    `Heute ist ${heuteDE()}.`,
    `<handwerker>${dienstleister ? `${dienstleister.name} (${dienstleister.gewerk ?? "Gewerk unbekannt"})` : "noch nicht ausgewählt"}</handwerker>`,
    ort,
    `<schadensmeldung>\nBetreff: ${nachricht.betreff ?? ""}\nEingang: ${datumDE(nachricht.eingang_am)}\nFotos: ${fotos}\n\n${kuerze(nachricht.text, 6000)}\n</schadensmeldung>`,
    o.anweisung?.trim() ? `<anweisung_von_robert>\n${kuerze(o.anweisung, 2000)}\n</anweisung_von_robert>` : "",
    "Aufgabe: Schreibe einen kurzen, sachlichen Auftrag an den Handwerker.",
  ].filter(Boolean).join("\n\n");
  const system =
    `Du schreibst im Namen von ${profil?.inhaber ?? "der Verwaltung"} (${profil?.firma ?? "Hausverwaltung"}) einen Auftrag an einen Handwerker.\nRegeln:\n` +
    "- Inhalt: Was ist kaputt (aus Meldung und Fotos, sachlich, ohne Vermutungen als Tatsache), wo (Adresse, Wohnung), Kontakt des Mieters für die Terminabsprache, Bitte um kurze Rückmeldung mit Termin und bei größerem Aufwand vorab um einen Kostenvoranschlag.\n" +
    `- Fotos: ${fotos ? "Hinweis, dass die Fotos im Anhang sind." : "Es liegen keine Fotos vor."}\n` +
    "- Keine Beträge, Fristen oder Zusagen erfinden. Keine Angaben zu Miete, Rückständen, Jobcenter oder Bankdaten.\n" +
    "- " + KI_REGEL_FREMD + "\n" +
    "- Anrede „Sehr geehrte Damen und Herren,“ (oder den Namen, falls bekannt), kurze Absätze, keine Grußformel, keine Unterschrift.\n" +
    "- Antworte ausschließlich über das Werkzeug 'entwurf'.";
  const { daten, modell } = await claude({ system, inhalt: [...bilder, { type: "text", text }], werkzeug: WERKZEUG_ENTWURF, maxTokens: 2000 });
  return {
    betreff: String(daten.betreff ?? `Auftrag: ${nachricht.betreff ?? ""}`).slice(0, 200),
    text: String(daten.text ?? "").replace(/\n{3,}/g, "\n\n").trim(),
    hinweise: [...hinweise, ...(Array.isArray(daten.hinweise) ? daten.hinweise.map(String) : [])].slice(0, 8),
    modell,
  };
}

// ---------------------------------------------------------------------------
// Foto, PDF, Word oder Excel lesen: Anfrage fürs Postfach oder Dokument für die Ablage?
// ---------------------------------------------------------------------------
const WERKZEUG_DOKUMENT: Werkzeug = {
  name: "dokument",
  description: "Liest ein fotografiertes oder hochgeladenes Schreiben und schlägt vor, wohin es gehört.",
  input_schema: {
    type: "object",
    properties: {
      eingang: { type: "string", enum: ["anfrage", "dokument"], description: "anfrage: ein Mieter, Amt oder Interessent will etwas und braucht eine Antwort (→ Postfach). dokument: Rechnung, Vertrag, Bescheid, Abrechnung, Angebot, Notiz o. Ä. zum Ablegen." },
      absender_name: { type: ["string", "null"], description: "Wer hat es geschrieben (Person oder Firma/Stelle)." },
      absender_kurz: { type: ["string", "null"], description: "Kurzname des Absenders für den Dateinamen, 1–2 Wörter, z. B. 'Stadtwerke', 'Haustechnik Muster'." },
      absender_email: { type: ["string", "null"] },
      datum: { type: ["string", "null"], description: "Datum des Schreibens als JJJJ-MM-TT, falls erkennbar." },
      betreff: { type: "string", description: "Betreff aus dem Schreiben oder eine kurze eigene Überschrift." },
      text: { type: "string", description: "Abschrift ab der Anrede (bei Anfragen vollständig). Bei langen Dokumenten das Wesentliche, höchstens ca. 3000 Zeichen. Absätze durch Leerzeilen trennen." },
      zusammenfassung: { type: "string", description: "1–2 Sätze: Worum geht es? Bei Rechnungen Betrag und Fälligkeit nennen, falls angegeben." },
      objekt_id: { type: ["string", "null"], description: "ID aus <objekte>, wenn das Schreiben eindeutig ein Haus betrifft (Adresse!). Sonst null." },
      mieter_id: { type: ["string", "null"], description: "ID aus der Mieterliste, wenn eindeutig eine Mietpartei betroffen ist. Sonst null." },
      ordner: { type: "string", enum: DOKUMENT_ORDNER },
      art: { type: "string", enum: DOKUMENT_ARTEN },
      ...NAMENS_FELDER,
      lesbar: { type: "boolean", description: "false, wenn nichts Lesbares zu erkennen ist." },
    },
    required: ["eingang", "betreff", "text", "zusammenfassung", "ordner", "art", "lesbar", "objekt_id", "mieter_id"],
  },
};

// datei: Foto/PDF als { daten, typ } oder ausgelesener Text einer Word-/Excel-Datei als { text, art: "word" | "excel" };
// dateiname (optional): Name auf dem Gerät, nur als Hinweis
export async function liesDokument(
  datei: { daten?: string; typ?: string; text?: string; art?: string },
  zugriff: Zugriff,
  dateiname: unknown = null,
  // deno-lint-ignore no-explicit-any
): Promise<any> {
  const alsText = typeof datei.text === "string";
  const istPdf = datei.typ === "application/pdf";
  if (alsText) {
    if (!datei.text!.trim()) throw new Fehler(400, "In der Datei steht kein lesbarer Text.", "eingabe");
  } else {
    if (typeof datei.daten !== "string" || !datei.typ) throw new Fehler(400, "Foto oder PDF fehlt", "eingabe");
    if (!istPdf && !/^image\/(jpeg|png|webp|gif)$/.test(datei.typ)) throw new Fehler(400, "Bitte ein Foto (JPEG/PNG) oder ein PDF senden.", "eingabe");
    if (datei.daten.length > (istPdf ? 11_000_000 : 7_000_000)) throw new Fehler(413, "Die Datei ist zu groß.", "eingabe");
  }
  const name = ohneIban(dateiname).replace(/[\u0000-\u001f<>]/g, " ").trim().slice(0, 150);
  const [{ objekte, text: objekteText }, { mieter, text: mieterText }, { namen: ordnerListe, hinweis: ordnerHinweis }, { wohnungen, text: wohnungenText }] = await Promise.all([
    objektListe(zugriff), mieterListe(zugriff), dokumentOrdnerInfo(zugriff), wohnungListe(zugriff),
  ]);
  // Werkzeug mit der aktuellen Ordnerliste (Unterordner mit „/“)
  const werkzeug: Werkzeug = {
    ...WERKZEUG_DOKUMENT,
    input_schema: {
      ...WERKZEUG_DOKUMENT.input_schema,
      properties: {
        ...(WERKZEUG_DOKUMENT.input_schema.properties as Record<string, unknown>),
        ordner: { type: "string", enum: ordnerListe, description: "Passendster Ordner der Ablage. Unterordner sind mit „/“ geschrieben; den genauesten passenden wählen." + ordnerHinweis },
      },
    },
  };
  // Text aus Word/Excel: Bankverbindungen entfernen, Länge begrenzen
  const block = alsText
    ? { type: "text", text: `<datei art="${datei.art === "excel" ? "Excel-Tabelle" : "Word-Dokument"}">\n${kuerze(ohneIban(datei.text), 20000)}\n</datei>` }
    : istPdf
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: datei.daten } }
    : { type: "image", source: { type: "base64", media_type: datei.typ, data: datei.daten } };
  const hinweisName = name ? `\n\nDateiname auf dem Gerät (nur ein Hinweis, kann ungenau sein): ${name}` : "";
  const { daten } = await claude({
    system: `Du liest Schreiben für eine Hausverwaltung ab und schlägst die Ablage vor. Heute ist ${heuteDE()}. ${KI_REGEL_FREMD} Antworte ausschließlich über das Werkzeug 'dokument'.`,
    inhalt: [block, { type: "text", text: `${objekteText}\n\n${wohnungenText}\n\n${mieterText}${hinweisName}\n\n${alsText ? "Lies die Datei (Tabellen: Zeilen mit Tabulatoren) und ordne sie ein." : "Lies das Schreiben und ordne es ein."}` }],
    werkzeug,
    maxTokens: 4000,
  });
  return {
    eingang: daten.eingang === "anfrage" ? "anfrage" : "dokument",
    absender_name: ohneLeer(daten.absender_name),
    absender_kurz: ohneLeer(daten.absender_kurz),
    absender_email: ohneLeer(daten.absender_email),
    datum: datumOk(daten.datum) ? daten.datum : null,
    betreff: String(daten.betreff ?? "").slice(0, 300),
    text: String(daten.text ?? "").slice(0, 12000),
    zusammenfassung: String(daten.zusammenfassung ?? "").slice(0, 600),
    objekt_id: objekte.some((x: { id: string }) => x.id === daten.objekt_id) ? daten.objekt_id : null,
    mieter_id: mieter.some((x: { id: string }) => x.id === daten.mieter_id) ? daten.mieter_id : null,
    ordner: nurAus(ordnerListe, daten.ordner, "Sonstiges"),
    art: nurAus(DOKUMENT_ARTEN, daten.art, "Sonstiges"),
    thema: ohneLeer(daten.thema)?.slice(0, 40) ?? null,
    betrag: betragKurz(daten.betrag),
    wohnung_id: wohnungen.some((x: { id: string }) => x.id === daten.wohnung_id) ? daten.wohnung_id : null,
    lesbar: daten.lesbar !== false,
  };
}

// ---------------------------------------------------------------------------
// Ablage-Vorschlag für Text aus der App (E-Mail, gesendetes Schreiben, Notiz)
// ---------------------------------------------------------------------------
/** Bankverbindungen entfernen, bevor Text an die KI geht */
export const ohneIban = (s: unknown) =>
  String(s ?? "").replace(/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/g, "[IBAN entfernt]");

const WERKZEUG_ABLAGE: Werkzeug = {
  name: "ablage",
  description: "Schlägt vor, in welchen Ordner der Ablage ein Text gehört.",
  input_schema: {
    type: "object",
    properties: {
      ordner: { type: "string", enum: DOKUMENT_ORDNER, description: "Passendster Ordner. Unterordner sind mit „/“ geschrieben; den genauesten passenden wählen." },
      art: { type: "string", enum: DOKUMENT_ARTEN },
      gegenueber_kurz: { type: ["string", "null"], description: "Kurzname des Gegenübers für den Dateinamen (1–2 Wörter): bei Eingang der Absender, bei Ausgang der Empfänger, z. B. 'Huber', 'Jobcenter', 'Haustechnik Muster'." },
      ...NAMENS_FELDER,
      zusammenfassung: { type: "string", description: "1 kurzer Satz: worum geht es?" },
    },
    required: ["ordner", "art", "gegenueber_kurz", "thema", "betrag", "wohnung_id", "zusammenfassung"],
  },
};

type AblageAnfrage = {
  titel?: string; text?: string; richtung?: string; art?: string | null; gegenueber?: string | null;
  mieter_id?: string | null; objekt_id?: string | null;
};

// deno-lint-ignore no-explicit-any
export async function ablageVorschlag(e: AblageAnfrage, zugriff: Zugriff): Promise<any> {
  const text = kuerze(ohneIban(e.text), 4000);
  const titel = ohneIban(e.titel).slice(0, 300);
  if (!text.trim() && !titel.trim()) throw new Fehler(400, "Kein Text zum Ablegen.", "eingabe");
  const [{ namen: ordnerListe, hinweis: ordnerHinweis }, mieter, haus] = await Promise.all([
    dokumentOrdnerInfo(zugriff),
    e.mieter_id ? rest(`mieter?id=eq.${enc(e.mieter_id)}&select=vorname,nachname,wohnung_id,wohnung:wohnungen(bezeichnung,objekt_id,objekt:objekte(bezeichnung))`, zugriff).then((r) => r[0]).catch(() => null) : null,
    e.objekt_id ? rest(`objekte?id=eq.${enc(e.objekt_id)}&select=bezeichnung`, zugriff).then((r) => r[0]).catch(() => null) : null,
  ]);
  // Wohnungen des betroffenen Hauses (für „WHG 1“ im Dateinamen)
  const hausId = e.objekt_id ?? mieter?.wohnung?.objekt_id ?? null;
  const { wohnungen, text: wohnungenText } = hausId ? await wohnungListe(zugriff, hausId) : { wohnungen: [], text: "" };
  const richtung = e.richtung === "ausgang" ? "Ausgang (von uns gesendet)" : e.richtung === "notiz" ? "eigene Notiz der Verwaltung" : "Eingang (an uns)";
  const werkzeug: Werkzeug = {
    ...WERKZEUG_ABLAGE,
    input_schema: {
      ...WERKZEUG_ABLAGE.input_schema,
      properties: {
        ...(WERKZEUG_ABLAGE.input_schema.properties as Record<string, unknown>),
        ordner: { type: "string", enum: ordnerListe, description: "Passendster Ordner. Unterordner sind mit „/“ geschrieben; den genauesten passenden wählen." + ordnerHinweis },
      },
    },
  };
  const kontext = [
    `<ordner>\n${ordnerListe.join("\n")}\n</ordner>`,
    `Richtung: ${richtung}`,
    e.art ? `Art laut App: ${e.art}` : "",
    e.gegenueber ? `Gegenüber: ${String(e.gegenueber).slice(0, 120)}` : "",
    mieter ? `Mietpartei: ${[mieter.vorname, mieter.nachname].filter(Boolean).join(" ")} (${mieter.wohnung?.objekt?.bezeichnung ?? ""}, ${mieter.wohnung?.bezeichnung ?? ""})` : "",
    haus ? `Haus: ${haus.bezeichnung}` : "",
    wohnungenText,
    `<text>\nTitel: ${titel}\n\n${text}\n</text>`,
  ].filter(Boolean).join("\n\n");
  const { daten } = await claude({
    system: `Du ordnest Schriftverkehr einer Hausverwaltung in die vorgegebenen Ordner ein. ${KI_REGEL_FREMD} Antworte ausschließlich über das Werkzeug 'ablage', auf Deutsch.`,
    inhalt: [{ type: "text", text: kontext }],
    werkzeug,
    maxTokens: 600,
  });
  return {
    ordner: nurAus(ordnerListe, daten.ordner, "Sonstiges"),
    art: nurAus(DOKUMENT_ARTEN, daten.art, nurAus(DOKUMENT_ARTEN, e.art, "Sonstiges")),
    gegenueber_kurz: ohneLeer(daten.gegenueber_kurz)?.slice(0, 40) ?? null,
    thema: ohneLeer(ohneIban(daten.thema))?.slice(0, 40) ?? null,
    betrag: betragKurz(daten.betrag),
    wohnung_id: wohnungen.some((x: { id: string }) => x.id === daten.wohnung_id) ? daten.wohnung_id : (mieter?.wohnung_id ?? null),
    zusammenfassung: String(daten.zusammenfassung ?? "").slice(0, 300),
  };
}

// ---------------------------------------------------------------------------
// Eingesprochenes Wissen ordnen
// ---------------------------------------------------------------------------
const WERKZEUG_WISSEN: Werkzeug = {
  name: "wissen",
  description: "Macht aus einer gesprochenen Notiz einen sauberen Wissenseintrag.",
  input_schema: {
    type: "object",
    properties: {
      titel: { type: "string", description: "Kurzer, eindeutiger Titel, z. B. 'Heizung Lindenstraße: Druck nachfüllen'." },
      inhalt: { type: "string", description: "Der Inhalt sauber und knapp formuliert. Alle Fakten, Zahlen, Namen und Telefonnummern unverändert übernehmen, nichts dazuerfinden." },
      objekt_id: { type: ["string", "null"], description: "ID aus <objekte>, wenn eindeutig ein Haus gemeint ist. Sonst null (gilt für alle)." },
      ordner: { type: "string", enum: WISSEN_ORDNER },
    },
    required: ["titel", "inhalt", "objekt_id", "ordner"],
  },
};

export async function ordneWissen(text: string, zugriff: Zugriff, objektId?: string | null) {
  if (!text?.trim()) throw new Fehler(400, "Bitte erst etwas einsprechen oder eintippen.", "eingabe");
  const { objekte, text: objekteText } = await objektListe(zugriff);
  const { daten } = await claude({
    system: "Du hilfst einer Hausverwaltung, technisches und organisatorisches Wissen zu den Häusern abzulegen. Antworte ausschließlich über das Werkzeug 'wissen', auf Deutsch.",
    inhalt: [{ type: "text", text: `${objekteText}\n\n${objektId ? `Robert ist gerade auf der Seite des Hauses ${objektId}.\n\n` : ""}<notiz>\n${kuerze(text, 6000)}\n</notiz>` }],
    werkzeug: WERKZEUG_WISSEN,
    maxTokens: 1500,
  });
  return {
    titel: String(daten.titel ?? "").slice(0, 150),
    inhalt: String(daten.inhalt ?? "").slice(0, 6000),
    objekt_id: objekte.some((x: { id: string }) => x.id === daten.objekt_id) ? daten.objekt_id : (objektId ?? null),
    ordner: nurAus(WISSEN_ORDNER, daten.ordner, "Sonstiges"),
  };
}

// ---------------------------------------------------------------------------
// Notiz prüfen (z. B. „Check Möglichkeit Mieterhöhung Huber“)
// ---------------------------------------------------------------------------
const WERKZEUG_PRUEFUNG: Werkzeug = {
  name: "pruefung",
  description: "Kurze Antwort zu einer Notiz der Verwaltung.",
  input_schema: {
    type: "object",
    properties: {
      antwort: { type: "string", description: "2–6 kurze Sätze. Ergebnis zuerst. Nur Fakten aus den Daten; bei Mieterhöhungen die Zahlen aus <mieterhoehung_pruefung> übernehmen, nicht selbst rechnen." },
      wiedervorlage: { type: ["string", "null"], description: "Vorschlag für eine Wiedervorlage als JJJJ-MM-TT, wenn die Sache jetzt noch nicht geht oder später erneut geprüft werden sollte. Sonst null." },
      fehlend: { type: "array", items: { type: "string" }, description: "Angaben, die für eine sichere Antwort fehlen." },
    },
    required: ["antwort", "wiedervorlage", "fehlend"],
  },
};

// deno-lint-ignore no-explicit-any
export async function pruefeNotiz(aufgabeId: string, zugriff: Zugriff): Promise<any> {
  const [a] = await rest(`aufgaben?id=eq.${enc(aufgabeId)}&select=*`, zugriff);
  if (!a) throw new Fehler(404, "Notiz nicht gefunden.", "nicht_gefunden");
  const teile: string[] = [`Heute ist ${heuteDE()}.`];
  let objektId = a.objekt_id ?? null;
  let mieterhoehung = null;
  if (a.mieter_id) {
    const b = await mieterBlock(a.mieter_id, zugriff, null);
    if (b.text) teile.push(b.text);
    objektId = objektId ?? b.objektId;
    if (b.m) {
      const m = b.m;
      mieterhoehung = pruefeMieterhoehung({
        heute: heuteISO(), mietart: m.mietart ?? "normal", kaltmiete: Number(m.kaltmiete),
        kaltmiete_vorher: m.kaltmiete_vorher != null ? Number(m.kaltmiete_vorher) : null,
        letzte_erhoehung_am: m.letzte_erhoehung_am, mietbeginn: m.mietbeginn,
        wohnflaeche: m.wohnung?.flaeche_qm != null ? Number(m.wohnung.flaeche_qm) : null,
        vergleichsmiete_qm: m.vergleichsmiete_qm != null ? Number(m.vergleichsmiete_qm) : null,
        kappungsgrenze: m.wohnung?.objekt?.kappungsgrenze != null ? Number(m.wohnung.objekt.kappungsgrenze) : 20,
      });
      if (/miet\w*erh|erh(ö|oe)h|anheb|vergleichsmiete|kappung|mietspiegel/i.test(`${a.titel} ${a.notiz ?? ""}`)) {
        teile.push(`<mieterhoehung_pruefung>\nErgebnis: ${mieterhoehung.moeglich}\n${mieterhoehung.gruende.join("\n")}\n` +
          `${mieterhoehung.fehlend.length ? `Fehlende Angaben: ${mieterhoehung.fehlend.join(", ")}\n` : ""}` +
          `Frühestes Erhöhungsverlangen: ${mieterhoehung.frueheste_zustellung ?? "-"}\n${mieterhoehung.hinweis}\n</mieterhoehung_pruefung>`);
      } else {
        mieterhoehung = null;
      }
    }
  }
  const w = await wissenBlock(objektId, zugriff);
  if (w) teile.push(w);
  teile.push(`<notiz>\nTitel: ${a.titel}\n${a.notiz ? `Notiz: ${kuerze(a.notiz, 3000)}\n` : ""}</notiz>`);
  const { daten } = await claude({
    system: "Du prüfst kurze Notizen einer Hausverwaltung und gibst eine knappe Einschätzung. Keine Rechtsberatung: bei rechtlichen Fragen zur Prüfung durch Fachleute raten. Erfinde nichts. Antworte ausschließlich über das Werkzeug 'pruefung', auf Deutsch.",
    inhalt: [{ type: "text", text: teile.join("\n\n") + "\n\nAufgabe: Beantworte die Notiz." }],
    werkzeug: WERKZEUG_PRUEFUNG,
    maxTokens: 1500,
  });
  let wv = datumOk(daten.wiedervorlage) && daten.wiedervorlage > heuteISO() ? daten.wiedervorlage : null;
  if (mieterhoehung?.frueheste_zustellung && mieterhoehung.frueheste_zustellung > heuteISO()) wv = mieterhoehung.frueheste_zustellung;
  return {
    antwort: String(daten.antwort ?? "").slice(0, 2000) + (mieterhoehung ? `\n\n${mieterhoehung.hinweis}` : ""),
    wiedervorlage: wv,
    fehlend: Array.isArray(daten.fehlend) ? daten.fehlend.map(String).slice(0, 6) : [],
    mieterhoehung,
  };
}
