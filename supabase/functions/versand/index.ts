// Edge Function "versand": verschickt eine Antwort per E-Mail über Resend.
// Wird NUR per Klick aus der App ausgelöst (nie automatisch).
//   { antwort_id, an?, anhang?: { dateiname, daten (base64) } }
// Benötigt die Secrets RESEND_API_KEY und VERSAND_ABSENDER (z. B. "ROK Immobilien <verwaltung@rok-immobilien.com>").
import { CORS, Fehler, enc, env, fehlerAntwort, istEmail, json, pruefeMitglied, rest } from "../_shared/gemeinsam.ts";

const escHtml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

export function emailText(text: string, profil: Record<string, string | null>): string {
  const signatur = profil.email_signatur?.trim() || [profil.inhaber, profil.firma].filter(Boolean).join("\n");
  return `${text.trim()}\n\nMit freundlichen Grüßen\n${signatur}`;
}

export function emailHtml(volltext: string): string {
  const absaetze = volltext.split(/\n{2,}/).map((a) => `<p style="margin:0 0 12px">${escHtml(a).replace(/\n/g, "<br>")}</p>`);
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1d2430">${absaetze.join("")}</div>`;
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ fehler: "Nur POST" }, 405);
  try {
    const zugriff = await pruefeMitglied(req);
    const schluessel = env("RESEND_API_KEY"), absender = env("VERSAND_ABSENDER");
    if (!schluessel || !absender) {
      throw new Fehler(503, "Der E-Mail-Versand ist noch nicht eingerichtet (RESEND_API_KEY / VERSAND_ABSENDER fehlen).", "versand_fehlt");
    }
    const eingabe = await req.json().catch(() => ({}));
    if (!eingabe.antwort_id) throw new Fehler(400, "antwort_id fehlt", "eingabe");

    const [antwort] = await rest(`antworten?id=eq.${enc(eingabe.antwort_id)}&select=*`, zugriff);
    if (!antwort) throw new Fehler(404, "Antwort nicht gefunden.", "nicht_gefunden");
    if (antwort.status === "gesendet") throw new Fehler(409, "Diese Antwort wurde bereits gesendet.", "schon_gesendet");
    const an = String(eingabe.an ?? antwort.empfaenger_email ?? "").trim();
    if (!istEmail(an)) throw new Fehler(400, "Bitte eine gültige Empfänger-Adresse angeben.", "eingabe");
    if (!antwort.text?.trim()) throw new Fehler(400, "Die Antwort ist leer.", "eingabe");

    const [profil] = await rest("vermieter_profil?id=eq.1&select=firma,inhaber,email_signatur,antwort_email", zugriff);
    let nachricht = null;
    if (antwort.nachricht_id) {
      [nachricht] = await rest(`nachrichten?id=eq.${enc(antwort.nachricht_id)}&select=id,extern_message_id`, zugriff);
    }

    const volltext = emailText(antwort.text, profil ?? {});
    const nutzlast: Record<string, unknown> = {
      from: absender,
      to: [an],
      subject: antwort.betreff || "Ihre Nachricht",
      text: volltext,
      html: emailHtml(volltext),
    };
    if (profil?.antwort_email && istEmail(profil.antwort_email)) nutzlast.reply_to = profil.antwort_email;
    if (nachricht?.extern_message_id) {
      nutzlast.headers = { "In-Reply-To": nachricht.extern_message_id, References: nachricht.extern_message_id };
    }
    if (eingabe.anhang?.daten && eingabe.anhang?.dateiname) {
      if (eingabe.anhang.daten.length > 8_000_000) throw new Fehler(413, "Der Anhang ist zu groß.", "eingabe");
      nutzlast.attachments = [{ filename: String(eingabe.anhang.dateiname), content: eingabe.anhang.daten }];
    }

    const basis = env("RESEND_URL") ?? "https://api.resend.com";
    const r = await fetch(`${basis}/emails`, {
      method: "POST",
      headers: { Authorization: `Bearer ${schluessel}`, "Content-Type": "application/json", "Idempotency-Key": `antwort-${antwort.id}` },
      body: JSON.stringify(nutzlast),
    });
    const ergebnis = await r.json().catch(() => null);
    if (!r.ok) {
      const meldung = ergebnis?.message ?? `Status ${r.status}`;
      const tipp = /domain|verify|testing emails/i.test(meldung)
        ? " Tipp: Ohne bestätigte Domain darf Resend nur an die eigene Konto-Adresse senden."
        : "";
      throw new Fehler(502, `Versand fehlgeschlagen: ${meldung}.${tipp}`, "versand_fehler");
    }

    const jetzt = new Date().toISOString();
    await rest(`antworten?id=eq.${enc(antwort.id)}`, zugriff, {
      method: "PATCH",
      body: { status: "gesendet", gesendet_am: jetzt, versand_id: ergebnis?.id ?? null, empfaenger_email: an },
    });
    if (antwort.nachricht_id) {
      await rest(`nachrichten?id=eq.${enc(antwort.nachricht_id)}`, zugriff, { method: "PATCH", body: { status: "beantwortet" } });
    }
    if (antwort.mieter_id) {
      await rest("vorgaenge", zugriff, {
        method: "POST",
        body: {
          mieter_id: antwort.mieter_id,
          typ: "antwort",
          titel: `E-Mail: ${antwort.betreff || "Antwort"}`,
          details: { antwort_id: antwort.id, an, kanal: "email", anhang: eingabe.anhang?.dateiname ?? null },
        },
      });
    }
    return json({ ok: true, id: ergebnis?.id ?? null, an });
  } catch (err) {
    return fehlerAntwort(err);
  }
}

// deno-lint-ignore no-explicit-any
if ((globalThis as any).Deno?.serve) Deno.serve(handler);
