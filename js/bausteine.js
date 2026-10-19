// Bausteine für Listen: Mietbuch-Leiste, Zeile je Mietpartei, Kacheln für erstellte Schreiben
import * as db from "./daten.js";
import { euro, datumDE, monatDE, mieterName } from "./dokumente.js";
import { zeigeDokument } from "./vorschau.js";
import { esc, melde, dateiTeil, zustand, kostentraegerVon } from "./helfer.js";

export const MONATE_KURZ = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
export const monatISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
export function letzteMonate(anzahl) {
  const jetzt = new Date();
  const liste = [];
  for (let i = anzahl - 1; i >= 0; i--) liste.push(monatISO(new Date(jetzt.getFullYear(), jetzt.getMonth() - i, 1)));
  return liste;
}
export const monatKurz = (iso) => MONATE_KURZ[Number(iso.slice(5, 7)) - 1];
export function mietbuch(forderungen, monate) {
  return `<span class="mietbuch">${monate
    .map((m) => {
      const imMonat = forderungen.filter((f) => String(f.monat).slice(0, 7) === m.slice(0, 7));
      const offen = imMonat.filter((f) => !f.bezahlt).reduce((s, f) => s + Number(f.betrag), 0);
      let art = "leer", titel = `${monatDE(m)}: keine Forderung erfasst`;
      if (imMonat.length && offen === 0) { art = "bezahlt"; titel = `${monatDE(m)}: bezahlt`; }
      else if (imMonat.length && imMonat.every((f) => !f.bezahlt)) { art = "offen"; titel = `${monatDE(m)}: ${euro(offen)} offen`; }
      else if (imMonat.length) { art = "teil"; titel = `${monatDE(m)}: teilweise offen (${euro(offen)})`; }
      return `<span class="mietbuch__monat mietbuch__monat--${art}" title="${esc(titel)}" aria-label="${esc(titel)}">${monatKurz(m)}</span>`;
    })
    .join("")}</span>`;
}
export const LEGENDE = `<div class="mietbuch-legende" aria-hidden="true">
  <span><i class="l-bezahlt"></i>bezahlt</span>
  <span><i class="l-teil"></i>teilweise offen</span>
  <span><i class="l-offen"></i>offen</span>
  <span><i class="l-leer"></i>nichts erfasst</span>
</div>`;

export function naechsterSchritt(m, vorgaenge) {
  const eigene = vorgaenge.filter((v) => v.mieter_id === m.id);
  const hat = (typ) => eigene.some((v) => v.typ === typ);
  const schritte = [];
  if (hat("mahnung_2")) schritte.push("weitere Schritte prüfen");
  else if (hat("mahnung_1")) schritte.push("2. Mahnung");
  else schritte.push("1. Mahnung");
  if (m.kostentraeger && !hat("nachweis_jobcenter")) schritte.push("Nachweis an Kostenträger");
  return schritte.join(", ");
}

// Eine Zeile pro Mietpartei: passt sich der Breite an, ohne seitliches Scrollen
export function mieterZeile(m, forderungen, monate, zusatz = "", mitObjekt = false) {
  const offen = Number(m.offen_summe) > 0;
  return `
    <a class="zeile" href="#/mieter/${esc(m.id)}">
      <span class="zeile__wer">
        <span class="zeile__name">${esc(mieterName(m))}</span>
        <span class="zeile__ort">${esc(mitObjekt ? [m.objekt, m.wohnung].filter(Boolean).join(", ") : m.wohnung || "")}${m.kostentraeger ? ` <span class="marker marker--messing">${esc(m.kostentraeger)}</span>` : ""}</span>
        ${zusatz}
      </span>
      <span class="zeile__buch">${mietbuch(forderungen.filter((f) => f.mieter_id === m.id), monate)}</span>
      <span class="zeile__betrag ${offen ? "betrag--offen" : "betrag--null"}">${offen ? euro(m.offen_summe) : "bezahlt"}
        <span class="zeile__klein">${offen ? "offen" : euro(m.monatlich_gesamt) + " / Monat"}</span></span>
    </a>`;
}

// Kachel für ein erstelltes Schreiben (Übersicht und Verlauf)
export function schreibenKachel(v, empfaenger) {
  const hatDatei = !!v.details?.datei_pfad;
  return `
    <button type="button" class="schreiben" data-schreiben="${esc(v.id)}" ${hatDatei ? "" : "data-ohne-datei"}>
      <span class="schreiben__blatt" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
      <span class="schreiben__text">
        <span class="schreiben__titel">${esc(v.titel)}</span>
        <span class="leise">${empfaenger ? esc(empfaenger) + ", " : ""}${datumDE(v.erstellt_am)}${v.summe != null ? `, ${euro(v.summe)}` : ""}</span>
        <span class="schreiben__aktion">${hatDatei ? "Ansehen" : "Testeintrag ohne Dokument"}</span>
      </span>
    </button>`;
}

export async function oeffneSchreiben(v, mieter) {
  if (!v.details?.datei_pfad) {
    return melde("Zu diesem Eintrag ist kein Dokument gespeichert (Testeintrag).", "info");
  }
  try {
    const bytes = await db.ladeSchreiben(v.details.datei_pfad);
    const kt = mieter ? kostentraegerVon(mieter.kostentraeger_id) : null;
    await zeigeDokument({
      titel: v.titel,
      untertitel: `${mieter ? mieterName(mieter) + ", " : ""}erstellt am ${datumDE(v.erstellt_am)}`,
      bytes,
      dateiname: v.details.datei || `${dateiTeil(v.titel)}.docx`,
      hinweis: "Archivierte Fassung, so wie sie erstellt wurde.",
      email: emailDaten(v.typ, mieter, kt, v.titel),
      melde,
    });
  } catch (err) {
    melde(err.message, "fehler");
  }
}

export function emailDaten(typ, mieter, kostentraeger, titel) {
  const an = typ === "nachweis_jobcenter" ? kostentraeger?.email : mieter?.email;
  const anrede = typ === "nachweis_jobcenter"
    ? "Sehr geehrte Damen und Herren,"
    : mieter?.anrede === "Frau" ? `Sehr geehrte Frau ${mieter.nachname},` : mieter?.anrede === "Herr" ? `Sehr geehrter Herr ${mieter.nachname},` : "Guten Tag,";
  return {
    an: an || "",
    betreff: `${titel}${mieter && typ === "nachweis_jobcenter" && mieter.aktenzeichen ? " – " + mieter.aktenzeichen : ""}`,
    text: `${anrede}\n\nim Anhang erhalten Sie unser Schreiben.\n\nMit freundlichen Grüßen\n${zustand.profil?.inhaber || ""}\n${zustand.profil?.firma || ""}`,
  };
}

