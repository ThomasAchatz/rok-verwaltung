// Schadensmeldung als Ablauf in 4 Schritten (im Vorgang und auf der Nachrichtenseite):
//   1. Antwort an den Mieter (Eingang bestätigen, ggf. Rückfrage/Fotos/Zeitfenster) – bereitet die KI automatisch als Entwurf vor
//   2. Handwerkerauftrag – auf Klick (Maske „Handwerker beauftragen“)
//   3. Rückmeldung des Handwerkers auswerten → Schreiben an den Mieter (Terminabstimmung oder Rückfrage) – auf Klick
//   4. Info an den Mieter, wann der Handwerker kommt – auf Klick
// Die KI schlägt nur vor; jedes Schreiben ist ein Entwurf, gesendet wird erst nach Prüfen. Gemerkt wird in nachrichten.ki_schritte (s3/s4).
import * as db from "./daten.js";
import { datumDE, mieterName } from "./dokumente.js";
import { $$, esc, melde, dialogFormular, zustand, objektVon, wohnungVon } from "./helfer.js";
import { ICON_KI, geheZu, mikroKnopf, verbindeDiktat, wartehinweis } from "./ui.js";

export const SCHADEN = "Reparatur/Mangel";
const GESENDET = (a) => a && a.status && a.status !== "entwurf";
const LAUFEND_HW = ["angefragt", "angebot", "beauftragt", "erledigt", "abgeschlossen"];
const euro = (n) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(Number(n) || 0);

/** Ist das eine Schadensmeldung, zu der der Ablauf passt? */
export const istSchaden = (n) => !!n && n.ki_kategorie === SCHADEN;

/** Erste Schadensmeldung eines Vorgangs (für die Vorgangsseite) */
export function schadenImVorgang(nachrichten = []) {
  return [...nachrichten].sort((x, y) => String(x.eingang_am).localeCompare(String(y.eingang_am))).find(istSchaden) || null;
}

/** Alles laden, was der Ablauf braucht */
/** n: die geöffnete Nachricht – der Ablauf hängt immer an der ersten Schadensmeldung ihres Vorgangs (null, wenn es keine gibt) */
export async function ladeAblauf(n0, { mieter = undefined } = {}) {
  // Status der Aufträge nach dem Senden nachziehen (sonst stünde ein gesendeter Auftrag noch als Entwurf da)
  await import("./handwerker.js").then((m) => m.abgleichen()).catch(() => null);
  const [auftraege, dienst, posten] = await Promise.all([
    db.ladeAuftraege().catch(() => []),
    db.ladeDienstleister().catch(() => []),
    n0.thema_id ? db.ladeThemaPosten(n0.thema_id).catch(() => ({ nachrichten: [], antworten: [] })) : { nachrichten: [], antworten: [] },
  ]);
  const vonHw = (x) => { const m = String(x?.absender_email || "").toLowerCase(); return !!m && dienst.some((d) => String(d.email || "").toLowerCase() === m); };
  const n = schadenImVorgang((posten.nachrichten || []).filter((x) => !vonHw(x))) || (istSchaden(n0) && !vonHw(n0) ? n0 : null);
  if (!n) return null;
  if (n.id !== n0.id) mieter = undefined;
  const eigene = await db.ladeAntworten({ nachrichtId: n.id }).catch(() => []);
  if (mieter === undefined) mieter = n.mieter_id ? await db.ladeMieter(n.mieter_id).catch(() => null) : null;
  const auftrag = auftraege.filter((a) => a.status !== "abgebrochen" && (a.nachricht_id === n.id || (n.thema_id && a.thema_id === n.thema_id)))[0] || null;
  const hwId = auftrag?.dienstleister_id || auftrag?.handwerker?.[0]?.dienstleister_id || null;
  const hw = hwId ? dienst.find((d) => d.id === hwId) || null : null;
  // Antworten des Handwerkers: im Vorgang des Auftrags (bzw. seiner Anfrage) nach dem Senden, oder von seiner Adresse
  const themen = [n.thema_id, auftrag?.thema_id, ...(auftrag?.handwerker || []).map((h) => h.thema_id)].filter(Boolean);
  const weitere = themen.length ? await db.ladeNachrichtenZuThemen(themen).catch(() => []) : [];
  const hwMail = String(hw?.email || "").toLowerCase();
  const mieterMail = String(mieter?.email || n.absender_email || "").toLowerCase();
  const seit = auftrag?.gesendet_am || auftrag?.erstellt_am || n.eingang_am;
  const hwAntworten = weitere.filter((x) => x.id !== n.id && String(x.eingang_am) > String(seit)
    && ((hwMail && String(x.absender_email || "").toLowerCase() === hwMail) || String(x.absender_email || "").toLowerCase() !== mieterMail))
    .sort((x, y) => String(y.eingang_am).localeCompare(String(x.eingang_am)));
  const alle = [...eigene, ...(posten.antworten || [])];
  const finde = (id) => (id ? alle.find((a) => a.id === id) || null : null);
  const s = n.ki_schritte || {};
  const aw = finde(s.antwort_id) || [...eigene].reverse().find((a) => a.art !== "auftrag" && !a.auftrag_id) || null;
  return { n, mieter, auftrag, hw, hwAntworten, aw, s3: finde(s.s3?.antwort_id), s4: finde(s.s4?.antwort_id) };
}

/** Aktueller Schritt (1–4), 5 = alles erledigt */
export function aktuellerSchritt(c) {
  if (!GESENDET(c.aw)) return 1;
  if (!c.auftrag || !LAUFEND_HW.includes(c.auftrag.status)) return 2;
  if (!GESENDET(c.s3) && !GESENDET(c.s4) && !c.auftrag.termin) return 3;
  if (!GESENDET(c.s4)) return 4;
  return 5;
}

/**
 * Kasten „Schaden-Ablauf“. seite: "nachricht" (Entwürfe stehen darunter) | "vorgang".
 * laeuft/fehler: Zustand der automatischen Vorbereitung von Schritt 1.
 */
export function ablaufHtml(c, { seite = "nachricht", laeuft = false, fehler = null } = {}) {
  const { n, auftrag, hw, aw } = c;
  const jetzt = aktuellerSchritt(c);
  const k = (op, text, art = "") => `<button type="button" class="knopf knopf--klein ${art}" data-ablauf="${op}">${text}</button>`;
  const zeile = (nr, titel, unter, aktion, { fertig = false, wartet = false } = {}) => `
    <li class="schritt ${fertig ? "schritt--fertig" : ""} ${nr === jetzt ? "schritt--jetzt" : ""} ${wartet ? "schritt--wartet" : ""}">
      <span class="schritt__nr">${fertig ? "✓" : nr}</span>
      <span class="schritt__text"><strong>${titel}</strong>${unter ? `<br><span class="leise">${unter}</span>` : ""}</span>
      <span class="schritt__aktion">${aktion || ""}</span></li>`;
  const wer = esc(c.mieter ? mieterName(c.mieter) : n.absender_name || "die Mietpartei");
  const offen = (a) => a && !GESENDET(a);
  // 1 Antwort an den Mieter
  const z1 = GESENDET(aw)
    ? zeile(1, `Antwort an ${wer}`, aw.status === "als_brief" ? "als Brief erledigt" : `gesendet ${aw.gesendet_am ? datumDE(aw.gesendet_am) : ""}`, "", { fertig: true })
    : laeuft ? zeile(1, `Antwort an ${wer}`, `<span class="kreisel" aria-hidden="true"></span> Die KI schreibt die Antwort …`, "")
    : fehler ? zeile(1, `Antwort an ${wer}`, `Vorbereiten hat nicht geklappt: ${esc(fehler)}`, k("nochmal", `${ICON_KI} Nochmal`, "knopf--ki"))
    : offen(aw) ? zeile(1, `Antwort an ${wer}`, "Eingang bestätigen, bei Bedarf Fotos oder Zeitfenster erfragen. Entwurf liegt bereit.",
        seite === "nachricht" ? k("s1-senden", "Ansehen &amp; senden", "knopf--primaer") : k("zur-nachricht", "Öffnen", "knopf--primaer"))
    : zeile(1, `Antwort an ${wer}`, "Eingang bestätigen, bei Bedarf Fotos oder Zeitfenster erfragen.",
        seite === "nachricht" ? k("s1-schreiben", "Antwort schreiben", "knopf--primaer") : k("zur-nachricht", "Öffnen", "knopf--primaer"));
  // 2 Handwerkerauftrag
  const hwName = hw ? esc(hw.name) : "Handwerker";
  const z2 = !auftrag
    ? zeile(2, "Handwerker beauftragen", "Auftrag mit Fotos und Kontakt der Mietpartei", k("s2", "Auftrag vorbereiten", jetzt === 2 ? "knopf--primaer" : ""))
    : auftrag.status === "entwurf"
    ? zeile(2, `Auftrag an ${hwName}`, "Entwurf liegt bereit – noch nicht gesendet.", seite === "nachricht" ? k("s2-senden", "Ansehen &amp; senden", "knopf--primaer") : k("zur-nachricht", "Öffnen", "knopf--primaer"))
    : zeile(2, `Auftrag an ${hwName}`, `${esc(auftrag.art === "angebot" ? "Angebot angefragt" : "beauftragt")}${auftrag.gesendet_am ? ` am ${datumDE(auftrag.gesendet_am)}` : ""} · <a href="#/auftrag/${esc(auftrag.id)}">Auftrag öffnen</a>`, "", { fertig: true });
  // 3 Rückmeldung des Handwerkers → Mieter
  const hwA = c.hwAntworten[0];
  const z3 = GESENDET(c.s3)
    ? zeile(3, "Rückmeldung an die Mietpartei", `gesendet ${c.s3.gesendet_am ? datumDE(c.s3.gesendet_am) : ""}`, "", { fertig: true })
    : offen(c.s3) ? zeile(3, "Rückmeldung an die Mietpartei", "Entwurf liegt bereit.", k("s3-oeffnen", "Ansehen &amp; senden", "knopf--primaer"))
    : !auftrag || auftrag.status === "entwurf" ? zeile(3, "Rückmeldung des Handwerkers", "Sobald der Handwerker antwortet: Termin oder Rückfrage an die Mietpartei weitergeben.", "", { wartet: true })
    : hwA ? zeile(3, `${hwName} hat geantwortet`, `${esc(hwA.betreff || "")} · ${datumDE(hwA.eingang_am)} · <a href="#/postfach/${esc(hwA.id)}">lesen</a>`,
        k("s3", `${zustand.ki?.ki ? ICON_KI + " " : ""}Auswerten &amp; Mieter informieren`, "knopf--primaer"))
    : auftrag.termin ? zeile(3, "Rückmeldung des Handwerkers", `Termin ${datumDE(auftrag.termin)} ist schon eingetragen.`, "", { fertig: true })
    : zeile(3, `Warten auf ${hwName}`, "Noch keine Antwort im Vorgang. Kam sie per Telefon? Dann den Termin eintragen.",
        k("termin", "Termin eintragen") + k("erinnern", "Nachfassen", "knopf--leise"));
  // 4 Info an den Mieter, wann der Handwerker kommt
  const z4 = GESENDET(c.s4)
    ? zeile(4, `Termin-Info an ${wer}`, `gesendet ${c.s4.gesendet_am ? datumDE(c.s4.gesendet_am) : ""}`, "", { fertig: true })
    : offen(c.s4) ? zeile(4, `Termin-Info an ${wer}`, "Entwurf liegt bereit.", k("s4-oeffnen", "Ansehen &amp; senden", "knopf--primaer"))
    : auftrag?.termin ? zeile(4, `Termin-Info an ${wer}`, `${hwName} kommt am ${datumDE(auftrag.termin)}${auftrag.notiz ? ` (${esc(auftrag.notiz)})` : ""}.`,
        k("s4", `${zustand.ki?.ki ? ICON_KI + " " : ""}Mieter informieren`, jetzt === 4 ? "knopf--primaer" : ""))
    : zeile(4, `Termin-Info an ${wer}`, "Sobald ein Termin feststeht – oder die Bitte, sich direkt mit dem Handwerker abzustimmen.",
        auftrag && auftrag.status !== "entwurf" ? k("s4", "Direkt abstimmen lassen", "knopf--leise") : "", { wartet: true });
  const verwerfen = offen(aw) && n.ki_schritte?.antwort_id === aw?.id && seite === "nachricht";
  return `<section class="flaeche schritte schaden" id="schritte">
    <div class="flaeche__kopf"><h2>Schaden-Ablauf</h2><span class="leise">${jetzt > 4 ? "alles erledigt" : `Schritt ${jetzt} von 4`}</span></div>
    <div class="flaeche__inhalt">
      <ol class="schritte__liste">${z1}${z2}${z3}${z4}</ol>
      ${n.ki_schritte?.hinweise?.length && !GESENDET(aw) ? `<p class="leise">Bitte prüfen: ${n.ki_schritte.hinweise.map(esc).join(" · ")}</p>` : ""}
      <p class="leise schritte__fuss">Die KI bereitet nur Schritt 1 von selbst vor; die nächsten Schritte entstehen auf Klick, passend zur Antwort. Gesendet wird nie automatisch.
        ${verwerfen ? `<button type="button" class="textknopf" data-ablauf="verwerfen">Antwort-Entwurf verwerfen</button>` : ""}</p>
    </div>
  </section>`;
}

/**
 * Knöpfe verbinden. Für die Nachrichtenseite übergibt postfach: senden1() (Senden-Knopf des Antwort-Entwurfs),
 * senden2() (Auftrags-Entwurf), auftragStarten(), nochmal(), verwerfen().
 */
export function verbindeAblauf(root, c, { neu = () => {}, senden1, senden2, schreiben1, auftragStarten, nochmal, verwerfen } = {}) {
  for (const b of $$("[data-ablauf]", root)) b.addEventListener("click", async () => {
    const op = b.dataset.ablauf;
    try {
      if (op === "zur-nachricht") return geheZu(`#/postfach/${c.n.id}`);
      if (op === "s1-senden") return senden1?.();
      if (op === "s1-schreiben") return schreiben1?.();
      if (op === "s2") return auftragStarten ? auftragStarten() : geheZu(`#/postfach/${c.n.id}`);
      if (op === "s2-senden") return senden2?.();
      if (op === "s3-oeffnen") return geheZu(`#/entwurf/${c.s3.id}`);
      if (op === "s4-oeffnen") return geheZu(`#/entwurf/${c.s4.id}`);
      if (op === "nochmal") { b.disabled = true; return nochmal?.(); }
      if (op === "verwerfen") return verwerfen?.();
      if (op === "termin" || op === "erinnern") {
        const hwm = await import("./handwerker.js");
        if (await hwm.aktion(c.auftrag, op)) neu();
        return;
      }
      if (op === "s3") { b.disabled = true; const ok = await schritt3(c); b.disabled = false; if (ok === "neu") neu(); return; }
      if (op === "s4") { b.disabled = true; const ok = await schritt4(c); b.disabled = false; if (ok === "neu") neu(); return; }
    } catch (err) { b.disabled = false; melde(err.message, "fehler"); }
  });
}

// ---------------------------------------------------------------------------
// Schritt 3: Antwort des Handwerkers auswerten → Termin/Betrag (zum Bestätigen) + Schreiben an den Mieter
// ---------------------------------------------------------------------------
async function schritt3(c) {
  const hwA = c.hwAntworten[0];
  let r = null;
  if (zustand.ki?.ki) {
    const warte = wartehinweis("Die KI liest die Antwort des Handwerkers …");
    try { r = await db.funktion("schaden", { aktion: "handwerker_antwort", nachricht_id: hwA.id, auftrag_id: c.auftrag?.id || null }); }
    catch (err) { melde(`KI: ${err.message} – bitte selbst ausfüllen.`, "info"); }
    finally { await warte.ende(); }
  }
  r = r || { art: "sonstiges", zusammenfassung: "", termin: null, termin_text: null, betrag: null, mieter_informieren: true, direkt_abstimmen: false, mieter_anweisung: "" };
  const hw = c.hw;
  const tel = hw?.telefon ? `, Tel. ${hw.telefon}` : "";
  const ARTTEXT = { termin_vorschlag: "Terminvorschlag", termin_fest: "Fester Termin", rueckfrage: "Rückfrage", angebot: "Angebot", erledigt: "Erledigt gemeldet", sonstiges: "Antwort" };
  const d = await dialogFormular(`
    <h2>Rückmeldung von ${esc(hw?.name || hwA.absender_name || "Handwerker")}</h2>
    ${r.zusammenfassung ? `<p><span class="marker marker--ki">${esc(ARTTEXT[r.art] || "Antwort")}</span> ${esc(r.zusammenfassung)}</p>` : `<p class="leise">Antwort vom ${datumDE(hwA.eingang_am)}: <a href="#/postfach/${esc(hwA.id)}" target="_blank" rel="noopener">lesen</a></p>`}
    ${c.auftrag ? `<fieldset class="gruppe"><legend>Am Auftrag eintragen (Vorschlag)</legend>
      <div class="formraster formraster--zwei">
        <label class="feld"><span>Termin</span><input type="date" name="termin" value="${esc(r.termin || c.auftrag.termin || "")}"></label>
        <label class="feld"><span>Uhrzeit / Hinweis</span><input name="notiz" value="${esc(r.termin_text || c.auftrag.notiz || "")}" placeholder="z. B. 8–10 Uhr"></label>
      </div>
      ${r.betrag ? `<label class="checkfeld"><input type="checkbox" name="betrag_an" checked> Betrag ${esc(euro(r.betrag))} ${r.art === "angebot" ? "als Angebot" : ""} eintragen</label>` : ""}
    </fieldset>` : ""}
    <label class="checkfeld"><input type="checkbox" name="schreiben" ${r.mieter_informieren ? "checked" : ""}> Schreiben an ${esc(c.mieter ? mieterName(c.mieter) : "die Mietpartei")} entwerfen</label>
    <label class="feld" data-anw><span>Was soll die Mietpartei erfahren?</span>
      <span class="diktat"><textarea name="anweisung" rows="4" placeholder="z. B. Handwerker kommt Do 06.11. zwischen 8 und 10 Uhr, bitte zu Hause sein">${esc(r.mieter_anweisung || "")}</textarea>${mikroKnopf()}</span></label>
    ${hw ? `<label class="checkfeld" data-anw><input type="checkbox" name="direkt" ${r.direkt_abstimmen ? "checked" : ""}> Bitte direkt mit ${esc(hw.name)} abstimmen (Telefon mitgeben)</label>` : ""}
    <p class="leise">Es entsteht ein Entwurf im selben Vorgang – gesendet wird erst nach deinem Klick.</p>
    <div class="knopfreihe"><button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button><button class="knopf knopf--primaer" value="ok">Übernehmen</button></div>`, {
    breit: true,
    vorbereiten: (form) => {
      verbindeDiktat(form);
      const zeige = () => { for (const el of $$("[data-anw]", form)) el.hidden = !form.schreiben.checked; };
      form.schreiben.addEventListener("change", zeige); zeige();
    },
  });
  if (!d) return null;
  if (c.auftrag) {
    const felder = {};
    if (d.get("termin") && d.get("termin") !== c.auftrag.termin) felder.termin = d.get("termin");
    const notiz = String(d.get("notiz") || "").trim();
    if (notiz && notiz !== c.auftrag.notiz) felder.notiz = notiz;
    if (d.get("betrag_an") && r.betrag) {
      if (r.art === "angebot") {
        felder.handwerker = (c.auftrag.handwerker || []).map((h) => (h.dienstleister_id === hw?.id ? { ...h, status: "angebot", betrag: r.betrag, datum: hwA.eingang_am.slice(0, 10) } : h));
        if (["angefragt", "entwurf"].includes(c.auftrag.status)) felder.status = "angebot";
      } else felder.betrag = r.betrag;
    }
    if (Object.keys(felder).length) { Object.assign(c.auftrag, await db.speichereAuftrag(c.auftrag.id, felder)); melde("Am Auftrag eingetragen.", "ok"); }
  }
  if (!d.get("schreiben")) return "neu";
  let anweisung = String(d.get("anweisung") || "").trim();
  if (!anweisung) return melde("Bitte kurz eintragen, was die Mietpartei erfahren soll.", "info"), "neu";
  if (d.get("direkt") && hw) anweisung += `\nBitte stimmen Sie den Termin direkt mit ${hw.name}${tel} ab.`;
  await entwurfAnMieter(c, anweisung, "s3", { betreff: `Ihre Schadensmeldung: ${titelVon(c)}` });
  return null;
}

// ---------------------------------------------------------------------------
// Schritt 4: Info an den Mieter, wann der Handwerker kommt (oder: bitte direkt abstimmen)
// ---------------------------------------------------------------------------
async function schritt4(c) {
  const a = c.auftrag, hw = c.hw;
  const tel = hw?.telefon ? `, Tel. ${hw.telefon}` : "";
  const vorschlag = a?.termin
    ? `Teilen Sie mit, dass ${hw?.name || "der Handwerker"} am ${datumDE(a.termin)}${a.notiz ? ` (${a.notiz})` : ""} wegen „${titelVon(c)}“ kommt. Bitte zu Hause sein bzw. den Zugang ermöglichen. Falls der Termin nicht passt, bitte kurz melden.`
    : `Teilen Sie mit, dass ${hw?.name || "der Handwerker"} wegen „${titelVon(c)}“ beauftragt ist, und bitten Sie, den Termin direkt mit ${hw?.name || "dem Handwerker"}${tel} abzustimmen.`;
  const d = await dialogFormular(`
    <h2>Mietpartei informieren</h2>
    <label class="feld"><span>Was soll ${esc(c.mieter ? mieterName(c.mieter) : "die Mietpartei")} erfahren?</span>
      <span class="diktat"><textarea name="anweisung" rows="4">${esc(vorschlag)}</textarea>${mikroKnopf()}</span></label>
    ${hw && a?.termin ? `<label class="checkfeld"><input type="checkbox" name="direkt"> Zusätzlich: bei Fragen direkt an ${esc(hw.name)} wenden (Telefon mitgeben)</label>` : ""}
    <p class="leise">Es entsteht ein Entwurf im selben Vorgang – gesendet wird erst nach deinem Klick.</p>
    <div class="knopfreihe"><button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button><button class="knopf knopf--primaer" value="ok">${zustand.ki?.ki ? ICON_KI + " " : ""}Entwurf erstellen</button></div>`,
  { breit: true, vorbereiten: (form) => verbindeDiktat(form) });
  if (!d) return null;
  let anweisung = String(d.get("anweisung") || "").trim();
  if (!anweisung) return null;
  if (d.get("direkt") && hw) anweisung += `\nBei Fragen zum Termin bitte direkt an ${hw.name}${tel} wenden.`;
  await entwurfAnMieter(c, anweisung, "s4", { betreff: a?.termin ? `Handwerkertermin am ${datumDE(a.termin)}` : `Ihre Schadensmeldung: ${titelVon(c)}` });
  return null;
}

const titelVon = (c) => String(c.auftrag?.titel || c.n.betreff || "Schadensmeldung").replace(/^\s*((aw|re|wg|fwd?)\s*:\s*)+/i, "").slice(0, 80);

/** Entwurf an die Mietpartei im Vorgang der Schadensmeldung anlegen, im Ablauf merken und öffnen */
async function entwurfAnMieter(c, anweisung, schritt, { betreff }) {
  const { n, mieter } = c;
  const warte = wartehinweis(zustand.ki?.ki ? "Die KI schreibt den Entwurf …" : "Entwurf wird angelegt …");
  try {
    let r = { betreff, text: `Guten Tag,\n\n${anweisung}`, modell: null };
    if (zustand.ki?.ki && mieter) {
      try {
        const k = await db.funktion("ki", { aktion: "entwurf", mieter_id: mieter.id, anweisung: `${anweisung}\n\n(Es geht um die Schadensmeldung „${titelVon(c)}“.)` });
        if (k?.text) r = { betreff: k.betreff || betreff, text: k.text, modell: k.modell || null };
      } catch (err) { melde(`KI: ${err.message} – Entwurf ohne KI angelegt.`, "info"); }
    }
    const w = mieter ? wohnungVon(mieter.wohnung_id) : null;
    const s = await db.speichereAntwort(null, {
      art: "antwort", status: "entwurf", thema_id: n.thema_id || null, mieter_id: mieter?.id || n.mieter_id || null,
      objekt_id: mieter ? null : n.objekt_id || (w ? objektVon(w.objekt_id)?.id : null) || null,
      empfaenger_email: mieter?.email || n.absender_email || null, empfaenger_name: mieter ? mieterName(mieter) : n.absender_name || null,
      betreff: String(r.betreff || betreff).slice(0, 200), text: r.text, anweisung: anweisung.slice(0, 2000), ki_modell: r.modell,
    });
    const ks = { ...(n.ki_schritte || { status: "keine" }), [schritt]: { antwort_id: s.id, am: new Date().toISOString() } };
    n.ki_schritte = (await db.aendereNachricht(n.id, { ki_schritte: ks }).catch(() => null))?.ki_schritte || ks;
    await warte.ende();
    melde("Entwurf angelegt – bitte prüfen und senden.", "ok");
    geheZu(`#/entwurf/${s.id}`);
  } catch (err) {
    await warte.ende();
    throw err;
  }
}
