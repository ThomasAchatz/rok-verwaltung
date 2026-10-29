// Standort-Check: Recherche im Internet zu einem Ort bzw. Kaufobjekt (Marktmiete, Kaufpreise, Baurecht, Handwerker, Makler).
// Ins Internet geht nur, was hier eingegeben wird (Ort, Adresse, Eckdaten); Kaufpreis und Ist-Miete bleiben in der App,
// die Rechnung (Faktor, Rendite) macht der Code. Ergebnisse werden gespeichert (Tabelle recherchen), damit ein Bericht
// ohne neue Suche wieder geöffnet werden kann. Kontakte übernimmt Robert per Klick.
import * as db from "./daten.js";
import { datumDE, euro } from "./dokumente.js";
import { $, $$, esc, melde, zustand, frage, heuteISO, brotkrumen } from "./helfer.js";
import { ICON_KI, geheZu, norm } from "./ui.js";
import * as ablage from "./ablage.js";

const inhalt = () => $("#inhalt");
const ABSCHNITTE = [
  { id: "markt", titel: "Mieten & Kaufpreise" },
  { id: "recht", titel: "Recht & Bauamt" },
  { id: "handwerker", titel: "Handwerker" },
  { id: "partner", titel: "Makler, Verwaltungen & Gutachter" },
];
const GEWERKE = ["Hausmeister", "Sanitär/Heizung", "Elektro", "Dachdecker", "Maler", "Schlüsseldienst", "Schreiner", "Gartenpflege", "Reinigung"];
const GEWERKE_START = ["Hausmeister", "Sanitär/Heizung", "Elektro", "Dachdecker", "Maler"];
const OBJEKTARTEN = ["Mehrfamilienhaus", "Wohn- und Geschäftshaus", "Eigentumswohnung", "Einfamilienhaus", "Grundstück"];
const KRUMEN = [{ text: "Recherche", href: "#/recherche" }];

// Laufende Recherchen (überleben einen Seitenwechsel): id → { ergebnis, laeuft: Set, fehler: {}, suchen, speichern: Promise }
const laeufe = new Map();

const zahl = (v) => { const n = Number(String(v ?? "").replace(/\./g, "").replace(",", ".")); return Number.isFinite(n) && n > 0 ? n : null; };
const komma = (n, stellen = 2) => (n == null ? "" : Number(n).toLocaleString("de-DE", { minimumFractionDigits: stellen, maximumFractionDigits: stellen }));
const spanne = (s, einheit = "€/m²", stellen = 2) => {
  const [von, bis] = Array.isArray(s) ? s : [];
  if (von == null && bis == null) return null;
  const e = einheit.startsWith("-") ? einheit : ` ${einheit}`;
  if (von != null && bis != null && von !== bis) return `${komma(von, stellen)} – ${komma(bis, stellen)}${e}`;
  return `${komma(von ?? bis, stellen)}${e}`;
};
const mitte = (s) => { const [a, b] = Array.isArray(s) ? s : []; return a != null && b != null ? (a + b) / 2 : a ?? b ?? null; };
const sicherUrl = (u) => (typeof u === "string" && /^https?:\/\/[^\s<>"]+$/i.test(u) ? u : null);
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
const aussen = (u, text) => { const s = sicherUrl(u); return s ? `<a href="${esc(s)}" target="_blank" rel="noopener noreferrer">${esc(text || host(s))}</a>` : ""; };

// ---------------------------------------------------------------------------
// Startseite: Eingabe + frühere Recherchen
// ---------------------------------------------------------------------------
export async function zeigeRecherche(id) {
  if (id) return zeigeBericht(id);
  const liste = await db.ladeRecherchen().catch(() => []);
  const v = zustand.rechercheVorgabe || {};
  zustand.rechercheVorgabe = null;
  const gewerke = v.gewerke?.length ? v.gewerke : GEWERKE_START;
  inhalt().innerHTML = `
    <div class="kopf"><div><h1>Standort-Check</h1>
      <p>Recherche im Internet zu einem Ort oder Kaufobjekt: Mieten, Kaufpreise, Baurecht, Handwerker und Makler – mit Quellen.</p></div></div>
    <section class="flaeche recherche-form">
      <form id="recherche-form">
        <div class="formraster">
          <label class="feld breit"><span>Ort oder Stadtteil *</span><input name="ort" required maxlength="120" placeholder="z. B. Regensburg-Ost" value="${esc(v.ort || "")}"></label>
          <label class="feld breit"><span>Adresse oder Lage (optional)</span><input name="adresse" maxlength="160" placeholder="z. B. Landshuter Straße 40 oder „nahe Hauptbahnhof“" value="${esc(v.adresse || "")}"></label>
          <label class="feld"><span>Objektart</span><select name="objektart">${OBJEKTARTEN.map((o) => `<option ${o === (v.objektart || "Mehrfamilienhaus") ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></label>
          <label class="feld"><span>Einheiten</span><input name="einheiten" inputmode="numeric" value="${esc(v.einheiten ?? "")}" placeholder="z. B. 8"></label>
          <label class="feld"><span>Wohnfläche gesamt (m²)</span><input name="wohnflaeche" inputmode="decimal" value="${esc(v.wohnflaeche ?? "")}" placeholder="z. B. 560"></label>
          <label class="feld"><span>Baujahr</span><input name="baujahr" inputmode="numeric" value="${esc(v.baujahr ?? "")}" placeholder="z. B. 1965"></label>
          <label class="feld"><span>Kaufpreis (€)</span><input name="kaufpreis" inputmode="decimal" value="${esc(v.kaufpreis ?? "")}" placeholder="z. B. 1.200.000"></label>
          <label class="feld"><span>Ist-Miete nettokalt (€/Monat)</span><input name="ist_miete" inputmode="decimal" placeholder="z. B. 5.200"></label>
        </div>
        <fieldset class="gruppe recherche-gewerke"><legend>Handwerker suchen für</legend>
          ${GEWERKE.map((g) => `<label class="chipwahl"><input type="checkbox" name="gewerk" value="${esc(g)}" ${gewerke.includes(g) ? "checked" : ""}> ${esc(g)}</label>`).join("")}
        </fieldset>
        <fieldset class="gruppe recherche-gewerke"><legend>Was soll recherchiert werden?</legend>
          ${ABSCHNITTE.map((a) => `<label class="chipwahl"><input type="checkbox" name="abschnitt" value="${a.id}" checked> ${esc(a.titel)}</label>`).join("")}
        </fieldset>
        <p class="leise">Ins Internet geht nur Ort, Adresse und Eckdaten – Kaufpreis und Ist-Miete bleiben in der App und werden hier nur gerechnet.
          Dauer etwa 1–2 Minuten, Kosten grob 1–2 € je Bericht.</p>
        <div class="knopfreihe"><button class="knopf knopf--primaer" type="submit">${ICON_KI} Recherche starten</button></div>
      </form>
    </section>
    ${liste.length ? `<section class="flaeche"><h2 class="flaeche__titel">Frühere Recherchen</h2>
      <div class="zeilen">${liste.map((r) => `<a class="zeile zeile--einfach" href="#/recherche/${esc(r.id)}">
        <span class="zeile__wer"><span class="zeile__name">${esc(r.titel)}</span>
          <span class="zeile__ort">${esc(datumDE(r.erstellt_am))}${r.suchen ? ` · ${r.suchen} Suchen` : ""}${r.dokument_id ? " · abgelegt" : ""}</span></span>
        <span class="zeile__pfeil" aria-hidden="true">›</span></a>`).join("")}</div></section>` : ""}`;

  $("#recherche-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!zustand.ki?.ki) return melde("Die KI ist noch nicht eingerichtet (Einstellungen).", "fehler");
    const f = new FormData(ev.target);
    const abschnitte = f.getAll("abschnitt");
    if (!abschnitte.length) return melde("Bitte mindestens einen Bereich wählen.", "fehler");
    const eingabe = {
      ort: String(f.get("ort") || "").trim(), adresse: String(f.get("adresse") || "").trim() || null, objektart: f.get("objektart"),
      einheiten: zahl(f.get("einheiten")), wohnflaeche: zahl(f.get("wohnflaeche")), baujahr: zahl(f.get("baujahr")),
      kaufpreis: zahl(f.get("kaufpreis")), ist_miete: zahl(f.get("ist_miete")), gewerke: f.getAll("gewerk"), abschnitte,
    };
    if (!eingabe.ort) return melde("Bitte einen Ort eingeben.", "fehler");
    const knopf = ev.submitter; if (knopf) knopf.disabled = true;
    try {
      const r = await db.speichereRecherche(null, { titel: [eingabe.ort, eingabe.adresse].filter(Boolean).join(" – ").slice(0, 200), eingabe, ergebnis: {} });
      starte(r, abschnitte);
      geheZu(`#/recherche/${r.id}`);
    } catch (err) { melde(err.message, "fehler"); if (knopf) knopf.disabled = false; }
  });
}

// ---------------------------------------------------------------------------
// Recherche ausführen: je Abschnitt ein Aufruf, parallel; Ergebnisse nacheinander speichern
// ---------------------------------------------------------------------------
function starte(r, abschnitte) {
  const lauf = laeufe.get(r.id) || { ergebnis: { ...(r.ergebnis || {}) }, laeuft: new Set(), fehler: {}, suchen: r.suchen || 0, speichern: Promise.resolve() };
  laeufe.set(r.id, lauf);
  const e = r.eingabe || {};
  for (const ab of abschnitte) {
    if (lauf.laeuft.has(ab)) continue;
    lauf.laeuft.add(ab);
    delete lauf.fehler[ab];
    db.funktion("recherche", {
      aktion: "standort", abschnitt: ab, ort: e.ort, adresse: e.adresse, objektart: e.objektart,
      einheiten: e.einheiten, wohnflaeche: e.wohnflaeche, baujahr: e.baujahr, gewerke: e.gewerke,
    }).then((antwort) => {
      lauf.ergebnis[ab] = { ...antwort.ergebnis, quellen: antwort.quellen || [], stand: heuteISO() };
      lauf.suchen += antwort.suchen || 0;
      lauf.speichern = lauf.speichern.then(() => db.speichereRecherche(r.id, { ergebnis: lauf.ergebnis, suchen: lauf.suchen })).catch((err) => melde(err.message, "fehler"));
    }).catch((err) => {
      lauf.fehler[ab] = err.message;
    }).finally(() => {
      lauf.laeuft.delete(ab);
      if (location.hash === `#/recherche/${r.id}`) zeichneAbschnitt(r, ab);
      if (!lauf.laeuft.size) lauf.speichern.then(() => { if (location.hash === `#/recherche/${r.id}`) zeichneKopf(r); });
    });
  }
  return lauf;
}

// ---------------------------------------------------------------------------
// Bericht
// ---------------------------------------------------------------------------
async function zeigeBericht(id) {
  const r = await db.ladeRecherche(id);
  const lauf = laeufe.get(id);
  if (lauf) r.ergebnis = lauf.ergebnis;
  const e = r.eingabe || {};
  const gewollt = Array.isArray(e.abschnitte) && e.abschnitte.length ? e.abschnitte : ABSCHNITTE.map((a) => a.id);
  inhalt().innerHTML = `
    ${brotkrumen([...KRUMEN, { text: r.titel }])}
    <div class="kopf" id="recherche-kopf"></div>
    <div class="recherche-bericht">
      <section class="flaeche" data-abschnitt="rechnung"></section>
      ${ABSCHNITTE.filter((a) => gewollt.includes(a.id)).map((a) => `<section class="flaeche" data-abschnitt="${a.id}"></section>`).join("")}
      <section class="flaeche" data-abschnitt="quellen"></section>
      <p class="leise recherche-hinweis">Einschätzung aus öffentlichen Quellen, kein Gutachten. Angebotsmieten liegen meist über den Bestandsmieten.
        Rechtliches bitte beim Bauamt bzw. bei Fachleuten bestätigen lassen.</p>
    </div>`;
  zeichneKopf(r);
  for (const a of gewollt) zeichneAbschnitt(r, a);
  zeichneAbschnitt(r, "rechnung");
  zeichneAbschnitt(r, "quellen");
  // Klicks im Bericht (Übernehmen, Nochmal)
  $(".recherche-bericht").addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-uebernehmen]");
    if (b) return uebernehmen(r, b);
    const n = ev.target.closest("[data-nochmal]");
    if (n) { starte(r, [n.dataset.nochmal]); zeichneAbschnitt(r, n.dataset.nochmal); }
  });
}

function zeichneKopf(r) {
  const el = $("#recherche-kopf");
  if (!el) return;
  const lauf = laeufe.get(r.id);
  const laeuft = lauf?.laeuft.size > 0;
  const e = r.eingabe || {};
  const eck = [e.objektart, e.einheiten && `${e.einheiten} Einheiten`, e.wohnflaeche && `${komma(e.wohnflaeche, 0)} m²`, e.baujahr && `Baujahr ${e.baujahr}`,
    e.kaufpreis && `Kaufpreis ${euro(e.kaufpreis)}`].filter(Boolean).join(" · ");
  el.innerHTML = `<div><h1>${esc(r.titel)}</h1>
      <p>${esc(eck)}</p>
      <p class="leise">${laeuft ? `<span class="kreisel" aria-hidden="true"></span> Die KI recherchiert noch (${lauf.laeuft.size} ${lauf.laeuft.size === 1 ? "Bereich" : "Bereiche"}) …`
        : `Stand ${esc(datumDE(r.aktualisiert_am || r.erstellt_am))}${(lauf?.suchen ?? r.suchen) ? ` · ${lauf?.suchen ?? r.suchen} Suchen im Internet` : ""}`}</p></div>
    <div class="knopfreihe">
      <button type="button" class="knopf" data-k="pdf" ${laeuft ? "disabled" : ""}>${r.dokument_id ? "Nochmal als PDF ablegen" : "Als PDF ablegen"}</button>
      <button type="button" class="knopf knopf--leise" data-k="neu" ${laeuft ? "disabled" : ""}>Neu recherchieren</button>
      <button type="button" class="knopf knopf--leise" data-k="weg" ${laeuft ? "disabled" : ""}>Löschen</button>
    </div>`;
  el.querySelector("[data-k=pdf]").addEventListener("click", () => alsPdf(r));
  el.querySelector("[data-k=neu]").addEventListener("click", async () => {
    if (!(await frage("Neu recherchieren?", "<p>Alle Bereiche werden neu im Internet gesucht (wieder 1–2 Minuten, 1–2 €). Übernommene Kontakte bleiben erhalten.</p>", "Neu recherchieren"))) return;
    const e2 = r.eingabe || {};
    starte(r, Array.isArray(e2.abschnitte) && e2.abschnitte.length ? e2.abschnitte : ABSCHNITTE.map((a) => a.id));
    zeigeBericht(r.id);
  });
  el.querySelector("[data-k=weg]").addEventListener("click", async () => {
    if (!(await frage("Recherche löschen?", `<p>„${esc(r.titel)}“ wird gelöscht. Übernommene Kontakte und eine abgelegte PDF bleiben.</p>`, "Löschen", { gefahr: true }))) return;
    try { await db.loescheRecherche(r.id); laeufe.delete(r.id); melde("Recherche gelöscht.", "ok"); geheZu("#/recherche"); } catch (err) { melde(err.message, "fehler"); }
  });
}

function zeichneAbschnitt(r, ab) {
  const el = $(`[data-abschnitt="${ab}"]`);
  if (!el) return;
  const lauf = laeufe.get(r.id);
  if (lauf) r.ergebnis = lauf.ergebnis;
  const erg = r.ergebnis || {};
  if (ab === "rechnung") { el.innerHTML = rechnungHtml(r.eingabe || {}, erg.markt); el.hidden = !el.innerHTML; return; }
  if (ab === "quellen") { el.innerHTML = quellenHtml(erg); el.hidden = !el.innerHTML; return; }
  const titel = ABSCHNITTE.find((a) => a.id === ab)?.titel || ab;
  const kopf = `<h2 class="flaeche__titel">${esc(titel)}</h2>`;
  if (lauf?.laeuft.has(ab)) { el.innerHTML = `${kopf}<div class="warten"><span class="kreisel" aria-hidden="true"></span><p>sucht im Internet …</p></div>`; return; }
  if (lauf?.fehler[ab]) { el.innerHTML = `${kopf}<p class="chat__fehler">Das hat nicht geklappt: ${esc(lauf.fehler[ab])}</p><button type="button" class="knopf knopf--klein" data-nochmal="${ab}">Nochmal versuchen</button>`; return; }
  const d = erg[ab];
  if (!d) { el.innerHTML = `${kopf}<p class="leise">Noch nicht recherchiert.</p><button type="button" class="knopf knopf--klein" data-nochmal="${ab}">Jetzt recherchieren</button>`; return; }
  el.innerHTML = kopf + (ab === "markt" ? marktHtml(d) : ab === "recht" ? rechtHtml(d) : kontakteHtml(ab, d));
  if (ab === "markt") zeichneAbschnitt(r, "rechnung");
  zeichneAbschnitt(r, "quellen");
}

// --- Rechnung (Code, nicht KI) ---
export function rechne(e, markt) {
  const flaeche = e.wohnflaeche || null, preis = e.kaufpreis || null;
  const out = {};
  if (preis && flaeche) out.preisQm = preis / flaeche;
  if (preis && e.ist_miete) { out.faktorIst = preis / (e.ist_miete * 12); out.renditeIst = (e.ist_miete * 12) / preis; }
  const marktMiete = mitte(markt?.miete_bestand) ?? mitte(markt?.miete_angebot);
  if (marktMiete && flaeche) {
    out.marktMieteQm = marktMiete;
    out.marktJahresmiete = marktMiete * flaeche * 12;
    if (preis) { out.faktorMarkt = preis / out.marktJahresmiete; out.renditeMarkt = out.marktJahresmiete / preis; }
  }
  if (e.ist_miete && flaeche) out.istMieteQm = e.ist_miete / flaeche;
  const fMitte = mitte(markt?.faktor);
  if (preis && flaeche && fMitte) out.noetigeMieteQm = preis / fMitte / 12 / flaeche;
  return out;
}
function rechnungHtml(e, markt) {
  const x = rechne(e, markt);
  const zeilen = [];
  const vergleich = (wert, s) => {
    const [von, bis] = Array.isArray(s) ? s : [];
    if (wert == null || (von == null && bis == null)) return "";
    if (bis != null && wert > bis * 1.05) return ` <span class="marker marker--offen">über Markt</span>`;
    if (von != null && wert < von * 0.95) return ` <span class="marker marker--ok">unter Markt</span>`;
    return ` <span class="marker marker--leise">im Rahmen</span>`;
  };
  if (x.preisQm) zeilen.push(["Kaufpreis je m²", `${euro(x.preisQm)}${vergleich(x.preisQm, markt?.kaufpreis_mfh)}`, spanne(markt?.kaufpreis_mfh) ? `Markt MFH: ${spanne(markt.kaufpreis_mfh, "€/m²", 0)}` : ""]);
  if (x.faktorIst) zeilen.push(["Faktor auf Ist-Miete", `${komma(x.faktorIst, 1)}-fach${vergleich(x.faktorIst, markt?.faktor)}`, `Bruttorendite ${komma(x.renditeIst * 100, 1)} %`]);
  if (x.istMieteQm) zeilen.push(["Ist-Miete je m²", `${komma(x.istMieteQm)} €/m²${vergleich(x.istMieteQm, markt?.miete_bestand)}`, spanne(markt?.miete_bestand) ? `Bestand: ${spanne(markt.miete_bestand)}` : ""]);
  if (x.marktJahresmiete) zeilen.push(["Marktmiete (Mitte)", `${komma(x.marktMieteQm)} €/m² · ${euro(x.marktJahresmiete)} im Jahr`, markt?.miete_bestand?.some((v) => v != null) ? "aus Bestandsmieten" : "aus Angebotsmieten"]);
  if (x.faktorMarkt) zeilen.push(["Faktor auf Marktmiete", `${komma(x.faktorMarkt, 1)}-fach${vergleich(x.faktorMarkt, markt?.faktor)}`, `Bruttorendite ${komma(x.renditeMarkt * 100, 1)} %`]);
  if (x.noetigeMieteQm) zeilen.push(["Miete für üblichen Faktor", `${komma(x.noetigeMieteQm)} €/m²`, `bei Faktor ${komma(mitte(markt.faktor), 1)}`]);
  if (!zeilen.length) {
    return e.kaufpreis || e.wohnflaeche ? `<h2 class="flaeche__titel">Rechnung</h2><p class="leise">Für die Rechnung fehlen noch Zahlen (Wohnfläche und Kaufpreis bzw. Marktmiete).</p>` : "";
  }
  return `<h2 class="flaeche__titel">Rechnung <span class="leise">(gerechnet, nicht geschätzt)</span></h2>
    <dl class="recherche-zahlen">${zeilen.map(([k, v, z]) => `<div><dt>${esc(k)}</dt><dd>${v}${z ? `<span class="leise">${esc(z)}</span>` : ""}</dd></div>`).join("")}</dl>`;
}

// --- Abschnitte ---
const punktListe = (punkte) => (punkte?.length ? `<ul class="recherche-punkte">${punkte.map((p) => `<li>${esc(p.text)}${p.quelle ? ` <span class="recherche-quelle">(${aussen(p.quelle)})</span>` : ""}</li>`).join("")}</ul>` : "");
function marktHtml(d) {
  const zahlen = [
    ["Bestandsmiete (Mietspiegel)", spanne(d.miete_bestand)],
    ["Angebotsmiete (Inserate)", spanne(d.miete_angebot)],
    ["Kaufpreis Mehrfamilienhaus", spanne(d.kaufpreis_mfh, "€/m²", 0)],
    ["Kaufpreis Eigentumswohnung", spanne(d.kaufpreis_etw, "€/m²", 0)],
    ["Kaufpreisfaktor", spanne(d.faktor, "-fach", 1)],
    ["Bodenrichtwert", d.bodenrichtwert ? `${komma(d.bodenrichtwert, 0)} €/m²` : null],
    ["Mietspiegel", d.mietspiegel],
  ].filter(([, v]) => v);
  return `${d.zusammenfassung ? `<p>${esc(d.zusammenfassung)}</p>` : ""}
    ${zahlen.length ? `<dl class="recherche-zahlen">${zahlen.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>` : `<p class="leise">Keine belastbaren Zahlen gefunden.</p>`}
    ${punktListe(d.punkte)}`;
}
const STAND = { gilt: ["gilt", "marker--offen"], gilt_nicht: ["gilt nicht", "marker--ok"], unklar: ["unklar", "marker--leise"] };
function rechtHtml(d) {
  const b = d.bauamt;
  return `${d.zusammenfassung ? `<p>${esc(d.zusammenfassung)}</p>` : ""}
    ${d.punkte?.length ? `<ul class="recherche-recht">${d.punkte.map((p) => `<li><span class="recherche-recht__kopf"><strong>${esc(p.thema)}</strong>
      <span class="marker ${STAND[p.stand]?.[1] || ""}">${esc(STAND[p.stand]?.[0] || "unklar")}</span></span>
      <span>${esc(p.text)}${p.quelle ? ` <span class="recherche-quelle">(${aussen(p.quelle)})</span>` : ""}</span></li>`).join("")}</ul>` : ""}
    ${b ? `<div class="recherche-kontakt"><div><strong>${esc(b.name)}</strong>
        <span class="leise">${[b.adresse, b.telefon, b.email].filter(Boolean).map(esc).join(" · ")}</span>${b.web ? ` <span class="recherche-quelle">${aussen(b.web, "Webseite")}</span>` : ""}</div>
        ${uebernahmeKnopf("bauamt", 0, b, "kontakt")}</div>` : ""}
    ${d.portale?.length ? `<p class="recherche-portale">Portale: ${d.portale.map((p) => aussen(p.url, p.titel)).filter(Boolean).join(" · ")}</p>` : ""}`;
}
function kontakteHtml(ab, d) {
  if (!d.eintraege?.length) return `<p class="leise">${esc(d.hinweis || "Keine passenden Einträge gefunden.")}</p>`;
  const gruppen = new Map();
  d.eintraege.forEach((k, i) => { const g = k.art || "Sonstige"; if (!gruppen.has(g)) gruppen.set(g, []); gruppen.get(g).push([k, i]); });
  return `${d.hinweis ? `<p class="leise">${esc(d.hinweis)}</p>` : ""}
    ${[...gruppen.entries()].map(([g, liste]) => `<h3 class="recherche-gruppe">${esc(g)}</h3>
      <div class="recherche-kontakte">${liste.map(([k, i]) => `<div class="recherche-kontakt">
        <div><strong>${esc(k.name)}</strong>
          <span class="leise">${[k.ort ? esc(k.ort) : null, k.telefon ? `<a href="tel:${esc(k.telefon.replace(/[^\d+]/g, ""))}">${esc(k.telefon)}</a>` : null,
            k.email ? `<a href="mailto:${esc(k.email)}">${esc(k.email)}</a>` : null].filter(Boolean).join(" · ")}</span>
          ${k.notiz ? `<span class="leise">${esc(k.notiz)}</span>` : ""}
          <span class="recherche-quelle">${[aussen(k.web, "Webseite"), k.quelle && k.quelle !== k.web ? aussen(k.quelle, "Quelle") : ""].filter(Boolean).join(" · ")}</span></div>
        ${uebernahmeKnopf(ab, i, k, ab === "handwerker" ? "handwerker" : "kontakt")}
      </div>`).join("")}</div>`).join("")}`;
}
function uebernahmeKnopf(ab, i, k, ziel) {
  if (k.uebernommen?.id) {
    const href = k.uebernommen.ziel === "handwerker" ? "#/kontakte/handwerker" : `#/kontakt/${k.uebernommen.id}`;
    return `<a class="knopf knopf--klein knopf--leise" href="${esc(href)}">${k.uebernommen.vorhanden ? "Schon vorhanden" : "Übernommen"} · öffnen</a>`;
  }
  return `<button type="button" class="knopf knopf--klein" data-uebernehmen="${ab}:${i}:${ziel}">${ziel === "handwerker" ? "Als Handwerker übernehmen" : "Als Kontakt übernehmen"}</button>`;
}
function quellenHtml(erg) {
  const alle = new Map();
  for (const a of ABSCHNITTE) for (const q of erg[a.id]?.quellen || []) if (sicherUrl(q.url) && !alle.has(q.url)) alle.set(q.url, q);
  if (!alle.size) return "";
  return `<details class="ausklapp"><summary>Quellen (${alle.size})</summary>
    <ul class="recherche-quellen">${[...alle.values()].map((q) => `<li>${aussen(q.url, q.titel || host(q.url))} <span class="leise">${esc(host(q.url))}</span></li>`).join("")}</ul></details>`;
}

// ---------------------------------------------------------------------------
// Kontakt / Handwerker übernehmen (Doppelte erkennen)
// ---------------------------------------------------------------------------
async function uebernehmen(r, knopf) {
  const [ab, i, ziel] = knopf.dataset.uebernehmen.split(":");
  const lauf = laeufe.get(r.id);
  const erg = lauf ? lauf.ergebnis : r.ergebnis;
  const k = ab === "bauamt" ? erg.recht?.bauamt : erg[ab]?.eintraege?.[Number(i)];
  if (!k) return;
  knopf.disabled = true;
  const ort = r.eingabe?.ort || "";
  const herkunft = `Aus dem Standort-Check ${ort} (${datumDE(heuteISO())})`;
  try {
    let id = null, vorhanden = false;
    if (ziel === "handwerker") {
      const liste = await db.ladeDienstleister().catch(() => []);
      const da = liste.find((x) => norm(x.name) === norm(k.name) || (k.email && norm(x.email) === norm(k.email)));
      if (da) { id = da.id; vorhanden = true; }
      else id = (await db.speichereDienstleister(null, {
        name: k.name, gewerk: k.art || null, telefon: k.telefon || null, email: k.email || null, objekt_id: null, aktiv: true,
        notiz: [k.ort, k.web, k.notiz, herkunft].filter(Boolean).join("\n"),
      })).id;
    } else {
      const liste = await db.ladeKontakte().catch(() => []);
      const da = liste.find((x) => (x.firma && norm(x.firma) === norm(k.name)) || (k.email && norm(x.email) === norm(k.email)));
      if (da) { id = da.id; vorhanden = true; }
      else id = (await db.speichereKontakt(null, {
        firma: k.name, rolle: ab === "bauamt" ? "Behörde (Bauamt)" : k.art || null, telefon: k.telefon || null, email: k.email || null,
        adresse: k.adresse || k.ort || null, notiz: [k.web, k.notiz, herkunft].filter(Boolean).join("\n"),
      })).id;
      zustand.kontakte = null;
    }
    k.uebernommen = { id, ziel, vorhanden };
    if (lauf) lauf.speichern = lauf.speichern.then(() => db.speichereRecherche(r.id, { ergebnis: erg }));
    else await db.speichereRecherche(r.id, { ergebnis: erg });
    melde(vorhanden ? `${k.name} gibt es schon – nicht doppelt angelegt.` : `${k.name} übernommen.`, vorhanden ? "info" : "ok");
    zeichneAbschnitt(r, ab === "bauamt" ? "recht" : ab);
  } catch (err) {
    knopf.disabled = false;
    melde(err.message, "fehler");
  }
}

// ---------------------------------------------------------------------------
// Bericht als PDF in die Ablage (Name vorher sichtbar über inAblageDialog)
// ---------------------------------------------------------------------------
export function berichtAbschnitte(r) {
  const e = r.eingabe || {}, erg = r.ergebnis || {};
  const ab = [];
  const x = rechne(e, erg.markt);
  const eck = [
    `Objekt: ${[e.objektart, e.einheiten && `${e.einheiten} Einheiten`, e.wohnflaeche && `${komma(e.wohnflaeche, 0)} m²`, e.baujahr && `Baujahr ${e.baujahr}`].filter(Boolean).join(", ")}`,
    e.kaufpreis ? `Kaufpreis: ${euro(e.kaufpreis)}${x.preisQm ? ` (${euro(x.preisQm)} je m²)` : ""}` : null,
    e.ist_miete ? `Ist-Miete nettokalt: ${euro(e.ist_miete)} im Monat` : null,
    x.faktorIst ? `Faktor auf Ist-Miete: ${komma(x.faktorIst, 1)} (Bruttorendite ${komma(x.renditeIst * 100, 1)} %)` : null,
    x.faktorMarkt ? `Faktor auf Marktmiete (${komma(x.marktMieteQm)} €/m²): ${komma(x.faktorMarkt, 1)} (Bruttorendite ${komma(x.renditeMarkt * 100, 1)} %)` : null,
    x.noetigeMieteQm ? `Miete für üblichen Faktor: ${komma(x.noetigeMieteQm)} €/m²` : null,
  ].filter(Boolean);
  ab.push({ titel: "Eckdaten und Rechnung", text: eck.join("\n") });
  const m = erg.markt;
  if (m) ab.push({ titel: "Mieten und Kaufpreise", text: [m.zusammenfassung,
    spanne(m.miete_bestand) && `Bestandsmiete: ${spanne(m.miete_bestand)}`, spanne(m.miete_angebot) && `Angebotsmiete: ${spanne(m.miete_angebot)}`,
    spanne(m.kaufpreis_mfh) && `Kaufpreis MFH: ${spanne(m.kaufpreis_mfh, "€/m²", 0)}`, spanne(m.kaufpreis_etw) && `Kaufpreis ETW: ${spanne(m.kaufpreis_etw, "€/m²", 0)}`,
    spanne(m.faktor) && `Kaufpreisfaktor: ${spanne(m.faktor, "-fach", 1)}`, m.bodenrichtwert && `Bodenrichtwert: ${komma(m.bodenrichtwert, 0)} €/m²`, m.mietspiegel && `Mietspiegel: ${m.mietspiegel}`,
    ...(m.punkte || []).map((p) => `- ${p.text}${p.quelle ? ` (${host(p.quelle)})` : ""}`)].filter(Boolean).join("\n") });
  const re = erg.recht;
  if (re) ab.push({ titel: "Recht und Bauamt", text: [re.zusammenfassung,
    ...(re.punkte || []).map((p) => `- ${p.thema} (${STAND[p.stand]?.[0] || "unklar"}): ${p.text}`),
    re.bauamt && `Bauamt: ${[re.bauamt.name, re.bauamt.adresse, re.bauamt.telefon, re.bauamt.email, re.bauamt.web].filter(Boolean).join(", ")}`,
    ...(re.portale || []).map((p) => `Portal: ${p.titel} – ${p.url}`)].filter(Boolean).join("\n") });
  for (const [id, titel] of [["handwerker", "Handwerker"], ["partner", "Makler, Verwaltungen und Gutachter"]]) {
    const d = erg[id];
    if (d?.eintraege?.length) ab.push({ titel, text: d.eintraege.map((k) => `- ${k.name} (${k.art})${[k.ort, k.telefon, k.email, k.web].filter(Boolean).length ? `: ${[k.ort, k.telefon, k.email, k.web].filter(Boolean).join(", ")}` : ""}`).join("\n") });
  }
  const quellen = new Map();
  for (const a of ABSCHNITTE) for (const q of erg[a.id]?.quellen || []) if (!quellen.has(q.url)) quellen.set(q.url, q);
  if (quellen.size) ab.push({ titel: "Quellen", text: [...quellen.values()].map((q) => `- ${q.titel}: ${q.url}`).join("\n") });
  ab.push({ titel: "Hinweis", text: "Einschätzung aus öffentlichen Quellen, kein Gutachten. Angebotsmieten liegen meist über den Bestandsmieten. Rechtliches beim Bauamt bzw. bei Fachleuten bestätigen lassen." });
  return ab;
}
async function alsPdf(r) {
  const lauf = laeufe.get(r.id);
  if (lauf) r.ergebnis = lauf.ergebnis;
  const p = zustand.profil || {};
  const titel = `Standort-Check ${r.titel}`;
  const abschnitte = berichtAbschnitte(r);
  const e = {
    quelle: {}, richtung: "notiz", art: "Sonstiges", artFest: false, datum: heuteISO(), objektId: null, mieterId: null,
    gegenueber: "", thema: `Standort-Check ${r.eingabe?.ort || ""}`.slice(0, 60),
    kiText: { titel, text: abschnitte.map((x) => `${x.titel}: ${x.text}`).join("\n").slice(0, 6000) },
    beschreibung: "Der Bericht wird als PDF abgelegt.",
    datei: ablage.pdfEintrag({ kopf: [p.firma || p.inhaber].filter(Boolean), titel, angaben: [["Stand", datumDE(r.aktualisiert_am || new Date())], ["Ort", r.titel]], text: "", abschnitte }),
  };
  const doc = await ablage.inAblageDialog(e);
  if (doc?.id) {
    try { Object.assign(r, await db.speichereRecherche(r.id, { dokument_id: doc.id })); zeichneKopf(r); } catch (err) { melde(err.message, "fehler"); }
  }
}
