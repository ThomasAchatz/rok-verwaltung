// Edge Function "ki": alle KI-Aufgaben der App. Nur für freigeschaltete Mitglieder (pruefeMitglied).
// Die KI liefert immer nur Vorschläge; gespeichert, gesendet oder geändert wird erst nach einem Klick in der App.
//   { aktion: "status" }
//   { aktion: "einordnen", nachricht_id }
//   { aktion: "entwurf", nachricht_id?, mieter_id?, dienstleister_id?, kontakt_id?, kostentraeger_id?, objekt_id?, rundschreiben?, absender?, anweisung?, bisher?, aenderung? }
//   { aktion: "auftrag", nachricht_id, dienstleister_id?, anweisung? }       → Auftrag an Handwerker
//   { aktion: "brief_lesen", bild: { daten, typ } | datei_text: { text, art }, dateiname? } → Foto/PDF/Word/Excel lesen + Ablage vorschlagen
//   { aktion: "ablage_vorschlag", titel, text, richtung, art?, gegenueber?, mieter_id?, objekt_id? } → Ordner für die Ablage
//   { aktion: "wissen_ordnen", text, objekt_id? }                             → eingesprochenes Wissen ordnen
//   { aktion: "notiz_pruefen", aufgabe_id }                                   → Notiz prüfen (z. B. Mieterhöhung)
//   { aktion: "chat", verlauf: [{ rolle: "robert"|"ki", text }] }            → Fragen an die App
//   { aktion: "notiz_lesen", text, kontakt_id?, mieter_id? }                  → eingesprochene Notiz: wer, was, Termine, Schreiben
//   { aktion: "thema_zusammenfassen", thema_id }                              → Zusammenfassung für das Abschluss-PDF
//   { aktion: "datei_erschliessen", bild | datei_text, dateiname?, ordner? } → kurze Inhaltsangabe einer abgelegten Datei
import { CORS, Fehler, MODELL, env, fehlerAntwort, json, kiEingerichtet, pruefeMitglied } from "../_shared/gemeinsam.ts";
import {
  ablageVorschlag, auftrag, entwirf, erschliesseDatei, fasseThemaZusammen, liesDokument, ordneEin, ordneWissen, pruefeNotiz,
} from "../_shared/fach.ts";
import { chat } from "../_shared/chat.ts";
import { liesNotiz } from "../_shared/notiz.ts";

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ fehler: "Nur POST" }, 405);
  try {
    const zugriff = await pruefeMitglied(req);
    const e = await req.json().catch(() => ({}));
    switch (e.aktion) {
      case "status":
        return json({
          ki: kiEingerichtet(),
          modell: MODELL(),
          versand: !!env("RESEND_API_KEY") && !!env("VERSAND_ABSENDER"),
          absender: env("VERSAND_ABSENDER") ?? null,
          webhook_signatur: !!env("RESEND_WEBHOOK_SECRET"),
        });
      case "einordnen":
        if (!e.nachricht_id) throw new Fehler(400, "nachricht_id fehlt", "eingabe");
        return json({ nachricht: await ordneEin(e.nachricht_id, zugriff) });
      case "entwurf":
        if (!e.nachricht_id && !e.anweisung?.trim()) throw new Fehler(400, "Bitte sagen Sie der KI, was im Schreiben stehen soll.", "eingabe");
        return json(await entwirf({
          zugriff, nachrichtId: e.nachricht_id ?? null, mieterId: e.mieter_id ?? null,
          anweisung: e.anweisung ?? null, bisher: e.bisher ?? null, aenderung: e.aenderung ?? null,
          dienstleisterId: e.dienstleister_id ?? null, objektId: e.objekt_id ?? null,
          kontaktId: e.kontakt_id ?? null, kostentraegerId: e.kostentraeger_id ?? null,
          rundschreiben: e.rundschreiben === true,
          absender: e.absender && typeof e.absender === "object" ? { name: e.absender.name ?? null, bezeichnung: e.absender.bezeichnung ?? null } : null,
        }));
      case "auftrag":
        if (!e.nachricht_id) throw new Fehler(400, "nachricht_id fehlt", "eingabe");
        return json(await auftrag({ zugriff, nachrichtId: e.nachricht_id, dienstleisterId: e.dienstleister_id ?? null, anweisung: e.anweisung ?? null }));
      case "brief_lesen":
        if (typeof e.datei_text?.text === "string") {
          return json(await liesDokument({ text: e.datei_text.text, art: e.datei_text.art }, zugriff, e.dateiname ?? null));
        }
        if (!e.bild?.daten || !e.bild?.typ) throw new Fehler(400, "Foto oder PDF fehlt", "eingabe");
        return json(await liesDokument(e.bild, zugriff, e.dateiname ?? null));
      case "ablage_vorschlag":
        return json(await ablageVorschlag({
          titel: e.titel, text: e.text, richtung: e.richtung, art: e.art ?? null, gegenueber: e.gegenueber ?? null,
          mieter_id: e.mieter_id ?? null, objekt_id: e.objekt_id ?? null,
        }, zugriff));
      case "wissen_ordnen":
        return json(await ordneWissen(String(e.text ?? ""), zugriff, e.objekt_id ?? null));
      case "notiz_pruefen":
        if (!e.aufgabe_id) throw new Fehler(400, "aufgabe_id fehlt", "eingabe");
        return json(await pruefeNotiz(e.aufgabe_id, zugriff));
      case "chat":
        return json(await chat(e.verlauf, zugriff));
      case "notiz_lesen":
        return json(await liesNotiz(String(e.text ?? ""), zugriff, { kontaktId: e.kontakt_id ?? null, mieterId: e.mieter_id ?? null }));
      case "thema_zusammenfassen":
        if (!e.thema_id) throw new Fehler(400, "thema_id fehlt", "eingabe");
        return json(await fasseThemaZusammen(e.thema_id, zugriff));
      case "datei_erschliessen":
        if (typeof e.datei_text?.text === "string") {
          return json(await erschliesseDatei({ text: e.datei_text.text, art: e.datei_text.art }, zugriff, e.dateiname ?? null, e.ordner ?? null));
        }
        if (!e.bild?.daten || !e.bild?.typ) throw new Fehler(400, "Datei fehlt", "eingabe");
        return json(await erschliesseDatei(e.bild, zugriff, e.dateiname ?? null, e.ordner ?? null));
      default:
        throw new Fehler(400, "Unbekannte Aktion", "eingabe");
    }
  } catch (err) {
    return fehlerAntwort(err);
  }
}

// deno-lint-ignore no-explicit-any
if ((globalThis as any).Deno?.serve) Deno.serve(handler);
