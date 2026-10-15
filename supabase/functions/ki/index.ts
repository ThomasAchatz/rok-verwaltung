// Edge Function "ki": alle KI-Aufgaben der App.
// Aufruf aus der App mit dem Login des Nutzers (nur freigeschaltete Mitglieder).
//   { aktion: "status" }                                       → was ist eingerichtet?
//   { aktion: "einordnen", nachricht_id }                       → Kategorie, Dringlichkeit, Mieter zuordnen
//   { aktion: "entwurf", nachricht_id?, mieter_id?, anweisung?,
//     bisher?: { betreff, text }, aenderung? }                  → Antwort / Schreiben entwerfen
//   { aktion: "brief_lesen", bild: { daten (base64), typ } }    → fotografierten Brief abschreiben
// verify_jwt ist aus: Die Prüfung von Login und Freischaltung passiert in pruefeMitglied().
import {
  CORS, Fehler, MODELL, entwirf, env, fehlerAntwort, json, kiEingerichtet, liesBrief, ordneEin, pruefeMitglied,
} from "../_shared/gemeinsam.ts";

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ fehler: "Nur POST" }, 405);
  try {
    const zugriff = await pruefeMitglied(req);
    const eingabe = await req.json().catch(() => ({}));
    switch (eingabe.aktion) {
      case "status":
        return json({
          ki: kiEingerichtet(),
          modell: MODELL(),
          versand: !!env("RESEND_API_KEY") && !!env("VERSAND_ABSENDER"),
          absender: env("VERSAND_ABSENDER") ?? null,
          webhook_signatur: !!env("RESEND_WEBHOOK_SECRET"),
        });
      case "einordnen":
        if (!eingabe.nachricht_id) throw new Fehler(400, "nachricht_id fehlt", "eingabe");
        return json({ nachricht: await ordneEin(eingabe.nachricht_id, zugriff) });
      case "entwurf":
        if (!eingabe.nachricht_id && !eingabe.anweisung?.trim()) {
          throw new Fehler(400, "Bitte sagen Sie der KI, was im Schreiben stehen soll.", "eingabe");
        }
        return json(await entwirf({
          zugriff,
          nachrichtId: eingabe.nachricht_id ?? null,
          mieterId: eingabe.mieter_id ?? null,
          anweisung: eingabe.anweisung ?? null,
          bisher: eingabe.bisher ?? null,
          aenderung: eingabe.aenderung ?? null,
        }));
      case "brief_lesen":
        if (!eingabe.bild?.daten || !eingabe.bild?.typ) throw new Fehler(400, "Foto fehlt", "eingabe");
        return json(await liesBrief(eingabe.bild));
      default:
        throw new Fehler(400, "Unbekannte Aktion", "eingabe");
    }
  } catch (err) {
    return fehlerAntwort(err);
  }
}

// deno-lint-ignore no-explicit-any
if ((globalThis as any).Deno?.serve) Deno.serve(handler);
