// Edge Function "posteingang": nimmt eingehende E-Mails entgegen und legt sie im Postfach ab.
// Adresse: https://<projekt>.supabase.co/functions/v1/posteingang?token=<Token aus Tabelle postfach>
// Unterstützt:
//   - Resend-Webhook "email.received" (Inhalt wird über die Resend-API nachgeladen, braucht RESEND_API_KEY)
//   - einfaches JSON { from, subject, text, html?, message_id?, id? } (z. B. aus einem Cloudflare Email Worker)
//   - Postmark-Format { From, FromName, Subject, TextBody, HtmlBody, MessageID }
// Ist RESEND_WEBHOOK_SECRET gesetzt, muss zusätzlich jede Anfrage gültig signiert sein (nur Resend).
// Anhänge (nur Fotos und PDF, mit Größen- und Inhaltsprüfung) werden in den privaten Bucket „eingang“ übernommen.
// Ist die KI eingerichtet, wird die Nachricht gleich eingeordnet.
import {
  CORS, Fehler, dateiArt, enc, env, fehlerAntwort, gleich, htmlZuText, json, kiEingerichtet, kuerze, pruefeSvix,
  rest, speichereDatei, zerlegeAdresse,
} from "../_shared/gemeinsam.ts";
import { bezugsIds, ordneEin, themaFuerEingang } from "../_shared/fach.ts";

const ADMIN = { admin: true } as const;

// Kopfzeile aus Resend/Postmark: als Objekt { "In-Reply-To": … } oder als Liste [{ name, value }]
function kopfWert(kopf: unknown, name: string): string | null {
  if (!kopf) return null;
  if (Array.isArray(kopf)) {
    // deno-lint-ignore no-explicit-any
    const e = kopf.find((x: any) => String(x?.name ?? x?.Name ?? x?.key ?? "").toLowerCase() === name);
    // deno-lint-ignore no-explicit-any
    return e ? String((e as any).value ?? (e as any).Value ?? "") : null;
  }
  if (typeof kopf === "object") {
    for (const [k, v] of Object.entries(kopf as Record<string, unknown>)) {
      if (k.toLowerCase() === name) return Array.isArray(v) ? v.join(" ") : String(v ?? "");
    }
  }
  return null;
}

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

const ERLAUBT = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ANHAENGE = 6;
const sichererName = (s: unknown) =>
  String(s ?? "Anhang").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._]+/, "").slice(0, 80) || "Anhang";

// Anhänge einer bei Resend eingegangenen Mail übernehmen. Alles andere als Fotos/PDF wird verworfen.
export async function uebernimmAnhaenge(emailId: string, nachrichtId: string): Promise<unknown[]> {
  const schluessel = env("RESEND_API_KEY");
  if (!schluessel) return [];
  const basis = env("RESEND_URL") ?? "https://api.resend.com";
  const liste = await fetch(`${basis}/emails/receiving/${enc(emailId)}/attachments`, { headers: { Authorization: `Bearer ${schluessel}` } });
  if (!liste.ok) throw new Fehler(502, `Resend: Anhänge nicht abrufbar (${liste.status})`, "resend");
  // deno-lint-ignore no-explicit-any
  const daten: any[] = (await liste.json())?.data ?? [];
  const ergebnis: unknown[] = [];
  for (const [i, a] of daten.entries()) {
    const eintrag = { name: String(a.filename ?? "Anhang").slice(0, 120), typ: a.content_type ?? null, groesse: a.size ?? null };
    if (i >= MAX_ANHAENGE || !ERLAUBT.includes(a.content_type) || (a.size && a.size > MAX_BYTES) || !a.download_url) {
      ergebnis.push({ ...eintrag, verworfen: true });
      continue;
    }
    try {
      const r = await fetch(a.download_url);
      const bytes = new Uint8Array(await r.arrayBuffer());
      const art = r.ok ? dateiArt(bytes) : null;
      if (!art || bytes.length > MAX_BYTES) { ergebnis.push({ ...eintrag, verworfen: true }); continue; }
      const pfad = `${nachrichtId}/${i + 1}_${sichererName(a.filename)}`;
      await speichereDatei("eingang", pfad, bytes, art, ADMIN);
      ergebnis.push({ name: eintrag.name, typ: art, groesse: bytes.length, pfad });
    } catch (err) {
      console.error("Anhang nicht übernommen:", err);
      ergebnis.push({ ...eintrag, verworfen: true });
    }
  }
  return ergebnis;
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
    let bezug: string[] = []; // In-Reply-To / References: gehört die Mail zu einem Vorgang?
    let anhaenge: unknown[] = [];
    if (e.type === "email.received" && e.data?.email_id) {
      const voll = await ladeResendMail(e.data.email_id);
      absender = zerlegeAdresse(voll?.headers?.from ?? voll?.from ?? e.data.from);
      betreff = voll?.subject ?? e.data.subject ?? "";
      text = voll ? (voll.text || htmlZuText(voll.html)) : "(Inhalt nicht geladen: In Supabase fehlt das Secret RESEND_API_KEY.)";
      externId = `resend:${e.data.email_id}`;
      messageId = voll?.message_id ?? e.data.message_id ?? null;
      bezug = bezugsIds(kopfWert(voll?.headers, "in-reply-to"), kopfWert(voll?.headers, "references"), voll?.in_reply_to, voll?.references);
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
      bezug = bezugsIds(e.in_reply_to, e.InReplyTo, e.references, e.References, kopfWert(e.headers ?? e.Headers, "in-reply-to"), kopfWert(e.headers ?? e.Headers, "references"));
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

    // 4. Doppelte Zustellung? Dann nichts tun (auch keinen Vorgang anlegen)
    if (externId) {
      const [schon] = await rest(`nachrichten?extern_id=eq.${enc(externId)}&select=id`, ADMIN);
      if (schon) return json({ ok: true, doppelt: true });
    }
    // Vorgang: Antwort auf eine frühere Mail oder gleicher Betreff derselben Person, sonst neu
    const themaId = await themaFuerEingang({ betreff, email: absender.email, mieterId, bezug }, ADMIN).catch(() => null);

    // 5. Ablegen (doppelte Zustellungen werden ignoriert)
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
          thema_id: themaId,
          erstellt_von: null,
        },
      },
    );
    const neu = Array.isArray(zeilen) ? zeilen[0] : null;
    if (!neu) return json({ ok: true, doppelt: true });

    // 6. Im Hintergrund: Anhänge übernehmen, dann einordnen (Fehler verhindern den Eingang nicht)
    const resendId = e.type === "email.received" ? e.data.email_id : null;
    if (resendId || kiEingerichtet()) {
      const arbeit = (async () => {
        if (resendId && anhaenge.length) {
          try {
            const gespeichert = await uebernimmAnhaenge(resendId, neu.id);
            if (gespeichert.length) await rest(`nachrichten?id=eq.${enc(neu.id)}`, ADMIN, { method: "PATCH", body: { anhaenge: gespeichert } });
          } catch (err) { console.error("Anhänge fehlgeschlagen:", err); }
        }
        if (kiEingerichtet()) await ordneEin(neu.id, ADMIN);
      })().catch((err) => console.error("Einordnen fehlgeschlagen:", err));
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
