// Edge Function "schaden": KI für den Ablauf einer Schadensmeldung (Schritt 3: Rückmeldung des Handwerkers auswerten).
// Nur für freigeschaltete Mitglieder (pruefeMitglied). Liefert nur Vorschläge; gespeichert wird erst nach Bestätigung in der App.
//   { aktion: "handwerker_antwort", nachricht_id, auftrag_id? } → Art der Antwort, Termin/Betrag (Vorschlag), Anweisung für das Schreiben an den Mieter
import { CORS, Fehler, fehlerAntwort, json, pruefeMitglied } from "../_shared/gemeinsam.ts";
import { liesHandwerkerAntwort } from "../_shared/schaden.ts";

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ fehler: "Nur POST" }, 405);
  try {
    const zugriff = await pruefeMitglied(req);
    const e = await req.json().catch(() => ({}));
    switch (e.aktion) {
      case "handwerker_antwort":
        if (!e.nachricht_id) throw new Fehler(400, "nachricht_id fehlt", "eingabe");
        return json(await liesHandwerkerAntwort(e.nachricht_id, e.auftrag_id ?? null, zugriff));
      default:
        throw new Fehler(400, "Unbekannte Aktion", "eingabe");
    }
  } catch (err) {
    return fehlerAntwort(err);
  }
}

// deno-lint-ignore no-explicit-any
if ((globalThis as any).Deno?.serve) Deno.serve(handler);
