// Edge Function "versand": verschickt eine Antwort per E-Mail über Resend.
// Wird NUR per Klick aus der App ausgelöst (nie automatisch).
//   { antwort_id, an?, anhang?: { dateiname, daten (base64) } }
// Benötigt die Secrets RESEND_API_KEY und VERSAND_ABSENDER (z. B. "ROK Immobilien <verwaltung@rok-immobilien.com>").
import {
  CORS, Fehler, base64, enc, env, fehlerAntwort, istEmail, json, ladeDatei, pruefeMitglied, rest,
} from "../_shared/gemeinsam.ts";

const BUCKETS = ["eingang", "dokumente"];
const MAX_ANHANG_GESAMT = 20 * 1024 * 1024;

const escHtml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

export function emailText(text: string, profil: Record<string, string | null>): string {
  const signatur = profil.email_signatur?.trim() || [profil.inhaber, profil.firma].filter(Boolean).join("\n");
  return `${text.trim()}\n\nMit freundlichen Grüßen\n${signatur}`;
}

// Briefkopf unter der E-Mail: Firma, Anschrift, Kontakt (aus den Einstellungen)
export function briefkopfZeilen(profil: Record<string, string | null>): string[] {
  const ort = [profil.plz, profil.ort].filter(Boolean).join(" ");
  return [
    profil.firma,
    [profil.strasse, ort].filter(Boolean).join(", "),
    [profil.telefon ? `Tel. ${profil.telefon}` : "", profil.email, profil.web].filter(Boolean).join(" · "),
  ].map((z) => String(z ?? "").trim()).filter(Boolean);
}

export function emailHtml(volltext: string, profil: Record<string, string | null> = {}): string {
  const absaetze = volltext.split(/\n{2,}/).map((a) => `<p style="margin:0 0 12px">${escHtml(a).replace(/\n/g, "<br>")}</p>`);
  const kopf = briefkopfZeilen(profil);
  const fuss = kopf.length
    ? `<div style="margin-top:20px;padding-top:10px;border-top:2px solid #b08d57;font-size:12px;line-height:1.5;color:#5a6270">` +
      kopf.map((z, i) => (i === 0 ? `<strong style="color:#1f3a5f;font-size:13px">${escHtml(z)}</strong>` : escHtml(z))).join("<br>") + "</div>"
    : "";
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1d2430">${absaetze.join("")}${fuss}</div>`;
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

    const [profil] = await rest("vermieter_profil?id=eq.1&select=firma,inhaber,email_signatur,antwort_email,strasse,plz,ort,telefon,email,web", zugriff);
    let nachricht = null;
    if (antwort.nachricht_id) {
      [nachricht] = await rest(`nachrichten?id=eq.${enc(antwort.nachricht_id)}&select=id,extern_message_id`, zugriff);
    }

    const volltext = emailText(antwort.text, profil ?? {});
    const kopf = briefkopfZeilen(profil ?? {});
    const nutzlast: Record<string, unknown> = {
      from: absender,
      to: [an],
      subject: String(antwort.betreff || "Ihre Nachricht").replace(/[\r\n]+/g, " ").slice(0, 200),
      text: kopf.length ? `${volltext}\n\n--\n${kopf.join("\n")}` : volltext,
      html: emailHtml(volltext, profil ?? {}),
    };
    if (profil?.antwort_email && istEmail(profil.antwort_email)) nutzlast.reply_to = profil.antwort_email;
    // Message-ID stammt aus einer fremden Mail: nur eine saubere <…@…>-Kennung übernehmen
    let mid = String(nachricht?.extern_message_id ?? "").replace(/[\r\n]/g, "").trim();
    if (/^[^<>\s]{1,250}@[^<>\s]{1,250}$/.test(mid)) mid = `<${mid}>`;
    if (/^<[^<>\s]{1,250}@[^<>\s]{1,250}>$/.test(mid)) {
      nutzlast.headers = { "In-Reply-To": mid, References: mid };
    }
    const anhaenge: { filename: string; content: string }[] = [];
    const sauber = (n: unknown) => String(n ?? "").replace(/[\r\n\\/"]/g, "").slice(0, 120) || "Anhang";
    if (eingabe.anhang?.daten && eingabe.anhang?.dateiname) {
      if (eingabe.anhang.daten.length > 8_000_000) throw new Fehler(413, "Der Anhang ist zu groß.", "eingabe");
      anhaenge.push({ filename: sauber(eingabe.anhang.dateiname), content: eingabe.anhang.daten });
    }
    // Anhänge aus dem Speicher (z. B. Fotos zum Handwerker-Auftrag) – gelesen mit Roberts Rechten
    let gesamt = 0;
    for (const a of (Array.isArray(antwort.anhaenge) ? antwort.anhaenge : []).slice(0, 8)) {
      if (!BUCKETS.includes(a?.bucket) || typeof a?.pfad !== "string") continue;
      const { bytes } = await ladeDatei(a.bucket, a.pfad, zugriff);
      gesamt += bytes.length;
      if (gesamt > MAX_ANHANG_GESAMT) throw new Fehler(413, "Die Anhänge sind zusammen zu groß (max. 20 MB).", "eingabe");
      anhaenge.push({ filename: sauber(a.name), content: base64(bytes) });
    }
    if (anhaenge.length) nutzlast.attachments = anhaenge;

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
    const istAuftrag = antwort.art === "auftrag";
    // Ein Auftrag an den Handwerker beantwortet die Nachricht des Mieters noch nicht
    if (antwort.nachricht_id && !istAuftrag) {
      await rest(`nachrichten?id=eq.${enc(antwort.nachricht_id)}`, zugriff, { method: "PATCH", body: { status: "beantwortet" } });
    }
    if (antwort.mieter_id) {
      await rest("vorgaenge", zugriff, {
        method: "POST",
        body: {
          mieter_id: antwort.mieter_id,
          typ: istAuftrag ? "auftrag" : "antwort",
          titel: `${istAuftrag ? `Auftrag an ${antwort.empfaenger_name || an}` : "E-Mail"}: ${antwort.betreff || "Antwort"}`,
          details: { antwort_id: antwort.id, an, kanal: "email", anhaenge: anhaenge.map((a) => a.filename) },
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
