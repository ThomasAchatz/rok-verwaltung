// Mieteingänge: Soll (Forderungen) gegen Ist (Zahlungen) je Monat, Haus und Mietpartei.
// Kacheln oben (Monat, Eingänge, Jahr, Rückstand), Jahresverlauf, darunter je Mietpartei Kalt/Nebenkosten,
// Historie und Aktion (geprüft · in Rückstand stellen · kontaktieren · Zahlung erfassen) mit Vorschlag.
// Ist = Zahlungen der Art „miete“; gibt es für einen Monat keine, gilt der Haken „bezahlt“ an den Forderungen (Bestand).
import * as db from "./daten.js";
import { euro, datumDE, monatDE, mieterName } from "./dokumente.js";
import { $, $$, esc, melde, dialogFormular, frage, heuteISO, zustand, wohnungVon, objektVon, kostentraegerVon } from "./helfer.js";
import { ICON_KI, geheZu, wartehinweis } from "./ui.js";

const inhalt = () => $("#inhalt");
export const POSTEN = ["kaltmiete", "nebenkosten", "strom", "internet"];
const SICHTEN = { gesamt: POSTEN, kalt: ["kaltmiete"], nk: ["nebenkosten", "strom", "internet"] };
const SICHT_NAME = { gesamt: "Gesamtmiete", kalt: "Kaltmiete", nk: "Nebenkosten" };
const MONATE_LANG = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const MONATE_KURZ = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
export const ZAHLUNG_ART = { miete: "Miete", kaution: "Kaution", nachzahlung: "Nachzahlung Nebenkosten", sonstiges: "Sonstiges" };
const QUELLE = { hand: "von Hand", bank: "Kontoauszug", excel: "Excel-Import" };
const STATUS_NAME = { geprueft: "geprüft", rueckstand: "Rückstand", kontaktiert: "kontaktiert" };
const ZUSTAND_NAME = { ok: "bezahlt", teil: "teilweise bezahlt", offen: "offen", erwartet: "noch nicht fällig", zukunft: "kommt noch", keine: "keine Miete fällig" };

const rund = (n) => Math.round(Number(n) * 100) / 100;
const summe = (liste, f = (x) => x.betrag) => rund(liste.reduce((s, x) => s + Number(f(x) || 0), 0));
export const monatPlus = (iso, n) => {
  const [j, m] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(j, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
};
const monatJetzt = () => heuteISO().slice(0, 7) + "-01";
const monatName = (iso) => `${MONATE_LANG[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const kurz = (iso) => MONATE_KURZ[Number(iso.slice(5, 7)) - 1];

// ---------------------------------------------------------------------------
// Rechnen (ohne Oberfläche, damit es sich testen lässt)
// ---------------------------------------------------------------------------
/**
 * Bild eines Monats für eine Mietpartei.
 * Zahlungen der Art „miete“ werden der Reihe nach auf Kaltmiete, Nebenkosten, Strom und Internet verteilt;
 * was darüber hinausgeht, ist „ueber“ (Überzahlung). Ohne Zahlungen zählen die als bezahlt markierten Posten.
 */
export function monatsbild(forderungen, zahlungen, status) {
  const fs = forderungen.filter((f) => POSTEN.includes(f.art));
  const soll = Object.fromEntries(POSTEN.map((a) => [a, summe(fs.filter((f) => f.art === a))]));
  const miete = zahlungen.filter((z) => z.art === "miete");
  const ist = Object.fromEntries(POSTEN.map((a) => [a, 0]));
  let ueber = 0;
  if (miete.length) {
    let rest = summe(miete);
    for (const a of POSTEN) { const t = Math.min(rest, soll[a]); ist[a] = rund(t); rest = rund(rest - t); }
    ueber = rest;
  } else {
    for (const a of POSTEN) ist[a] = summe(fs.filter((f) => f.art === a && f.bezahlt));
  }
  return { soll, ist, ueber, ausZahlungen: miete.length > 0, zahlungen, forderungen: fs, status: status?.status || null, st: status || null };
}

/** Zustand eines Monats in einer Sicht (gesamt | kalt | nk) */
export function zustandVon(b, sicht, monat, heute = heuteISO()) {
  const arten = SICHTEN[sicht] || POSTEN;
  const s = rund(arten.reduce((x, a) => x + b.soll[a], 0));
  const i = rund(arten.reduce((x, a) => x + b.ist[a], 0));
  const jetzt = heute.slice(0, 7) + "-01";
  let z;
  if (!s) z = i > 0 ? "ok" : "keine";
  else if (b.status === "geprueft" || i >= s - 0.005) z = "ok";
  else if (i > 0) z = "teil";
  else if (monat > jetzt) z = "zukunft";
  else if (monat === jetzt && Number(heute.slice(8, 10)) <= 5) z = "erwartet";
  else z = "offen";
  return { soll: s, ist: i, fehlt: z === "ok" ? 0 : rund(Math.max(0, s - i)), zustand: z };
}

/** Bilder je Mietpartei und Monat: Map "mieterId|monat" → monatsbild */
export function auswerten({ forderungen, zahlungen, status }) {
  const gruppe = (liste) => {
    const m = new Map();
    for (const x of liste) {
      const k = `${x.mieter_id}|${String(x.monat).slice(0, 10)}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(x);
    }
    return m;
  };
  const f = gruppe(forderungen), z = gruppe(zahlungen);
  const s = new Map(status.map((x) => [`${x.mieter_id}|${String(x.monat).slice(0, 10)}`, x]));
  const schluessel = new Set([...f.keys(), ...z.keys(), ...s.keys()]);
  const bilder = new Map();
  for (const k of schluessel) bilder.set(k, monatsbild(f.get(k) || [], z.get(k) || [], s.get(k)));
  return bilder;
}

/** Summen für Kacheln und Jahresverlauf über eine Liste von Mietparteien */
export function summen(bilder, mieterIds, monate, sicht, heute = heuteISO()) {
  const leer = { soll: 0, ist: 0, fehlt: 0, faellig: 0, bezahlt: 0 };
  const proMonat = new Map(monate.map((m) => [m, { ...leer }]));
  for (const id of mieterIds) {
    for (const m of monate) {
      const b = bilder.get(`${id}|${m}`);
      if (!b) continue;
      const z = zustandVon(b, sicht, m, heute);
      const p = proMonat.get(m);
      p.soll = rund(p.soll + z.soll); p.ist = rund(p.ist + Math.min(z.ist, z.soll || z.ist)); p.fehlt = rund(p.fehlt + z.fehlt);
      if (z.soll > 0) { p.faellig++; if (z.zustand === "ok") p.bezahlt++; }
    }
  }
  return proMonat;
}

/** Vorschlag nach festen Regeln (ohne KI), z. B. „Teilzahlung: 50 € fehlen – Rest anfordern“ */
export function regelVorschlag({ bild, verlauf, monat, kostentraeger, direktzahlung, heute = heuteISO() }) {
  if (!bild) return null;
  const z = zustandVon(bild, "gesamt", monat, heute);
  const offen = verlauf.filter((v) => v.zustand === "offen" || v.zustand === "teil");
  const offenSumme = rund(offen.reduce((s, v) => s + v.fehlt, 0));
  if (z.zustand === "ok") {
    if (!z.soll) return null;
    if (bild.status === "geprueft") return { aktion: null, text: "Geprüft – Zahlung passt." };
    return { aktion: "geprueft", text: bild.ueber > 0 ? `Bezahlt, ${euro(bild.ueber)} zu viel (Kaution? Nachzahlung?) – prüfen` : "Zahlung passt – als geprüft markieren" };
  }
  if (z.zustand === "erwartet") return { aktion: null, text: "Noch nicht fällig – abwarten." };
  if (z.zustand === "zukunft" || z.zustand === "keine") return null;
  if (bild.status === "kontaktiert") return { aktion: null, text: `Kontaktiert${bild.st?.aktualisiert_am ? ` am ${datumDE(bild.st.aktualisiert_am)}` : ""} – Zahlung abwarten.` };
  if (z.zustand === "teil") return { aktion: "kontakt", text: `Teilzahlung: ${euro(z.fehlt)} fehlen – Rest anfordern.` };
  if (kostentraeger && direktzahlung) return { aktion: "amt", text: `Zahlung vom ${kostentraeger.name} fehlt – beim Amt nachfragen.` };
  if (offen.length >= 2) return { aktion: "rueckstand", text: `${offen.length} Monate offen (${euro(offenSumme)}) – in Rückstand stellen und mahnen.` };
  return { aktion: "kontakt", text: "Noch nichts eingegangen – freundlich erinnern." };
}

// ---------------------------------------------------------------------------
// Abgleich: Haken „bezahlt“ an den Forderungen aus den Zahlungen ableiten (für Mietbuch, Akte, Übersicht)
// ---------------------------------------------------------------------------
export async function abgleichen(mieterId, monat, { nachLoeschen = false } = {}) {
  const [fs, zs, st] = await Promise.all([
    db.ladeForderungen({ mieterId, abMonat: monat }).then((l) => l.filter((f) => String(f.monat).slice(0, 10) === monat && POSTEN.includes(f.art))),
    db.ladeZahlungen({ mieterId, monat }),
    db.ladeMieteingangStatus(monat, monat).then((l) => l.find((x) => x.mieter_id === mieterId) || null),
  ]);
  if (!fs.length) return;
  const miete = zs.filter((z) => z.art === "miete");
  if (st?.status === "geprueft") return void await db.setzeForderungen(fs.filter((f) => !f.bezahlt).map((f) => f.id), { bezahlt: true, bezahlt_am: heuteISO() });
  if (!miete.length && !nachLoeschen) return;
  const reihe = [...fs].sort((a, b) => POSTEN.indexOf(a.art) - POSTEN.indexOf(b.art) || String(a.erstellt_am).localeCompare(String(b.erstellt_am)));
  let rest = summe(miete);
  const datum = miete.map((z) => z.datum).filter(Boolean).sort().pop() || heuteISO();
  const ja = [], nein = [];
  for (const f of reihe) {
    if (rest >= Number(f.betrag) - 0.005) { ja.push(f); rest = rund(rest - Number(f.betrag)); } else nein.push(f);
  }
  await Promise.all([
    db.setzeForderungen(ja.filter((f) => !f.bezahlt).map((f) => f.id), { bezahlt: true, bezahlt_am: datum }),
    db.setzeForderungen(nein.filter((f) => f.bezahlt).map((f) => f.id), { bezahlt: false, bezahlt_am: null }),
  ]);
}

/**
 * Abgleich für viele Mietparteien und Monate auf einmal (nach einem Import): lädt einmal, schreibt gebündelt.
 * paare: [{ mieter_id, monat }]
 */
export async function abgleichenViele(paare, { nachLoeschen = false } = {}) {
  const liste = [...new Map(paare.map((p) => [`${p.mieter_id}|${p.monat}`, p])).values()];
  if (!liste.length) return;
  const monate = liste.map((p) => p.monat).sort();
  const von = monate[0], bis = monate[monate.length - 1];
  const [alleF, alleZ, alleSt] = await Promise.all([
    db.ladeForderungenZeitraum(von, bis), db.ladeZahlungen({ von, bis }), db.ladeMieteingangStatus(von, bis),
  ]);
  const schluessel = (x) => `${x.mieter_id}|${String(x.monat).slice(0, 10)}`;
  const gruppe = (l) => { const m = new Map(); for (const x of l) { const k = schluessel(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; };
  const fG = gruppe(alleF.filter((f) => POSTEN.includes(f.art))), zG = gruppe(alleZ);
  const stG = new Map(alleSt.map((s) => [schluessel(s), s]));
  const setzen = new Map(); // bezahlt_am → ids
  const zuruecksetzen = [];
  const ja = (f, datum) => { if (f.bezahlt) return; if (!setzen.has(datum)) setzen.set(datum, []); setzen.get(datum).push(f.id); };
  for (const p of liste) {
    const k = `${p.mieter_id}|${p.monat}`;
    const fs = fG.get(k) || [];
    if (!fs.length) continue;
    const miete = (zG.get(k) || []).filter((z) => z.art === "miete");
    if (stG.get(k)?.status === "geprueft") { for (const f of fs) ja(f, heuteISO()); continue; }
    if (!miete.length && !nachLoeschen) continue;
    const reihe = [...fs].sort((a, b) => POSTEN.indexOf(a.art) - POSTEN.indexOf(b.art) || String(a.erstellt_am).localeCompare(String(b.erstellt_am)));
    let rest = summe(miete);
    const datum = miete.map((z) => z.datum).filter(Boolean).sort().pop() || heuteISO();
    for (const f of reihe) {
      if (rest >= Number(f.betrag) - 0.005) { ja(f, datum); rest = rund(rest - Number(f.betrag)); } else if (f.bezahlt) zuruecksetzen.push(f.id);
    }
  }
  const auftraege = [...setzen].map(([datum, ids]) => db.setzeForderungen(ids, { bezahlt: true, bezahlt_am: datum }));
  if (zuruecksetzen.length) auftraege.push(db.setzeForderungen(zuruecksetzen, { bezahlt: false, bezahlt_am: null }));
  await Promise.all(auftraege);
}

// ---------------------------------------------------------------------------
// Seite
// ---------------------------------------------------------------------------
function einstellung() {
  zustand.mieteingang = zustand.mieteingang || { monat: monatJetzt(), haus: "alle", sicht: "gesamt", nurOffen: false };
  return zustand.mieteingang;
}

async function laden(e) {
  // Fehlende Monatsposten bis heute einmal je Sitzung und Tag anlegen
  if (zustand.sollstellungAm !== heuteISO()) {
    await db.sollstellungErgaenzen().catch((err) => console.warn("Sollstellung:", err.message));
    zustand.sollstellungAm = heuteISO();
  }
  // Ganzes Jahr (Kacheln, Jahresverlauf) plus die fünf Monate davor (Historie im Januar)
  const jahr = e.monat.slice(0, 4);
  const start = [`${jahr}-01-01`, monatPlus(e.monat, -5)].sort()[0];
  const ende = `${jahr}-12-01`;
  const [mieter, uebersicht, forderungen, zahlungen, status] = await Promise.all([
    db.ladeMieterMiete(), db.ladeUebersicht(), db.ladeForderungenZeitraum(start, ende), db.ladeZahlungen({ von: start, bis: ende }),
    db.ladeMieteingangStatus(start, ende),
  ]);
  return { mieter, uebersicht, forderungen, zahlungen, status, bilder: auswerten({ forderungen, zahlungen, status }) };
}

export async function zeigeMieteingaenge() {
  const e = einstellung();
  const d = await laden(e);
  zeichne(e, d);
}

function aktiveMieter(d, e) {
  const ende = monatPlus(e.monat, 1);
  return d.mieter.filter((m) => {
    const haus = wohnungVon(m.wohnung_id)?.objekt_id || null;
    if (e.haus !== "alle" && haus !== e.haus) return false;
    if (d.bilder.has(`${m.id}|${e.monat}`)) return true;
    return (!m.mietbeginn || m.mietbeginn < ende) && (!m.mietende || m.mietende >= e.monat);
  }).sort((a, b) => {
    const wa = wohnungVon(a.wohnung_id), wb = wohnungVon(b.wohnung_id);
    return String(objektVon(wa?.objekt_id)?.bezeichnung || "").localeCompare(String(objektVon(wb?.objekt_id)?.bezeichnung || ""))
      || String(wa?.bezeichnung || "").localeCompare(String(wb?.bezeichnung || ""), "de", { numeric: true }) || mieterName(a).localeCompare(mieterName(b));
  });
}

const leerBild = { soll: Object.fromEntries(POSTEN.map((a) => [a, 0])), ist: Object.fromEntries(POSTEN.map((a) => [a, 0])), ueber: 0, zahlungen: [], forderungen: [], status: null, st: null };

function zeichne(e, d) {
  const heute = heuteISO();
  const jahr = e.monat.slice(0, 4);
  const jahresMonate = Array.from({ length: 12 }, (_, i) => `${jahr}-${String(i + 1).padStart(2, "0")}-01`);
  const bisMonat = jahresMonate.filter((m) => m <= e.monat);
  const leute = aktiveMieter(d, e);
  const ids = leute.map((m) => m.id);
  const jahrSummen = summen(d.bilder, ids, jahresMonate, e.sicht, heute);
  const monat = jahrSummen.get(e.monat);
  const kum = bisMonat.reduce((s, m) => { const x = jahrSummen.get(m); return { soll: s.soll + x.soll, ist: s.ist + x.ist, fehlt: s.fehlt + x.fehlt }; }, { soll: 0, ist: 0, fehlt: 0 });
  const offenGesamt = d.uebersicht.filter((u) => e.haus === "alle" || u.objekt_id === e.haus).reduce((s, u) => s + Number(u.offen_summe || 0), 0);
  const quote = (a, b) => (b > 0 ? Math.min(100, Math.round((a / b) * 100)) : 0);
  const haeuser = zustand.stamm.objekte.filter((o) => d.mieter.some((m) => wohnungVon(m.wohnung_id)?.objekt_id === o.id));
  const maxBalken = Math.max(1, ...jahresMonate.map((m) => Math.max(jahrSummen.get(m).soll, jahrSummen.get(m).ist)));
  const historie = Array.from({ length: 6 }, (_, i) => monatPlus(e.monat, i - 5));
  const zeilen = leute.map((m) => zeile(m, d, e, historie, heute)).filter((z) => !e.nurOffen || z.offen);

  inhalt().innerHTML = `
    <div class="kopf">
      <div><h1>Mieteingänge</h1>
        <p>Soll und Ist der Mieten je Monat. ${SICHT_NAME[e.sicht]}${e.haus === "alle" ? ", alle Häuser" : `, ${esc(objektVon(e.haus)?.bezeichnung || "")}`}.</p></div>
      <div class="knopfreihe">
        <button type="button" class="knopf" id="me-import" title="Kontoauszug (CSV) oder immocloud-Excel einlesen – oder die Datei einfach auf die Seite ziehen">Kontoauszug / Excel einlesen</button>
        ${zustand.ki?.ki ? `<button type="button" class="knopf knopf--ki" id="me-ki">${ICON_KI} Vorschläge der KI</button>` : ""}
      </div>
    </div>
    <div class="me-steuerung">
      <div class="me-monat" role="group" aria-label="Monat">
        <button type="button" class="knopf knopf--klein" data-monat="-1" aria-label="Vormonat">‹</button>
        <strong>${esc(monatName(e.monat))}</strong>
        <button type="button" class="knopf knopf--klein" data-monat="1" aria-label="Nächster Monat">›</button>
        ${e.monat !== monatJetzt() ? `<button type="button" class="textknopf" data-monat="0">Heute</button>` : ""}
      </div>
      <div class="reiter me-sicht" role="group" aria-label="Was zählt">
        ${Object.entries(SICHT_NAME).map(([k, n]) => `<button type="button" class="reiter__knopf" data-sicht="${k}" aria-pressed="${e.sicht === k}">${n}</button>`).join("")}
      </div>
    </div>
    <div class="me-kacheln">
      <div class="me-kachel">
        <div class="me-kachel__titel">Mieteinnahmen ${esc(MONATE_LANG[Number(e.monat.slice(5, 7)) - 1])}</div>
        <div class="me-kachel__wert">${euro(monat.ist)}</div>
        <div class="me-kachel__unter">von ${euro(monat.soll)} Soll</div>
        <div class="me-balken" aria-hidden="true"><span style="width:${quote(monat.ist, monat.soll)}%"></span></div>
        <div class="me-kachel__fuss ${monat.fehlt > 0 ? "betrag--offen" : "me-gut"}">${monat.fehlt > 0 ? `es fehlen ${euro(monat.fehlt)}` : monat.soll ? "alles da" : "nichts fällig"}</div>
      </div>
      <div class="me-kachel">
        <div class="me-kachel__titel">Mieteingänge ${esc(MONATE_LANG[Number(e.monat.slice(5, 7)) - 1])}</div>
        <div class="me-kachel__wert">${monat.bezahlt} / ${monat.faellig}</div>
        <div class="me-kachel__unter">Mietparteien vollständig bezahlt</div>
        <div class="me-balken" aria-hidden="true"><span style="width:${quote(monat.bezahlt, monat.faellig)}%"></span></div>
        <div class="me-kachel__fuss">${monat.faellig - monat.bezahlt > 0 ? `<button type="button" class="textknopf" data-nur-offen>${monat.faellig - monat.bezahlt} offen anzeigen</button>` : "&nbsp;"}</div>
      </div>
      <div class="me-kachel">
        <div class="me-kachel__titel">${esc(jahr)} bis ${esc(MONATE_LANG[Number(e.monat.slice(5, 7)) - 1])}</div>
        <div class="me-kachel__wert">${euro(kum.ist)}</div>
        <div class="me-kachel__unter">von ${euro(kum.soll)} Soll</div>
        <div class="me-balken" aria-hidden="true"><span style="width:${quote(kum.ist, kum.soll)}%"></span></div>
        <div class="me-kachel__fuss ${kum.fehlt > 0 ? "betrag--offen" : "me-gut"}">${kum.fehlt > 0 ? `es fehlen ${euro(kum.fehlt)}` : "alles da"}</div>
      </div>
      <div class="me-kachel">
        <div class="me-kachel__titel">Rückstand insgesamt</div>
        <div class="me-kachel__wert ${offenGesamt > 0 ? "betrag--offen" : ""}">${euro(offenGesamt)}</div>
        <div class="me-kachel__unter">alle offenen Posten, auch ältere</div>
        <div class="me-kachel__fuss">&nbsp;</div>
      </div>
    </div>
    <details class="flaeche ausklapp me-verlauf" ${zustand.mieteingangVerlaufOffen ? "open" : ""}>
      <summary>Jahresverlauf ${esc(jahr)}: Soll und Ist je Monat</summary>
      <div class="me-jahr" role="img" aria-label="Soll und Ist je Monat ${esc(jahr)}">
        ${jahresMonate.map((m) => {
          const x = jahrSummen.get(m);
          return `<button type="button" class="me-jahr__monat ${m === e.monat ? "me-jahr__monat--aktiv" : ""}" data-gehe="${m}" title="${esc(`${monatName(m)}: ${euro(x.ist)} von ${euro(x.soll)}`)}">
            <span class="me-jahr__saeulen"><span class="me-jahr__soll" style="height:${Math.round((x.soll / maxBalken) * 100)}%"></span><span class="me-jahr__ist ${x.fehlt > 0 && m <= monatJetzt() ? "me-jahr__ist--fehlt" : ""}" style="height:${Math.round((x.ist / maxBalken) * 100)}%"></span></span>
            <span class="me-jahr__name">${kurz(m)}</span></button>`;
        }).join("")}
      </div>
      <p class="leise me-jahr__legende"><i class="me-l-soll"></i> Soll <i class="me-l-ist"></i> Ist <i class="me-l-fehlt"></i> Ist mit Fehlbetrag</p>
    </details>
    <nav class="reiter me-haeuser" aria-label="Häuser">
      <button type="button" class="reiter__knopf" data-haus="alle" aria-pressed="${e.haus === "alle"}">Alle Häuser</button>
      ${haeuser.map((o) => `<button type="button" class="reiter__knopf" data-haus="${esc(o.id)}" aria-pressed="${e.haus === o.id}">${esc(o.bezeichnung)}</button>`).join("")}
    </nav>
    <section class="flaeche me-liste">
      <div class="flaeche__kopf"><h2>Mietparteien · ${esc(monatName(e.monat))}</h2>
        <label class="checkfeld me-nur-offen"><input type="checkbox" id="me-nur-offen" ${e.nurOffen ? "checked" : ""}> nur offene</label></div>
      <div class="me-zeile me-zeile--kopf" aria-hidden="true">
        <span>Mieter</span><span>Wohnung</span><span>Kalt</span><span>Nebenkosten</span><span>Historie</span><span>Aktion</span>
      </div>
      ${zeilen.length ? zeilen.map((z) => z.html).join("") : `<div class="leer">${e.nurOffen ? "Keine offenen Mieten in diesem Monat." : "Keine Mietparteien in diesem Monat."}</div>`}
    </section>
    <p class="leise me-hinweis">Grün = bezahlt, gelb = teilweise, rot = offen, gestrichelt = nichts fällig. Ein Klick auf einen Monat zeigt Soll, Zahlungen und „Zahlung erfassen“.</p>`;

  verbinde(e, d, leute, historie);
}

function markeHtml(soll, ist, b, monat) {
  if (!soll) return `<span class="me-betrag leise">–</span>`;
  const z = b.status === "geprueft" || ist >= soll - 0.005 ? "ok" : ist > 0 ? "teil" : monat > monatJetzt() ? "zukunft" : "offen";
  const zeichen = { ok: "✓", teil: "◐", offen: "✗", zukunft: "·" }[z];
  const titel = z === "teil" ? `${euro(ist)} von ${euro(soll)}` : z === "ok" ? "bezahlt" : z === "zukunft" ? "kommt noch" : "offen";
  return `<span class="me-betrag me-betrag--${z}" title="${esc(titel)}">${euro(soll)} <b aria-label="${esc(titel)}">${zeichen}</b></span>`;
}

function zeile(m, d, e, historie, heute) {
  const w = wohnungVon(m.wohnung_id);
  const haus = objektVon(w?.objekt_id);
  const kt = m.kostentraeger_id ? kostentraegerVon(m.kostentraeger_id) : null;
  const b = d.bilder.get(`${m.id}|${e.monat}`) || leerBild;
  const z = zustandVon(b, "gesamt", e.monat, heute);
  const verlauf = historie.map((h) => ({ monat: h, ...zustandVon(d.bilder.get(`${m.id}|${h}`) || leerBild, e.sicht, h, heute) }));
  const regel = regelVorschlag({ bild: b, verlauf, monat: e.monat, kostentraeger: kt, direktzahlung: !!m.direktzahlung, heute });
  const ki = b.st?.ki_vorschlag?.text ? b.st.ki_vorschlag : null;
  const vorschlag = ki || regel;
  const sollKalt = b.soll.kaltmiete, istKalt = b.ist.kaltmiete;
  const sollNk = rund(b.soll.nebenkosten + b.soll.strom + b.soll.internet), istNk = rund(b.ist.nebenkosten + b.ist.strom + b.ist.internet);
  const aktionKnopf = vorschlag?.aktion && AKTION_KNOPF[vorschlag.aktion] && !(vorschlag.aktion === "geprueft" && b.status === "geprueft")
    ? `<button type="button" class="knopf knopf--klein ${vorschlag.aktion === "geprueft" ? "knopf--primaer" : ""}" data-aktion-mieter="${esc(m.id)}" data-aktion="${esc(vorschlag.aktion)}">${AKTION_KNOPF[vorschlag.aktion]}</button>` : "";
  const html = `
    <div class="me-zeile" data-mieter="${esc(m.id)}">
      <span class="me-zeile__mieter"><a href="#/mieter/${esc(m.id)}">${esc(mieterName(m))}</a>
        ${kt ? `<span class="marker" title="${m.direktzahlung ? "zahlt direkt an uns" : "Kostenträger"}">${esc(kt.name)}${m.direktzahlung ? " · direkt" : ""}</span>` : ""}
        ${b.status ? `<span class="marker ${b.status === "geprueft" ? "marker--ok" : b.status === "rueckstand" ? "marker--offen" : "marker--messing"}">${STATUS_NAME[b.status]}</span>` : ""}</span>
      <span class="me-zeile__wohnung"><span class="me-label">Wohnung</span>${esc(w?.bezeichnung || "–")}${e.haus === "alle" && haus ? `<span class="leise"> · ${esc(haus.bezeichnung)}</span>` : ""}</span>
      <span class="me-zeile__kalt"><span class="me-label">Kalt</span>${markeHtml(sollKalt, istKalt, b, e.monat)}</span>
      <span class="me-zeile__nk"><span class="me-label">Nebenkosten</span>${markeHtml(sollNk, istNk, b, e.monat)}</span>
      <span class="me-zeile__historie"><span class="me-label">Historie</span><span class="mietbuch">${verlauf.map((v) => {
        const art = { ok: "bezahlt", teil: "teil", offen: "offen", erwartet: "erwartet", zukunft: "leer", keine: "leer" }[v.zustand];
        const titel = `${monatName(v.monat)}: ${ZUSTAND_NAME[v.zustand]}${v.soll ? ` (${euro(v.ist)} von ${euro(v.soll)})` : ""}`;
        return `<button type="button" class="mietbuch__monat mietbuch__monat--${art} ${v.monat === e.monat ? "me-aktuell" : ""}" data-monat-dialog="${esc(m.id)}|${v.monat}" title="${esc(titel)}" aria-label="${esc(titel)}">${kurz(v.monat)}</button>`;
      }).join("")}</span></span>
      <span class="me-zeile__aktion">
        ${vorschlag ? `<span class="me-vorschlag">${ki ? `<span class="me-ki" title="Vorschlag der KI${ki.am ? ` vom ${esc(datumDE(ki.am))}` : ""}">${ICON_KI}</span> ` : ""}${esc(vorschlag.text)}</span>` : ""}
        <span class="me-aktion">
          ${aktionKnopf}
          <select class="me-aktion__wahl" data-wahl="${esc(m.id)}" aria-label="Aktion für ${esc(mieterName(m))}">
            <option value="">Aktion …</option>
            <option value="geprueft">Geprüft (Zahlung passt)</option>
            <option value="rueckstand">In Rückstand stellen</option>
            <option value="kontakt">Kontaktieren …</option>
            ${kt ? `<option value="amt">${esc(kt.name)} anschreiben …</option>` : ""}
            <option value="zahlung">Zahlung erfassen …</option>
            ${b.status ? `<option value="zuruecksetzen">Status „${STATUS_NAME[b.status]}“ zurücknehmen</option>` : ""}
          </select>
        </span>
      </span>
    </div>`;
  return { html, offen: ["offen", "teil"].includes(z.zustand) };
}
const AKTION_KNOPF = { geprueft: "✓ Geprüft", kontakt: "Erinnern …", amt: "Amt anschreiben …", rueckstand: "In Rückstand" };

function verbinde(e, d, leute, historie) {
  const neu = () => zeigeMieteingaenge();
  for (const b of $$("[data-monat]")) b.addEventListener("click", () => {
    const n = Number(b.dataset.monat);
    e.monat = n === 0 ? monatJetzt() : monatPlus(e.monat, n);
    neu();
  });
  for (const b of $$("[data-gehe]")) b.addEventListener("click", () => { e.monat = b.dataset.gehe; neu(); });
  for (const b of $$("[data-sicht]")) b.addEventListener("click", () => { e.sicht = b.dataset.sicht; zeichne(e, d); });
  for (const b of $$("[data-haus]")) b.addEventListener("click", () => { e.haus = b.dataset.haus; zeichne(e, d); });
  $("#me-nur-offen")?.addEventListener("change", (ev) => { e.nurOffen = ev.target.checked; zeichne(e, d); });
  $("[data-nur-offen]")?.addEventListener("click", () => { e.nurOffen = true; zeichne(e, d); $(".me-liste")?.scrollIntoView({ block: "start" }); });
  $(".me-verlauf")?.addEventListener("toggle", (ev) => { zustand.mieteingangVerlaufOffen = ev.target.open; });
  for (const b of $$("[data-monat-dialog]")) b.addEventListener("click", () => {
    const [id, monat] = b.dataset.monatDialog.split("|");
    monatDialog(d.mieter.find((m) => m.id === id), monat, d).then((geaendert) => { if (geaendert) neu(); });
  });
  const ausfuehren = async (id, aktion) => {
    const m = d.mieter.find((x) => x.id === id);
    try {
      if (await aktionAusfuehren(m, aktion, e.monat, d, historie)) neu();
    } catch (err) { melde(err.message, "fehler"); }
  };
  for (const b of $$("[data-aktion-mieter]")) b.addEventListener("click", () => ausfuehren(b.dataset.aktionMieter, b.dataset.aktion));
  for (const s of $$("[data-wahl]")) s.addEventListener("change", () => { const a = s.value; s.value = ""; if (a) ausfuehren(s.dataset.wahl, a); });
  $("#me-ki")?.addEventListener("click", () => kiVorschlaege(e, d, leute, historie).then((ok) => { if (ok) neu(); }));
  $("#me-import")?.addEventListener("click", async () => {
    const { importStarten } = await import("./zahlungsimport.js");
    importStarten({ nachher: neu });
  });
  // Kontoauszug/Excel einfach auf die Seite ziehen: direkt zur Vorschau (Fotos usw. gehen wie gewohnt zur Ablage)
  import("./ablage.js").then(({ setzeSeitenAblage }) => setzeSeitenAblage(["#/mieteingaenge", "#/rueckstaende"], async (dateien) => {
    const { importStarten, istImportDatei } = await import("./zahlungsimport.js");
    const passend = dateien.filter(istImportDatei);
    if (!passend.length) return false;
    await importStarten({ nachher: neu, dateien: passend });
    return true;
  }, "Loslassen – der Kontoauszug bzw. die Excel-Datei wird eingelesen (erst Vorschau, dann übernehmen)"));
}

// ---------------------------------------------------------------------------
// Aktionen
// ---------------------------------------------------------------------------
async function aktionAusfuehren(m, aktion, monat, d, historie) {
  const b = d.bilder.get(`${m.id}|${monat}`) || leerBild;
  const z = zustandVon(b, "gesamt", monat);
  if (aktion === "geprueft") {
    if (z.soll && z.ist < z.soll - 0.005 && !(await frage("Als geprüft markieren?", `<p>Für ${esc(monatName(monat))} sind erst <strong>${euro(z.ist)}</strong> von ${euro(z.soll)} eingegangen.</p>
      <p>„Geprüft“ heißt: Die Miete ist vollständig da (z. B. bar bezahlt). Der Monat gilt dann als bezahlt.</p>`, "Ja, geprüft"))) return false;
    await db.setzeMieteingangStatus(m.id, monat, { status: "geprueft" });
    await abgleichen(m.id, monat);
    melde(`${mieterName(m)}: ${monatName(monat)} geprüft.`, "ok");
    return true;
  }
  if (aktion === "rueckstand") {
    await db.setzeMieteingangStatus(m.id, monat, { status: "rueckstand" });
    melde(`${mieterName(m)}: ${monatName(monat)} in Rückstand gestellt.`, "ok");
    return true;
  }
  if (aktion === "zuruecksetzen") {
    const war = b.status;
    await db.setzeMieteingangStatus(m.id, monat, { status: null });
    if (war === "geprueft") await abgleichen(m.id, monat, { nachLoeschen: true });
    melde("Status zurückgenommen.", "ok");
    return true;
  }
  if (aktion === "zahlung") return monatDialog(m, monat, d, { neu: true });
  if (aktion === "kontakt" || aktion === "amt") {
    const kt = m.kostentraeger_id ? kostentraegerVon(m.kostentraeger_id) : null;
    const offen = historie.map((h) => ({ monat: h, ...zustandVon(d.bilder.get(`${m.id}|${h}`) || leerBild, "gesamt", h) }))
      .filter((v) => v.monat <= monat && (v.zustand === "offen" || v.zustand === "teil"));
    const liste = offen.length ? offen : [{ monat, ...z }];
    const posten = liste.map((v) => `${monatName(v.monat)}: ${euro(v.fehlt)} offen${v.ist > 0 ? ` (eingegangen ${euro(v.ist)} von ${euro(v.soll)})` : ""}`).join("; ");
    const summeOffen = euro(liste.reduce((s, v) => s + v.fehlt, 0));
    const w = wohnungVon(m.wohnung_id);
    if (aktion === "amt" && kt) {
      zustand.vorbelegung = { nachricht_id: null, anweisung:
        `Die Mietzahlung für ${mieterName(m)} (${w?.bezeichnung || "Wohnung"}) ist nicht vollständig eingegangen: ${posten}. ` +
        `Bitte um Prüfung und Überweisung${m.direktzahlung ? " (Direktzahlung an den Vermieter)" : ""}. Sachlich und freundlich.` };
      await db.setzeMieteingangStatus(m.id, monat, { status: "kontaktiert" });
      melde("Anweisung eingetragen. Mit „Entwurf mit KI“ den Entwurf erstellen.", "info");
      geheZu(`#/schreiben/t-${kt.id}.${m.id}`);
      return false;
    }
    zustand.vorbelegung = { nachricht_id: null, anweisung:
      `Freundliche Zahlungserinnerung: ${posten}. Zusammen ${summeOffen}. Bitte um Überweisung innerhalb von 7 Tagen. ` +
      "Falls die Zahlung schon unterwegs ist, ist das Schreiben gegenstandslos. Kein Mahnton." };
    await db.setzeMieteingangStatus(m.id, monat, { status: "kontaktiert" });
    melde("Anweisung eingetragen. Mit „Entwurf mit KI“ den Entwurf erstellen.", "info");
    geheZu(`#/schreiben/${m.id}`);
    return false;
  }
  return false;
}

/** Monat einer Mietpartei: Soll, Zahlungen (löschen), neue Zahlung erfassen. Liefert true, wenn sich etwas geändert hat. */
async function monatDialog(m, monat, d, { neu = false } = {}) {
  if (!m) return false;
  const [fs, zs] = await Promise.all([
    db.ladeForderungen({ mieterId: m.id, abMonat: monat }).then((l) => l.filter((f) => String(f.monat).slice(0, 10) === monat)),
    db.ladeZahlungen({ mieterId: m.id, monat }),
  ]);
  const b = monatsbild(fs, zs, d.bilder.get(`${m.id}|${monat}`)?.st);
  const z = zustandVon(b, "gesamt", monat);
  const ART = { kaltmiete: "Kaltmiete", nebenkosten: "Nebenkosten", strom: "Strompauschale", internet: "Internetpauschale", sonstiges: "Sonstiges" };
  const daten = await dialogFormular(`
    <h2>${esc(mieterName(m))} · ${esc(monatName(monat))}</h2>
    <p class="leise">${esc(ZUSTAND_NAME[z.zustand])}${z.soll ? `: ${euro(z.ist)} von ${euro(z.soll)}` : ""}${b.ueber > 0 ? `, dazu ${euro(b.ueber)} zu viel` : ""}</p>
    <h3 class="me-dialog__titel">Soll</h3>
    ${fs.length ? `<ul class="dialogliste">${fs.map((f) => `<li><span>${esc(f.bezeichnung || ART[f.art] || f.art)}${f.bezahlt ? ` <span class="me-gut">✓</span>` : ""}</span><span class="posten__betrag">${euro(f.betrag)}</span></li>`).join("")}</ul>`
      : `<p class="leise">Für diesen Monat ist keine Miete angelegt.</p>`}
    <h3 class="me-dialog__titel">Zahlungen</h3>
    ${zs.length ? `<ul class="dialogliste me-zahlungen">${zs.map((x) => `<li><span>${x.datum ? esc(datumDE(x.datum)) : "ohne Datum"} · ${esc(ZAHLUNG_ART[x.art] || x.art)}
        <span class="leise">· ${esc(QUELLE[x.quelle] || x.quelle)}${x.zahler ? ` · ${esc(x.zahler)}` : ""}</span>${x.text ? `<br><span class="leise">${esc(x.text)}</span>` : ""}</span>
        <span class="posten__betrag">${euro(x.betrag)} <button class="textknopf" value="weg:${esc(x.id)}" formnovalidate aria-label="Zahlung löschen">Löschen</button></span></li>`).join("")}</ul>`
      : `<p class="leise">${b.ausZahlungen ? "" : fs.some((f) => f.bezahlt) ? "Keine Zahlungen erfasst; im Mietbuch als bezahlt markiert." : "Noch keine Zahlung erfasst."}</p>`}
    <fieldset class="gruppe me-neu" ${neu ? "" : ""}>
      <legend>Zahlung erfassen</legend>
      <div class="formraster formraster--zwei">
        <label class="feld"><span>Eingang am</span><input type="date" name="datum" value="${esc(heuteISO())}"></label>
        <label class="feld"><span>Betrag in €</span><input name="betrag" inputmode="decimal" pattern="[0-9]+([.,][0-9]{1,2})?" placeholder="0,00" value="${z.fehlt > 0 ? esc(String(z.fehlt.toFixed(2)).replace(".", ",")) : ""}"></label>
        <label class="feld"><span>Für Monat</span><input type="month" name="monat" value="${esc(monat.slice(0, 7))}"></label>
        <label class="feld"><span>Art</span><select name="art">${Object.entries(ZAHLUNG_ART).map(([k, n]) => `<option value="${k}">${esc(n)}</option>`).join("")}</select></label>
      </div>
    </fieldset>
    <p class="oz-fehler" data-fehler role="alert" hidden></p>
    <div class="knopfreihe">
      <button class="knopf" value="abbrechen" formnovalidate>Schließen</button>
      <button class="knopf knopf--primaer" value="neu">Zahlung speichern</button>
    </div>`, {
    breit: true,
    vorbereiten: (form) => {
      if (neu) setTimeout(() => form.betrag.focus(), 50);
      form.addEventListener("submit", (ev) => {
        if (ev.submitter?.value !== "neu") return;
        const betrag = Number(String(form.betrag.value).replace(",", "."));
        const fehler = !(betrag > 0) ? "Bitte einen Betrag eingeben." : !form.monat.value ? "Bitte den Monat wählen." : "";
        const p = $("[data-fehler]", form);
        p.textContent = fehler; p.hidden = !fehler;
        if (fehler) ev.preventDefault();
      });
    },
  });
  if (!daten) return false;
  const aktion = String(daten.get("_aktion") || "");
  try {
    if (aktion.startsWith("weg:")) {
      const z2 = zs.find((x) => x.id === aktion.slice(4));
      if (!z2 || !(await frage("Zahlung löschen?", `<p>${euro(z2.betrag)}${z2.datum ? ` vom ${esc(datumDE(z2.datum))}` : ""} wird gelöscht.</p>`, "Löschen", { gefahr: true }))) return false;
      await db.loescheZahlung(z2.id);
      await abgleichen(m.id, monat, { nachLoeschen: true });
      melde("Zahlung gelöscht.", "ok");
      return true;
    }
    if (aktion === "neu") {
      const ziel = `${daten.get("monat")}-01`;
      await db.neueZahlungen([{
        mieter_id: m.id, monat: ziel, datum: daten.get("datum") || null, betrag: rund(Number(String(daten.get("betrag")).replace(",", "."))),
        art: daten.get("art") || "miete", quelle: "hand",
      }]);
      await abgleichen(m.id, ziel);
      melde(`Zahlung für ${monatName(ziel)} gespeichert.`, "ok");
      return true;
    }
  } catch (err) { melde(err.message, "fehler"); }
  return false;
}

// ---------------------------------------------------------------------------
// Vorschläge der KI: bekommt nur Zahlen (Soll/Ist je Monat), Kostenträger-Art und Status – keine Namen, keine Bankdaten
// ---------------------------------------------------------------------------
async function kiVorschlaege(e, d, leute, historie) {
  const zeilen = leute.map((m) => {
    const b = d.bilder.get(`${m.id}|${e.monat}`);
    if (!b) return null;
    const kt = m.kostentraeger_id ? kostentraegerVon(m.kostentraeger_id) : null;
    return {
      id: m.id,
      kostentraeger: kt ? (kt.art || "amt") : null,
      direktzahlung: !!m.direktzahlung,
      status: b.status,
      kontaktiert_am: b.status === "kontaktiert" ? String(b.st?.aktualisiert_am || "").slice(0, 10) : null,
      monate: historie.map((h) => {
        const z = zustandVon(d.bilder.get(`${m.id}|${h}`) || leerBild, "gesamt", h);
        return { monat: h.slice(0, 7), soll: z.soll, ist: z.ist, zustand: z.zustand };
      }),
      ueberzahlung: b.ueber || 0,
    };
  }).filter(Boolean).filter((x) => x.monate.some((v) => v.soll > 0)).slice(0, 80);
  if (!zeilen.length) { melde("In diesem Monat gibt es nichts zu bewerten.", "info"); return false; }
  const warte = wartehinweis("Die KI schaut sich die Mieteingänge an …");
  try {
    const r = await db.funktion("miete", { aktion: "mieteingang_vorschlaege", monat: e.monat.slice(0, 7), heute: heuteISO(), zeilen });
    const am = new Date().toISOString();
    const liste = (r.vorschlaege || []).filter((v) => zeilen.some((z) => z.id === v.id));
    await Promise.all(liste.map((v) => db.setzeMieteingangStatus(v.id, e.monat, { ki_vorschlag: { aktion: v.aktion || null, text: v.text, am } })));
    melde(`${liste.length} ${liste.length === 1 ? "Vorschlag" : "Vorschläge"} der KI hinterlegt.`, "ok");
    return true;
  } catch (err) {
    melde("Vorschläge gerade nicht möglich: " + err.message, "fehler");
    return false;
  } finally {
    await warte.ende();
  }
}
