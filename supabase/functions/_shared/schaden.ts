// Schadensmeldung, Schritt 3: Die Antwort eines Handwerkers lesen und vorschlagen, was der Mieter erfahren soll.
// Nur Vorschläge (Termin, Betrag, Anweisung für das Schreiben); eingetragen und geschrieben wird erst nach Roberts Klick.
// An die KI gehen nur Antwort, Auftrag (Titel, Beschreibung) und Name des Handwerkers – keine Mieten, keine Bankdaten.
import { Fehler, KI_REGEL_FREMD, type Werkzeug, type Zugriff, claude, datumDE, datumOk, enc, heuteDE, heuteISO, kuerze, rest } from "./gemeinsam.ts";

const ARTEN = ["termin_vorschlag", "termin_fest", "rueckfrage", "angebot", "erledigt", "sonstiges"] as const;
const IBAN = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/g;
const ohneIban = (s: unknown) => String(s ?? "").replace(IBAN, "[IBAN entfernt]");

const WERKZEUG: Werkzeug = {
  name: "auswertung",
  description: "Wertet die Antwort eines Handwerkers zu einem Auftrag aus.",
  input_schema: {
    type: "object",
    properties: {
      art: {
        type: "string", enum: [...ARTEN],
        description: "termin_vorschlag: schlägt einen oder mehrere Termine vor, noch nicht fest. termin_fest: nennt einen festen Termin. " +
          "rueckfrage: braucht Infos (Fotos, Maße, Zugang …). angebot: schickt ein Angebot/Kostenvoranschlag. erledigt: meldet die Arbeit als erledigt. sonstiges: anderes.",
      },
      zusammenfassung: { type: "string", description: "1–2 Sätze: Was schreibt der Handwerker?" },
      termin: { type: ["string", "null"], description: "Fester oder vorgeschlagener Termin als JJJJ-MM-TT (der erste, falls mehrere). Sonst null." },
      termin_text: { type: ["string", "null"], description: "Termin(e) wörtlich kurz, z. B. 'Do 06.11., 8–10 Uhr' oder 'Di oder Mi vormittags'. Sonst null." },
      betrag: { type: ["string", "null"], description: "Genannter Betrag (Angebot/Kosten) im Format 480,00. Sonst null." },
      mieter_informieren: { type: "boolean", description: "true, wenn die Mietpartei jetzt etwas erfahren oder tun muss (Termin bestätigen, zu Hause sein, Fotos schicken, Zugang ermöglichen)." },
      direkt_abstimmen: { type: "boolean", description: "true, wenn der Handwerker anbietet, den Termin direkt mit der Mietpartei abzusprechen, oder darum bittet." },
      mieter_anweisung: {
        type: "string",
        description: "Anweisung an die schreibende KI für ein Schreiben an die Mietpartei, mit allen nötigen Fakten (Name des Handwerkers, Termin/Zeitfenster, was die Mietpartei tun soll). " +
          "Keine Beträge und keine Kosten nennen. Leer, wenn die Mietpartei nichts erfahren muss.",
      },
    },
    required: ["art", "zusammenfassung", "termin", "termin_text", "betrag", "mieter_informieren", "direkt_abstimmen", "mieter_anweisung"],
  },
};

function betragZahl(roh: unknown): number | null {
  let s = String(roh ?? "").replace(/[€\s]|EUR/gi, "");
  if (!s) return null;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) s = s.replace(/\./g, "");
  s = s.replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) && n > 0 && n < 1_000_000 ? Math.round(n * 100) / 100 : null;
}

// deno-lint-ignore no-explicit-any
export async function liesHandwerkerAntwort(nachrichtId: string, auftragId: string | null, zugriff: Zugriff): Promise<any> {
  const [n] = await rest(`nachrichten?id=eq.${enc(nachrichtId)}&select=id,betreff,text,absender_name,absender_email,eingang_am,thema_id`, zugriff);
  if (!n) throw new Fehler(404, "Nachricht nicht gefunden.", "nicht_gefunden");
  let a = null;
  if (auftragId) [a] = await rest(`auftraege?id=eq.${enc(auftragId)}&select=id,titel,beschreibung,status,termin,dienstleister_id,handwerker`, zugriff).catch(() => []);
  const hwId = a?.dienstleister_id ?? a?.handwerker?.[0]?.dienstleister_id ?? null;
  const [hw] = hwId ? await rest(`dienstleister?id=eq.${enc(hwId)}&select=id,name,gewerk,telefon,email`, zugriff).catch(() => []) : [];
  const text = [
    `Heute ist ${heuteDE()} (${heuteISO()}).`,
    a ? `<auftrag>\nTitel: ${a.titel}\n${a.beschreibung ? `Beschreibung: ${kuerze(ohneIban(a.beschreibung), 1500)}\n` : ""}Status: ${a.status}${a.termin ? `\nBisher eingetragener Termin: ${datumDE(a.termin)}` : ""}\n</auftrag>` : "",
    hw ? `<handwerker>${hw.name}${hw.gewerk ? ` (${hw.gewerk})` : ""}${hw.telefon ? `, Tel. ${hw.telefon}` : ""}</handwerker>` : "",
    `<antwort_des_handwerkers>\nVon: ${n.absender_name ?? ""} <${n.absender_email ?? "unbekannt"}>\nEingang: ${datumDE(n.eingang_am)}\nBetreff: ${n.betreff ?? ""}\n\n${kuerze(ohneIban(n.text), 6000)}\n</antwort_des_handwerkers>`,
    "Aufgabe: Werte die Antwort aus und schlage vor, was die Mietpartei jetzt erfahren muss.",
  ].filter(Boolean).join("\n\n");
  const { daten } = await claude({
    system: "Du hilfst einer Hausverwaltung, die Antwort eines Handwerkers auf einen Reparaturauftrag einzuordnen. Erfinde nichts: Termine und Beträge nur, wenn sie in der Antwort stehen. " +
      `Ein Datum ohne Jahr bezieht sich auf das nächste passende Datum ab heute. ${KI_REGEL_FREMD} Antworte ausschließlich über das Werkzeug 'auswertung', auf Deutsch.`,
    inhalt: [{ type: "text", text }],
    werkzeug: WERKZEUG,
    maxTokens: 1500,
  });
  const termin = datumOk(daten.termin) && daten.termin >= heuteISO() ? daten.termin : null;
  return {
    art: (ARTEN as readonly string[]).includes(daten.art) ? daten.art : "sonstiges",
    zusammenfassung: ohneIban(daten.zusammenfassung).slice(0, 500),
    termin,
    termin_text: daten.termin_text ? ohneIban(daten.termin_text).slice(0, 120) : null,
    betrag: betragZahl(daten.betrag),
    mieter_informieren: daten.mieter_informieren !== false,
    direkt_abstimmen: daten.direkt_abstimmen === true,
    mieter_anweisung: ohneIban(daten.mieter_anweisung).trim().slice(0, 2000),
    handwerker: hw ? { id: hw.id, name: hw.name, telefon: hw.telefon ?? null } : null,
  };
}
