// Edge Function "miete": KI für die Mieteingänge. Nur für freigeschaltete Mitglieder (pruefeMitglied).
// Liefert nur Vorschläge; gespeichert wird erst nach Bestätigung in der App. Nie IBAN an die KI.
//   { aktion: "mieteingang_vorschlaege", monat, zeilen } → nächster Schritt je Mietpartei (nur Zahlen, keine Namen)
//   { aktion: "buchungen_zuordnen", buchungen }          → unklare Kontobuchungen Mietparteien zuordnen (ohne IBAN)
import { CORS, Fehler, fehlerAntwort, json, pruefeMitglied } from "../_shared/gemeinsam.ts";
import { buchungenZuordnen, mieteingangVorschlaege } from "../_shared/miete.ts";

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ fehler: "Nur POST" }, 405);
  try {
    const zugriff = await pruefeMitglied(req);
    const e = await req.json().catch(() => ({}));
    switch (e.aktion) {
      case "mieteingang_vorschlaege":
        return json(await mieteingangVorschlaege(e, zugriff));
      case "buchungen_zuordnen":
        return json(await buchungenZuordnen(e, zugriff));
      default:
        throw new Fehler(400, "Unbekannte Aktion", "eingabe");
    }
  } catch (err) {
    return fehlerAntwort(err);
  }
}

// deno-lint-ignore no-explicit-any
if ((globalThis as any).Deno?.serve) Deno.serve(handler);
