// Datenzugriff auf Supabase. Alle Abfragen laufen mit dem Login des Nutzers;
// was er sehen darf, entscheidet die Row Level Security in der Datenbank.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

const pruefe = ({ data, error }) => {
  if (error) throw new Error(error.message);
  return data;
};

// --- Anmeldung -------------------------------------------------------------
export async function aktuellerNutzer() {
  const { data } = await sb.auth.getSession();
  return data.session?.user ?? null;
}
export async function anmelden(email, passwort) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password: passwort });
  if (error) throw new Error(error.message);
  return data.user;
}
export async function abmelden() {
  await sb.auth.signOut();
}
export function beiAnmeldeWechsel(cb) {
  sb.auth.onAuthStateChange((ereignis, sitzung) => cb(ereignis, sitzung?.user ?? null));
}
export async function istMitglied(userId) {
  const zeilen = pruefe(await sb.from("mitglieder").select("user_id").eq("user_id", userId));
  return zeilen.length > 0;
}

// --- Lesen -----------------------------------------------------------------
export async function ladeProfil() {
  return pruefe(await sb.from("vermieter_profil").select("*").eq("id", 1).maybeSingle());
}
export async function ladeUebersicht() {
  return pruefe(await sb.from("mieter_uebersicht").select("*").order("objekt").order("wohnung"));
}
export async function ladeStammdaten() {
  const [objekte, wohnungen, kostentraeger] = await Promise.all([
    sb.from("objekte").select("*").order("bezeichnung"),
    sb.from("wohnungen").select("*").order("bezeichnung"),
    sb.from("kostentraeger").select("*").order("name"),
  ]);
  return { objekte: pruefe(objekte), wohnungen: pruefe(wohnungen), kostentraeger: pruefe(kostentraeger) };
}
export async function ladeMieter(id) {
  return pruefe(await sb.from("mieter").select("*").eq("id", id).single());
}
export async function ladeForderungen({ mieterId = null, abMonat = null } = {}) {
  let q = sb.from("forderungen").select("*").order("monat").order("art");
  if (mieterId) q = q.eq("mieter_id", mieterId);
  if (abMonat) q = q.gte("monat", abMonat);
  return pruefe(await q);
}
export async function ladeVorgaenge({ mieterId = null, anzahl = 50 } = {}) {
  let q = sb.from("vorgaenge").select("*").order("erstellt_am", { ascending: false }).limit(anzahl);
  if (mieterId) q = q.eq("mieter_id", mieterId);
  return pruefe(await q);
}
export async function ladeVorlagen() {
  return pruefe(await sb.from("vorlagen").select("*").order("schluessel"));
}

// --- Schreiben -------------------------------------------------------------
export async function speichereMieter(id, felder) {
  return pruefe(await sb.from("mieter").update(felder).eq("id", id).select().single());
}
export async function speichereProfil(felder) {
  return pruefe(await sb.from("vermieter_profil").update(felder).eq("id", 1).select().single());
}
export async function setzeBezahlt(ids, bezahlt, datum = null) {
  if (!ids.length) return [];
  return pruefe(
    await sb.from("forderungen")
      .update({ bezahlt, bezahlt_am: bezahlt ? datum : null })
      .in("id", ids)
      .select()
  );
}
export async function neueForderungen(zeilen) {
  return pruefe(await sb.from("forderungen").insert(zeilen).select());
}
export async function loescheForderung(id) {
  pruefe(await sb.from("forderungen").delete().eq("id", id));
}
export async function protokolliereVorgang(zeile) {
  return pruefe(await sb.from("vorgaenge").insert(zeile).select().single());
}

// --- Vorlagen-Dateien ------------------------------------------------------
export async function ladeVorlagenDatei(vorlage) {
  if (vorlage.storage_pfad) {
    const { data, error } = await sb.storage.from("vorlagen").download(vorlage.storage_pfad);
    if (error) throw new Error("Eigene Vorlage konnte nicht geladen werden: " + error.message);
    return await data.arrayBuffer();
  }
  const antwort = await fetch(vorlage.standard_datei, { cache: "no-cache" });
  if (!antwort.ok) throw new Error(`Standardvorlage nicht gefunden (${vorlage.standard_datei})`);
  return await antwort.arrayBuffer();
}
export async function ladeVorlageHoch(schluessel, datei) {
  const pfad = `${schluessel}.docx`;
  const { error } = await sb.storage.from("vorlagen").upload(pfad, datei, {
    upsert: true,
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  if (error) throw new Error(error.message);
  return pruefe(await sb.from("vorlagen").update({ storage_pfad: pfad }).eq("schluessel", schluessel).select().single());
}
export async function vorlageZuruecksetzen(vorlage) {
  if (vorlage.storage_pfad) {
    const { error } = await sb.storage.from("vorlagen").remove([vorlage.storage_pfad]);
    if (error) throw new Error(error.message);
  }
  return pruefe(await sb.from("vorlagen").update({ storage_pfad: null }).eq("schluessel", vorlage.schluessel).select().single());
}

// --- Unterschrift (Bild im privaten Bucket „vorlagen“) ---------------------
export async function speichereUnterschriftBild(blob) {
  const pfad = `unterschrift/${crypto.randomUUID()}.png`;
  const { error } = await sb.storage.from("vorlagen").upload(pfad, blob, { upsert: false, contentType: "image/png" });
  if (error) throw new Error("Unterschrift konnte nicht gespeichert werden: " + error.message);
  return pfad;
}
export async function ladeUnterschriftBild(pfad) {
  const { data, error } = await sb.storage.from("vorlagen").download(pfad);
  if (error) throw new Error("Unterschrift konnte nicht geladen werden: " + error.message);
  return new Uint8Array(await data.arrayBuffer());
}
export async function loescheUnterschriftBild(pfad) {
  const { error } = await sb.storage.from("vorlagen").remove([pfad]);
  if (error) throw new Error(error.message);
}

// --- Archiv der erzeugten Schreiben ---------------------------------------
const DOCX_TYP = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Legt ein fertiges Schreiben im privaten Bucket ab und vermerkt es im Verlauf. */
export async function archiviereSchreiben({ vorgangId, mieterId, bytes, vorgang }) {
  const pfad = `${mieterId}/${vorgangId}.docx`;
  const { error } = await sb.storage.from("schreiben").upload(pfad, new Blob([bytes], { type: DOCX_TYP }), {
    upsert: false,
    contentType: DOCX_TYP,
  });
  if (error) throw new Error("Schreiben konnte nicht gespeichert werden: " + error.message);
  return await protokolliereVorgang({
    ...vorgang,
    id: vorgangId,
    mieter_id: mieterId,
    details: { ...(vorgang.details || {}), datei_pfad: pfad },
  });
}
export async function ladeSchreiben(pfad) {
  const { data, error } = await sb.storage.from("schreiben").download(pfad);
  if (error) throw new Error("Schreiben konnte nicht geladen werden: " + error.message);
  return await data.arrayBuffer();
}

// --- Postfach, Antworten, Wissen -------------------------------------------
export { SUPABASE_URL };

export async function ladeMieterKurz() {
  return pruefe(await sb.from("mieter")
    .select("id,anrede,vorname,nachname,email,wohnung_id,kostentraeger_id,aktenzeichen")
    .order("nachname"));
}
export async function ladeNachrichten({ status = null, mieterId = null, anzahl = 200 } = {}) {
  let q = sb.from("nachrichten").select("*").order("eingang_am", { ascending: false }).limit(anzahl);
  if (status) q = q.in("status", status);
  if (mieterId) q = q.eq("mieter_id", mieterId);
  return pruefe(await q);
}
export async function ladeNachricht(id) {
  return pruefe(await sb.from("nachrichten").select("*").eq("id", id).single());
}
export async function aendereNachricht(id, felder) {
  return pruefe(await sb.from("nachrichten").update(felder).eq("id", id).select().single());
}
export async function neueNachricht(zeile) {
  return pruefe(await sb.from("nachrichten").insert(zeile).select().single());
}
export async function ladeAntworten({ nachrichtId = null, mieterId = null, anzahl = 50 } = {}) {
  let q = sb.from("antworten").select("*").order("erstellt_am", { ascending: false }).limit(anzahl);
  if (nachrichtId) q = q.eq("nachricht_id", nachrichtId);
  if (mieterId) q = q.eq("mieter_id", mieterId);
  return pruefe(await q);
}
/** Legt einen Entwurf an (id leer) oder ändert ihn. */
export async function speichereAntwort(id, felder) {
  if (!id) return pruefe(await sb.from("antworten").insert(felder).select().single());
  return pruefe(await sb.from("antworten").update(felder).eq("id", id).select().single());
}
export async function loescheAntwort(id) {
  pruefe(await sb.from("antworten").delete().eq("id", id));
}
export async function ladeWissen() {
  return pruefe(await sb.from("wissen").select("*").order("titel"));
}
export async function speichereWissen(id, felder) {
  if (!id) return pruefe(await sb.from("wissen").insert(felder).select().single());
  return pruefe(await sb.from("wissen").update(felder).eq("id", id).select().single());
}
export async function loescheWissen(id) {
  pruefe(await sb.from("wissen").delete().eq("id", id));
}
export async function ladePostfach() {
  return pruefe(await sb.from("postfach").select("*").eq("id", 1).maybeSingle());
}
export async function speicherePostfach(felder) {
  return pruefe(await sb.from("postfach").update(felder).eq("id", 1).select().single());
}
export async function erneuerePostfachToken() {
  return pruefe(await sb.rpc("postfach_token_erneuern"));
}

// Fotografierte Briefe (privater Bucket "eingang")
export async function ladeFotoHoch(pfad, blob) {
  const { error } = await sb.storage.from("eingang").upload(pfad, blob, { upsert: false, contentType: blob.type });
  if (error) throw new Error("Foto konnte nicht gespeichert werden: " + error.message);
  return pfad;
}
export async function fotoAdresse(pfad) {
  const { data, error } = await sb.storage.from("eingang").createSignedUrl(pfad, 600);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

/** Ruft eine Edge Function mit dem Login des Nutzers auf. Fehler haben .code (z. B. "ki_fehlt"). */
export async function funktion(name, body) {
  const { data, error } = await sb.functions.invoke(name, { body });
  if (error) {
    let info = null;
    try { info = await error.context?.json(); } catch { /* keine JSON-Antwort */ }
    const fehler = new Error(info?.fehler || (error.name === "FunctionsFetchError"
      ? "Der Server ist nicht erreichbar. Bitte Internetverbindung prüfen."
      : error.message));
    fehler.code = info?.code || "fehler";
    throw fehler;
  }
  return data;
}
export async function ladeAntwort(id) {
  return pruefe(await sb.from("antworten").select("*").eq("id", id).single());
}
export async function zaehleNeue() {
  const { count, error } = await sb.from("nachrichten").select("id", { count: "exact", head: true }).eq("status", "neu");
  if (error) throw new Error(error.message);
  return count ?? 0;
}

// --- Notizen und Wiedervorlagen (Tabelle aufgaben) -------------------------
export async function ladeAufgaben({ status = "offen", mieterId = null, objektId = null, kontaktId = null, themaId = null } = {}) {
  let q = sb.from("aufgaben").select("*, dienstleister:dienstleister(name)").order("faellig_am", { ascending: true, nullsFirst: false }).order("erstellt_am", { ascending: false }).limit(300);
  if (status) q = q.eq("status", status);
  if (mieterId) q = q.eq("mieter_id", mieterId);
  if (objektId) q = q.eq("objekt_id", objektId);
  if (kontaktId) q = q.eq("kontakt_id", kontaktId);
  if (themaId) q = q.eq("thema_id", themaId);
  return pruefe(await q);
}
export async function ladeAufgabe(id) {
  return pruefe(await sb.from("aufgaben").select("*").eq("id", id).single());
}
export async function speichereAufgabe(id, felder) {
  if (!id) return pruefe(await sb.from("aufgaben").insert(felder).select().single());
  return pruefe(await sb.from("aufgaben").update(felder).eq("id", id).select().single());
}
export async function loescheAufgabe(id) {
  pruefe(await sb.from("aufgaben").delete().eq("id", id));
}

// --- Kontakte (Makler, Bank, Behörden …) und Verlauf (Gesprächsnotizen) ------
export async function ladeKontakte() {
  return pruefe(await sb.from("kontakte").select("*").order("nachname", { nullsFirst: false }).order("firma").limit(2000));
}
export async function ladeKontakt(id) {
  return pruefe(await sb.from("kontakte").select("*").eq("id", id).single());
}
export async function speichereKontakt(id, felder) {
  if (!id) return pruefe(await sb.from("kontakte").insert(felder).select().single());
  return pruefe(await sb.from("kontakte").update(felder).eq("id", id).select().single());
}
export async function loescheKontakt(id) {
  pruefe(await sb.from("kontakte").delete().eq("id", id));
}
/** Verlauf eines Kontakts oder einer Mietpartei, neueste zuerst */
export async function ladeVerlauf({ kontaktId = null, mieterId = null, anzahl = 200 } = {}) {
  let q = sb.from("verlauf").select("*").order("datum", { ascending: false }).order("erstellt_am", { ascending: false }).limit(anzahl);
  if (kontaktId) q = q.eq("kontakt_id", kontaktId);
  if (mieterId) q = q.eq("mieter_id", mieterId);
  return pruefe(await q);
}
/** Datum des letzten Verlaufseintrags je Kontakt (für die Liste) */
export async function ladeLetzteKontakte() {
  return pruefe(await sb.from("verlauf").select("kontakt_id,datum").not("kontakt_id", "is", null).order("datum", { ascending: false }).limit(2000));
}
export async function speichereVerlauf(id, felder) {
  if (!id) return pruefe(await sb.from("verlauf").insert(felder).select().single());
  return pruefe(await sb.from("verlauf").update(felder).eq("id", id).select().single());
}
export async function loescheVerlauf(id) {
  pruefe(await sb.from("verlauf").delete().eq("id", id));
}

// --- Handwerker und Dienstleister ------------------------------------------
export async function ladeDienstleister() {
  return pruefe(await sb.from("dienstleister").select("*").order("gewerk").order("name"));
}
export async function speichereDienstleister(id, felder) {
  if (!id) return pruefe(await sb.from("dienstleister").insert(felder).select().single());
  return pruefe(await sb.from("dienstleister").update(felder).eq("id", id).select().single());
}
export async function loescheDienstleister(id) {
  pruefe(await sb.from("dienstleister").delete().eq("id", id));
}

// --- Häuser, Wohnungen, Kostenträger, neue Mietparteien -----------------------
export async function speichereObjekt(id, felder) {
  if (!id) return pruefe(await sb.from("objekte").insert(felder).select().single());
  return pruefe(await sb.from("objekte").update(felder).eq("id", id).select().single());
}
export async function loescheObjekt(id) {
  pruefe(await sb.from("objekte").delete().eq("id", id));
}
export async function speichereWohnung(id, felder) {
  if (!id) return pruefe(await sb.from("wohnungen").insert(felder).select().single());
  return pruefe(await sb.from("wohnungen").update(felder).eq("id", id).select().single());
}
export async function loescheWohnung(id) {
  pruefe(await sb.from("wohnungen").delete().eq("id", id));
}
export async function speichereKostentraeger(id, felder) {
  if (!id) return pruefe(await sb.from("kostentraeger").insert(felder).select().single());
  return pruefe(await sb.from("kostentraeger").update(felder).eq("id", id).select().single());
}
export async function loescheKostentraeger(id) {
  pruefe(await sb.from("kostentraeger").delete().eq("id", id));
}
export async function neuerMieter(felder) {
  return pruefe(await sb.from("mieter").insert(felder).select().single());
}

// --- Dokumentenablage (privater Bucket "dokumente") -------------------------
export async function ladeDokumente({ objektId, mieterId = null } = {}) {
  let q = sb.from("dokumente").select("*").order("datum", { ascending: false, nullsFirst: false }).order("erstellt_am", { ascending: false }).limit(500);
  if (objektId === null) q = q.is("objekt_id", null);
  else if (objektId) q = q.eq("objekt_id", objektId);
  if (mieterId) q = q.eq("mieter_id", mieterId);
  return pruefe(await q);
}
/** Nur Haus und Ordner aller Dokumente (für die Zahlen in der Objektübersicht) */
/** Bestimmte Dokumente (z. B. Anhänge, die der Chat vorschlägt) */
export async function ladeDokumenteIds(ids) {
  if (!ids?.length) return [];
  return pruefe(await sb.from("dokumente").select("*").in("id", ids));
}
export async function ladeDokumentZahlen() {
  return pruefe(await sb.from("dokumente").select("objekt_id,ordner").limit(10000));
}
export async function legeDokumentAb(zeile, blob) {
  const { error } = await sb.storage.from("dokumente").upload(zeile.pfad, blob, { upsert: false, contentType: blob.type });
  if (error) throw new Error("Datei konnte nicht gespeichert werden: " + error.message);
  try {
    return pruefe(await sb.from("dokumente").insert(zeile).select().single());
  } catch (err) {
    await sb.storage.from("dokumente").remove([zeile.pfad]);
    throw err;
  }
}
export async function aendereDokument(id, felder) {
  return pruefe(await sb.from("dokumente").update(felder).eq("id", id).select().single());
}
export async function loescheDokument(dok) {
  const { error } = await sb.storage.from("dokumente").remove([dok.pfad]);
  if (error) throw new Error(error.message);
  pruefe(await sb.from("dokumente").delete().eq("id", dok.id));
}
/** Kurz gültige Adresse zum Ansehen einer privaten Datei (Bucket "dokumente" oder "eingang"). */
export async function dateiAdresse(bucket, pfad, { download = false } = {}) {
  if (!["dokumente", "eingang"].includes(bucket)) throw new Error("Unbekannter Speicher");
  // download: true oder ein Dateiname (so heißt die Datei dann beim Speichern)
  const { data, error } = await sb.storage.from(bucket).createSignedUrl(pfad, 600, download ? { download } : undefined);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

/** Datei aus der Ablage laden (für den ZIP-Export) */
export async function ladeDokumentDatei(pfad) {
  const { data, error } = await sb.storage.from("dokumente").download(pfad);
  if (error) throw new Error(error.message);
  return data;
}
/** Anhang einer Nachricht laden (Bucket "eingang"), z. B. um ihn in die Ablage zu kopieren */
export async function ladeEingangDatei(pfad) {
  const { data, error } = await sb.storage.from("eingang").download(pfad);
  if (error) throw new Error(error.message);
  return data;
}
/** Dokumente, die schon aus einer Nachricht, Antwort, Notiz oder einem Schreiben abgelegt wurden */
export async function ladeAbgelegte(feld, ids) {
  if (!["id", "nachricht_id", "antwort_id", "aufgabe_id", "vorgang_id", "verlauf_id"].includes(feld)) throw new Error("Unbekanntes Feld");
  const liste = (ids || []).filter(Boolean);
  if (!liste.length) return [];
  return pruefe(await sb.from("dokumente").select("*").in(feld, liste).order("erstellt_am"));
}

// --- Ordner der Dokumentenablage (bereich „haus“ = für alle Häuser, „allgemein“ = nur unter Allgemein) ---
export async function ladeDokumentOrdner() {
  return pruefe(await sb.from("dokument_ordner").select("*").order("reihenfolge").order("name"));
}
export async function speichereDokumentOrdner(id, felder) {
  if (!id) return pruefe(await sb.from("dokument_ordner").insert(felder).select().single());
  return pruefe(await sb.from("dokument_ordner").update(felder).eq("id", id).select().single());
}
export async function loescheDokumentOrdner(id) {
  pruefe(await sb.from("dokument_ordner").delete().eq("id", id));
}
/** Alle Dokumente eines Ordners in einen anderen verschieben (beim Umbenennen oder Löschen) */
// allgemein: true = nur Dokumente ohne Haus, false = nur Dokumente in Häusern (Ordnerlisten sind getrennt)
export async function verschiebeDokumente(alt, neu, { flach = false, ausser = [], allgemein = false } = {}) {
  const bereich = (q) => (allgemein ? q.is("objekt_id", null) : q.not("objekt_id", "is", null));
  pruefe(await bereich(sb.from("dokumente").update({ ordner: neu }).eq("ordner", alt)));
  // Dokumente in Unterordnern (auch automatischen wie „/2026“) gehen mit; flach = alle direkt in „neu“
  const unter = pruefe(await bereich(sb.from("dokumente").select("id,ordner").like("ordner", `${alt.replace(/[%_\\]/g, "\\$&")}/%`)));
  for (const d of unter) {
    // Unterordner, die es weiter gibt, bleiben, wo sie sind
    if (ausser.some((n) => n.length > alt.length && (d.ordner === n || d.ordner.startsWith(n + "/")))) continue;
    pruefe(await sb.from("dokumente").update({ ordner: flach ? neu : neu + d.ordner.slice(alt.length) }).eq("id", d.id));
  }
}

// --- Vorgänge („Themen“): E-Mail-Pingpong zu einer Sache -------------------------
export async function ladeThemen({ mieterId = null, kontaktId = null, ids = null, anzahl = 100 } = {}) {
  let q = sb.from("themen").select("*").order("aktualisiert_am", { ascending: false }).limit(anzahl);
  if (mieterId) q = q.eq("mieter_id", mieterId);
  if (kontaktId) q = q.eq("kontakt_id", kontaktId);
  if (ids) q = q.in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  return pruefe(await q);
}
export async function ladeThema(id) {
  return pruefe(await sb.from("themen").select("*").eq("id", id).single());
}
export async function speichereThema(id, felder) {
  if (!id) return pruefe(await sb.from("themen").insert(felder).select().single());
  return pruefe(await sb.from("themen").update(felder).eq("id", id).select().single());
}
/** Alles, was zu einem Vorgang gehört: eingegangene Nachrichten und eigene Schreiben (inkl. Entwürfe) */
export async function ladeThemaPosten(id) {
  const [n, a] = await Promise.all([
    sb.from("nachrichten").select("*").eq("thema_id", id).order("eingang_am"),
    sb.from("antworten").select("*").eq("thema_id", id).order("erstellt_am"),
  ]);
  return { nachrichten: pruefe(n), antworten: pruefe(a) };
}
/** Anzahl Einträge je Vorgang (für Listen) */
export async function zaehleThemaPosten(ids) {
  if (!ids.length) return {};
  const [n, a] = await Promise.all([
    sb.from("nachrichten").select("thema_id").in("thema_id", ids),
    sb.from("antworten").select("thema_id,status").in("thema_id", ids),
  ]);
  const zahl = {};
  for (const z of pruefe(n)) (zahl[z.thema_id] ||= { ein: 0, aus: 0 }).ein++;
  for (const z of pruefe(a)) if (z.status !== "entwurf") (zahl[z.thema_id] ||= { ein: 0, aus: 0 }).aus++;
  return zahl;
}
/** Dateien einer Ablage ohne Inhaltsangabe (für „Für die KI erschließen“) */
export async function ladeUnerschlossene({ objektId = undefined } = {}) {
  let q = sb.from("dokumente").select("id,titel,ordner,objekt_id,pfad,typ,groesse").is("zusammenfassung", null).limit(500);
  if (objektId === null) q = q.is("objekt_id", null);
  else if (objektId) q = q.eq("objekt_id", objektId);
  return pruefe(await q);
}
