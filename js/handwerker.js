// Handwerker: Angebote einholen oder direkt beauftragen, Aufträge verfolgen bis „abgeschlossen“, Handwerker-Liste.
// Seite #/handwerker (Reiter Laufend | Abgeschlossen | Handwerker), Auftragsseite #/auftrag/<id>, Maske anfrageDialog().
// Grundsätze: Schreiben an Handwerker sind immer Entwürfe (nie automatisch senden); die KI formuliert nur den Text,
// Einsatzort und Kontakt der Mietpartei setzt die App selbst darunter (nur wenn „Der Handwerker sieht“ es erlaubt).
// Schreiben, die woanders entstehen (Nachricht → „Handwerker beauftragen“, „Ja und Ja“), werden beim Laden übernommen (abgleichen()).
import * as db from "./daten.js";
import { euro, datumDE, mieterName } from "./dokumente.js";
import { $, $$, esc, melde, dialogFormular, frage, heuteISO, zustand, objektVon, wohnungVon, brotkrumen } from "./helfer.js";
import { ICON_KI, geheZu, mieterListe, mikroKnopf, verbindeDiktat, wartehinweis, norm, verkleinere } from "./ui.js";
import * as ablage from "./ablage.js";
import * as vorgaenge from "./vorgaenge.js";

const inhalt = () => $("#inhalt");
export const STATUS = {
  entwurf: "Entwurf", angefragt: "Angefragt", angebot: "Angebot da", beauftragt: "Beauftragt",
  erledigt: "Erledigt", abgeschlossen: "Abgeschlossen", abgebrochen: "Abgebrochen",
};
const HW_STATUS = { entwurf: "Entwurf", angefragt: "angefragt", angebot: "Angebot da", abgelehnt: "abgesagt", beauftragen: "Auftrag als Entwurf", beauftragt: "beauftragt" };
const LAUFEND = ["entwurf", "angefragt", "angebot", "beauftragt", "erledigt"];
const GESENDET = ["gesendet", "als_brief"];
const SCHRITTE = { angebot: ["angefragt", "angebot", "beauftragt", "erledigt"], auftrag: ["beauftragt", "erledigt", "abgeschlossen"] };
const ICON_PLUS = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>`;
const tageSeit = (iso) => (iso ? Math.floor((Date.parse(heuteISO() + "T12:00:00") - Date.parse(String(iso).slice(0, 10) + "T12:00:00")) / 86400000) : 0);
const zahl = (s) => { const n = Number(String(s ?? "").replace(/\./g, "").replace(",", ".")); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null; };
const betragFeld = (n) => (n ? String(Number(n).toFixed(2)).replace(".", ",") : "");
const titelAus = (betreff) => String(betreff || "").replace(/^\s*((auftrag|anfrage|angebot|aw|re|wg)\s*:\s*)+/i, "").trim().slice(0, 160) || "Auftrag";
const istHausmeister = (d) => /hausmeist/i.test(d?.gewerk || "");

// ---------------------------------------------------------------------------
// Zustand eines Auftrags (für Liste, Kacheln und Auftragsseite)
// ---------------------------------------------------------------------------
/** Was ist überfällig? Liefert einen kurzen Text oder "" */
export function ueberfaellig(a, heute = heuteISO()) {
  if (a.status === "entwurf" && tageSeit(a.erstellt_am) >= 2) return "Entwurf noch nicht gesendet";
  if ((a.status === "angefragt" || a.status === "angebot") && a.frist && a.frist < heute) {
    const offen = (a.handwerker || []).filter((h) => h.status === "angefragt").length;
    if (a.status === "angefragt" || offen) return `Angebotsfrist seit ${datumDE(a.frist)} vorbei`;
  }
  if (a.status === "beauftragt") {
    if (a.frist && a.frist < heute) return `sollte bis ${datumDE(a.frist)} erledigt sein`;
    if (!a.termin && a.gesendet_am && tageSeit(a.gesendet_am) >= 5) return `keine Rückmeldung seit ${tageSeit(a.gesendet_am)} Tagen`;
    if (a.termin && a.termin < heute && tageSeit(a.termin) >= 3) return `Termin ${datumDE(a.termin)} vorbei – erledigt?`;
  }
  return "";
}
export function zustandText(a) {
  const hw = a.handwerker || [];
  if (a.status === "entwurf") return "noch nicht gesendet";
  if (a.status === "angefragt") return `${hw.filter((h) => h.status !== "entwurf").length || hw.length} angefragt${a.frist ? ` · Angebot bis ${datumDE(a.frist)}` : ""}`;
  if (a.status === "angebot") {
    const da = hw.filter((h) => h.status === "angebot" || h.betrag).length;
    const guenstig = hw.filter((h) => h.betrag).sort((x, y) => x.betrag - y.betrag)[0];
    return `${da} von ${hw.length} Angeboten${guenstig ? ` · ab ${euro(guenstig.betrag)}` : ""}`;
  }
  if (a.status === "beauftragt") return a.termin ? `Termin ${datumDE(a.termin)}` : a.gesendet_am ? `beauftragt am ${datumDE(a.gesendet_am)}` : "beauftragt";
  if (a.status === "erledigt") return `erledigt${a.erledigt_am ? ` am ${datumDE(a.erledigt_am)}` : ""}${a.rechnung_dokument_id ? "" : " · Rechnung fehlt"}`;
  if (a.status === "abgeschlossen") return `${a.abgeschlossen_am ? datumDE(a.abgeschlossen_am) : ""}${a.betrag ? ` · ${euro(a.betrag)}` : ""}`;
  return a.notiz || "";
}
const chipKlasse = (a, spaet) => (spaet && LAUFEND.includes(a.status) ? "hw-chip--rot" : `hw-chip--${a.status}`);
function schritteHtml(a) {
  const reihe = SCHRITTE[a.art] || SCHRITTE.auftrag;
  const i = reihe.indexOf(a.status === "abgeschlossen" && a.art === "angebot" ? "erledigt" : a.status);
  return `<span class="hw-schritte" aria-hidden="true">${reihe.map((_, k) => `<i class="${k <= i ? "an" : ""}"></i>`).join("")}</span>`;
}
const ortText = (a, mieterL) => {
  const m = a.mieter_id ? mieterL.find((x) => x.id === a.mieter_id) : null;
  const w = m ? wohnungVon(m.wohnung_id) : null;
  const o = objektVon(a.objekt_id || w?.objekt_id);
  return [o?.bezeichnung || "ohne Haus", w ? w.bezeichnung : a.objekt_id ? "ganzes Haus" : ""].filter(Boolean).join(" · ");
};
const hwName = (dienst, id) => dienst.find((d) => d.id === id)?.name || "Handwerker";

// ---------------------------------------------------------------------------
// Abgleich: Schreiben ↔ Aufträge (übernimmt Aufträge aus dem Postfach, setzt „angefragt“/„beauftragt“ nach dem Senden)
// ---------------------------------------------------------------------------
export async function abgleichen() {
  const [auftraege, schreiben, mieterL, dienst] = await Promise.all([
    db.ladeAuftraege(), db.ladeHandwerkerSchreiben(), mieterListe(), db.ladeDienstleister().catch(() => []),
  ]);
  let geaendert = false;
  // 1. Aufträge aus dem Postfach / „Ja und Ja“ (antworten.art = auftrag ohne Auftrag) übernehmen
  for (const s of schreiben.filter((x) => x.art === "auftrag" && !x.auftrag_id)) {
    const m = s.mieter_id ? mieterL.find((x) => x.id === s.mieter_id) : null;
    const objekt = (m && wohnungVon(m.wohnung_id)?.objekt_id) || s.objekt_id || dienst.find((d) => d.id === s.dienstleister_id)?.objekt_id || null;
    const gesendet = GESENDET.includes(s.status);
    try {
      const neu = await db.speichereAuftrag(null, {
        art: "auftrag", status: gesendet ? "beauftragt" : "entwurf", titel: titelAus(s.betreff), objekt_id: objekt, mieter_id: s.mieter_id || null,
        dienstleister_id: s.dienstleister_id || null, thema_id: s.thema_id || null, nachricht_id: s.nachricht_id || null,
        handwerker: s.dienstleister_id ? [{ dienstleister_id: s.dienstleister_id, antwort_id: s.id, thema_id: s.thema_id || null, status: gesendet ? "beauftragt" : "entwurf" }] : [],
        gesendet_am: gesendet ? s.gesendet_am || null : null, sichtbar: { fotos: true, kontakt: true },
      });
      await db.speichereAntwort(s.id, { auftrag_id: neu.id });
      s.auftrag_id = neu.id;
      auftraege.unshift(neu);
      geaendert = true;
    } catch (err) { console.warn("Auftrag übernehmen:", err.message); }
  }
  // 2. Status nach dem Senden nachziehen
  const vonAuftrag = new Map();
  for (const s of schreiben) if (s.auftrag_id) { if (!vonAuftrag.has(s.auftrag_id)) vonAuftrag.set(s.auftrag_id, []); vonAuftrag.get(s.auftrag_id).push(s); }
  for (const a of auftraege) {
    const liste = vonAuftrag.get(a.id) || [];
    const neu = {};
    const hw = (a.handwerker || []).map((h) => ({ ...h }));
    let hwAnders = false;
    for (const h of hw) {
      const anfrage = liste.find((s) => s.id === h.antwort_id);
      if (h.status === "entwurf" && anfrage && GESENDET.includes(anfrage.status)) { h.status = a.art === "angebot" ? "angefragt" : "beauftragt"; h.gesendet_am = anfrage.gesendet_am || null; hwAnders = true; }
      const auftragS = h.auftrag_antwort_id ? liste.find((s) => s.id === h.auftrag_antwort_id) : null;
      if (h.status === "beauftragen" && auftragS && GESENDET.includes(auftragS.status)) {
        h.status = "beauftragt"; hwAnders = true;
        Object.assign(neu, { status: "beauftragt", dienstleister_id: h.dienstleister_id, gesendet_am: auftragS.gesendet_am || new Date().toISOString() });
      }
      if (h.status === "beauftragen" && h.auftrag_antwort_id && !auftragS) { h.status = h.betrag ? "angebot" : "angefragt"; delete h.auftrag_antwort_id; hwAnders = true; }
    }
    if (hwAnders) neu.handwerker = hw;
    if (a.status === "entwurf") {
      const raus = liste.filter((s) => GESENDET.includes(s.status));
      if (raus.length) {
        neu.status = a.art === "angebot" ? "angefragt" : "beauftragt";
        neu.gesendet_am = raus.map((s) => s.gesendet_am).filter(Boolean).sort()[0] || new Date().toISOString();
      } else if (!liste.length && Date.now() - Date.parse(a.erstellt_am) > 10 * 60000 && !a.notiz) {
        // Entwurf verworfen: Auftrag ohne Schreiben wieder entfernen
        await db.loescheAuftrag(a.id).catch(() => {});
        a._weg = true; geaendert = true;
        continue;
      }
    }
    if (Object.keys(neu).length) {
      try { Object.assign(a, await db.speichereAuftrag(a.id, neu)); geaendert = true; } catch (err) { console.warn("Auftrag abgleichen:", err.message); }
    }
  }
  return { auftraege: auftraege.filter((a) => !a._weg), schreiben, mieterL, dienst, geaendert };
}

// ---------------------------------------------------------------------------
// Seite „Handwerker“
// ---------------------------------------------------------------------------
export async function zeigeHandwerkerSeite(reiter = "laufend") {
  if (!["laufend", "abgeschlossen", "liste"].includes(reiter)) reiter = "laufend";
  const { auftraege, schreiben, mieterL, dienst } = await abgleichen();
  const laufend = auftraege.filter((a) => LAUFEND.includes(a.status));
  const fertig = auftraege.filter((a) => !LAUFEND.includes(a.status));
  const themen = laufend.flatMap((a) => [a.thema_id, ...(a.handwerker || []).map((h) => h.thema_id)]);
  const post = await db.ladeNachrichtenZuThemen(themen).catch(() => []);
  const haus = zustand.hwHaus || "";
  const imHaus = (a) => !haus || a.objekt_id === haus;
  const jahr = heuteISO().slice(0, 4);
  const fertigJahr = fertig.filter((a) => a.status === "abgeschlossen" && String(a.abgeschlossen_am || a.aktualisiert_am).startsWith(jahr));
  const spaete = laufend.filter((a) => ueberfaellig(a));
  const beauftragt = laufend.filter((a) => a.status === "beauftragt");
  const naechster = beauftragt.map((a) => a.termin).filter((t) => t && t >= heuteISO()).sort()[0];
  const angefragt = laufend.filter((a) => a.status === "angefragt" || a.status === "angebot");
  const angeboteDa = angefragt.reduce((s, a) => s + (a.handwerker || []).filter((h) => h.betrag).length, 0);
  const summe = fertigJahr.reduce((s, a) => s + Number(a.betrag || 0), 0);
  const antwortenVon = (a) => {
    const ids = new Set([a.thema_id, ...(a.handwerker || []).map((h) => h.thema_id)].filter(Boolean));
    return post.filter((n) => ids.has(n.thema_id) && (!a.gesendet_am || n.eingang_am > a.gesendet_am));
  };
  const reiterLink = (r, text, n) => `<a class="reiter__knopf" href="#/handwerker${r === "laufend" ? "" : `/${r}`}" ${r === reiter ? 'aria-current="page"' : ""}>${text} <span class="hw-zahl">${n}</span></a>`;

  let liste = "";
  if (reiter === "laufend") {
    const zeilen = laufend.filter(imHaus).sort((x, y) => (!!ueberfaellig(y) - !!ueberfaellig(x)) || LAUFEND.indexOf(x.status) - LAUFEND.indexOf(y.status) || String(y.erstellt_am).localeCompare(String(x.erstellt_am)));
    liste = zeilen.length ? `<div class="hw-liste">${zeilen.map((a) => auftragZeile(a, { mieterL, dienst, schreiben, antworten: antwortenVon(a) })).join("")}</div>`
      : `<div class="leer">Keine laufenden Aufträge${haus ? " in diesem Haus" : ""}. Mit „Handwerker beauftragen“ geht es los.</div>`;
  } else if (reiter === "abgeschlossen") {
    const zeilen = fertig.filter(imHaus).sort((x, y) => String(y.abgeschlossen_am || y.aktualisiert_am).localeCompare(String(x.abgeschlossen_am || x.aktualisiert_am)));
    const sum = zeilen.filter((a) => a.status === "abgeschlossen").reduce((s, a) => s + Number(a.betrag || 0), 0);
    liste = zeilen.length ? `<p class="hw-summe">${zeilen.length} Aufträge · zusammen ${euro(sum)}</p>
      <div class="hw-liste">${zeilen.map((a) => auftragZeile(a, { mieterL, dienst, schreiben, antworten: [] })).join("")}</div>`
      : `<div class="leer">Noch keine abgeschlossenen Aufträge.</div>`;
  } else {
    const zahlen = (d) => ({
      laufend: laufend.filter((a) => a.dienstleister_id === d.id || (a.handwerker || []).some((h) => h.dienstleister_id === d.id)).length,
      fertig: fertig.filter((a) => a.status === "abgeschlossen" && a.dienstleister_id === d.id).length,
      letzter: auftraege.find((a) => a.dienstleister_id === d.id || (a.handwerker || []).some((h) => h.dienstleister_id === d.id)),
    });
    const sichtbar = dienst.filter((d) => !haus || !d.objekt_id || d.objekt_id === haus);
    liste = sichtbar.length ? `<div class="hw-karten">${sichtbar.map((d) => {
      const z = zahlen(d);
      return `<div class="hw-karte ${d.aktiv ? "" : "hw-karte--aus"}">
        <button type="button" class="hw-karte__kopf" data-dienst="${esc(d.id)}">
          <span class="hw-ini" aria-hidden="true">${esc((d.name || "?").split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase())}</span>
          <span><strong>${esc(d.name)}</strong><span class="leise">${esc([d.gewerk, d.objekt_id ? objektVon(d.objekt_id)?.bezeichnung : "alle Häuser", d.aktiv ? "" : "ausgeschaltet"].filter(Boolean).join(" · "))}</span></span>
        </button>
        <p class="hw-karte__zahlen">laufend ${z.laufend} · abgeschlossen ${z.fertig}${z.letzter ? `<br><span class="leise">zuletzt: ${esc(z.letzter.titel)}</span>` : ""}</p>
        <div class="knopfreihe knopfreihe--eng">
          ${d.telefon ? `<a class="knopf knopf--klein" href="tel:${esc(String(d.telefon).replace(/[^\d+]/g, ""))}">${esc(d.telefon)}</a>` : ""}
          ${d.aktiv ? `<button type="button" class="knopf knopf--klein knopf--primaer" data-beauftrage="${esc(d.id)}">Beauftragen</button>` : ""}
        </div>
      </div>`;
    }).join("")}</div>` : `<div class="leer">Noch keine Handwerker eingetragen.</div>`;
  }

  inhalt().innerHTML = `
    <div class="kopf">
      <div><h1>Handwerker</h1><p>Aufträge, Angebote und deine Handwerker an einem Ort</p></div>
      <div class="knopfreihe">
        <button type="button" class="knopf" id="hw-neu">${ICON_PLUS} Handwerker anlegen</button>
        <button type="button" class="knopf knopf--primaer" id="hw-anfragen">${ICON_PLUS} Handwerker beauftragen</button>
      </div>
    </div>
    <div class="hw-kacheln">
      <a class="hw-kachel" href="#/handwerker"><small>Angebote angefragt</small><b>${angefragt.length}</b><span>${angeboteDa ? `${angeboteDa} ${angeboteDa === 1 ? "Angebot" : "Angebote"} eingegangen` : "noch keine Angebote da"}</span></a>
      <a class="hw-kachel" href="#/handwerker"><small>Beauftragt</small><b>${beauftragt.length}</b><span>${naechster ? `nächster Termin ${datumDE(naechster)}` : "kein Termin eingetragen"}</span></a>
      <a class="hw-kachel ${spaete.length ? "hw-kachel--rot" : ""}" href="#/handwerker"><small>Überfällig</small><b>${spaete.length}</b><span>${spaete.length ? esc(ueberfaellig(spaete[0])) : "alles im Plan"}</span></a>
      <a class="hw-kachel" href="#/handwerker/abgeschlossen"><small>Abgeschlossen ${jahr}</small><b>${fertigJahr.length}</b><span>${summe ? `zusammen ${euro(summe)}` : "–"}</span></a>
    </div>
    <div class="hw-leiste">
      <nav class="reiter reiter--seiten" aria-label="Bereiche">${reiterLink("laufend", "Laufend", laufend.length)}${reiterLink("abgeschlossen", `<span class="hw-lang">Abgeschlossen</span><span class="hw-kurz">Fertig</span>`, fertig.length)}${reiterLink("liste", "Handwerker", dienst.filter((d) => d.aktiv).length)}</nav>
      <label class="hw-filter"><span class="sr-only">Haus</span><select id="hw-haus"><option value="">Alle Häuser</option>${zustand.stamm.objekte.map((o) => `<option value="${esc(o.id)}" ${o.id === haus ? "selected" : ""}>${esc(o.bezeichnung)}</option>`).join("")}</select></label>
    </div>
    <section class="flaeche hw-flaeche">${liste}</section>
    ${reiter === "laufend" ? `<p class="leise hw-legende">Ablauf: Angebot einholen (angefragt → Angebot da) oder direkt beauftragen → erledigt → abgeschlossen (mit oder ohne Rechnung, z. B. beim Hausmeister).</p>` : ""}
    <button type="button" class="hw-fab" id="hw-fab">${ICON_PLUS} Beauftragen</button>`;

  const neu = () => zeigeHandwerkerSeite(reiter);
  $("#hw-haus").addEventListener("change", (e) => { zustand.hwHaus = e.target.value || ""; neu(); });
  for (const k of ["#hw-anfragen", "#hw-fab"]) $(k).addEventListener("click", () => anfrageDialog({ objektId: haus || null }));
  $("#hw-neu").addEventListener("click", () => ablage.bearbeiteDienstleister(null, { nachher: neu, objektId: haus || null }));
  for (const b of $$("[data-dienst]")) b.addEventListener("click", () => ablage.bearbeiteDienstleister(dienst.find((d) => d.id === b.dataset.dienst), { nachher: neu }));
  for (const b of $$("[data-beauftrage]")) {
    b.addEventListener("click", () => {
      const d = dienst.find((x) => x.id === b.dataset.beauftrage);
      anfrageDialog({ dienstleisterIds: [d.id], objektId: haus || d.objekt_id || null, art: "auftrag" });
    });
  }
  verbindeSchnell(inhalt(), { auftraege, dienst, mieterL, nachher: neu });
}

function auftragZeile(a, { mieterL, dienst, schreiben, antworten }) {
  const spaet = LAUFEND.includes(a.status) ? ueberfaellig(a) : "";
  const hw = (a.handwerker || []).length ? a.handwerker : a.dienstleister_id ? [{ dienstleister_id: a.dienstleister_id, status: a.status }] : [];
  const m = a.mieter_id ? mieterL.find((x) => x.id === a.mieter_id) : null;
  const fotos = schreiben.filter((s) => s.auftrag_id === a.id).reduce((n, s) => Math.max(n, (s.anhaenge || []).length), 0);
  return `
    <div class="hw-zeile">
      <a class="hw-zeile__was" href="#/auftrag/${esc(a.id)}">
        <span class="hw-ort">${esc(ortText(a, mieterL))}</span>
        <span class="hw-titel">${esc(a.titel)}</span>
        <span class="leise">${esc([a.art === "angebot" ? "Angebot eingeholt" : "Direktauftrag", m ? mieterName(m) : "", fotos ? `${fotos} ${fotos === 1 ? "Anhang" : "Anhänge"}` : ""].filter(Boolean).join(" · "))}</span>
      </a>
      <div class="hw-wer">${hw.slice(0, 4).map((h) => `<span class="hw-person ${h.dienstleister_id === a.dienstleister_id && a.art === "angebot" && ["beauftragt", "erledigt", "abgeschlossen"].includes(a.status) ? "hw-person--gewaehlt" : ""}">${esc(hwName(dienst, h.dienstleister_id))}${h.betrag ? ` <b>${euro(h.betrag)}</b>` : ""}</span>`).join("")}${hw.length > 4 ? `<span class="leise">+${hw.length - 4}</span>` : ""}</div>
      <div class="hw-stand">
        <span class="hw-chip ${chipKlasse(a, spaet)}">${esc(spaet && a.status !== "entwurf" ? (a.status === "beauftragt" && !a.termin ? "Keine Rückmeldung" : "Überfällig") : STATUS[a.status])}</span>
        <span class="leise">${esc(spaet || zustandText(a))}</span>
        ${antworten.length ? `<a class="hw-post" href="#/postfach/${esc(antworten[0].id)}">✉ ${antworten.length === 1 ? "Antwort" : `${antworten.length} Antworten`} vom Handwerker</a>` : ""}
        ${LAUFEND.includes(a.status) ? schritteHtml(a) : ""}
      </div>
      <div class="hw-aktion">${schnellKnopf(a, spaet)}<a class="knopf knopf--klein" href="#/auftrag/${esc(a.id)}">Öffnen</a></div>
    </div>`;
}

/** Der wichtigste nächste Schritt als Knopf (Liste und Postfach) */
function schnellKnopf(a, spaet = ueberfaellig(a)) {
  const k = (was, text, primaer = true) => `<button type="button" class="knopf knopf--klein ${primaer ? "knopf--primaer" : ""}" data-schnell="${esc(a.id)}:${was}">${text}</button>`;
  if (a.status === "entwurf") return k("entwurf", "Entwurf senden");
  if (a.status === "angefragt") return spaet ? k("erinnern", "Nachfassen") : k("angebot", "Angebot eintragen");
  if (a.status === "angebot") return `<a class="knopf knopf--klein knopf--primaer" href="#/auftrag/${esc(a.id)}">Vergleichen &amp; beauftragen</a>`;
  if (a.status === "beauftragt") return spaet && !a.termin ? k("erinnern", "Erinnern") : !a.termin ? k("termin", "Termin eintragen") : k("erledigt", "Erledigt melden");
  if (a.status === "erledigt") return a.rechnung_dokument_id ? k("abschliessen", "Abschließen") : k("rechnung", "Rechnung ablegen");
  return "";
}
function verbindeSchnell(root, { auftraege, dienst, mieterL, nachher }) {
  for (const b of $$("[data-schnell]", root)) {
    b.addEventListener("click", async () => {
      const [id, was] = b.dataset.schnell.split(":");
      const a = auftraege.find((x) => x.id === id) || await db.ladeAuftrag(id).catch(() => null);
      if (!a) return;
      try { if (await aktion(a, was, { dienst, mieterL })) nachher(); } catch (err) { melde(err.message, "fehler"); }
    });
  }
}

// ---------------------------------------------------------------------------
// Auftragsseite
// ---------------------------------------------------------------------------
export async function zeigeAuftrag(id) {
  const { auftraege, schreiben, mieterL, dienst } = await abgleichen();
  const a = auftraege.find((x) => x.id === id);
  if (!a) { inhalt().innerHTML = `<div class="leer">Diesen Auftrag gibt es nicht mehr. <a href="#/handwerker">Zur Übersicht</a></div>`; return; }
  const meine = schreiben.filter((s) => s.auftrag_id === a.id);
  const themen = [a.thema_id, ...(a.handwerker || []).map((h) => h.thema_id)];
  const post = (await db.ladeNachrichtenZuThemen(themen).catch(() => [])).filter((n) => !a.gesendet_am || n.eingang_am > a.gesendet_am);
  const m = a.mieter_id ? mieterL.find((x) => x.id === a.mieter_id) : null;
  const spaet = LAUFEND.includes(a.status) ? ueberfaellig(a) : "";
  const hw = (a.handwerker || []).length ? a.handwerker : a.dienstleister_id ? [{ dienstleister_id: a.dienstleister_id, status: a.status === "entwurf" ? "entwurf" : "beauftragt" }] : [];
  const rechnung = a.rechnung_dokument_id ? (await db.ladeDokumenteIds([a.rechnung_dokument_id]).catch(() => []))[0] : null;
  const angebotsDocs = await db.ladeDokumenteIds(hw.map((h) => h.dokument_id).filter(Boolean)).catch(() => []);
  const link = (s) => (s.nachricht_id ? `#/postfach/${s.nachricht_id}` : s.status === "entwurf" ? `#/entwurf/${s.id}` : s.thema_id ? `#/thema/${s.thema_id}` : `#/entwurf/${s.id}`);
  const schreibenVon = (h) => meine.filter((s) => s.dienstleister_id === h.dienstleister_id);
  const hatAngebote = hw.some((h) => h.betrag);
  const offen = LAUFEND.includes(a.status);

  const hwZeile = (h) => {
    const d = dienst.find((x) => x.id === h.dienstleister_id);
    const doc = angebotsDocs.find((x) => x.id === h.dokument_id);
    const entwurf = schreibenVon(h).find((s) => s.status === "entwurf");
    return `<div class="hw-beteiligt ${h.dienstleister_id === a.dienstleister_id && a.art === "angebot" && ["beauftragt", "erledigt", "abgeschlossen"].includes(a.status) ? "hw-beteiligt--gewaehlt" : ""}">
      <div><strong>${esc(d?.name || "Handwerker")}</strong>${d?.gewerk ? ` <span class="leise">${esc(d.gewerk)}</span>` : ""}
        <div class="leise">${[d?.telefon ? `<a href="tel:${esc(String(d.telefon).replace(/[^\d+]/g, ""))}">${esc(d.telefon)}</a>` : "", d?.email ? esc(d.email) : "keine E-Mail"].filter(Boolean).join(" · ")}</div></div>
      <div><span class="hw-chip hw-chip--${esc(h.status)}">${esc(HW_STATUS[h.status] || h.status)}</span>
        ${h.betrag ? `<div class="hw-betrag">${euro(h.betrag)}${h.datum ? ` <span class="leise">vom ${datumDE(h.datum)}</span>` : ""}</div>` : ""}
        ${doc ? `<button type="button" class="textknopf" data-dok="${esc(doc.id)}">${esc(doc.titel)}</button>` : ""}</div>
      <div class="knopfreihe knopfreihe--eng">
        ${entwurf ? `<a class="knopf knopf--klein knopf--primaer" href="${link(entwurf)}">Entwurf ansehen &amp; senden</a>` : ""}
        ${schreibenVon(h).filter((s) => s.status !== "entwurf").slice(0, 1).map((s) => `<a class="knopf knopf--klein" href="${link(s)}">Schriftverkehr</a>`).join("")}
        ${offen && a.art === "angebot" && ["angefragt", "angebot"].includes(h.status) ? `<button type="button" class="knopf knopf--klein" data-hw="${esc(h.dienstleister_id)}:angebot">${h.betrag ? "Angebot ändern" : "Angebot eintragen"}</button>` : ""}
        ${offen && a.art === "angebot" && ["angefragt", "angebot"].includes(a.status) && h.status !== "abgelehnt" ? `<button type="button" class="knopf knopf--klein ${h.betrag ? "knopf--primaer" : ""}" data-hw="${esc(h.dienstleister_id)}:beauftragen">Beauftragen</button>` : ""}
      </div>
    </div>`;
  };

  inhalt().innerHTML = `
    ${brotkrumen([{ text: "Handwerker", href: "#/handwerker" }, { text: a.titel }])}
    <div class="akte__kopf">
      <h1>${esc(a.titel)}</h1>
      <div class="unter"><span>${esc(ortText(a, mieterL))}</span>${m ? `<a href="#/mieter/${esc(m.id)}">${esc(mieterName(m))}</a>` : ""}
        <span class="hw-chip ${chipKlasse(a, spaet)}">${esc(STATUS[a.status])}</span><span class="leise">${a.art === "angebot" ? "Angebote eingeholt" : "Direktauftrag"}</span></div>
    </div>
    ${spaet ? `<p class="hw-warnung">${esc(spaet)}</p>` : ""}
    <div class="akte">
      <div class="stapel">
        <section class="flaeche">
          <div class="flaeche__kopf"><h2>${a.art === "angebot" ? "Angebote" : "Handwerker"}</h2>${offen ? schritteHtml(a) : ""}</div>
          <div class="flaeche__inhalt">
            ${hw.length ? hw.map(hwZeile).join("") : `<p class="leise">Noch kein Handwerker gewählt.</p>`}
            ${a.art === "angebot" && hw.filter((h) => h.betrag).length > 1 ? `<p class="leise">Günstigstes Angebot: ${esc(hwName(dienst, [...hw].filter((h) => h.betrag).sort((x, y) => x.betrag - y.betrag)[0].dienstleister_id))} (${euro(Math.min(...hw.filter((h) => h.betrag).map((h) => h.betrag)))}).</p>` : ""}
          </div>
        </section>
        ${post.length ? `<section class="flaeche"><div class="flaeche__kopf"><h2>Antworten der Handwerker</h2></div><div class="zeilen">${post.map((n) => `
          <a class="zeile zeile--einfach" href="#/postfach/${esc(n.id)}"><span><strong>${esc(n.absender_name || n.absender_email || "Handwerker")}</strong><br><span class="leise">${esc(n.betreff || "")}</span></span><span class="leise">${esc(datumDE(n.eingang_am))}${n.status === "neu" ? ` <span class="marker">neu</span>` : ""}</span></a>`).join("")}</div></section>` : ""}
        <section class="flaeche">
          <div class="flaeche__kopf"><h2>Was soll gemacht werden?</h2></div>
          <div class="flaeche__inhalt"><p class="umbruch">${esc(a.beschreibung || "–")}</p>${a.notiz ? `<p class="leise umbruch">Notiz: ${esc(a.notiz)}</p>` : ""}</div>
        </section>
      </div>
      <div class="stapel">
        <section class="flaeche">
          <div class="flaeche__kopf"><h2>Nächste Schritte</h2></div>
          <div class="flaeche__inhalt hw-schritte-knoepfe">${aktionsKnoepfe(a)}</div>
        </section>
        <section class="flaeche">
          <div class="flaeche__kopf"><h2>Angaben</h2><button type="button" class="knopf knopf--klein" data-aktion-auftrag="bearbeiten">Ändern</button></div>
          <div class="flaeche__inhalt"><dl class="datenliste">
            ${a.frist ? `<dt>${a.art === "angebot" && ["angefragt", "angebot", "entwurf"].includes(a.status) ? "Angebot bis" : "Erledigt bis"}</dt><dd>${esc(datumDE(a.frist))}</dd>` : ""}
            <dt>Termin</dt><dd>${a.termin ? esc(datumDE(a.termin)) : "–"}</dd>
            ${a.kostenrahmen ? `<dt>Kostenrahmen</dt><dd>bis ${euro(a.kostenrahmen)}</dd>` : ""}
            <dt>Betrag</dt><dd>${a.betrag ? euro(a.betrag) : "–"}</dd>
            <dt>Rechnung</dt><dd>${rechnung ? `<button type="button" class="textknopf" data-dok="${esc(rechnung.id)}">${esc(rechnung.titel)}</button>` : "–"}</dd>
            ${a.gesendet_am ? `<dt>Gesendet</dt><dd>${esc(datumDE(a.gesendet_am))}</dd>` : ""}
            ${a.erledigt_am ? `<dt>Erledigt</dt><dd>${esc(datumDE(a.erledigt_am))}</dd>` : ""}
            ${a.abgeschlossen_am ? `<dt>Abgeschlossen</dt><dd>${esc(datumDE(a.abgeschlossen_am))}</dd>` : ""}
            ${a.thema_id ? `<dt>Vorgang</dt><dd><a href="#/thema/${esc(a.thema_id)}">Verlauf ansehen</a></dd>` : ""}
            ${a.nachricht_id ? `<dt>Meldung</dt><dd><a href="#/postfach/${esc(a.nachricht_id)}">Nachricht öffnen</a></dd>` : ""}
          </dl></div>
        </section>
      </div>
    </div>`;

  const neu = () => zeigeAuftrag(id);
  for (const b of $$("[data-aktion-auftrag]")) {
    b.addEventListener("click", async () => {
      try { if (await aktion(a, b.dataset.aktionAuftrag, { dienst, mieterL, schreiben: meine })) neu(); } catch (err) { melde(err.message, "fehler"); }
    });
  }
  for (const b of $$("[data-hw]")) {
    b.addEventListener("click", async () => {
      const [did, was] = b.dataset.hw.split(":");
      try { if (await aktion(a, was, { dienst, mieterL, dienstleisterId: did, schreiben: meine })) neu(); } catch (err) { melde(err.message, "fehler"); }
    });
  }
  const docs = [rechnung, ...angebotsDocs].filter(Boolean);
  for (const b of $$("[data-dok]")) b.addEventListener("click", () => ablage.oeffneDokument(docs.find((d) => d.id === b.dataset.dok), { nachher: neu }));
}

function aktionsKnoepfe(a) {
  const k = (was, text, art = "") => `<button type="button" class="knopf ${art}" data-aktion-auftrag="${was}">${text}</button>`;
  const L = [];
  if (a.status === "entwurf") L.push(k("entwurf", "Entwurf ansehen & senden", "knopf--primaer"), k("ohne", "Schon telefonisch vergeben (ohne Schreiben)"));
  if (a.status === "angefragt" || a.status === "angebot") L.push(k("angebot", "Angebot eintragen", a.status === "angefragt" ? "knopf--primaer" : ""), k("erinnern", "Nachfassen"));
  if (a.status === "beauftragt") L.push(k("termin", a.termin ? "Termin ändern" : "Termin eintragen", a.termin ? "" : "knopf--primaer"), k("erledigt", "Erledigt melden", a.termin ? "knopf--primaer" : ""), k("erinnern", "Erinnern"), k("anderer", "Anderen beauftragen"));
  if (a.status === "erledigt") L.push(k("rechnung", a.rechnung_dokument_id ? "Rechnung ändern" : "Rechnung ablegen", a.rechnung_dokument_id ? "" : "knopf--primaer"), k("abschliessen", "Abschließen", a.rechnung_dokument_id ? "knopf--primaer" : ""));
  if (a.status === "abgeschlossen" || a.status === "abgebrochen") L.push(k("wieder", "Wieder öffnen"));
  if (LAUFEND.includes(a.status) && a.status !== "entwurf") L.push(k("abbrechen", "Auftrag abbrechen", "knopf--leise"));
  if (a.status === "entwurf" || a.status === "abgebrochen") L.push(k("loeschen", "Löschen", "knopf--gefahr"));
  return L.join("") || `<p class="leise">Nichts zu tun.</p>`;
}

// ---------------------------------------------------------------------------
// Aktionen an einem Auftrag (Liste, Auftragsseite, Postfach). Liefert true, wenn neu gezeichnet werden soll.
// ---------------------------------------------------------------------------
export async function aktion(a, was, { dienst = null, mieterL = null, dienstleisterId = null, schreiben = null } = {}) {
  dienst = dienst || await db.ladeDienstleister().catch(() => []);
  mieterL = mieterL || await mieterListe();
  const speichere = async (felder, text) => { Object.assign(a, await db.speichereAuftrag(a.id, felder)); if (text) melde(text, "ok"); return true; };
  const hw = () => (a.handwerker || []).map((h) => ({ ...h }));

  if (was === "entwurf") {
    const liste = schreiben || (await db.ladeHandwerkerSchreiben()).filter((s) => s.auftrag_id === a.id);
    const e = liste.find((s) => s.status === "entwurf");
    if (!e) return melde("Kein offener Entwurf gefunden.", "info"), false;
    return geheZu(e.nachricht_id ? `#/postfach/${e.nachricht_id}` : `#/entwurf/${e.id}`), false;
  }
  if (was === "ohne") {
    if (!(await frage("Ohne Schreiben weiter?", "<p>Der Auftrag wird als gesendet geführt (z. B. telefonisch oder per WhatsApp vergeben). Der Entwurf bleibt liegen und kann gelöscht werden.</p>", "Ja, als vergeben markieren"))) return false;
    const h = hw().map((x) => ({ ...x, status: a.art === "angebot" ? "angefragt" : "beauftragt" }));
    return speichere({ status: a.art === "angebot" ? "angefragt" : "beauftragt", gesendet_am: new Date().toISOString(), handwerker: h }, "Vermerkt.");
  }
  if (was === "angebot") return angebotEintragen(a, dienst, dienstleisterId);
  if (was === "beauftragen") return angebotBeauftragen(a, dienst, mieterL, dienstleisterId);
  if (was === "termin") {
    const d = await dialogFormular(`
      <h2>Termin</h2>
      <label class="feld"><span>Termin des Handwerkers</span><input type="date" name="termin" required value="${esc(a.termin || "")}"></label>
      <label class="feld"><span>Notiz (optional)</span><input name="notiz" value="${esc(a.notiz || "")}" placeholder="z. B. vormittags, Schlüssel beim Hausmeister"></label>
      <div class="knopfreihe"><button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button><button class="knopf knopf--primaer" value="ok">Speichern</button></div>`);
    if (!d) return false;
    return speichere({ termin: d.get("termin"), notiz: String(d.get("notiz") || "").trim() || null }, "Termin eingetragen.");
  }
  if (was === "erledigt") {
    const d = await dialogFormular(`
      <h2>Erledigt</h2>
      <label class="feld"><span>Erledigt am</span><input type="date" name="datum" required value="${esc(heuteISO())}"></label>
      <label class="checkfeld"><input type="checkbox" name="fertig"> Gleich abschließen (es kommt keine Rechnung, z. B. Hausmeister)</label>
      <div class="knopfreihe"><button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button><button class="knopf knopf--primaer" value="ok">Speichern</button></div>`);
    if (!d) return false;
    const fertig = !!d.get("fertig");
    return speichere({ status: fertig ? "abgeschlossen" : "erledigt", erledigt_am: d.get("datum"), ...(fertig ? { abgeschlossen_am: heuteISO() } : {}) },
      fertig ? "Erledigt und abgeschlossen." : "Als erledigt vermerkt. Fehlt nur noch die Rechnung.");
  }
  if (was === "rechnung") return rechnungAblegen(a);
  if (was === "abschliessen") {
    if (!(await frage("Auftrag abschließen?", `<p>„${esc(a.titel)}“ wandert zu „Abgeschlossen“.${a.rechnung_dokument_id ? "" : " Es ist keine Rechnung abgelegt – das ist in Ordnung, wenn keine kommt."}</p>`, "Abschließen"))) return false;
    return speichere({ status: "abgeschlossen", abgeschlossen_am: heuteISO(), erledigt_am: a.erledigt_am || heuteISO() }, "Abgeschlossen.");
  }
  if (was === "wieder") return speichere({ status: a.rechnung_dokument_id || a.erledigt_am ? "erledigt" : a.dienstleister_id && a.gesendet_am ? "beauftragt" : "angefragt", abgeschlossen_am: null }, "Wieder geöffnet.");
  if (was === "abbrechen") {
    const d = await dialogFormular(`
      <h2>Auftrag abbrechen?</h2>
      <p>„${esc(a.titel)}“ wird als abgebrochen geführt. Den Handwerker bitte selbst informieren.</p>
      <label class="feld"><span>Grund (optional)</span><input name="grund" placeholder="z. B. hat sich erledigt, Mieter hat selbst repariert"></label>
      <div class="knopfreihe"><button class="knopf" value="abbrechen" formnovalidate>Zurück</button><button class="knopf knopf--gefahr" value="ok">Abbrechen</button></div>`);
    if (!d) return false;
    return speichere({ status: "abgebrochen", abgeschlossen_am: heuteISO(), notiz: String(d.get("grund") || "").trim() || a.notiz || null }, "Auftrag abgebrochen.");
  }
  if (was === "loeschen") {
    const liste = (schreiben || (await db.ladeHandwerkerSchreiben()).filter((s) => s.auftrag_id === a.id)).filter((s) => s.status === "entwurf");
    if (!(await frage("Auftrag löschen?", `<p>„${esc(a.titel)}“ wird gelöscht${liste.length ? `, dazu ${liste.length === 1 ? "der ungesendete Entwurf" : `${liste.length} ungesendete Entwürfe`}` : ""}. Gesendete Schreiben bleiben im Verlauf.</p>`, "Löschen", { gefahr: true }))) return false;
    for (const s of liste) await db.loescheAntwort(s.id).catch(() => {});
    await db.loescheAuftrag(a.id);
    melde("Gelöscht.", "ok");
    geheZu("#/handwerker");
    return false;
  }
  if (was === "anderer") {
    await anfrageDialog({ art: "auftrag", objektId: a.objekt_id, mieterId: a.mieter_id, titel: a.titel, beschreibung: a.beschreibung, ersetzt: a, ohne: [a.dienstleister_id] });
    return false;
  }
  if (was === "erinnern") return erinnern(a, dienst, mieterL);
  if (was === "bearbeiten") return bearbeiten(a, mieterL);
  return false;
}

async function angebotEintragen(a, dienst, dienstleisterId) {
  const hwL = (a.handwerker || []).filter((h) => h.status !== "abgelehnt");
  if (!hwL.length) return melde("Bei diesem Auftrag ist kein Handwerker angefragt.", "info"), false;
  const vor = hwL.find((h) => h.dienstleister_id === dienstleisterId) || hwL.find((h) => !h.betrag) || hwL[0];
  const d = await dialogFormular(`
    <h2>Angebot eintragen</h2>
    <label class="feld"><span>Von</span><select name="dienstleister_id">${hwL.map((h) => `<option value="${esc(h.dienstleister_id)}" ${h === vor ? "selected" : ""}>${esc(hwName(dienst, h.dienstleister_id))}${h.betrag ? ` (bisher ${euro(h.betrag)})` : ""}</option>`).join("")}</select></label>
    <div class="formraster formraster--zwei">
      <label class="feld"><span>Betrag (brutto) in €</span><input name="betrag" inputmode="decimal" required pattern="[0-9.]+([,][0-9]{1,2})?|[0-9]+([.][0-9]{1,2})?" placeholder="0,00" value="${esc(betragFeld(vor.betrag))}"></label>
      <label class="feld"><span>Angebot vom</span><input type="date" name="datum" value="${esc(vor.datum || heuteISO())}"></label>
    </div>
    <label class="feld"><span>Notiz (optional)</span><input name="notiz" value="${esc(vor.notiz || "")}" placeholder="z. B. inkl. Material, Ausführung KW 46"></label>
    <label class="feld"><span>Angebot als Datei (optional)</span><input type="file" name="datei" accept="image/*,application/pdf,.pdf"></label>
    <p class="leise">Mit Datei kommt danach die Ablage: Ordner und Dateiname siehst du vorher.</p>
    <div class="knopfreihe"><button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button><button class="knopf knopf--primaer" value="ok">Speichern</button></div>`);
  if (!d) return false;
  const betrag = zahl(d.get("betrag"));
  if (!betrag) return melde("Bitte einen Betrag eintragen.", "fehler"), false;
  const did = d.get("dienstleister_id");
  const datei = d.get("datei");
  let dokumentId = null;
  if (datei && datei.size) {
    const r = await ablage.erfasse(datei, { objektId: a.objekt_id || null, nurAblage: true, weiter: false });
    dokumentId = r?.dokument?.id || null;
  }
  const liste = (a.handwerker || []).map((h) => (h.dienstleister_id === did ? { ...h, status: h.status === "beauftragen" ? h.status : "angebot", betrag, datum: d.get("datum") || heuteISO(), notiz: String(d.get("notiz") || "").trim() || null, ...(dokumentId ? { dokument_id: dokumentId } : {}) } : h));
  Object.assign(a, await db.speichereAuftrag(a.id, { handwerker: liste, status: a.status === "angefragt" || a.status === "entwurf" ? "angebot" : a.status }));
  melde(`Angebot über ${euro(betrag)} eingetragen.`, "ok");
  return true;
}

async function angebotBeauftragen(a, dienst, mieterL, dienstleisterId) {
  const hwL = (a.handwerker || []).filter((h) => h.status !== "abgelehnt");
  const vor = hwL.find((h) => h.dienstleister_id === dienstleisterId) || [...hwL].filter((h) => h.betrag).sort((x, y) => x.betrag - y.betrag)[0] || hwL[0];
  if (!vor) return false;
  const andere = hwL.filter((h) => h !== vor);
  const d = await dialogFormular(`
    <h2>Beauftragen</h2>
    <label class="feld"><span>Wer bekommt den Auftrag?</span><select name="dienstleister_id">${hwL.map((h) => `<option value="${esc(h.dienstleister_id)}" ${h === vor ? "selected" : ""}>${esc(hwName(dienst, h.dienstleister_id))}${h.betrag ? ` – ${euro(h.betrag)}` : " – kein Angebot eingetragen"}</option>`).join("")}</select></label>
    <label class="feld"><span>Hinweis für den Auftrag (optional)</span><span class="diktat"><textarea name="anweisung" rows="2" placeholder="z. B. Ausführung bitte bis Ende November, Termin mit dem Hausmeister absprechen"></textarea>${mikroKnopf()}</span></label>
    ${andere.length ? `<label class="checkfeld"><input type="checkbox" name="absagen"> Absage-Entwürfe an die anderen (${andere.length})</label>` : ""}
    <p class="leise">Es entsteht ein Entwurf – gesendet wird erst, wenn du ihn ansiehst und auf „Senden“ klickst.</p>
    <div class="knopfreihe">
      <button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button>
      <button class="knopf" value="ohne">Schon telefonisch vergeben</button>
      <button class="knopf knopf--primaer" value="ok">${zustand.ki?.ki ? `${ICON_KI} Auftrag entwerfen` : "Auftrag schreiben"}</button>
    </div>`, { vorbereiten: (form) => verbindeDiktat(form) });
  if (!d) return false;
  const did = d.get("dienstleister_id");
  const gewaehlt = (a.handwerker || []).find((h) => h.dienstleister_id === did);
  const betrag = gewaehlt?.betrag || null;
  if (d.get("_aktion") === "ohne") {
    const liste = (a.handwerker || []).map((h) => (h.dienstleister_id === did ? { ...h, status: "beauftragt" } : h));
    Object.assign(a, await db.speichereAuftrag(a.id, { status: "beauftragt", dienstleister_id: did, betrag, handwerker: liste, gesendet_am: new Date().toISOString() }));
    melde("Als beauftragt vermerkt.", "ok");
    return true;
  }
  const d0 = dienst.find((x) => x.id === did);
  const anweisung = [
    `Auftrag erteilen zu „${a.titel}“${betrag ? ` gemäß Ihrem Angebot${gewaehlt?.datum ? ` vom ${datumDE(gewaehlt.datum)}` : ""} über ${euro(betrag)}` : ""}.`,
    a.beschreibung ? `Worum es geht: ${a.beschreibung}` : "",
    "Bitte um kurze Bestätigung und einen Terminvorschlag.",
    String(d.get("anweisung") || "").trim(),
  ].filter(Boolean).join("\n");
  const warte = wartehinweis("Die KI schreibt den Auftrag …");
  let neueId = null;
  try {
    const s = await schreibenAnlegen(a, d0, { anweisung, betreff: `Auftrag: ${a.titel}`, mieterL, anhaengeUebernehmen: true });
    neueId = s.id;
    let liste = (a.handwerker || []).map((h) => (h.dienstleister_id === did ? { ...h, status: "beauftragen", auftrag_antwort_id: s.id } : h));
    if (d.get("absagen")) {
      for (const h of andere) {
        const dx = dienst.find((x) => x.id === h.dienstleister_id);
        if (!dx) continue;
        const ab = await schreibenAnlegen(a, dx, {
          anweisung: `Freundliche Absage zu „${a.titel}“: Wir haben uns für ein anderes Angebot entschieden. Danke für das Angebot${h.datum ? ` vom ${datumDE(h.datum)}` : ""}.`,
          betreff: `Ihr Angebot: ${a.titel}`, mieterL, ohneOrt: true,
        }).catch(() => null);
        liste = liste.map((x) => (x.dienstleister_id === h.dienstleister_id ? { ...x, status: "abgelehnt", ...(ab ? { absage_antwort_id: ab.id } : {}) } : x));
      }
    }
    Object.assign(a, await db.speichereAuftrag(a.id, { handwerker: liste, dienstleister_id: did, betrag }));
  } finally { await warte.ende(); }
  if (neueId) { melde("Auftrag als Entwurf angelegt – bitte prüfen und senden.", "ok"); geheZu(`#/entwurf/${neueId}`); }
  return false;
}

async function rechnungAblegen(a) {
  const d = await dialogFormular(`
    <h2>Rechnung</h2>
    <label class="feld"><span>Rechnungsbetrag (brutto) in €</span><input name="betrag" inputmode="decimal" placeholder="0,00" value="${esc(betragFeld(a.betrag))}"></label>
    <label class="feld"><span>Rechnung als Foto oder PDF</span><input type="file" name="datei" accept="image/*,application/pdf,.pdf"></label>
    <label class="checkfeld"><input type="checkbox" name="fertig" checked> Danach abschließen</label>
    <p class="leise">Die Datei geht in die Ablage des Hauses – Ordner und Dateiname siehst du vorher. Liegt die Rechnung schon in der Ablage: Feld leer lassen.</p>
    <div class="knopfreihe"><button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button><button class="knopf knopf--primaer" value="ok">Weiter</button></div>`);
  if (!d) return false;
  const datei = d.get("datei");
  let dokumentId = a.rechnung_dokument_id || null;
  if (datei && datei.size) {
    const r = await ablage.erfasse(datei, { objektId: a.objekt_id || null, nurAblage: true, weiter: false });
    if (!r?.dokument) return melde("Die Rechnung wurde nicht abgelegt.", "info"), false;
    dokumentId = r.dokument.id;
  }
  const fertig = !!d.get("fertig");
  Object.assign(a, await db.speichereAuftrag(a.id, {
    rechnung_dokument_id: dokumentId, betrag: zahl(d.get("betrag")) || a.betrag || null,
    ...(fertig ? { status: "abgeschlossen", abgeschlossen_am: heuteISO(), erledigt_am: a.erledigt_am || heuteISO() } : {}),
  }));
  melde(fertig ? "Rechnung vermerkt, Auftrag abgeschlossen." : "Rechnung vermerkt.", "ok");
  return true;
}

async function erinnern(a, dienst, mieterL) {
  const ziele = a.status === "angefragt" || a.status === "angebot"
    ? (a.handwerker || []).filter((h) => h.status === "angefragt")
    : [{ dienstleister_id: a.dienstleister_id }].filter((h) => h.dienstleister_id);
  if (!ziele.length) return melde("Es gibt niemanden, bei dem eine Antwort fehlt.", "info"), false;
  if (!(await frage(a.status === "beauftragt" ? "Erinnern?" : "Nachfassen?", `<p>Entwurf an ${ziele.map((h) => esc(hwName(dienst, h.dienstleister_id))).join(", ")}: freundlich nach ${a.status === "beauftragt" ? "Termin und Stand" : "dem Angebot"} fragen. Gesendet wird erst nach deinem Klick.</p>`, "Entwurf erstellen"))) return false;
  const warte = wartehinweis("Die KI schreibt …");
  const neu = [];
  try {
    for (const h of ziele) {
      const d = dienst.find((x) => x.id === h.dienstleister_id);
      if (!d) continue;
      const s = await schreibenAnlegen(a, d, {
        anweisung: a.status === "beauftragt"
          ? `Freundlich nachfragen zum Auftrag „${a.titel}“ (beauftragt am ${datumDE(a.gesendet_am || a.erstellt_am)}): Bitte um kurzen Stand und einen Termin.`
          : `Freundlich nachfragen zur Angebotsanfrage „${a.titel}“ (angefragt am ${datumDE(a.gesendet_am || a.erstellt_am)})${a.frist ? `, Angebot erbeten bis ${datumDE(a.frist)}` : ""}: Kommt noch ein Angebot?`,
        betreff: `Nachfrage: ${a.titel}`, mieterL, ohneOrt: a.status !== "beauftragt", themaVon: h,
      });
      neu.push(s);
    }
  } finally { await warte.ende(); }
  if (neu.length === 1) geheZu(`#/entwurf/${neu[0].id}`);
  else if (neu.length) { melde(`${neu.length} Entwürfe angelegt – unter „Schriftverkehr“ bzw. im Postfach bei den Entwürfen.`, "ok"); return true; }
  return false;
}

async function bearbeiten(a, mieterL) {
  const d = await dialogFormular(`
    <h2>Auftrag ändern</h2>
    <label class="feld"><span>Was?</span><input name="titel" required maxlength="160" value="${esc(a.titel)}"></label>
    <label class="feld"><span>Beschreibung</span><span class="diktat"><textarea name="beschreibung" rows="4">${esc(a.beschreibung || "")}</textarea>${mikroKnopf()}</span></label>
    <div class="formraster formraster--zwei">
      <label class="feld"><span>Haus</span><select name="objekt_id"><option value="">–</option>${zustand.stamm.objekte.map((o) => `<option value="${esc(o.id)}" ${o.id === a.objekt_id ? "selected" : ""}>${esc(o.bezeichnung)}</option>`).join("")}</select></label>
      <label class="feld"><span>Mietpartei</span><select name="mieter_id"><option value="">Keine / ganzes Haus</option>${mieterL.map((m) => `<option value="${esc(m.id)}" ${m.id === a.mieter_id ? "selected" : ""}>${esc(mieterName(m))}</option>`).join("")}</select></label>
      <label class="feld"><span>${a.art === "angebot" ? "Angebot bis / erledigt bis" : "Erledigt bis"}</span><input type="date" name="frist" value="${esc(a.frist || "")}"></label>
      <label class="feld"><span>Termin</span><input type="date" name="termin" value="${esc(a.termin || "")}"></label>
      <label class="feld"><span>Kostenrahmen bis €</span><input name="kostenrahmen" inputmode="decimal" value="${esc(betragFeld(a.kostenrahmen))}"></label>
      <label class="feld"><span>Betrag €</span><input name="betrag" inputmode="decimal" value="${esc(betragFeld(a.betrag))}"></label>
    </div>
    <label class="feld"><span>Notiz</span><input name="notiz" value="${esc(a.notiz || "")}"></label>
    <div class="knopfreihe"><button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button><button class="knopf knopf--primaer" value="ok">Speichern</button></div>`, { breit: true, vorbereiten: (form) => verbindeDiktat(form) });
  if (!d) return false;
  Object.assign(a, await db.speichereAuftrag(a.id, {
    titel: String(d.get("titel")).trim(), beschreibung: String(d.get("beschreibung") || "").trim() || null,
    objekt_id: d.get("objekt_id") || null, mieter_id: d.get("mieter_id") || null, frist: d.get("frist") || null, termin: d.get("termin") || null,
    kostenrahmen: zahl(d.get("kostenrahmen")), betrag: zahl(d.get("betrag")), notiz: String(d.get("notiz") || "").trim() || null,
  }));
  melde("Gespeichert.", "ok");
  return true;
}

// ---------------------------------------------------------------------------
// Schreiben an einen Handwerker anlegen (Entwurf). Einsatzort und Kontakt setzt die App unter den KI-Text.
// ---------------------------------------------------------------------------
function ortBlock(a, mieterL, { kontakt = true, zugang = false, hausmeister = null } = {}) {
  const m = a.mieter_id ? mieterL.find((x) => x.id === a.mieter_id) : null;
  const w = m ? wohnungVon(m.wohnung_id) : null;
  const o = objektVon(a.objekt_id || w?.objekt_id);
  const z = [];
  if (o) z.push(`Einsatzort: ${o.strasse}, ${o.plz} ${o.ort}${w ? `, ${w.bezeichnung}` : ""}`);
  if (m && kontakt) {
    const anrede = m.anrede === "Herr" ? "Herr " : m.anrede === "Frau" ? "Frau " : "";
    z.push(`Ansprechpartner vor Ort: ${anrede}${mieterName(m)}${m.telefon ? `, Tel. ${m.telefon}` : ""}${m.email ? `, ${m.email}` : ""}`);
  }
  if (zugang && hausmeister) z.push(`Zugang / Schlüssel: ${hausmeister.name}${hausmeister.telefon ? `, Tel. ${hausmeister.telefon}` : ""}`);
  return z.join("\n");
}
async function schreibenAnlegen(a, d, { anweisung, anzeige = null, betreff, mieterL, anhaenge = null, anhaengeUebernehmen = false, ohneOrt = false, themaVon = null, sichtbar = null, hausmeister = null }) {
  const sicht = sichtbar || a.sichtbar || {};
  const ort = ohneOrt ? "" : ortBlock(a, mieterL, { kontakt: sicht.kontakt !== false, zugang: !!sicht.zugang, hausmeister });
  let betr = betreff, text = "Sehr geehrte Damen und Herren,\n\n" + anweisung, modell = null;
  if (zustand.ki?.ki) {
    try {
      const r = await db.funktion("ki", {
        aktion: "entwurf", dienstleister_id: d.id, objekt_id: a.objekt_id || null,
        anweisung: `${anweisung}\n\n(Einsatzort und Kontaktdaten setzt die App automatisch unter den Text – bitte nicht selbst nennen. Keine Grußformel.)`,
      });
      if (r?.text) { text = r.text; betr = r.betreff || betreff; modell = r.modell || null; }
    } catch (err) { melde(`KI: ${err.message} – Entwurf ohne KI angelegt.`, "info"); }
  }
  if (ort) text = `${text.trim()}\n\n${ort}`;
  // Vorgang: je Handwerker einer (damit Antworten richtig zugeordnet werden)
  const h = themaVon || (a.handwerker || []).find((x) => x.dienstleister_id === d.id);
  let thema = h?.thema_id || (a.dienstleister_id === d.id ? a.thema_id : null);
  if (!thema) thema = await vorgaenge.neuesThema({ betreff: betr, an: d.email, dienstleisterId: d.id, objektId: a.objekt_id || null }).catch(() => null);
  let anh = anhaenge;
  if (!anh && anhaengeUebernehmen) {
    const alt = (await db.ladeHandwerkerSchreiben().catch(() => [])).find((s) => s.auftrag_id === a.id && (s.anhaenge || []).length);
    anh = alt?.anhaenge || [];
  }
  return db.speichereAntwort(null, {
    art: "antwort", status: "entwurf", auftrag_id: a.id, thema_id: thema, dienstleister_id: d.id, objekt_id: a.objekt_id || null,
    empfaenger_email: d.email || null, empfaenger_name: d.name, betreff: String(betr || "").slice(0, 200), text,
    anweisung: (anzeige ?? anweisung).slice(0, 2000) || null, ki_modell: modell, anhaenge: anh || [],
  });
}

// ---------------------------------------------------------------------------
// Maske „Handwerker beauftragen“: Angebote einholen | Direkt beauftragen
// v: { art, objektId, mieterId, dienstleisterIds, titel, beschreibung, nachricht, mieter, bilder, ersetzt, ohne, nachEntwurf(schreiben[]) }
// ---------------------------------------------------------------------------
const PASST = [
  [/heiz|warmwasser|therme|kalt|heizkoerper/, /heiz|sanit/], [/wasser|rohr|tropf|abfluss|verstopf|wc|toilette|dusche|bad|feucht|schimmel|hahn/, /sanit|heiz/],
  [/strom|licht|steckdose|sicherung|elektr|kabel|rauchmelder/, /elektr/], [/schluessel|schlussel|schloss|tuer|tur|ausgesperrt/, /schluess|schluss|schloss/],
  [/dach|regen|undicht|ziegel|rinne/, /dach/], [/wand|farbe|tapete|streichen|maler/, /maler/], [/garten|rasen|hecke|baum|laub|schnee|muell|mull|treppenhaus|reinig/, /hausmeist|garten|reinig/],
];
export async function anfrageDialog(v = {}) {
  const [alle, mieterL] = await Promise.all([db.ladeDienstleister().catch(() => []), mieterListe()]);
  const aktive = alle.filter((d) => d.aktiv && !(v.ohne || []).includes(d.id));
  if (!aktive.length) {
    melde("Noch keine Handwerker eingetragen – bitte zuerst einen anlegen.", "info");
    return ablage.bearbeiteDienstleister(null, { nachher: () => geheZu("#/handwerker/liste"), objektId: v.objektId || null });
  }
  const n = v.nachricht || null;
  const mieterStart = v.mieterId || v.mieter?.id || n?.mieter_id || null;
  const objektStart = v.objektId || (mieterStart ? wohnungVon(mieterL.find((m) => m.id === mieterStart)?.wohnung_id)?.objekt_id : null) || n?.objekt_id || null;
  const text = norm(`${v.titel || ""} ${v.beschreibung || ""} ${n?.betreff || ""} ${n?.text || ""} ${n?.ki_zusammenfassung || ""}`);
  const bilder = (v.bilder || []).filter((b) => b.pfad);
  const kiDa = !!zustand.ki?.ki;
  const artStart = v.art || ((v.dienstleisterIds || []).length > 1 ? "angebot" : "auftrag");
  const punkte = (d, haus) => PASST.reduce((s, [t, g]) => s + (t.test(text) && g.test(norm(d.gewerk)) ? 10 : 0), 0) + (haus && d.objekt_id === haus ? 3 : 0) + (istHausmeister(d) && haus && d.objekt_id === haus ? 2 : 0);
  const hwListe = (haus) => aktive.filter((d) => !haus || !d.objekt_id || d.objekt_id === haus)
    .sort((x, y) => punkte(y, haus) - punkte(x, haus) || String(x.gewerk || "").localeCompare(String(y.gewerk || "")) || x.name.localeCompare(y.name));
  const vorwahl = new Set(v.dienstleisterIds || []);
  if (!vorwahl.size && artStart === "auftrag") { const top = hwListe(objektStart)[0]; if (top && punkte(top, objektStart) >= 10) vorwahl.add(top.id); }
  const hwHtml = (haus) => hwListe(haus).map((d) => `
    <label class="hw-wahl" data-name="${esc(norm(`${d.name} ${d.gewerk || ""}`))}">
      <input type="checkbox" name="hw" value="${esc(d.id)}" ${vorwahl.has(d.id) ? "checked" : ""}>
      <span><strong>${esc(d.name)}</strong> <span class="leise">${esc([d.gewerk, d.objekt_id ? "" : "alle Häuser"].filter(Boolean).join(" · "))}</span>
        ${punkte(d, haus) >= 10 ? `<span class="marker marker--ki">passt</span>` : ""}${istHausmeister(d) ? `<span class="marker">Hausmeister</span>` : ""}${d.email ? "" : `<span class="leise"> · keine E-Mail</span>`}</span>
    </label>`).join("") || `<p class="leise">Für dieses Haus ist kein Handwerker eingetragen.</p>`;
  const mieterOpt = (haus, gewaehlt) => `<option value="">${haus ? "Ganzes Haus / Allgemeinflächen" : "Keine bestimmte Mietpartei"}</option>` +
    mieterL.filter((m) => !haus || wohnungVon(m.wohnung_id)?.objekt_id === haus).map((m) => `<option value="${esc(m.id)}" ${m.id === gewaehlt ? "selected" : ""}>${esc(mieterName(m))}${wohnungVon(m.wohnung_id) ? ` · ${esc(wohnungVon(m.wohnung_id).bezeichnung)}` : ""}</option>`).join("");
  let dateien = []; // vom Gerät: { datei, name, blob }
  let ablageAnh = []; // aus der Ablage: Anhänge
  const ablageDocs = await db.ladeDokumente({}).catch(() => []);

  const daten = await dialogFormular(`
    <h2>${v.ersetzt ? "Anderen Handwerker beauftragen" : "Handwerker beauftragen"}</h2>
    <div class="hw-seg" role="radiogroup" aria-label="Art">
      <label><input type="radio" name="art" value="auftrag" ${artStart === "auftrag" ? "checked" : ""}><span>Direkt beauftragen</span></label>
      <label><input type="radio" name="art" value="angebot" ${artStart === "angebot" ? "checked" : ""}><span>Angebote einholen</span></label>
    </div>
    <p class="leise" data-art-hinweis></p>
    <label class="feld"><span>Was? (kurz)</span><input name="titel" required maxlength="160" value="${esc(v.titel || (n ? titelAus(n.betreff) : ""))}" placeholder="z. B. Wasserhahn Küche tropft"></label>
    <div class="formraster formraster--zwei">
      <label class="feld"><span>Haus</span><select name="objekt_id"><option value="">– kein bestimmtes –</option>${zustand.stamm.objekte.map((o) => `<option value="${esc(o.id)}" ${o.id === objektStart ? "selected" : ""}>${esc(o.bezeichnung)}</option>`).join("")}</select></label>
      <label class="feld"><span>Mietpartei / Ort</span><select name="mieter_id">${mieterOpt(objektStart, mieterStart)}</select></label>
    </div>
    <fieldset class="gruppe"><legend data-hw-legende>Handwerker</legend>
      <input type="search" class="hw-suche" placeholder="Handwerker oder Gewerk suchen …" aria-label="Handwerker suchen">
      <div class="hw-wahlliste" data-hwliste>${hwHtml(objektStart)}</div>
      <p class="leise"><button type="button" class="textknopf" data-hw-neu>＋ neuen Handwerker anlegen</button> <span class="leise">(schließt diese Maske; danach erneut öffnen)</span></p>
    </fieldset>
    <label class="feld"><span>Was soll gemacht werden?</span>
      <span class="diktat"><textarea name="beschreibung" rows="4" required placeholder="Stichpunkte reichen – die KI formuliert daraus das Schreiben.">${esc(v.beschreibung || (n ? String(n.ki_zusammenfassung || n.text || "").slice(0, 1500) : ""))}</textarea>${mikroKnopf()}</span></label>
    <div class="formraster formraster--zwei">
      <label class="feld"><span data-frist-label>Erledigt bis (optional)</span><input type="date" name="frist" min="${esc(heuteISO())}"></label>
      <label class="feld" data-nur="auftrag"><span>Kostenrahmen bis € (optional)</span><input name="kostenrahmen" inputmode="decimal" placeholder="z. B. 300"></label>
    </div>
    <fieldset class="gruppe"><legend>Fotos / Dateien</legend>
      ${bilder.length ? `<div class="fotowahl">${bilder.map((b, i) => `<label><input type="checkbox" name="foto" value="${i}" checked><img data-datei="${esc(b.pfad)}" alt="${esc(b.name || "Foto")}"></label>`).join("")}</div>` : ""}
      <div class="hw-anhaenge" data-anhaenge></div>
      <div class="knopfreihe knopfreihe--eng">
        <label class="knopf knopf--klein">＋ Foto/PDF vom Gerät<input type="file" data-geraet accept="image/*,application/pdf,.pdf" multiple hidden></label>
        ${ablageDocs.length ? `<select class="knopf knopf--klein hw-ablagewahl" data-ablagewahl aria-label="Aus der Ablage anhängen"><option value="">＋ Aus der Ablage …</option></select>` : ""}
      </div>
    </fieldset>
    <fieldset class="gruppe"><legend>Der Handwerker sieht</legend>
      <label class="checkfeld"><input type="checkbox" name="s_fotos" checked> Fotos/Dateien und Beschreibung</label>
      <label class="checkfeld"><input type="checkbox" name="s_kontakt" checked> Kontakt der Mietpartei für einen Termin <span class="leise">(Name, Telefon, E-Mail)</span></label>
      <label class="checkfeld"><input type="checkbox" name="s_zugang"> Zugang über den Hausmeister <span class="leise">(Name, Telefon)</span></label>
    </fieldset>
    <p class="oz-fehler" data-fehler role="alert" hidden></p>
    <div class="knopfreihe">
      <button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button>
      <button class="knopf" value="ohne" data-ohne title="Wenn du schon angerufen oder per WhatsApp vergeben hast">Nur eintragen (schon vergeben)</button>
      <button class="knopf knopf--primaer" value="ok" data-los>${kiDa ? ICON_KI : ""} Auftrag entwerfen</button>
    </div>`, {
    breit: true,
    vorbereiten: (form) => {
      verbindeDiktat(form);
      const art = () => form.querySelector("[name=art]:checked").value;
      const gewaehlt = () => $$("[name=hw]:checked", form);
      const aktualisiere = () => {
        const angebot = art() === "angebot";
        $("[data-hw-legende]", form).textContent = angebot ? "Handwerker (mehrere möglich)" : "Handwerker (einer)";
        $("[data-frist-label]", form).textContent = angebot ? "Angebot bis" : "Erledigt bis (optional)";
        form.frist.required = angebot;
        $("[data-nur=auftrag]", form).hidden = angebot;
        $("[data-art-hinweis]", form).textContent = angebot
          ? "Jeder gewählte Handwerker bekommt eine Anfrage (je ein Entwurf). Danach Angebote eintragen, vergleichen und einen beauftragen."
          : "Der Handwerker wird gleich beauftragt – z. B. Hausmeister oder bekannter Betrieb, ohne Angebot vorher.";
        const n0 = gewaehlt().length;
        $("[data-los]", form).innerHTML = `${kiDa ? ICON_KI + " " : ""}${angebot ? (n0 > 1 ? `${n0} Anfragen entwerfen` : "Anfrage entwerfen") : "Auftrag entwerfen"}`;
        $("[data-ohne]", form).textContent = angebot ? "Nur eintragen (schon angefragt)" : "Nur eintragen (schon vergeben)";
        form.s_kontakt.disabled = !form.mieter_id.value;
      };
      for (const r of $$("[name=art]", form)) r.addEventListener("change", () => {
        if (art() === "auftrag") gewaehlt().slice(1).forEach((c) => (c.checked = false));
        aktualisiere();
      });
      const verbindeHw = () => {
        for (const c of $$("[name=hw]", form)) c.addEventListener("change", () => {
          if (c.checked && art() === "auftrag") for (const x of gewaehlt()) if (x !== c) x.checked = false;
          aktualisiere();
        });
      };
      verbindeHw();
      form.objekt_id.addEventListener("change", () => {
        const wahl = new Set(gewaehlt().map((c) => c.value));
        vorwahl.clear(); for (const id of wahl) vorwahl.add(id);
        $("[data-hwliste]", form).innerHTML = hwHtml(form.objekt_id.value || null);
        form.mieter_id.innerHTML = mieterOpt(form.objekt_id.value || null, null);
        verbindeHw(); aktualisiere();
      });
      form.mieter_id.addEventListener("change", aktualisiere);
      $(".hw-suche", form).addEventListener("input", (e) => {
        const q = norm(e.target.value).trim();
        for (const l of $$(".hw-wahl", form)) l.hidden = !!q && !l.dataset.name.includes(q) && !$("input", l).checked;
      });
      $("[data-hw-neu]", form).addEventListener("click", () => {
        $("#dialog").close();
        setTimeout(() => ablage.bearbeiteDienstleister(null, { objektId: form.objekt_id.value || null, nachher: () => melde("Handwerker angelegt – „Handwerker beauftragen“ jetzt erneut öffnen.", "ok") }), 0);
      });
      for (const img of $$("img[data-datei]", form)) db.dateiAdresse("eingang", img.dataset.datei).then((u) => (img.src = u)).catch(() => {});
      // Anhänge: vom Gerät (Fotos werden verkleinert) und aus der Ablage
      const zeigeAnh = () => {
        $("[data-anhaenge]", form).innerHTML = [...dateien.map((x, i) => `<span class="datei-chip-x">${esc(x.name)} <button type="button" data-weg-g="${i}" aria-label="entfernen">×</button></span>`),
          ...ablageAnh.map((x, i) => `<span class="datei-chip-x">${esc(x.name)} <button type="button" data-weg-a="${i}" aria-label="entfernen">×</button></span>`)].join("");
        for (const b of $$("[data-weg-g]", form)) b.addEventListener("click", () => { dateien.splice(Number(b.dataset.wegG), 1); zeigeAnh(); });
        for (const b of $$("[data-weg-a]", form)) b.addEventListener("click", () => { ablageAnh.splice(Number(b.dataset.wegA), 1); zeigeAnh(); });
      };
      $("[data-geraet]", form).addEventListener("change", async (e) => {
        for (const f of [...e.target.files].slice(0, 8)) {
          if (f.size > 15 * 1024 * 1024) { melde(`„${f.name}“ ist zu groß.`, "fehler"); continue; }
          const pdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
          try {
            const blob = pdf ? new Blob([f], { type: "application/pdf" }) : (await verkleinere(f, 2000)).blob;
            dateien.push({ name: pdf ? f.name : f.name.replace(/\.[^.]+$/, "") + ".jpg", blob, typ: pdf ? "application/pdf" : "image/jpeg" });
          } catch (err) { melde(`„${f.name}“: ${err.message}`, "fehler"); }
        }
        e.target.value = "";
        zeigeAnh();
      });
      const wahl = $("[data-ablagewahl]", form);
      if (wahl) {
        const fuelle = () => {
          const haus = form.objekt_id.value || null;
          const liste = ablageDocs.filter((d) => !haus || d.objekt_id === haus || !d.objekt_id).slice(0, 150);
          wahl.innerHTML = `<option value="">＋ Aus der Ablage …</option>${liste.map((d) => `<option value="${esc(d.id)}">${esc(d.titel)}</option>`).join("")}`;
        };
        fuelle();
        form.objekt_id.addEventListener("change", fuelle);
        wahl.addEventListener("change", () => {
          const d = ablageDocs.find((x) => x.id === wahl.value);
          wahl.value = "";
          if (d && !ablageAnh.some((x) => x.dokument_id === d.id)) { ablageAnh.push(ablage.anhangVonDokument(d)); zeigeAnh(); }
        });
      }
      form.addEventListener("submit", (e) => {
        if (!["ok", "ohne"].includes(e.submitter?.value)) return;
        const fehler = !gewaehlt().length ? "Bitte mindestens einen Handwerker wählen."
          : art() === "angebot" && !form.frist.value ? "Bitte angeben, bis wann das Angebot kommen soll."
          : !form.titel.value.trim() ? "Bitte kurz eintragen, worum es geht." : "";
        const p = $("[data-fehler]", form);
        p.textContent = fehler; p.hidden = !fehler;
        if (fehler) e.preventDefault();
      });
      aktualisiere();
    },
  });
  if (!daten) return null;

  // ---- Speichern ----
  const art = daten.get("art");
  const ids = daten.getAll("hw");
  const gewaehlteHw = ids.map((id) => aktive.find((d) => d.id === id)).filter(Boolean);
  const objektId = daten.get("objekt_id") || null;
  const mieterId = daten.get("mieter_id") || null;
  const sichtbar = { fotos: !!daten.get("s_fotos"), kontakt: !!daten.get("s_kontakt") && !!mieterId, zugang: !!daten.get("s_zugang") };
  const nurEintragen = daten.get("_aktion") === "ohne";
  const titel = String(daten.get("titel")).trim();
  const beschreibung = String(daten.get("beschreibung") || "").trim();
  const frist = daten.get("frist") || null;
  const kostenrahmen = art === "auftrag" ? zahl(daten.get("kostenrahmen")) : null;
  const fotos = daten.getAll("foto").map((i) => bilder[Number(i)]).filter(Boolean);
  const hausmeister = sichtbar.zugang ? alle.find((d) => d.aktiv && istHausmeister(d) && (!objektId || d.objekt_id === objektId)) || null : null;
  if (sichtbar.zugang && !hausmeister) melde("Für dieses Haus ist kein Hausmeister eingetragen – der Zugang wird nicht genannt.", "info");

  const warte = nurEintragen ? null : wartehinweis(kiDa ? `Die KI schreibt ${gewaehlteHw.length > 1 ? `${gewaehlteHw.length} Entwürfe` : "den Entwurf"} …` : "Entwurf wird angelegt …");
  try {
    let a = await db.speichereAuftrag(null, {
      art, status: nurEintragen ? (art === "angebot" ? "angefragt" : "beauftragt") : "entwurf", titel, beschreibung: beschreibung || null,
      objekt_id: objektId, mieter_id: mieterId, dienstleister_id: art === "auftrag" ? gewaehlteHw[0]?.id || null : null,
      handwerker: gewaehlteHw.map((d) => ({ dienstleister_id: d.id, status: nurEintragen ? (art === "angebot" ? "angefragt" : "beauftragt") : "entwurf" })),
      nachricht_id: n?.id || null, frist, kostenrahmen, sichtbar, gesendet_am: nurEintragen ? new Date().toISOString() : null,
      notiz: nurEintragen ? "ohne Schreiben vergeben" : null,
    });
    if (v.ersetzt) await db.speichereAuftrag(v.ersetzt.id, { status: "abgebrochen", abgeschlossen_am: heuteISO(), notiz: `ersetzt durch Auftrag an ${gewaehlteHw.map((d) => d.name).join(", ")}` }).catch(() => {});
    if (nurEintragen) {
      if (n) await db.speichereAuftrag(a.id, { thema_id: await vorgaenge.themaFuerNachricht(n).catch(() => null) }).catch(() => {});
      melde(art === "angebot" ? "Anfrage eingetragen." : "Auftrag eingetragen.", "ok");
      geheZu(`#/auftrag/${a.id}`);
      return a;
    }
    // Anhänge: Fotos der Nachricht, vom Gerät hochgeladen (Bucket „eingang“), aus der Ablage
    let anhaenge = [];
    if (sichtbar.fotos) {
      anhaenge.push(...fotos.map((f) => ({ bucket: "eingang", pfad: f.pfad, name: f.name || "Foto.jpg" })));
      for (let i = 0; i < dateien.length; i++) {
        const x = dateien[i];
        const pfad = `auftrag/${a.id}/${i + 1}_${x.name.replace(/[^\w.\-äöüÄÖÜß ]+/g, "_").slice(0, 80)}`;
        await db.ladeFotoHoch(pfad, x.blob);
        anhaenge.push({ bucket: "eingang", pfad, name: x.name, groesse: x.blob.size });
      }
      anhaenge.push(...ablageAnh);
      anhaenge = anhaenge.slice(0, 8);
    }
    const kopf = art === "angebot"
      ? `Bitte um ein Angebot (Kostenvoranschlag) bis ${datumDE(frist)} – noch KEIN Auftrag.`
      : `Direkter Auftrag${frist ? `, bitte erledigen bis ${datumDE(frist)}` : ""}${kostenrahmen ? `. Kostenrahmen bis ${betragFeld(kostenrahmen)} € – darüber bitte vorher Rücksprache` : ""}. Bitte um kurze Bestätigung mit Terminvorschlag.`;
    const anweisung = [`Thema: ${titel}`, kopf, beschreibung ? `Was zu tun ist: ${beschreibung}` : "", anhaenge.length ? `Im Anhang: ${anhaenge.length} ${anhaenge.length === 1 ? "Datei" : "Dateien"} (Fotos/Unterlagen).` : ""].filter(Boolean).join("\n");
    // Sichtbar im Feld „Hinweis an die KI“: nur, was Robert selbst eingegeben hat (plus Art des Schreibens)
    const kurzAnweisung = [art === "angebot" ? `Nur ein Angebot anfragen (bis ${datumDE(frist)}), noch kein Auftrag.` : "", beschreibung].filter(Boolean).join("\n").slice(0, 2000);
    const hw = [];
    const neueSchreiben = [];
    let themaGemeinsam = null;
    // Aus einer Nachricht: ein noch nicht gesendeter Auftrags-Entwurf (z. B. von der KI vorbereitet) wird ersetzt – nie zwei
    if (n) {
      const alt = (await db.ladeAntworten({ nachrichtId: n.id }).catch(() => [])).filter((x) => x.art === "auftrag" && x.status === "entwurf");
      for (const x of alt) {
        await db.loescheAntwort(x.id).catch(() => {});
        if (x.auftrag_id) {
          const altA = await db.ladeAuftrag(x.auftrag_id).catch(() => null);
          if (altA && altA.status === "entwurf" && altA.id !== a.id) await db.loescheAuftrag(altA.id).catch(() => {});
        }
      }
      if (alt.length) melde(`Der vorbereitete Auftrag an ${[...new Set(alt.map((x) => x.empfaenger_name || "Handwerker"))].join(", ")} wurde ersetzt.`, "info");
    }
    // Aus einer Nachricht: Auftrag wie bisher an der Nachricht (die KI kennt Meldung und Fotos), ein Vorgang
    if (n) themaGemeinsam = await vorgaenge.themaFuerNachricht(n).catch(() => null);
    const ergebnisse = await Promise.all(gewaehlteHw.map(async (d) => {
      if (n) {
        let r = { betreff: `${art === "angebot" ? "Anfrage" : "Auftrag"}: ${titel}`.slice(0, 200), text: `Sehr geehrte Damen und Herren,\n\n${anweisung}`, hinweise: [] };
        if (kiDa) {
          try {
            r = await db.funktion("ki", {
              aktion: "auftrag", nachricht_id: n.id, dienstleister_id: d.id,
              anweisung: `${anweisung}${sichtbar.kontakt ? "" : "\nKontaktdaten des Mieters NICHT nennen (Termin bitte über uns)."}`,
            });
          } catch (err) { melde(`KI: ${err.message}`, "info"); }
        }
        let text = r.text;
        if (sichtbar.zugang && hausmeister) text = `${text.trim()}\n\nZugang / Schlüssel: ${hausmeister.name}${hausmeister.telefon ? `, Tel. ${hausmeister.telefon}` : ""}`;
        const s = await db.speichereAntwort(null, {
          thema_id: themaGemeinsam, art: "auftrag", nachricht_id: n.id, mieter_id: mieterId, dienstleister_id: d.id, auftrag_id: a.id,
          empfaenger_email: d.email || null, empfaenger_name: d.name, betreff: r.betreff, text, anweisung: kurzAnweisung || null,
          ki_modell: r.modell || null, anhaenge,
        });
        return { d, s: { ...s, hinweise: r.hinweise || [] } };
      }
      const s = await schreibenAnlegen(a, d, { anweisung, anzeige: kurzAnweisung, betreff: `${art === "angebot" ? "Anfrage" : "Auftrag"}: ${titel}`, mieterL, anhaenge, sichtbar, hausmeister, themaVon: { dienstleister_id: d.id } });
      return { d, s };
    }));
    for (const { d, s } of ergebnisse) { hw.push({ dienstleister_id: d.id, antwort_id: s.id, thema_id: s.thema_id || null, status: "entwurf" }); neueSchreiben.push(s); }
    a = await db.speichereAuftrag(a.id, { handwerker: hw, thema_id: themaGemeinsam || hw[0]?.thema_id || null });
    if (n?.ki_schritte?.auftrag_id && neueSchreiben[0]) {
      await db.aendereNachricht(n.id, { ki_schritte: { ...n.ki_schritte, auftrag_id: neueSchreiben[0].id, dienstleister: { id: gewaehlteHw[0].id, name: gewaehlteHw[0].name, gewerk: gewaehlteHw[0].gewerk || null, email: gewaehlteHw[0].email || null } } }).catch(() => {});
    }
    await warte?.ende();
    if (n) {
      melde(neueSchreiben.length > 1 ? `${neueSchreiben.length} Entwürfe angelegt – bitte prüfen und senden.` : "Entwurf angelegt – bitte prüfen und senden.", "ok");
      if (v.nachEntwurf) await v.nachEntwurf(neueSchreiben);
      else geheZu(`#/postfach/${n.id}`);
    }
    else if (neueSchreiben.length === 1) { melde("Entwurf angelegt – bitte prüfen und senden.", "ok"); geheZu(`#/entwurf/${neueSchreiben[0].id}`); }
    else { melde(`${neueSchreiben.length} Entwürfe angelegt – bitte jeden prüfen und senden.`, "ok"); geheZu(`#/auftrag/${a.id}`); }
    return a;
  } catch (err) {
    await warte?.ende();
    melde(err.message, "fehler");
    return null;
  }
}

// ---------------------------------------------------------------------------
// Postfach: Nachricht eines Handwerkers (oder im Vorgang eines Auftrags) → Kasten mit Status und nächstem Schritt
// ---------------------------------------------------------------------------
export async function kastenFuerNachricht(n) {
  const [auftraege, dienst] = await Promise.all([db.ladeAuftraege().catch(() => []), db.ladeDienstleister().catch(() => [])]);
  const email = String(n.absender_email || "").toLowerCase();
  const vonHw = dienst.find((d) => email && String(d.email || "").toLowerCase() === email);
  const passend = auftraege.filter((a) => LAUFEND.includes(a.status) && (
    (n.thema_id && (a.thema_id === n.thema_id || (a.handwerker || []).some((h) => h.thema_id === n.thema_id))) ||
    (vonHw && (a.dienstleister_id === vonHw.id || (a.handwerker || []).some((h) => h.dienstleister_id === vonHw.id)))));
  const a = passend[0];
  if (!a) return { html: "", verbinde: () => {} };
  const html = `<section class="flaeche hw-kasten">
    <div class="flaeche__kopf"><h2>Handwerker-Auftrag</h2><span class="hw-chip hw-chip--${esc(a.status)}">${esc(STATUS[a.status])}</span></div>
    <div class="flaeche__inhalt">
      <p><a href="#/auftrag/${esc(a.id)}"><strong>${esc(a.titel)}</strong></a><br><span class="leise">${esc(zustandText(a))}</span></p>
      ${vonHw ? `<p class="leise">Diese Nachricht kommt von ${esc(vonHw.name)}.</p>` : ""}
      <div class="knopfreihe knopfreihe--eng">
        ${a.art === "angebot" && ["angefragt", "angebot"].includes(a.status) ? `<button type="button" class="knopf knopf--klein knopf--primaer" data-kasten="angebot">Angebot eintragen</button>` : ""}
        ${a.status === "beauftragt" ? `<button type="button" class="knopf knopf--klein knopf--primaer" data-kasten="termin">Termin eintragen</button><button type="button" class="knopf knopf--klein" data-kasten="erledigt">Erledigt</button>` : ""}
        ${a.status === "erledigt" ? `<button type="button" class="knopf knopf--klein knopf--primaer" data-kasten="rechnung">Rechnung ablegen</button>` : ""}
        <a class="knopf knopf--klein" href="#/auftrag/${esc(a.id)}">Auftrag öffnen</a>
      </div>
      ${passend.length > 1 ? `<p class="leise">${passend.length - 1} weitere laufende Aufträge bei diesem Handwerker – <a href="#/handwerker">alle ansehen</a>.</p>` : ""}
    </div>
  </section>`;
  const verbinde = (root, nachher) => {
    for (const b of $$("[data-kasten]", root)) {
      b.addEventListener("click", async () => {
        try { if (await aktion(a, b.dataset.kasten, { dienst, dienstleisterId: vonHw?.id || null })) nachher?.(); } catch (err) { melde(err.message, "fehler"); }
      });
    }
  };
  return { html, verbinde };
}

/** Für die Übersicht (To-dos): überfällige Aufträge */
export async function ueberfaelligeAuftraege() {
  const liste = await db.ladeAuftraege().catch(() => []);
  return liste.filter((a) => LAUFEND.includes(a.status) && ueberfaellig(a)).map((a) => ({ ...a, grund: ueberfaellig(a) }));
}
