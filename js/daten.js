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
