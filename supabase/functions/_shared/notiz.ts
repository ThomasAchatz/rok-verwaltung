// Eingesprochene Notiz einordnen („Mini-CRM“): Wer ist gemeint (Mietpartei, Kontakt oder neuer Kontakt),
// was ist die Notiz für den Verlauf, gibt es Geburtstag, feste Infos zum Kontakt oder Aufgaben mit Datum?
// Die KI schlägt nur vor; gespeichert wird erst nach Bestätigung in der App. Keine Bankdaten an die KI.
import { Fehler, KI_REGEL_FREMD, type Werkzeug, type Zugriff, claude, datumOk, enc, heuteDE, heuteISO, kuerze, rest } from "./gemeinsam.ts";

export const VERLAUF_ARTEN = ["telefonat", "treffen", "email", "notiz"] as const;
const ZIELE = ["mieter", "kontakt", "neuer_kontakt", "keiner"] as const;
const IBAN = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/g;
const ohneIban = (s: unknown) => String(s ?? "").replace(IBAN, "[IBAN entfernt]");
const kurz = (s: unknown, n: number) => {
  const t = ohneIban(s).replace(/\s+/g, " ").trim();
  return t ? t.slice(0, n) : null;
};

const WERKZEUG_NOTIZ: Werkzeug = {
  name: "notiz",
  description: "Ordnet eine eingesprochene Notiz der Verwaltung einem Kontakt oder einer Mietpartei zu und zerlegt sie.",
  input_schema: {
    type: "object",
    properties: {
      ziel: {
        type: "string", enum: [...ZIELE],
        description: "mieter: betrifft eine Mietpartei aus <mieterliste>. kontakt: betrifft einen Kontakt aus <kontakte>. " +
          "neuer_kontakt: eine Person/Firma, die es in beiden Listen noch nicht gibt (Makler, Bank, Behörde …). keiner: nicht erkennbar.",
      },
      mieter_id: { type: ["string", "null"], description: "ID aus <mieterliste>, nur bei ziel=mieter." },
      kontakt_id: { type: ["string", "null"], description: "ID aus <kontakte>, nur bei ziel=kontakt." },
      neuer_kontakt: {
        type: ["object", "null"],
        description: "Nur bei ziel=neuer_kontakt: was über die Person gesagt wurde.",
        properties: {
          vorname: { type: ["string", "null"] }, nachname: { type: ["string", "null"] },
          firma: { type: ["string", "null"], description: "Firma oder Stelle, z. B. 'Sparkasse Musterstadt'." },
          rolle: { type: ["string", "null"], description: "Kurz: Makler, Bank, Behörde, Steuerberater, Notar, Versicherung, Hausverwaltung, Sonstiges." },
          telefon: { type: ["string", "null"] }, email: { type: ["string", "null"] },
        },
      },
      art: { type: "string", enum: [...VERLAUF_ARTEN], description: "telefonat, treffen (persönlich), email oder notiz (sonst)." },
      datum: { type: ["string", "null"], description: "Datum des Gesprächs als JJJJ-MM-TT. 'heute' = heutiges Datum. Sonst null." },
      notiz: {
        type: "string",
        description: "Die Notiz für den Verlauf: sachlich, kurz (1–5 Sätze), alle Fakten unverändert (Beträge, Raten, Termine, Namen, Objekte). " +
          "Ohne Anweisungen an die App (also nicht 'bitte ablegen', 'mache ein ToDo').",
      },
      kontakt_info: {
        type: ["string", "null"],
        description: "Dauerhafte persönliche Infos für die Kontaktkarte, falls genannt, stichpunktartig (z. B. 'Hat einen Hund; Tochter hat am 22.10. Geburtstag'). Sonst null.",
      },
      geburtstag: {
        type: ["object", "null"],
        description: "Geburtstag der gemeinten Person selbst, nur wenn genannt. Sonst null.",
        properties: { tag: { type: "integer" }, monat: { type: "integer" }, jahr: { type: ["integer", "null"] } },
      },
      aufgaben: {
        type: "array",
        description: "Aufgaben/Erinnerungen, die ausdrücklich gewünscht oder klar vereinbart wurden (Rückruf, Frist, Rate prüfen). " +
          "KEINE Aufgabe für den Geburtstag der Person selbst, wenn er im Feld 'geburtstag' steht: daran erinnert die App jedes Jahr automatisch.",
        items: {
          type: "object",
          properties: {
            titel: { type: "string", description: "Kurz, z. B. 'Zweite Kautionsrate von Frau Meier prüfen'." },
            faellig_am: { type: ["string", "null"], description: "JJJJ-MM-TT, falls ein Datum genannt oder klar ist." },
          },
          required: ["titel", "faellig_am"],
        },
      },
      ablegen: { type: "boolean", description: "true, wenn die Notiz ausdrücklich in der Akte/Ablage abgelegt werden soll." },
    },
    required: ["ziel", "mieter_id", "kontakt_id", "neuer_kontakt", "art", "datum", "notiz", "kontakt_info", "geburtstag", "aufgaben", "ablegen"],
  },
};

const name = (x: { vorname?: string | null; nachname?: string | null }) => [x.vorname, x.nachname].filter(Boolean).join(" ");

function geburtstagOk(g: unknown): { tag: number; monat: number; jahr: number | null } | null {
  if (!g || typeof g !== "object") return null;
  // deno-lint-ignore no-explicit-any
  const { tag, monat, jahr } = g as any;
  const t = Number(tag), m = Number(monat);
  if (!Number.isInteger(t) || !Number.isInteger(m) || m < 1 || m > 12 || t < 1) return null;
  if (t > new Date(Date.UTC(2000, m, 0)).getUTCDate()) return null; // 2000 = Schaltjahr, 29.02. erlaubt
  const j = Number(jahr);
  const jahrOk = Number.isInteger(j) && j >= 1900 && j <= Number(heuteISO().slice(0, 4)) ? j : null;
  return { tag: t, monat: m, jahr: jahrOk };
}

// deno-lint-ignore no-explicit-any
export async function liesNotiz(text: string, zugriff: Zugriff, o: { kontaktId?: string | null; mieterId?: string | null } = {}): Promise<any> {
  const roh = String(text ?? "").trim();
  if (!roh) throw new Fehler(400, "Bitte erst etwas einsprechen oder eintippen.", "eingabe");
  const [mieter, kontakte] = await Promise.all([
    rest("mieter?select=id,vorname,nachname,wohnung:wohnungen(bezeichnung,objekt:objekte(bezeichnung))&order=nachname", zugriff),
    rest("kontakte?select=id,vorname,nachname,firma,rolle&order=nachname", zugriff),
  ]);
  const mieterText = mieter.map((m: { id: string; vorname: string; nachname: string; wohnung?: { bezeichnung?: string; objekt?: { bezeichnung?: string } } }) =>
    `${m.id} | ${name(m)} | ${m.wohnung?.objekt?.bezeichnung ?? ""}, ${m.wohnung?.bezeichnung ?? ""}`).join("\n");
  const kontakteText = kontakte.map((k: { id: string; vorname: string; nachname: string; firma: string; rolle: string }) =>
    `${k.id} | ${name(k) || "-"} | ${k.firma ?? "-"} | ${k.rolle ?? "-"}`).join("\n");
  const gerade = o.kontaktId && kontakte.some((k: { id: string }) => k.id === o.kontaktId)
    ? `Robert ist gerade auf der Seite des Kontakts ${o.kontaktId}. Ohne andere Angabe ist dieser gemeint.\n\n`
    : o.mieterId && mieter.some((m: { id: string }) => m.id === o.mieterId)
    ? `Robert ist gerade in der Akte der Mietpartei ${o.mieterId}. Ohne andere Angabe ist sie gemeint.\n\n`
    : "";

  const { daten } = await claude({
    system:
      `Du hilfst Robert (Hausverwaltung) beim Festhalten von Gesprächen in einem kleinen Kontakt-Verlauf. Heute ist ${heuteDE()} (${heuteISO()}). ` +
      "Ordne die Notiz der richtigen Person zu. Bei Mietparteien und Kontakten nur IDs aus den Listen verwenden, niemals raten. " +
      "Ähnliche Schreibweisen von Namen sind dieselbe Person. Übernimm nur, was gesagt wurde, erfinde nichts. " +
      `${KI_REGEL_FREMD} Antworte ausschließlich über das Werkzeug 'notiz', auf Deutsch.`,
    inhalt: [{
      type: "text",
      text: `<mieterliste>\nID | Name | Haus, Wohnung\n${mieterText}\n</mieterliste>\n\n<kontakte>\nID | Name | Firma | Rolle\n${kontakteText}\n</kontakte>\n\n` +
        `${gerade}<diktat>\n${kuerze(ohneIban(roh), 6000)}\n</diktat>`,
    }],
    werkzeug: WERKZEUG_NOTIZ,
    maxTokens: 1500,
  });

  let ziel = (ZIELE as readonly string[]).includes(daten.ziel) ? daten.ziel : "keiner";
  const mieterId = ziel === "mieter" && mieter.some((m: { id: string }) => m.id === daten.mieter_id) ? daten.mieter_id : null;
  const kontaktId = ziel === "kontakt" && kontakte.some((k: { id: string }) => k.id === daten.kontakt_id) ? daten.kontakt_id : null;
  let neu = null;
  if (ziel === "neuer_kontakt" && daten.neuer_kontakt && typeof daten.neuer_kontakt === "object") {
    const n = daten.neuer_kontakt;
    neu = {
      vorname: kurz(n.vorname, 60), nachname: kurz(n.nachname, 80), firma: kurz(n.firma, 120), rolle: kurz(n.rolle, 40),
      telefon: kurz(n.telefon, 40), email: kurz(n.email, 120),
    };
    if (!neu.nachname && !neu.firma) neu = null;
  }
  if ((ziel === "mieter" && !mieterId) || (ziel === "kontakt" && !kontaktId) || (ziel === "neuer_kontakt" && !neu)) ziel = "keiner";

  const aufgaben = (Array.isArray(daten.aufgaben) ? daten.aufgaben : []).slice(0, 5)
    // deno-lint-ignore no-explicit-any
    .map((a: any) => ({ titel: kurz(a?.titel, 200), faellig_am: datumOk(a?.faellig_am) ? a.faellig_am : null }))
    .filter((a: { titel: string | null }) => a.titel);

  return {
    ziel,
    mieter_id: mieterId,
    kontakt_id: kontaktId,
    neuer_kontakt: neu,
    art: (VERLAUF_ARTEN as readonly string[]).includes(daten.art) ? daten.art : "notiz",
    datum: datumOk(daten.datum) ? daten.datum : heuteISO(),
    notiz: kurz(daten.notiz, 4000) ?? kuerze(ohneIban(roh), 4000),
    kontakt_info: kurz(daten.kontakt_info, 300),
    geburtstag: geburtstagOk(daten.geburtstag),
    aufgaben,
    ablegen: daten.ablegen === true,
  };
}

/** Für den Chat: alles zu einem Kontakt (Stammdaten, Verlauf, offene Aufgaben) */
export async function kontaktInfo(id: string, zugriff: Zugriff) {
  const [k] = await rest(`kontakte?id=eq.${enc(id)}&select=id,vorname,nachname,firma,rolle,telefon,email,adresse,geburtstag_tag,geburtstag_monat,geburtsjahr,notiz`, zugriff);
  if (!k) return { fehler: "nicht gefunden" };
  const [verlauf, aufgaben] = await Promise.all([
    rest(`verlauf?kontakt_id=eq.${enc(id)}&select=datum,art,text&order=datum.desc&limit=20`, zugriff),
    rest(`aufgaben?kontakt_id=eq.${enc(id)}&status=eq.offen&select=id,titel,faellig_am`, zugriff),
  ]);
  return {
    ...k, name: name(k) || k.firma, link: `#/kontakt/${id}`,
    geburtstag: k.geburtstag_tag ? `${k.geburtstag_tag}.${k.geburtstag_monat}.${k.geburtsjahr ?? ""}` : null,
    verlauf: verlauf.map((v: { datum: string; art: string; text: string }) => ({ ...v, text: `<fremder_text>${kuerze(v.text, 1500)}</fremder_text>` })),
    offene_aufgaben: aufgaben,
  };
}
