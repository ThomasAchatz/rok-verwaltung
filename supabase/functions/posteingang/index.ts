// Edge Function "posteingang": nimmt eingehende E-Mails entgegen und legt sie im Postfach ab.
// Adresse: https://<projekt>.supabase.co/functions/v1/posteingang?token=<Token aus Tabelle postfach>
// Unterstützt:
//   - Resend-Webhook "email.received" (Inhalt wird über die Resend-API nachgeladen, braucht RESEND_API_KEY)
//   - einfaches JSON { from, subject, text, html?, message_id?, id? } (z. B. aus einem Cloudflare Email Worker)
//   - Postmark-Format { From, FromName, Subject, TextBody, HtmlBody, MessageID }
// Ist RESEND_WEBHOOK_SECRET gesetzt, muss zusätzlich jede Anfrage gültig signiert sein (nur Resend).
// Ist die KI eingerichtet, wird die Nachricht gleich eingeordnet.
import {
  CORS, Fehler, enc, env, fehlerAntwort, gleich, htmlZuText, json, kiEingerichtet, kuerze, ordneEin, pruefeSvix,
  rest, zerlegeAdresse,
} from "../_shared/gemeinsam.ts";

const ADMIN = { admin: true } as const;

// deno-lint-ignore no-explicit-any
async function ladeResendMail(id: string): Promise<any> {
  const schluessel = env("RESEND_API_KEY");
  if (!schluessel) return null;
  const basis = env("RESEND_URL") ?? "https://api.resend.com";
  const antwort = await fetch(`${basis}/emails/receiving/${enc(id)}`, {
    headers: { Authorization: `Bearer ${schluessel}` },
  });
  if (!antwort.ok) throw new Fehler(502, `Resend: E-Mail ${id} konnte nicht geladen werden (${antwort.status})`, "resend");
  return await antwort.json();
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ fehler: "Nur POST" }, 405);
  try {
    // 1. Zugang prüfen: Token aus der Adresse muss zum Token in der Datenbank passen
    const token = new URL(req.url).searchParams.get("token") ?? "";
    const [postfach] = await rest("postfach?id=eq.1&select=token", ADMIN);
    if (!postfach?.token || !token || !gleich(token, postfach.token)) {
      throw new Fehler(401, "Ungültiger Zugang", "token");
    }
    const rohtext = await req.text();
    // Ist das Signing Secret gesetzt, muss JEDE Anfrage korrekt signiert sein
    // (ein geleaktes Token allein reicht dann nicht mehr).
    const geheimnis = env("RESEND_WEBHOOK_SECRET");
    if (geheimnis && !(await pruefeSvix(req, rohtext, geheimnis))) {
      throw new Fehler(401, "Signatur fehlt oder ist ungültig", "signatur");
    }
    // deno-lint-ignore no-explicit-any
    let e: any;
    try { e = JSON.parse(rohtext); } catch { throw new Fehler(400, "Kein gültiges JSON", "eingabe"); }

    // 2. In ein einheitliches Format bringen
    let absender, betreff, text, externId, messageId;
    let anhaenge: unknown[] = [];
    if (e.type === "email.received" && e.data?.email_id) {
      const voll = await ladeResendMail(e.data.email_id);
      absender = zerlegeAdresse(voll?.headers?.from ?? voll?.from ?? e.data.from);
      betreff = voll?.subject ?? e.data.subject ?? "";
      text = voll ? (voll.text || htmlZuText(voll.html)) : "(Inhalt nicht geladen: In Supabase fehlt das Secret RESEND_API_KEY.)";
      externId = `resend:${e.data.email_id}`;
      messageId = voll?.message_id ?? e.data.message_id ?? null;
      anhaenge = (voll?.attachments ?? e.data.attachments ?? []).map((a: Record<string, unknown>) => ({
        name: a.filename, typ: a.content_type, groesse: a.size ?? null, quelle: "resend", id: a.id,
      }));
    } else if (e.type && e.type !== "email.received") {
      return json({ ok: true, ignoriert: e.type }); // andere Resend-Ereignisse
    } else {
      absender = zerlegeAdresse(e.from ?? e.From ?? e.sender);
      if (!absender.name) absender.name = e.from_name ?? e.FromName ?? null;
      betreff = e.subject ?? e.Subject ?? "";
      text = e.text ?? e.TextBody ?? e["body-plain"] ?? htmlZuText(e.html ?? e.HtmlBody);
      messageId = e.message_id ?? e.MessageID ?? null;
      externId = e.id ? `extern:${e.id}` : messageId ? `mid:${messageId}` : null;
      anhaenge = (e.attachments ?? e.Attachments ?? []).map((a: Record<string, unknown>) => ({
        name: a.filename ?? a.Name, typ: a.content_type ?? a.ContentType ?? null,
      }));
    }
    if (!absender?.email && !text) throw new Fehler(400, "Weder Absender noch Text gefunden", "eingabe");

    // 3. Mieter über die E-Mail-Adresse zuordnen
    let mieterId = null;
    if (absender.email) {
      const treffer = await rest(`mieter?select=id&email=ilike.${enc(absender.email)}&limit=2`, ADMIN);
      if (treffer.length === 1) mieterId = treffer[0].id;
    }

    // 4. Ablegen (doppelte Zustellungen werden ignoriert)
    const zeilen = await rest(
      externId ? "nachrichten?on_conflict=extern_id" : "nachrichten",
      ADMIN,
      {
        method: "POST",
        prefer: "return=representation,resolution=ignore-duplicates",
        body: {
          quelle: "email",
          absender_email: absender.email,
          absender_name: absender.name,
          betreff: kuerze(betreff, 300),
          text: kuerze(text, 20000),
          mieter_id: mieterId,
          zuordnung: mieterId ? "email" : null,
          extern_id: externId,
          extern_message_id: messageId,
          anhaenge,
          erstellt_von: null,
        },
      },
    );
    const neu = Array.isArray(zeilen) ? zeilen[0] : null;
    if (!neu) return json({ ok: true, doppelt: true });

    // 5. Gleich einordnen lassen (Fehler hier verhindern den Eingang nicht)
    if (kiEingerichtet()) {
      const arbeit = ordneEin(neu.id, ADMIN).catch((err) => console.error("Einordnen fehlgeschlagen:", err));
      // deno-lint-ignore no-explicit-any
      const laufzeit = (globalThis as any).EdgeRuntime;
      if (laufzeit?.waitUntil) laufzeit.waitUntil(arbeit);
      else await arbeit;
    }
    return json({ ok: true, id: neu.id, mieter_zugeordnet: !!mieterId });
  } catch (err) {
    return fehlerAntwort(err);
  }
}

// deno-lint-ignore no-explicit-any
if ((globalThis as any).Deno?.serve) Deno.serve(handler);
