// Zahlungsimport ohne Oberfläche: Kontoauszug (CSV) und immocloud-Mietübersicht (Excel) lesen und
// Zahlungseingänge Mietparteien und Monaten zuordnen. Keine Abhängigkeiten, damit es sich in Node testen lässt.
// Grundsätze: IBAN-Spalten werden nie gelesen, IBANs in Texten entfernt; Ausgänge werden übersprungen;
// die Zuordnung ist nur ein Vorschlag, gespeichert wird erst nach Bestätigung in der Vorschau.

const IBAN = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/gi;
export const ohneIban = (s) => String(s ?? "").replace(IBAN, "[IBAN entfernt]");
export const norm = (s) => String(s ?? "").toLowerCase()
  .replace(/ß/g, "ss").replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue")
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, " ").trim();
const rund = (n) => Math.round(Number(n) * 100) / 100;
const monatIso = (j, m) => `${j}-${String(m).padStart(2, "0")}-01`;
export const monatPlus = (iso, n) => {
  const [j, m] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(j, m - 1 + n, 1));
  return monatIso(d.getUTCFullYear(), d.getUTCMonth() + 1);
};

// ---------------------------------------------------------------------------
// Zahlen, Daten, Text
// ---------------------------------------------------------------------------
/** „1.234,56“, „-1.234,56 EUR“, „1234.56“, 1234.56 → Zahl (oder null) */
export function betragLesen(wert) {
  if (typeof wert === "number") return Number.isFinite(wert) ? rund(wert) : null;
  let s = String(wert ?? "").replace(/\s|€|eur/gi, "").replace(/^\+/, "");
  if (!s) return null;
  const minus = /^-|-$/.test(s) || /^\(.*\)$/.test(s);
  s = s.replace(/[-()]/g, "");
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? rund(minus ? -n : n) : null;
}

/** „01.10.2026“, „1.10.26“, „2026-10-01“ → „2026-10-01“ (oder null) */
export function datumLesen(wert) {
  const s = String(wert ?? "").trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/.exec(s);
  if (!m) return null;
  const j = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const mo = Number(m[2]), t = Number(m[1]);
  if (mo < 1 || mo > 12 || t < 1 || t > 31) return null;
  return `${j}-${String(mo).padStart(2, "0")}-${String(t).padStart(2, "0")}`;
}

/** Bytes einer CSV-Datei als Text: UTF-8, sonst Windows-1252 (viele Banken exportieren so) */
export function textDekodieren(bytes) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, ""); }
  catch { return new TextDecoder("windows-1252").decode(bytes); }
}

/** CSV in Zeilen und Zellen zerlegen (Trennzeichen ; , oder Tab, Anführungszeichen beachtet) */
export function csvZerlegen(text) {
  const probe = String(text).split(/\r?\n/).slice(0, 30).join("\n");
  const zaehle = (z) => (probe.match(new RegExp(z === "\t" ? "\\t" : `\\${z}`, "g")) || []).length;
  const trenner = [";", "\t", ","].sort((a, b) => zaehle(b) - zaehle(a))[0];
  const zeilen = [];
  let zeile = [], feld = "", inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '"' && text[i + 1] === '"') { feld += '"'; i++; }
      else if (c === '"') inQuote = false;
      else feld += c;
    } else if (c === '"') inQuote = true;
    else if (c === trenner) { zeile.push(feld); feld = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      zeile.push(feld); zeilen.push(zeile); zeile = []; feld = "";
    } else feld += c;
  }
  if (feld || zeile.length) { zeile.push(feld); zeilen.push(zeile); }
  return zeilen.map((z) => z.map((x) => x.trim())).filter((z) => z.some((x) => x));
}

// ---------------------------------------------------------------------------
// Kontoauszug (CSV aus dem Online-Banking)
// ---------------------------------------------------------------------------
const SPALTEN = {
  datum: [/^buchungstag$/, /^buchungsdatum$/, /^buchung$/, /^datum$/, /buchungstag/, /buchungsdatum/, /^datum/],
  valuta: [/valuta/, /wertstellung/],
  betrag: [/^betrag$/, /^betrag /, /^umsatz/, /betrag/],
  soll: [/^soll$/, /^soll /, /^ausgang/],
  haben: [/^haben$/, /^haben /, /^eingang/],
  name: [/zahlungspflichtige/, /auftraggeber/, /beguenstigter/, /empfaenger/, /^name/, /zahler/, /partner/, /gegenseite/, /^name /],
  zweck: [/verwendungszweck/, /zweck/, /^beschreibung/, /^vorgang/, /buchungstext/, /^text/, /info/],
};
const VERBOTEN = /iban|kontonummer|konto nr|bic|blz|bankleitzahl|glaeubiger id|mandat/;

function spaltenFinden(kopf) {
  const n = kopf.map(norm);
  const nimm = (liste, schon = []) => {
    for (const r of liste) {
      const i = n.findIndex((x, k) => r.test(x) && !VERBOTEN.test(x) && !schon.includes(k));
      if (i >= 0) return i;
    }
    return -1;
  };
  const s = {};
  s.datum = nimm(SPALTEN.datum.filter(Boolean)); if (s.datum >= 0 && /valuta|wertstellung/.test(n[s.datum])) s.datum = -1;
  if (s.datum < 0) s.datum = n.findIndex((x) => /datum/.test(x) && !/valuta|wertstellung/.test(x));
  s.valuta = nimm(SPALTEN.valuta, [s.datum]);
  s.betrag = nimm(SPALTEN.betrag, [s.datum, s.valuta]);
  if (s.betrag < 0) { s.soll = nimm(SPALTEN.soll); s.haben = nimm(SPALTEN.haben); }
  s.name = nimm(SPALTEN.name, [s.datum, s.valuta, s.betrag]);
  s.zweck = nimm(SPALTEN.zweck, [s.datum, s.valuta, s.betrag, s.name]);
  return s;
}

/**
 * Kontoauszug lesen: findet die Kopfzeile (Datum + Betrag), liefert alle Buchungen.
 * Rückgabe { buchungen: [{ nr, datum, valuta, betrag, zahler, text }], spalten, fehler }
 */
export function kontoauszugLesen(text) {
  const zeilen = csvZerlegen(text);
  let kopfNr = -1, s = null;
  for (let i = 0; i < Math.min(zeilen.length, 40); i++) {
    const t = spaltenFinden(zeilen[i]);
    if (t.datum >= 0 && (t.betrag >= 0 || (t.soll >= 0 && t.haben >= 0))) { kopfNr = i; s = t; break; }
  }
  if (kopfNr < 0) return { buchungen: [], spalten: null, fehler: "In der Datei fehlt eine Kopfzeile mit Buchungsdatum und Betrag. Bitte den CSV-Export aus dem Online-Banking nehmen." };
  const kopf = zeilen[kopfNr];
  const buchungen = [];
  for (const z of zeilen.slice(kopfNr + 1)) {
    const datum = datumLesen(z[s.datum]);
    let betrag = s.betrag >= 0 ? betragLesen(z[s.betrag]) : rund((betragLesen(z[s.haben]) || 0) - Math.abs(betragLesen(z[s.soll]) || 0));
    if (!datum || betrag === null || betrag === 0) continue;
    buchungen.push({
      nr: buchungen.length,
      datum,
      valuta: s.valuta >= 0 ? datumLesen(z[s.valuta]) : null,
      betrag,
      zahler: s.name >= 0 ? ohneIban(z[s.name]).slice(0, 120) : "",
      text: s.zweck >= 0 ? ohneIban(z[s.zweck]).replace(/\s+/g, " ").slice(0, 400) : "",
    });
  }
  return { buchungen, spalten: Object.fromEntries(Object.entries(s).filter(([, v]) => v >= 0).map(([k, v]) => [k, kopf[v]])), fehler: buchungen.length ? null : "Keine Buchungen gefunden." };
}

// ---------------------------------------------------------------------------
// Monat und Art einer Zahlung
// ---------------------------------------------------------------------------
const MONATSNAMEN = [
  ["januar", "jan"], ["februar", "feb"], ["maerz", "mrz", "mar"], ["april", "apr"], ["mai"], ["juni", "jun"],
  ["juli", "jul"], ["august", "aug"], ["september", "sept", "sep"], ["oktober", "okt", "oct"], ["november", "nov"], ["dezember", "dez", "dec"],
];
/**
 * Für welchen Monat ist die Zahlung? Erst aus dem Text („Miete Oktober“, „10/2026“), sonst nach Datum:
 * ab dem 25. zählt sie für den Folgemonat. Rückgabe { monat, quelle: "text" | "datum" }
 */
export function monatBestimmen(text, datum, { abTag = 25 } = {}) {
  const [j, m, t] = datum.split("-").map(Number);
  // volle Daten (z. B. „Valuta 30.09.2026“) nicht als Monatsangabe lesen
  const roh = String(text ?? "").replace(/\b\d{1,2}\.\d{1,2}\.\d{2,4}\b/g, " ");
  const n = ` ${norm(roh)} `;
  let gefunden = null;
  for (let i = 0; i < 12 && !gefunden; i++) {
    for (const name of MONATSNAMEN[i]) {
      if (n.includes(` ${name} `)) { gefunden = i + 1; break; }
    }
  }
  let jahr = null;
  const zahl = /\b(0?[1-9]|1[0-2])\s*[/.-]\s*(20\d{2}|\d{2})\b/.exec(roh);
  if (!gefunden && zahl) { gefunden = Number(zahl[1]); jahr = zahl[2].length === 2 ? 2000 + Number(zahl[2]) : Number(zahl[2]); }
  if (gefunden) {
    if (!jahr) {
      const j4 = /\b(20\d{2})\b/.exec(roh);
      jahr = j4 ? Number(j4[1]) : j;
      if (!j4) { if (gefunden - m > 6) jahr = j - 1; else if (m - gefunden > 6) jahr = j + 1; }
    }
    return { monat: monatIso(jahr, gefunden), quelle: "text" };
  }
  return { monat: t >= abTag ? monatPlus(monatIso(j, m), 1) : monatIso(j, m), quelle: "datum" };
}

export function artBestimmen(text) {
  const n = ` ${norm(text)} `;
  if (/ kaution| mietsicherheit/.test(n)) return "kaution";
  if (/nachzahlung|nebenkostenabrechnung|betriebskostenabrechnung|nk abrechnung|bk abrechnung|heizkostenabrechnung| abrechnung /.test(n)) return "nachzahlung";
  return "miete";
}

/** Kurzer, stabiler Fingerabdruck (FNV-1a) für die Erkennung doppelter Buchungen */
export function fingerabdruck(s) {
  let h = 0x811c9dc5;
  for (const c of String(s)) { h ^= c.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

// ---------------------------------------------------------------------------
// Zuordnung der Eingänge
// ---------------------------------------------------------------------------
const woerter = (s) => norm(s).split(" ").filter((w) => w.length >= 2);
const monatsmiete = (m) => rund(Number(m.kaltmiete || 0) + Number(m.nebenkosten_vz || 0) + Number(m.strom_pauschale || 0) + Number(m.internet_pauschale || 0));

/** Wie gut passt eine Buchung zu einer Mietpartei? (Nachname 3, Vorname 1, Mitbewohner 2, Kostenträger 1) */
export function punkte(m, satz, kostentraegerName = "") {
  let p = 0;
  const nn = woerter(m.nachname).filter((w) => w.length >= 3);
  if (nn.length && nn.every((w) => satz.has(w))) p += 3;
  const vn = woerter(m.vorname)[0];
  if (p && vn && satz.has(vn)) p += 1;
  for (const zeile of String(m.weitere_bewohner || "").split(/\n/)) {
    const ww = woerter(zeile.split("·")[0]).filter((w) => w.length >= 3);
    if (!p && ww.length >= 2 && ww.every((w) => satz.has(w))) p += 2;
  }
  const kt = woerter(kostentraegerName).filter((w) => w.length >= 4);
  if (p && kt.length && kt.some((w) => satz.has(w))) p += 1;
  return p;
}

/**
 * Eingänge eines Kontoauszugs Mietparteien zuordnen.
 * ctx: { mieter, kostentraeger, soll(mieterId, monat) → Zahl|null, gezahlt(mieterId, monat) → Zahl, vorhanden: Set(schluessel) }
 * Rückgabe: Zeilen { nr, teil, datum, betrag, gesamt, zahler, text, mieter_id, monat, monatQuelle, art, sicherheit, hinweis, schluessel, doppelt, kandidaten }
 */
export function bankZuordnen(buchungen, ctx) {
  const ktName = (id) => ctx.kostentraeger?.find((k) => k.id === id)?.name || "";
  const zugewiesen = new Map();
  const gleich = new Map();
  const zeilen = [];
  const eingaenge = buchungen.filter((b) => b.betrag > 0).sort((a, b) => a.datum.localeCompare(b.datum) || a.nr - b.nr);
  for (const b of eingaenge) {
    const satz = new Set(woerter(`${b.zahler} ${b.text}`));
    const bewertet = ctx.mieter.map((m) => ({ m, p: punkte(m, satz, ktName(m.kostentraeger_id)) })).filter((x) => x.p >= 2)
      .sort((a, b2) => b2.p - a.p);
    const kandidaten = bewertet.filter((x) => x.p === bewertet[0]?.p).map((x) => x.m);
    const { monat, quelle } = monatBestimmen(`${b.text}`, b.datum, ctx);
    // gleicher Name bei mehreren Mietparteien: der Betrag entscheidet (Monatsmiete am nächsten), sonst unklar
    const abstand = (m) => Math.abs((ctx.soll?.(m.id, monat) ?? monatsmiete(m)) - b.betrag);
    kandidaten.sort((x, y) => abstand(x) - abstand(y));
    const eindeutig = kandidaten.length === 1 || (kandidaten.length > 1 && abstand(kandidaten[0]) < abstand(kandidaten[1]) - 0.005);
    const m = eindeutig ? kandidaten[0] : null;
    let art = artBestimmen(`${b.zahler} ${b.text}`);
    // „Miete + Kaution“: erst die Miete, der Rest ist Kaution
    const mitKaution = art === "kaution" && / miete/.test(` ${norm(b.text)}`);
    if (mitKaution) art = "miete";
    // Fingerabdruck: Datum, Betrag, Zahler, Text (+ laufende Nummer bei gleichen Buchungen am selben Tag)
    const basis = `bank:${b.datum}:${b.betrag.toFixed(2)}:${fingerabdruck(`${norm(b.zahler)}|${norm(b.text)}`)}`;
    const n = (gleich.get(basis) || 0) + 1; gleich.set(basis, n);
    const schluessel = n > 1 ? `${basis}#${n}` : basis;
    const zeile = {
      nr: b.nr, teil: 0, datum: b.datum, betrag: b.betrag, gesamt: b.betrag, zahler: b.zahler, text: b.text,
      mieter_id: m?.id || null, monat, monatQuelle: quelle, art, hinweis: "", schluessel, basis: schluessel,
      kandidaten: kandidaten.map((x) => x.id),
    };
    if (!m) {
      zeile.sicherheit = "unklar";
      zeile.hinweis = kandidaten.length > 1 ? "Mehrere Mietparteien möglich" : "Keine Mietpartei erkannt";
      zeilen.push(zeile);
      continue;
    }
    const k = `${m.id}|${monat}`;
    const soll = ctx.soll?.(m.id, monat) ?? monatsmiete(m);
    const schon = rund((ctx.gezahlt?.(m.id, monat) || 0) + (zugewiesen.get(k) || 0));
    const rest = rund(Math.max(0, soll - schon));
    zeile.sicherheit = quelle === "text" || Math.abs(b.betrag - soll) < 0.005 || Math.abs(b.betrag - rest) < 0.005 ? "sicher" : "pruefen";
    if (art === "miete") {
      if (rest <= 0.005) {
        zeile.art = "sonstiges";
        zeile.sicherheit = "pruefen";
        zeile.hinweis = "Monat schon bezahlt – Überzahlung? (Kaution, Nachzahlung, Folgemonat)";
      } else if (b.betrag > rest + 0.005) {
        zugewiesen.set(k, rund((zugewiesen.get(k) || 0) + rest));
        zeilen.push({ ...zeile, betrag: rest, teil: 1, schluessel: `${schluessel}:1`, hinweis: `Miete (${rund(b.betrag - rest).toFixed(2).replace(".", ",")} € mehr überwiesen)` });
        zeilen.push({ ...zeile, betrag: rund(b.betrag - rest), teil: 2, art: mitKaution ? "kaution" : "sonstiges", sicherheit: "pruefen", schluessel: `${schluessel}:2`, hinweis: mitKaution ? "Mehrbetrag laut Text Kaution" : "Mehrbetrag – Kaution? Nachzahlung?" });
        continue;
      } else {
        zugewiesen.set(k, rund((zugewiesen.get(k) || 0) + b.betrag));
        if (b.betrag < rest - 0.005) zeile.hinweis = `Teilzahlung (${(rest - b.betrag).toFixed(2).replace(".", ",")} € fehlen noch)`;
      }
    }
    zeilen.push(zeile);
  }
  for (const z of zeilen) z.doppelt = !!ctx.vorhanden?.has(z.schluessel);
  return zeilen;
}

// ---------------------------------------------------------------------------
// immocloud: „Mietübersicht“ als Excel (ein Blatt je Haus, je Wohnung ein Block mit Mietphasen und Monaten)
// ---------------------------------------------------------------------------
const MONATS_LANG = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const MONATS_KOPF = ["jan", "feb", "maerz", "apr", "mai", "juni", "juli", "aug", "sept", "okt", "nov", "dez"];
const kopfMonat = (s) => {
  const n = norm(s);
  const i = MONATS_KOPF.indexOf(n);
  if (i >= 0) return i + 1;
  const j = MONATSNAMEN.findIndex((namen) => namen.includes(n));
  return j >= 0 ? j + 1 : 0;
};
const zahlOderNull = (v) => (v === "" || v === null || v === undefined ? null : betragLesen(v));

/**
 * Blätter (Zeilen mit Zellen) einer immocloud-Mietübersicht lesen.
 * Rückgabe: [{ blatt, objektName, adresse, phasen: [{ wohnung, nachname, kalt, nk, gesamtmiete, monate: {1..12: Zahl|null}, gesamtSpalte }], summen: {1..12}|null }]
 */
export function immocloudLesen(blaetter) {
  const ergebnis = [];
  for (const b of blaetter) {
    const z = b.zeilen;
    let objektName = "", adresse = "";
    const phasen = [];
    let wohnung = "", spalten = null, summen = null;
    for (let i = 0; i < z.length; i++) {
      const r = z[i] || [];
      const a = norm(r[0]);
      if (a === "name" && !spalten) { objektName = String(r[1] ?? "").trim(); continue; }
      if (a === "objekt adresse") { adresse = String(r[1] ?? "").trim(); continue; }
      if (a === "mieter" && /kaltmiete/.test(norm(r[1]))) {
        spalten = { monate: {} };
        r.forEach((h, k) => {
          const n = norm(h);
          if (/qm|m2/.test(n)) return;
          if (/^kaltmiete/.test(n)) spalten.kalt ??= k;
          else if (/^betriebskosten/.test(n)) spalten.bk = k;
          else if (/^heizkosten/.test(n)) spalten.heiz = k;
          else if (/^weitere betriebskosten/.test(n)) spalten.weitereBk = k;
          else if (/^weitere einheiten monatlich/.test(n)) spalten.einheiten = k;
          else if (/^sonstige kosten/.test(n)) spalten.sonst = k;
          else if (/^gesamtmiete/.test(n)) spalten.gesamtmiete = k;
          else if (n === "gesamt") spalten.gesamt = k;
          else if (kopfMonat(h)) spalten.monate[kopfMonat(h)] = k;
        });
        continue;
      }
      const belegt = r.filter((x) => x !== "" && x !== null && x !== undefined);
      // Überschrift einer Wohnung: nur die erste Zelle belegt
      if (r[0] && belegt.length === 1 && typeof r[0] === "string") { wohnung = String(r[0]).trim(); continue; }
      if (!spalten) continue;
      const wert = (k) => (k === undefined ? 0 : zahlOderNull(r[k]) || 0);
      if (r[0] && typeof r[0] === "string" && a !== "mieter") {
        const monate = {};
        for (const [mo, k] of Object.entries(spalten.monate)) monate[mo] = zahlOderNull(r[k]);
        phasen.push({
          wohnung, nachname: String(r[0]).trim(),
          kalt: wert(spalten.kalt), nk: rund(wert(spalten.bk) + wert(spalten.heiz) + wert(spalten.weitereBk) + wert(spalten.einheiten) + wert(spalten.sonst)),
          gesamtmiete: wert(spalten.gesamtmiete), monate, gesamtSpalte: spalten.gesamt !== undefined ? zahlOderNull(r[spalten.gesamt]) : null,
        });
        continue;
      }
      // Summenzeile: erste Zelle leer, Monatsspalten mit Zahlen
      if (!r[0] && Object.values(spalten.monate).some((k) => typeof zahlOderNull(r[k]) === "number")) {
        summen = {};
        for (const [mo, k] of Object.entries(spalten.monate)) summen[mo] = zahlOderNull(r[k]) || 0;
      }
    }
    if (phasen.length) ergebnis.push({ blatt: b.name, objektName, adresse, phasen, summen });
  }
  return ergebnis;
}

const strasseNorm = (s) => norm(String(s ?? "").split(",")[0]).replace(/str\b/g, "strasse").replace(/\s+/g, "");
const nummer = (s) => { const m = /\d+/.exec(String(s ?? "")); return m ? Number(m[0]) : null; };

/**
 * immocloud-Blätter auf Häuser, Wohnungen und Mietparteien abbilden und prüfen.
 * ctx: { objekte, wohnungen, mieter, jahr }
 * Rückgabe: [{ blatt, objekt_id, objektText, warnungen: [], phasen: [{ …phase, mieter_id, wohnung_id, kandidaten, monateIso: [{ monat, wert }] }] }]
 */
export function immocloudZuordnen(blaetter, ctx) {
  return blaetter.map((b) => {
    const warnungen = [];
    const ziel = strasseNorm(b.adresse) || "";
    let objekt = ctx.objekte.find((o) => ziel && strasseNorm(o.strasse) === ziel)
      || ctx.objekte.find((o) => o.strasse && norm(b.objektName).replace(/\s+/g, "").includes(strasseNorm(o.strasse)));
    if (!objekt) warnungen.push(`Haus zu „${b.adresse || b.objektName || b.blatt}“ nicht gefunden – bitte unten zuordnen.`);
    const wohnungen = objekt ? ctx.wohnungen.filter((w) => w.objekt_id === objekt.id) : [];
    const imHaus = (m) => wohnungen.some((w) => w.id === m.wohnung_id);
    const phasen = b.phasen.map((p) => {
      const n = nummer(p.wohnung);
      const wohnung = n !== null ? wohnungen.find((w) => nummer(w.bezeichnung) === n) : null;
      const nn = norm(p.nachname);
      const passt = (m) => norm(m.nachname) === nn || norm(`${m.vorname} ${m.nachname}`) === nn || nn.split(" ").pop() === norm(m.nachname);
      let kandidaten = ctx.mieter.filter((m) => passt(m) && (objekt ? imHaus(m) : true));
      if (kandidaten.length > 1 && wohnung) kandidaten = kandidaten.filter((m) => m.wohnung_id === wohnung.id).concat(kandidaten.filter((m) => m.wohnung_id !== wohnung.id));
      const eindeutig = kandidaten.length === 1 || (kandidaten.length > 1 && wohnung && kandidaten[0].wohnung_id === wohnung.id && kandidaten[1].wohnung_id !== wohnung.id);
      const monateIso = Object.entries(p.monate).filter(([, w]) => w !== null).map(([mo, w]) => ({ monat: monatIso(ctx.jahr, Number(mo)), wert: w }));
      return { ...p, wohnung_id: wohnung?.id || null, mieter_id: eindeutig ? kandidaten[0].id : null, kandidaten: kandidaten.map((m) => m.id), monateIso };
    });
    for (const p of phasen) if (!p.mieter_id) warnungen.push(`${p.wohnung ? `${p.wohnung}: ` : ""}„${p.nachname}“ nicht eindeutig gefunden – bitte Mietpartei wählen.`);
    // Prüfsummen: „Gesamt“ je Wohnung (steht in der letzten Phase) und die Summenzeile je Monat
    const proWohnung = new Map();
    for (const p of phasen) { const k = p.wohnung || "?"; if (!proWohnung.has(k)) proWohnung.set(k, []); proWohnung.get(k).push(p); }
    for (const [w, liste] of proWohnung) {
      const gesamt = liste.map((p) => p.gesamtSpalte).filter((x) => typeof x === "number").pop();
      const summe = rund(liste.reduce((s, p) => s + p.monateIso.reduce((t, x) => t + x.wert, 0), 0));
      if (typeof gesamt === "number" && Math.abs(gesamt - summe) > 0.5) warnungen.push(`${w}: Monate ergeben ${summe.toFixed(2).replace(".", ",")} €, „Gesamt“ sagt ${gesamt.toFixed(2).replace(".", ",")} € – fehlt eine Zeile im Export?`);
    }
    if (b.summen) {
      const abweichend = [];
      for (let mo = 1; mo <= 12; mo++) {
        const zeilen = rund(phasen.reduce((s, p) => s + (p.monate[mo] || 0), 0));
        const summe = b.summen[mo] || 0;
        if (Math.abs(summe - zeilen) > 0.5) abweichend.push(`${MONATS_LANG[mo - 1]} ${summe - zeilen > 0 ? "+" : ""}${(summe - zeilen).toFixed(2).replace(".", ",")} €`);
      }
      if (abweichend.length) warnungen.push(`Die Summenzeile weicht von den Wohnungen ab (${abweichend.slice(0, 4).join(", ")}${abweichend.length > 4 ? " …" : ""}) – vermutlich fehlen Einheiten im Export.`);
    }
    return { blatt: b.blatt, objekt_id: objekt?.id || null, objektText: b.adresse || b.objektName, warnungen, phasen };
  });
}
