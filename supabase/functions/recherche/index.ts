// Edge Function "recherche": Recherche im Internet (Websuche der Claude-Schnittstelle). Nur für freigeschaltete Mitglieder.
// Ins Internet geht nur, was Robert eingibt (Ort, Adresse, Eckdaten) – keine Daten aus der App.
//   { aktion: "standort", abschnitt: "markt"|"recht"|"handwerker"|"partner", ort, adresse?, objektart?, einheiten?, wohnflaeche?, baujahr?, gewerke? }
//       → { abschnitt, ergebnis, quellen, suchen }   (die App ruft die Abschnitte parallel auf)
//   { aktion: "frage", frage }  → { text, quellen } bzw. { fehler } (Suchanfrage mit persönlichen Daten wird abgelehnt)
import { CORS, Fehler, fehlerAntwort, json, pruefeMitglied } from "../_shared/gemeinsam.ts";
import { standortAbschnitt, webRecherche } from "../_shared/recherche.ts";

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ fehler: "Nur POST" }, 405);
  try {
    const zugriff = await pruefeMitglied(req);
    const e = await req.json().catch(() => ({}));
    switch (e.aktion) {
      case "standort":
        return json(await standortAbschnitt(e, zugriff));
      case "frage":
        return json(await webRecherche(e.frage, zugriff));
      default:
        throw new Fehler(400, "Unbekannte Aktion", "eingabe");
    }
  } catch (err) {
    return fehlerAntwort(err);
  }
}

// deno-lint-ignore no-explicit-any
if ((globalThis as any).Deno?.serve) Deno.serve(handler);
