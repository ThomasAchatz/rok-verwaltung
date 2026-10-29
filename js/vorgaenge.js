// Vorgänge („Themen“): E-Mail-Pingpong zu einer Sache als ein Verlauf.
// Eingehende Mails ordnet der Server zu (Antwort auf eine frühere Mail oder gleicher Betreff derselben Person),
// eigene Schreiben bekommen den Vorgang der Nachricht bzw. einen neuen. „Erledigt“ legt den ganzen Verlauf als PDF ab.
import * as db from "./daten.js";
import { datumDE, mieterName } from "./dokumente.js";
import { $, $$, esc, melde, dialogFormular, heuteISO, zustand, wohnungVon, objektVon, kostentraegerVon, brotkrumen, KRUMEN } from "./helfer.js";
import { ICON_KI, datumZeit, geheZu, wartehinweis } from "./ui.js";
import * as ablage from "./ablage.js";
import { kontaktName, kontaktVon, kontakteListe } from "./kontakte.js";
import { naechsterSchritt } from "./schritte.js";

const inhalt = () => $("#inhalt");
const VORSILBE = /^(\s*(aw|re|wg|fw|fwd|antw|antwort|tr)\s*(\[\d+\])?\s*:\s*)+/i;

/** Betreff ohne AW:/Re:/WG:, klein (gleich wie auf dem Server und in der Datenbank) */
export function betreffNorm(t) {
  const s = String(t ?? "").toLowerCase().replace(VORSILBE, "").replace(/\s+/g, " ").trim();
  return s || null;
}
export const betreffTitel = (t) => String(t ?? "").replace(VORSILBE, "").trim().slice(0, 200) || "(ohne Betreff)";

// ---------------------------------------------------------------------------
// Zuordnung eigener Schreiben
// ---------------------------------------------------------------------------
/** Vorgang einer eingegangenen Nachricht (legt ihn an, falls die Nachricht noch keinen hat) */
export async function themaFuerNachricht(n) {
  if (n.thema_id) return n.thema_id;
  const t = await db.speichereThema(null, {
    titel: betreffTitel(n.betreff), betreff_norm: betreffNorm(n.betreff), mieter_id: n.mieter_id || null,
    partner_email: n.absender_email ? String(n.absender_email).toLowerCase() : null,
  });
  await db.aendereNachricht(n.id, { thema_id: t.id });
  n.thema_id = t.id;
  return t.id;
}
/** Neuer Vorgang für ein eigenes Schreiben (Neues Schreiben ohne Nachricht) */
export async function neuesThema({ betreff, an, mieterId, kontaktId, dienstleisterId, kostentraegerId, objektId }) {
  const t = await db.speichereThema(null, {
    titel: betreff ? betreffTitel(betreff) : "Schreiben", betreff_norm: betreffNorm(betreff),
    mieter_id: mieterId || null, kontakt_id: kontaktId || null, dienstleister_id: dienstleisterId || null,
    kostentraeger_id: kostentraegerId || null, objekt_id: objektId || null,
    partner_email: an ? String(an).toLowerCase() : null,
  });
  return t.id;
}
/** Etwas ist passiert (gesendet, neue Nachricht): Vorgang nach oben, wieder offen */
export async function beruehre(themaId) {
  if (!themaId) return;
  await db.speichereThema(themaId, { status: "offen", erledigt_am: null }).catch(() => null);
}

// ---------------------------------------------------------------------------
// Listen (Akte, Kontakt) und Kasten auf der Nachrichtenseite
// ---------------------------------------------------------------------------
const zahlText = (z) => {
  if (!z) return "";
  const teile = [];
  if (z.ein) teile.push(`${z.ein} ${z.ein === 1 ? "Eingang" : "Eingänge"}`);
  if (z.aus) teile.push(`${z.aus} ${z.aus === 1 ? "Antwort" : "Antworten"}`);
  return teile.join(" · ");
};
export function vorgaengeListeHtml(themen, zahlen, { leer = "Noch kein Schriftverkehr." } = {}) {
  if (!themen.length) return leer ? `<div class="leer">${esc(leer)}</div>` : "";
  const zeile = (t) => `
    <a class="vorgangzeile" href="#/thema/${esc(t.id)}">
      <span class="vorgangzeile__titel">${esc(t.titel || "(ohne Betreff)")}</span>
      <span class="vorgangzeile__info"><span class="leise">${esc([zahlText(zahlen[t.id]), datumDE(t.aktualisiert_am)].filter(Boolean).join(" · "))}</span>
        ${t.status === "erledigt" ? `<span class="marker marker--ok">erledigt</span>` : `<span class="marker marker--messing">offen</span>`}</span>
    </a>`;
  const offen = themen.filter((t) => t.status !== "erledigt");
  const fertig = themen.filter((t) => t.status === "erledigt");
  return `<div class="zeilen">${offen.map(zeile).join("")}</div>
    ${fertig.length ? `<details class="mehr"><summary>${fertig.length} erledigt</summary><div class="zeilen">${fertig.map(zeile).join("")}</div></details>` : ""}`;
}
export async function ladeListe(filter) {
  const themen = await db.ladeThemen(filter).catch(() => []);
  const zahlen = await db.zaehleThemaPosten(themen.map((t) => t.id)).catch(() => ({}));
  return { themen, zahlen };
}
export async function vorgangKastenHtml(n) {
  if (!n.thema_id) return "";
  const [t, zahlen] = await Promise.all([db.ladeThema(n.thema_id).catch(() => null), db.zaehleThemaPosten([n.thema_id]).catch(() => ({}))]);
  if (!t) return "";
  const z = zahlen[t.id] || { ein: 1, aus: 0 };
  return `
    <section class="flaeche">
      <div class="flaeche__kopf"><h2>Vorgang</h2>${t.status === "erledigt" ? `<span class="marker marker--ok">erledigt</span>` : ""}</div>
      <div class="flaeche__inhalt">
        <p><a href="#/thema/${esc(t.id)}">${esc(t.titel)}</a><br><span class="leise">${esc(zahlText(z))}</span></p>
        <a class="knopf knopf--klein" href="#/thema/${esc(t.id)}">${z.ein + z.aus > 1 ? "Ganzen Verlauf ansehen" : "Verlauf / Erledigt"}</a>
      </div>
    </section>`;
}

// ---------------------------------------------------------------------------
// Seite eines Vorgangs: alle Nachrichten und Schreiben als Pingpong
// ---------------------------------------------------------------------------
const WEG = { email: "E-Mail", brief: "Brief", notiz: "Notiz" };
function postenListe({ nachrichten, antworten }) {
  const liste = [
    ...nachrichten.map((n) => ({
      art: "ein", zeit: n.eingang_am, id: n.id, href: `#/postfach/${n.id}`,
      wer: n.absender_name || n.absender_email || "Unbekannt", weg: WEG[n.quelle] || "Nachricht",
      betreff: n.betreff, text: n.text, anhaenge: (n.anhaenge || []).length,
    })),
    ...antworten.map((a) => ({
      art: a.status === "entwurf" ? "entwurf" : "aus", zeit: a.gesendet_am || a.aktualisiert_am || a.erstellt_am, id: a.id,
      href: a.nachricht_id ? `#/postfach/${a.nachricht_id}` : `#/entwurf/${a.id}`,
      wer: a.empfaenger_name || a.empfaenger_email || "",
      weg: a.status === "entwurf" ? "Entwurf" : a.art === "auftrag" ? (a.status === "als_brief" ? "Auftrag, gedruckt" : "Auftrag per E-Mail") : a.status === "als_brief" ? "Brief" : "E-Mail",
      betreff: a.betreff, text: a.text, anhaenge: (a.anhaenge || []).length, auftrag: a.art === "auftrag",
    })),
  ];
  return liste.sort((x, y) => String(x.zeit).localeCompare(String(y.zeit)));
}

function postenHtml(p) {
  const text = String(p.text || "").trim();
  const kurz = text.length > 600 ? text.slice(0, 600).replace(/\s+\S*$/, "") + " …" : text;
  return `
    <article class="faden__posten faden__posten--${p.art}">
      <div class="faden__kopf">
        <span class="faden__wer">${p.art === "ein" ? esc(p.wer) : `An ${esc(p.wer || "–")}`}</span>
        <span class="leise">${esc(p.weg)} · ${esc(datumZeit(p.zeit))}</span>
      </div>
      ${p.betreff ? `<div class="faden__betreff">${esc(p.betreff)}</div>` : ""}
      <div class="faden__text">${esc(kurz || "(kein Text)")}</div>
      ${text.length > 600 ? `<details class="faden__mehr"><summary>Ganzen Text</summary><div class="faden__text">${esc(text)}</div></details>` : ""}
      <div class="faden__fuss">${p.anhaenge ? `<span class="leise">${p.anhaenge} ${p.anhaenge === 1 ? "Anhang" : "Anhänge"}</span>` : ""}
        <a class="leise" href="${esc(p.href)}">${p.art === "entwurf" ? "Entwurf öffnen" : "Öffnen"}</a></div>
    </article>`;
}

function gegenueberVon(t, mieter) {
  if (mieter) return mieterName(mieter);
  if (t.kontakt_id) return kontaktName(kontaktVon(t.kontakt_id));
  if (t.kostentraeger_id) return kostentraegerVon(t.kostentraeger_id)?.name || "";
  return t.partner_email || "";
}

export async function zeigeThema(id) {
  const [t, posten, notizen] = await Promise.all([db.ladeThema(id), db.ladeThemaPosten(id), db.ladeAufgaben({ status: null, themaId: id }).catch(() => []), kontakteListe()]);
  const mieter = t.mieter_id ? await db.ladeMieter(t.mieter_id).catch(() => null) : null;
  const dienst = t.dienstleister_id ? (await db.ladeDienstleister().catch(() => [])).find((d) => d.id === t.dienstleister_id) : null;
  const liste = postenListe(posten);
  const gesendet = liste.filter((p) => p.art !== "entwurf");
  const doc = t.dokument_id ? (await db.ladeAbgelegte("id", [t.dokument_id]).catch(() => []))[0] : null;
  // Dateien, die an den Notizen des Vorgangs hängen (z. B. Infos von außen)
  const notizDateien = notizen.length ? (await db.ladeAbgelegte("aufgabe_id", notizen.map((a) => a.id)).catch(() => [])).filter((d) => d.art !== "Notiz") : [];
  const wer = gegenueberVon(t, mieter) || dienst?.name || "";
  // Wohin gehört der Vorgang? Mietpartei, Kontakt, Handwerker, Haus – sonst Postfach
  const haus = t.objekt_id ? objektVon(t.objekt_id) : null;
  const eltern = mieter ? [...KRUMEN.mieter, { text: mieterName(mieter), href: `#/mieter/${mieter.id}` }]
    : t.kontakt_id && kontaktVon(t.kontakt_id) ? [...KRUMEN.sonstige, { text: kontaktName(kontaktVon(t.kontakt_id)), href: `#/kontakt/${t.kontakt_id}` }]
    : dienst ? KRUMEN.handwerker
    : haus ? [...KRUMEN.objekte, { text: haus.bezeichnung, href: `#/objekt/${haus.id}` }]
    : KRUMEN.postfach;
  const neuLaden = () => zeigeThema(id);
  // Schadensmeldung im Vorgang: Ablauf in 4 Schritten (schaden.js erst bei Bedarf laden)
  const ursprung = posten.nachrichten.find((x) => x.ki_kategorie === "Reparatur/Mangel");
  const sm = ursprung && t.status !== "erledigt" ? await import("./schaden.js") : null;
  const ablauf = sm ? await sm.ladeAblauf(ursprung).catch(() => null) : null;

  inhalt().innerHTML = `
    ${brotkrumen([...eltern, { text: t.titel || "(ohne Betreff)" }])}
    <div class="kopf">
      <div><h1>${esc(t.titel || "(ohne Betreff)")}</h1>
        <p>${esc([wer, `${gesendet.length} ${gesendet.length === 1 ? "Eintrag" : "Einträge"}`, liste.length ? `seit ${datumDE(liste[0].zeit)}` : ""].filter(Boolean).join(" · "))}
          ${t.status === "erledigt" ? `<span class="marker marker--ok">erledigt</span>` : `<span class="marker marker--messing">offen</span>`}</p></div>
      <div class="knopfreihe">
        <button type="button" class="knopf" id="thema-antworten">Antworten</button>
        ${t.status === "erledigt" ? "" : `<button type="button" class="knopf knopf--ki" id="thema-schritt">${ICON_KI} Nächster Schritt</button>`}
        ${t.status === "erledigt"
          ? `<button type="button" class="knopf" id="thema-offen">Wieder öffnen</button>`
          : `<button type="button" class="knopf knopf--primaer" id="thema-erledigt">Erledigt</button>`}
      </div>
    </div>
    ${notizen.length ? `<p class="notiz-vorgang">${notizen.length === 1 ? "Notiz" : "Notizen"} zu diesem Vorgang:
      ${notizen.map((a) => `<button type="button" class="textknopf" data-notiz="${esc(a.id)}">„${esc(a.titel)}“</button>${a.status === "erledigt" ? ` <span class="leise">(erledigt)</span>` : ""}`).join(", ")}
      ${notizDateien.length ? `<br>Dateien: ${notizDateien.map((d) => `<button type="button" class="textknopf" data-abgelegt="${esc(d.id)}">${esc(d.titel || "Datei")}</button>`).join(", ")}` : ""}</p>` : ""}
    ${t.status === "erledigt" ? `
    <section class="flaeche vorgang-abschluss">
      <div class="flaeche__inhalt">
        <p><strong>Abgeschlossen am ${esc(datumDE(t.erledigt_am || t.aktualisiert_am))}.</strong>
          ${doc ? ablage.abgelegtHtml([doc]) : `<span class="leise">Kein Abschluss-PDF abgelegt.</span>`}</p>
        ${t.zusammenfassung ? `<div class="ki-antwort"><strong>${ICON_KI} Zusammenfassung</strong><p>${esc(t.zusammenfassung)}</p></div>` : ""}
      </div>
    </section>` : ""}
    ${ablauf ? sm.ablaufHtml(ablauf, { seite: "vorgang" }) : ""}
    <section class="flaeche">
      <div class="flaeche__kopf"><h2>Verlauf</h2><span class="leise">älteste zuerst</span></div>
      ${liste.length ? `<div class="faden">${liste.map(postenHtml).join("")}</div>` : `<div class="leer">Noch nichts in diesem Vorgang.</div>`}
    </section>`;

  if (ablauf) sm.verbindeAblauf($("#schritte"), ablauf, { neu: neuLaden });
  if (doc || notizDateien.length) ablage.verbindeAbgelegt(inhalt(), [doc, ...notizDateien].filter(Boolean), { nachher: neuLaden });
  // Notiz, aus der der Vorgang gestartet wurde (start.js erst bei Bedarf laden: Kreis start↔postfach↔vorgaenge)
  for (const b of $$("[data-notiz]")) {
    b.addEventListener("click", async () => {
      const { aufgabeDialog } = await import("./start.js");
      aufgabeDialog(notizen.find((a) => a.id === b.dataset.notiz), { nachher: neuLaden });
    });
  }
  $("#thema-antworten").addEventListener("click", () => {
    const letzte = [...posten.nachrichten].sort((a, b) => String(b.eingang_am).localeCompare(String(a.eingang_am)))[0];
    if (letzte) return geheZu(`#/postfach/${letzte.id}`);
    // Nur eigene Schreiben: neues Schreiben im selben Vorgang an denselben Empfänger
    zustand.themaVorgabe = t.id;
    const ziel = t.kontakt_id ? `k-${t.kontakt_id}` : t.dienstleister_id ? `d-${t.dienstleister_id}`
      : t.kostentraeger_id ? `t-${t.kostentraeger_id}${t.mieter_id ? "." + t.mieter_id : ""}` : t.mieter_id || "";
    geheZu(`#/schreiben${ziel ? "/" + ziel : ""}`);
  });
  $("#thema-schritt")?.addEventListener("click", () => naechsterSchritt(t.id));
  $("#thema-erledigt")?.addEventListener("click", () => abschliessen(t, posten, { mieter, wer, nachher: neuLaden }));
  $("#thema-offen")?.addEventListener("click", async () => {
    try {
      await db.speichereThema(t.id, { status: "offen", erledigt_am: null });
      melde("Vorgang wieder offen.", "ok");
      neuLaden();
    } catch (err) { melde(err.message, "fehler"); }
  });
}

// ---------------------------------------------------------------------------
// Erledigt: ganzen Verlauf als PDF ablegen (optional mit Zusammenfassung der KI)
// ---------------------------------------------------------------------------
function briefkopf() {
  const p = zustand.profil || {};
  return [p.firma, [p.strasse, [p.plz, p.ort].filter(Boolean).join(" ")].filter(Boolean).join(", ")].filter(Boolean);
}

/** Eintrag für die Ablage: der ganze Vorgang als PDF. zusammenfassung wird beim Erzeugen gelesen (kann später kommen). */
export function eintragThema(t, posten, { mieter = null, wer = "", zusammenfassung = () => null } = {}) {
  const liste = postenListe(posten).filter((p) => p.art !== "entwurf");
  const w = mieter && wohnungVon(mieter.wohnung_id);
  const objektId = w?.objekt_id || t.objekt_id || null;
  const datei = async () => {
    const z = await zusammenfassung();
    return ablage.pdfEintrag({
      kopf: briefkopf(),
      titel: t.titel || "Schriftverkehr",
      angaben: [
        ["Vorgang", `${liste.length} ${liste.length === 1 ? "Eintrag" : "Einträge"}${liste.length ? `, ${datumDE(liste[0].zeit)} bis ${datumDE(liste.at(-1).zeit)}` : ""}`],
        ["Mietpartei", mieter ? [mieterName(mieter), objektVon(w?.objekt_id)?.bezeichnung, w?.bezeichnung].filter(Boolean).join(", ") : ""],
        ["Gegenüber", mieter ? "" : wer],
        ["Abgeschlossen", datumDE(new Date())],
      ],
      text: z ? [`Worum ging es: ${z.zusammenfassung}`, `Ergebnis: ${z.ergebnis}`, z.offen ? `Noch offen: ${z.offen}` : ""].filter(Boolean).join("\n\n")
        : "Der vollständige Schriftverkehr dieses Vorgangs, älteste Nachricht zuerst.",
      abschnitte: liste.map((p) => ({
        titel: `${datumZeit(p.zeit)} · ${p.art === "ein" ? `${p.weg} von ${p.wer}` : `${p.weg} an ${p.wer || "–"}`}`,
        text: [p.betreff ? `Betreff: ${p.betreff}` : "", String(p.text || "").trim(), p.anhaenge ? `(${p.anhaenge} ${p.anhaenge === 1 ? "Anhang" : "Anhänge"})` : ""].filter(Boolean).join("\n\n"),
      })),
      fuss: `Vorgang abgeschlossen am ${datumDE(new Date())} · Verwaltungs-App`,
    })();
  };
  return {
    quelle: {},
    richtung: "notiz",
    art: "Schriftverkehr", artFest: true,
    datum: heuteISO(),
    objektId, mieterId: mieter?.id || null,
    gegenueber: wer,
    gegenueberKurz: mieter?.nachname || null,
    thema: t.titel ? betreffTitel(t.titel).slice(0, 60) : null,
    kiText: { titel: t.titel || "", text: liste.map((p) => `${p.weg} ${p.art === "ein" ? "von" : "an"} ${p.wer}: ${p.betreff || ""}\n${String(p.text || "").slice(0, 800)}`).join("\n\n").slice(0, 6000) },
    beschreibung: "Der ganze Verlauf wird als ein PDF abgelegt.",
    datei,
  };
}

export async function abschliessen(t, posten, { mieter = null, wer = "", nachher = () => {} } = {}) {
  const kiDa = !!zustand.ki?.ki;
  const offen = posten.nachrichten.filter((n) => n.status === "neu" || n.status === "offen");
  const entwuerfe = posten.antworten.filter((a) => a.status === "entwurf");
  let mitKi = kiDa;
  let ergebnis = null;
  const zusammenfassung = async () => {
    if (!mitKi) return null;
    if (ergebnis) return ergebnis;
    try {
      ergebnis = await db.funktion("ki", { aktion: "thema_zusammenfassen", thema_id: t.id });
    } catch (err) {
      melde("Zusammenfassung nicht möglich: " + err.message, "fehler");
      ergebnis = null;
    }
    return ergebnis;
  };
  const e = eintragThema(t, posten, { mieter, wer, zusammenfassung });
  let vorschlag = null;
  const daten = await dialogFormular(`
    <h2>Vorgang abschließen</h2>
    <p>„${esc(t.titel)}“ · ${postenListe(posten).filter((p) => p.art !== "entwurf").length} Einträge</p>
    ${ablage.ablageBlockHtml({ titel: "Ganzer Verlauf als PDF in die Ablage", immer: true })}
    ${kiDa ? `<label class="checkfeld"><input type="checkbox" name="ki" checked> ${ICON_KI} Kurze Zusammenfassung der KI oben ins PDF (worum ging es, Ergebnis, was ist offen)</label>` : ""}
    ${offen.length ? `<label class="checkfeld"><input type="checkbox" name="nachrichten" checked> ${offen.length === 1 ? "Die offene Nachricht" : `Die ${offen.length} offenen Nachrichten`} als erledigt markieren</label>` : ""}
    ${entwuerfe.length ? `<p class="feldhinweis feldhinweis--warn">${entwuerfe.length === 1 ? "Ein Entwurf ist" : `${entwuerfe.length} Entwürfe sind`} noch nicht gesendet und kommen nicht ins PDF.</p>` : ""}
    <div class="knopfreihe">
      <button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button>
      <button class="knopf knopf--primaer" value="ok">Erledigt</button>
    </div>`, { breit: true, vorbereiten: (form) => { vorschlag = ablage.verbindeAblageBlock(form, e); } });
  if (!daten) return;
  mitKi = kiDa && !!daten.get("ki");
  const vorgabe = ablage.ablageVorgabe(daten, vorschlag);
  const warte = wartehinweis(mitKi && !vorgabe.aus ? "Die KI fasst zusammen, das PDF wird abgelegt …" : "Wird abgeschlossen …");
  let doc = null;
  try {
    if (!vorgabe.aus) doc = await ablage.automatischAblegen(e, { meldung: false, vorgabe, immer: true });
    if (daten.get("nachrichten")) for (const n of offen) await db.aendereNachricht(n.id, { status: "erledigt" });
    await db.speichereThema(t.id, {
      status: "erledigt", erledigt_am: new Date().toISOString(), dokument_id: doc?.id || t.dokument_id || null,
      zusammenfassung: ergebnis ? [ergebnis.zusammenfassung, `Ergebnis: ${ergebnis.ergebnis}`, ergebnis.offen ? `Offen: ${ergebnis.offen}` : ""].filter(Boolean).join("\n") : t.zusammenfassung || null,
    });
  } catch (err) {
    await warte.ende();
    return melde(err.message, "fehler");
  }
  await warte.ende();
  melde(doc ? `Erledigt. Verlauf abgelegt in „${ablage.ordnerAnzeige(doc.ordner)}“.` : "Vorgang erledigt.", "ok", { dauer: 7000 });
  nachher();
}

/** Für die Nachrichtenseite: Zuordnung geändert → Vorgang bekommt die Mietpartei, wenn er sonst niemandem gehört */
export async function mieterNachziehen(themaId, mieterId, alt) {
  if (!themaId || !mieterId) return;
  const t = await db.ladeThema(themaId).catch(() => null);
  if (t && (!t.mieter_id || t.mieter_id === alt)) await db.speichereThema(themaId, { mieter_id: mieterId }).catch(() => null);
}

