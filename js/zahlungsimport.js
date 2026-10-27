// Zahlungen importieren: Kontoauszug (CSV aus dem Online-Banking) oder immocloud-Mietübersicht (Excel).
// Ablauf: Datei wählen → Vorschau mit Zuordnung (änderbar) → erst „Übernehmen“ speichert.
// Die Datei verlässt das Gerät nicht; an die KI gehen nur unklare Eingänge (ohne IBAN) auf ausdrücklichen Klick.
import * as db from "./daten.js";
import * as L from "./zahlungslogik.js";
import { euro, datumDE, mieterName } from "./dokumente.js";
import { $, esc, melde, dialogFormular, heuteISO, zustand } from "./helfer.js";
import { ICON_KI } from "./ui.js";
import { POSTEN, ZAHLUNG_ART, abgleichenViele } from "./mieteingaenge.js";

let nachherAktuell = null;
const MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const rund = (n) => Math.round(Number(n) * 100) / 100;
const MAX_DATEI = 10 * 1024 * 1024;
const anzahl = (n, eins, mehr) => `${n} ${n === 1 ? eins : mehr}`;
const SICHERHEIT = { sicher: "passt", pruefen: "bitte prüfen", unklar: "unklar" };

const IMPORT_TYPEN = ".csv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
/** Passt die Datei zum Zahlungsimport? (CSV, TXT, Excel; PDF wird abgefangen und erklärt) */
export const istImportDatei = (d) => /\.(csv|txt|xlsx|pdf)$/i.test(d?.name || "") || /^text\/(csv|plain)$/.test(d?.type || "");

/**
 * Startpunkt: Knopf „Kontoauszug / Excel einlesen“ (Dialog mit Ablagefläche) oder Dateien,
 * die auf die Seite Mieteingänge gezogen wurden (dateien: dann ohne Auswahldialog direkt zur Vorschau).
 */
export async function importStarten({ nachher = null, dateien = null } = {}) {
  let liste = dateien ? [...dateien] : null;
  if (!liste) {
    const daten = await dialogFormular(`
      <h2>Zahlungen importieren</h2>
      <ul class="zi-wege">
        <li><b>Kontoauszug als CSV</b> – im Online-Banking die Umsätze des Mietkontos als CSV exportieren.
          Eingänge werden Mietparteien und Monaten zugeordnet, Ausgänge übersprungen.</li>
        <li><b>immocloud-Mietübersicht (Excel)</b> – Export „Mietübersicht“ eines Hauses. Übernimmt die Monatsbeträge je Mietpartei.</li>
      </ul>
      <label class="ablegeflaeche ablegeflaeche--klein zi-ablage" data-dialog-ablage>
        <input type="file" name="datei" accept="${IMPORT_TYPEN}" multiple hidden>
        <span class="ablegeflaeche__text"><strong class="nur-maus">CSV oder Excel hierher ziehen</strong> <span class="nur-maus">oder</span>
          <span class="knopf knopf--klein ablegeflaeche__knopf">Datei auswählen</span></span>
        <span class="ablegeflaeche__hinweis leise" data-dateiname>Auch mehrere Dateien (z. B. zwei Konten) – sie werden nacheinander eingelesen.</span>
      </label>
      <p class="leise">Erst kommt eine Vorschau; gespeichert wird nur, was du dort bestätigst. Kontonummern (IBAN) werden nicht übernommen.
        PDF-Kontoauszüge gehen nicht – bitte CSV nehmen.</p>
      <p class="oz-fehler" data-fehler role="alert" hidden></p>
      <div class="knopfreihe">
        <button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button>
        <button class="knopf knopf--primaer" value="weiter">Weiter zur Vorschau</button>
      </div>`, {
      vorbereiten: (form) => {
        const flaeche = $("[data-dialog-ablage]", form), input = form.datei;
        const weiter = () => form.requestSubmit(form.querySelector("button[value=weiter]"));
        // Ausgewählt oder hineingezogen: gleich weiter zur Vorschau
        input.addEventListener("change", () => { if (input.files.length) weiter(); });
        let tiefe = 0;
        flaeche.addEventListener("dragenter", (e) => { e.preventDefault(); tiefe++; flaeche.classList.add("ablegeflaeche--aktiv"); });
        flaeche.addEventListener("dragleave", () => { if (--tiefe <= 0) { tiefe = 0; flaeche.classList.remove("ablegeflaeche--aktiv"); } });
        flaeche.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
        flaeche.addEventListener("drop", (e) => {
          e.preventDefault();
          tiefe = 0; flaeche.classList.remove("ablegeflaeche--aktiv");
          if (!e.dataTransfer?.files?.length) return;
          input.files = e.dataTransfer.files;
          weiter();
        });
        form.addEventListener("submit", (e) => {
          if (e.submitter?.value !== "weiter" || input.files.length) return;
          e.preventDefault();
          const p = $("[data-fehler]", form);
          p.textContent = "Bitte eine Datei auswählen oder hineinziehen."; p.hidden = false;
        });
      },
    });
    liste = daten ? daten.getAll("datei").filter((d) => d && d.size) : [];
  }
  if (!liste.length) return;
  nachherAktuell = nachher;
  for (const datei of liste.slice(0, 10)) {
    const vorname = liste.length > 1 ? `„${datei.name}“: ` : "";
    if (/\.pdf$/i.test(datei.name) || datei.type === "application/pdf") { melde(vorname + "PDF-Kontoauszüge kann ich nicht lesen. Bitte im Online-Banking die Umsätze als CSV exportieren.", "fehler"); continue; }
    if (datei.size > MAX_DATEI) { melde(vorname + "Die Datei ist zu groß (höchstens 10 MB).", "fehler"); continue; }
    try {
      const bytes = new Uint8Array(await datei.arrayBuffer());
      const fertig = bytes[0] === 0x50 && bytes[1] === 0x4b
        ? await excelImport(datei, datei.name)
        : await bankImport(L.textDekodieren(bytes));
      if (fertig) await nachher?.();
    } catch (err) {
      console.error(err);
      melde(`${vorname}Import fehlgeschlagen: ${err.message}`, "fehler");
    }
  }
}

async function stammUndMieter() {
  if (!zustand.stamm) zustand.stamm = await db.ladeStammdaten();
  return { stamm: zustand.stamm, mieter: await db.ladeMieterMiete() };
}

/** Auswahl der Mietparteien, nach Haus gruppiert */
function mieterOptionen(stamm, mieter, gewaehlt) {
  const gruppen = new Map();
  for (const m of mieter) {
    const w = stamm.wohnungen.find((x) => x.id === m.wohnung_id);
    const o = w ? stamm.objekte.find((x) => x.id === w.objekt_id) : null;
    const k = o?.bezeichnung || "Ohne Wohnung";
    if (!gruppen.has(k)) gruppen.set(k, []);
    gruppen.get(k).push({ m, w, ehemalig: m.mietende && m.mietende < heuteISO() });
  }
  return `<option value="">– Mietpartei wählen –</option>` + [...gruppen].map(([k, liste]) => `<optgroup label="${esc(k)}">${liste.map(({ m, w, ehemalig }) =>
    `<option value="${esc(m.id)}"${m.id === gewaehlt ? " selected" : ""}>${esc(mieterName(m) || "?")}${w ? ` · ${esc(w.bezeichnung)}` : ""}${ehemalig ? " (ausgezogen)" : ""}</option>`).join("")}</optgroup>`).join("");
}
const schluesselVon = (x) => `${x.mieter_id}|${String(x.monat).slice(0, 10)}`;

// ---------------------------------------------------------------------------
// Kontoauszug
// ---------------------------------------------------------------------------
async function bankImport(text) {
  const { buchungen, fehler } = L.kontoauszugLesen(text);
  if (fehler) { melde(fehler, "fehler"); return false; }
  const eingaenge = buchungen.filter((b) => b.betrag > 0);
  const ausgaenge = buchungen.length - eingaenge.length;
  if (!eingaenge.length) { melde("In der Datei sind keine Zahlungseingänge.", "info"); return false; }
  const { stamm, mieter } = await stammUndMieter();
  const tage = eingaenge.map((b) => b.datum).sort();
  const von = L.monatPlus(`${tage[0].slice(0, 7)}-01`, -2), bis = L.monatPlus(`${tage[tage.length - 1].slice(0, 7)}-01`, 2);
  const [fs, zs] = await Promise.all([db.ladeForderungenZeitraum(von, bis), db.ladeZahlungen({ von, bis })]);
  const soll = new Map(), gezahlt = new Map();
  for (const f of fs) if (POSTEN.includes(f.art)) soll.set(schluesselVon(f), rund((soll.get(schluesselVon(f)) || 0) + Number(f.betrag)));
  // Excel-Beträge zählen nicht: der Kontoauszug ersetzt sie
  for (const z of zs) if (z.art === "miete" && z.quelle !== "excel") gezahlt.set(schluesselVon(z), rund((gezahlt.get(schluesselVon(z)) || 0) + Number(z.betrag)));
  const ctx = {
    mieter, kostentraeger: stamm.kostentraeger,
    soll: (id, monat) => soll.get(`${id}|${monat}`) ?? null,
    gezahlt: (id, monat) => gezahlt.get(`${id}|${monat}`) || 0,
  };
  // Schon importierte Buchungen erkennen (auch wenn sie damals aufgeteilt wurden) und vor der Zuordnung herausnehmen
  const probe = L.bankZuordnen(eingaenge, ctx);
  const vorhanden = await db.vorhandeneSchluessel(probe.flatMap((z) => [z.basis, `${z.basis}:1`, `${z.basis}:2`]));
  const doppelt = new Set(probe.filter((z) => [z.basis, `${z.basis}:1`, `${z.basis}:2`].some((k) => vorhanden.has(k))).map((z) => z.nr));
  const zeilen = L.bankZuordnen(eingaenge.filter((b) => !doppelt.has(b.nr)), ctx);
  const RANG = { unklar: 0, pruefen: 1, sicher: 2 };
  zeilen.sort((a, b) => RANG[a.sicherheit] - RANG[b.sicherheit] || a.datum.localeCompare(b.datum) || a.nr - b.nr || a.teil - b.teil);
  return bankVorschau({ zeilen, stamm, mieter, ausgaenge, doppelt: doppelt.size, zs });
}

function bankZeileHtml(z, i, stamm, mieter) {
  return `
    <div class="zi-zeile zi-zeile--${z.sicherheit}" data-i="${i}">
      <label class="zi-an" title="Übernehmen"><input type="checkbox" name="an_${i}" ${z.mieter_id ? "checked" : ""} aria-label="Übernehmen"></label>
      <div class="zi-buchung">
        <div><b class="zi-betrag">${euro(z.betrag)}</b>${z.teil ? ` <span class="leise">von ${euro(z.gesamt)}</span>` : ""} · ${esc(datumDE(z.datum))}</div>
        <div class="zi-zahler">${esc(z.zahler || "–")}</div>
        ${z.text ? `<div class="zi-text leise">${esc(z.text)}</div>` : ""}
      </div>
      <div class="zi-felder">
        <select name="m_${i}" aria-label="Mietpartei">${mieterOptionen(stamm, mieter, z.mieter_id)}</select>
        <input type="month" name="mo_${i}" value="${esc(z.monat.slice(0, 7))}" aria-label="Für Monat">
        <select name="a_${i}" aria-label="Art">${Object.entries(ZAHLUNG_ART).map(([k, n]) => `<option value="${k}"${k === z.art ? " selected" : ""}>${esc(n)}</option>`).join("")}
          <option value="keine">Keine Mietzahlung (nicht übernehmen)</option></select>
      </div>
      <p class="zi-hinweis" data-hinweis><span class="zi-chip zi-chip--${z.sicherheit}">${SICHERHEIT[z.sicherheit]}</span>${z.monatQuelle === "datum" && z.mieter_id ? `<span>Monat nach Eingangsdatum</span>` : ""}${z.hinweis ? `<span>${esc(z.hinweis)}</span>` : ""}</p>
    </div>`;
}

async function bankVorschau({ zeilen, stamm, mieter, ausgaenge, doppelt, zs }) {
  if (!zeilen.length) { melde("Alle Eingänge dieser Datei sind schon importiert.", "info"); return false; }
  const zaehle = (s) => zeilen.filter((z) => z.sicherheit === s).length;
  const daten = await dialogFormular(`
    <h2>Kontoauszug – Vorschau</h2>
    <p class="zi-zusammenfassung">${anzahl(new Set(zeilen.map((z) => z.nr)).size, "Eingang", "Eingänge")}${new Set(zeilen.map((z) => z.nr)).size < zeilen.length ? ` in ${zeilen.length} Zeilen (aufgeteilt)` : ""}: <b>${zaehle("sicher")}</b> passen, <b>${zaehle("pruefen")}</b> bitte prüfen, <b>${zaehle("unklar")}</b> unklar.
      ${ausgaenge ? `<span class="leise">${anzahl(ausgaenge, "Ausgang", "Ausgänge")} übersprungen.</span>` : ""}
      ${doppelt ? `<span class="leise">${anzahl(doppelt, "Eingang", "Eingänge")} schon früher importiert – übersprungen.</span>` : ""}</p>
    <p class="leise">Ab dem 25. zählt ein Eingang für den Folgemonat, außer der Verwendungszweck nennt den Monat. Zuordnung, Monat und Art kannst du je Zeile ändern.</p>
    ${zaehle("unklar") ? `<p><button type="button" class="knopf" data-ki>${ICON_KI} Unklare von der KI zuordnen lassen</button>
      <span class="leise zi-ki-info">Geht an die KI: Datum, Betrag, Name und Verwendungszweck dieser Eingänge – ohne Kontonummern.</span></p>` : ""}
    <div class="zi-liste">${zeilen.map((z, i) => bankZeileHtml(z, i, stamm, mieter)).join("")}</div>
    <p class="oz-fehler" data-fehler role="alert" hidden></p>
    <div class="knopfreihe zi-fuss">
      <span class="zi-summe" data-summe></span>
      <button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button>
      <button class="knopf knopf--primaer" value="speichern">Übernehmen</button>
    </div>`, {
    breit: true,
    vorbereiten: (form) => {
      const summe = () => {
        let n = 0, s = 0;
        zeilen.forEach((z, i) => { if (form[`an_${i}`].checked) { n++; s += z.betrag; } });
        $("[data-summe]", form).textContent = n ? `${anzahl(n, "Zahlung", "Zahlungen")}, ${euro(rund(s))}` : "Nichts ausgewählt";
      };
      zeilen.forEach((z, i) => {
        const an = form[`an_${i}`], m = form[`m_${i}`], a = form[`a_${i}`];
        const pruefe = () => { if (!m.value || a.value === "keine") an.checked = false; };
        m.addEventListener("change", () => { an.checked = !!m.value && a.value !== "keine"; summe(); });
        a.addEventListener("change", () => { if (a.value === "keine") an.checked = false; else if (m.value) an.checked = true; summe(); });
        an.addEventListener("change", () => { pruefe(); summe(); });
      });
      summe();
      $("[data-ki]", form)?.addEventListener("click", (ev) => kiZuordnen(ev.currentTarget, form, zeilen).then(summe));
      form.addEventListener("submit", (ev) => {
        if (ev.submitter?.value !== "speichern") return;
        const fehlt = zeilen.findIndex((z, i) => form[`an_${i}`].checked && (!form[`m_${i}`].value || !form[`mo_${i}`].value));
        const keine = !zeilen.some((z, i) => form[`an_${i}`].checked);
        const fehler = keine ? "Bitte mindestens eine Zahlung auswählen." : fehlt >= 0 ? "Bei einer ausgewählten Zeile fehlt Mietpartei oder Monat." : "";
        const p = $("[data-fehler]", form);
        p.textContent = fehler; p.hidden = !fehler;
        if (fehler) { ev.preventDefault(); if (fehlt >= 0) $(`[data-i="${fehlt}"]`, form)?.scrollIntoView({ block: "center" }); }
      });
    },
  });
  if (daten?.get("_aktion") !== "speichern") return false;

  const importId = crypto.randomUUID();
  const neu = zeilen.map((z, i) => (daten.get(`an_${i}`) && daten.get(`m_${i}`) && daten.get(`a_${i}`) !== "keine" ? {
    mieter_id: daten.get(`m_${i}`), monat: `${daten.get(`mo_${i}`)}-01`, datum: z.datum, betrag: z.betrag,
    art: daten.get(`a_${i}`), quelle: "bank", zahler: z.zahler || null, text: z.text || null, schluessel: z.schluessel, import_id: importId,
  } : null)).filter(Boolean);
  const gespeichert = await db.neueZahlungen(neu);
  // Der Kontoauszug ersetzt Excel-Beträge derselben Monate
  const paare = [...new Map(neu.filter((z) => z.art === "miete").map((z) => [schluesselVon(z), { mieter_id: z.mieter_id, monat: z.monat }])).values()];
  const mitBank = new Set(paare.map(schluesselVon));
  const ersetzt = zs.filter((z) => z.quelle === "excel" && z.art === "miete" && mitBank.has(schluesselVon(z)));
  await db.loescheZahlungen(ersetzt.map((z) => z.id));
  await abgleichenViele(paare, { nachLoeschen: true });
  const summe = rund(gespeichert.reduce((s, z) => s + Number(z.betrag), 0));
  melde(`${anzahl(gespeichert.length, "Zahlung", "Zahlungen")} übernommen (${euro(summe)}).`, "ok", {
    dauer: 12000,
    aktion: { text: "Rückgängig", beiKlick: () => importZuruecknehmen(importId, gespeichert, ersetzt) },
  });
  return true;
}

async function importZuruecknehmen(importId, gespeichert, ersetzt) {
  try {
    await db.loescheZahlungen(gespeichert.map((z) => z.id));
    if (ersetzt.length) await db.neueZahlungen(ersetzt.map(({ id, ...z }) => ({ ...z, id })));
    await abgleichenViele(gespeichert.map((z) => ({ mieter_id: z.mieter_id, monat: String(z.monat).slice(0, 10) })), { nachLoeschen: true });
    melde("Import zurückgenommen.", "ok");
    await nachherAktuell?.();
  } catch (err) { melde(err.message, "fehler"); }
}

/** Unklare Eingänge (ohne gewählte Mietpartei) von der KI zuordnen lassen; trägt Vorschläge in die Felder ein */
async function kiZuordnen(knopf, form, zeilen) {
  const offen = zeilen.map((z, i) => ({ z, i })).filter(({ i }) => !form[`m_${i}`].value);
  if (!offen.length) return melde("Alle Eingänge haben schon eine Mietpartei.", "info");
  knopf.disabled = true;
  const alt = knopf.innerHTML;
  knopf.textContent = "Die KI ordnet zu …";
  try {
    const r = await db.funktion("miete", {
      aktion: "buchungen_zuordnen", heute: heuteISO(),
      buchungen: offen.slice(0, 60).map(({ z, i }) => ({ nr: i, datum: z.datum, betrag: z.betrag, zahler: L.ohneIban(z.zahler), text: L.ohneIban(z.text) })),
    });
    let n = 0;
    for (const b of r?.buchungen || []) {
      const i = b.nr;
      if (!zeilen[i] || form[`m_${i}`].value) continue;
      const hinweis = $(`[data-i="${i}"] [data-hinweis]`, form);
      if (b.art === "keine_miete") {
        form[`a_${i}`].value = "keine";
        form[`an_${i}`].checked = false;
      } else if (b.mieter_id && form[`m_${i}`].querySelector(`option[value="${CSS.escape(b.mieter_id)}"]`)) {
        form[`m_${i}`].value = b.mieter_id;
        if (b.monat) form[`mo_${i}`].value = b.monat;
        if (ZAHLUNG_ART[b.art]) form[`a_${i}`].value = b.art;
        form[`an_${i}`].checked = true;
        n++;
      }
      if (hinweis && b.grund) hinweis.insertAdjacentHTML("beforeend", `<span class="zi-ki">${ICON_KI} Vorschlag der KI: ${esc(b.grund)}</span>`);
    }
    melde(n ? `Die KI hat ${anzahl(n, "Eingang", "Eingänge")} zugeordnet – bitte prüfen.` : "Die KI konnte keinen weiteren Eingang sicher zuordnen.", n ? "ok" : "info");
  } catch (err) {
    melde(err.message, "fehler");
  } finally {
    knopf.disabled = false;
    knopf.innerHTML = alt;
  }
}

// ---------------------------------------------------------------------------
// immocloud-Mietübersicht (Excel)
// ---------------------------------------------------------------------------
async function excelImport(datei, dateiname) {
  const { excelZellen } = await import("./officetext.js");
  const blaetter = L.immocloudLesen(await excelZellen(datei));
  if (!blaetter.length) {
    melde("In der Excel-Datei ist keine immocloud-Mietübersicht zu erkennen (Blöcke „Wohnung …“ mit der Kopfzeile „Mieter, Kaltmiete, …“).", "fehler");
    return false;
  }
  const { stamm, mieter } = await stammUndMieter();
  const jahr = Number(/(?:^|\D)(20\d{2})(?:\D|$)/.exec(dateiname)?.[1]) || Number(heuteISO().slice(0, 4));
  const zuordnung = L.immocloudZuordnen(blaetter, { objekte: stamm.objekte, wohnungen: stamm.wohnungen, mieter, jahr });
  return excelVorschau({ zuordnung, stamm, mieter, jahr });
}

function phaseHtml(p, k, stamm, mieter) {
  const werte = Object.entries(p.monate).filter(([, w]) => w !== null).map(([mo, w]) => ({ mo: Number(mo), w }));
  const summe = rund(werte.reduce((s, x) => s + x.w, 0));
  const null0 = werte.filter((x) => x.w === 0).length;
  const spanne = werte.length ? `${MONATE[werte[0].mo - 1].slice(0, 3)}–${MONATE[werte[werte.length - 1].mo - 1].slice(0, 3)}` : "";
  return `
    <div class="zi-zeile${p.mieter_id ? "" : " zi-zeile--unklar"}">
      <label class="zi-an"><input type="checkbox" name="an_${k}" ${p.mieter_id && werte.length ? "checked" : ""} aria-label="Übernehmen"></label>
      <div class="zi-buchung">
        <div><b>${esc(p.nachname)}</b>${p.wohnung ? ` <span class="leise">· ${esc(p.wohnung)}</span>` : ""}</div>
        <div class="leise">Soll ${euro(rund(p.kalt + p.nk))} (kalt ${euro(p.kalt)} + NK ${euro(p.nk)})</div>
        <div>${werte.length ? `${werte.length} Monate ${esc(spanne)}: <b>${euro(summe)}</b>${null0 ? ` <span class="zi-chip zi-chip--pruefen">${null0}× 0 €</span>` : ""}` : `<span class="leise">keine Monatsbeträge</span>`}</div>
      </div>
      <div class="zi-felder"><select name="m_${k}" aria-label="Mietpartei">${mieterOptionen(stamm, mieter, p.mieter_id)}</select></div>
    </div>`;
}

async function excelVorschau({ zuordnung, stamm, mieter, jahr }) {
  const alle = zuordnung.flatMap((b, bi) => b.phasen.map((p, pi) => ({ p, k: `${bi}_${pi}` })));
  const daten = await dialogFormular(`
    <h2>immocloud-Mietübersicht – Vorschau</h2>
    <div class="formraster formraster--zwei">
      <label class="feld"><span>Jahr der Übersicht</span><input type="number" name="jahr" min="2000" max="2100" value="${jahr}" required></label>
    </div>
    <label class="checkfeld"><input type="checkbox" name="soll" checked> Fehlende Monatsmiete (Soll) aus der Excel anlegen</label>
    <p class="leise">Übernommen werden die Monatsbeträge je Mietpartei („0“ heißt: fällig, aber nichts gezahlt). Monate, für die es schon Zahlungen
      aus dem Kontoauszug oder von Hand gibt, bleiben unverändert. Ein erneuter Import derselben Übersicht aktualisiert die Beträge.</p>
    ${zuordnung.map((b, bi) => `
      <section class="zi-blatt">
        <h3 class="me-dialog__titel">${esc(stamm.objekte.find((o) => o.id === b.objekt_id)?.bezeichnung || b.objektText || b.blatt)}</h3>
        ${b.warnungen.length ? `<ul class="zi-warnungen">${b.warnungen.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}
        <div class="zi-liste">${b.phasen.map((p, pi) => phaseHtml(p, `${bi}_${pi}`, stamm, mieter)).join("")}</div>
      </section>`).join("")}
    <p class="oz-fehler" data-fehler role="alert" hidden></p>
    <div class="knopfreihe zi-fuss">
      <button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button>
      <button class="knopf knopf--primaer" value="speichern">Übernehmen</button>
    </div>`, {
    breit: true,
    vorbereiten: (form) => {
      for (const { k } of alle) form[`m_${k}`].addEventListener("change", () => { form[`an_${k}`].checked = !!form[`m_${k}`].value; });
      form.addEventListener("submit", (ev) => {
        if (ev.submitter?.value !== "speichern") return;
        const fehlt = alle.some(({ k }) => form[`an_${k}`].checked && !form[`m_${k}`].value);
        const keine = !alle.some(({ k }) => form[`an_${k}`].checked);
        const fehler = keine ? "Bitte mindestens eine Mietpartei auswählen." : fehlt ? "Bei einer ausgewählten Zeile fehlt die Mietpartei." : "";
        const p = $("[data-fehler]", form);
        p.textContent = fehler; p.hidden = !fehler;
        if (fehler) ev.preventDefault();
      });
    },
  });
  if (daten?.get("_aktion") !== "speichern") return false;

  const j = Number(daten.get("jahr"));
  const von = `${j}-01-01`, bis = `${j}-12-01`;
  const [fs, zs] = await Promise.all([db.ladeForderungenZeitraum(von, bis), db.ladeZahlungen({ von, bis })]);
  const andere = new Set(zs.filter((z) => z.art === "miete" && z.quelle !== "excel").map(schluesselVon));
  const mitSoll = new Set(fs.filter((f) => POSTEN.includes(f.art)).map(schluesselVon));
  const monate = new Map(); // mieter|monat → { mieter_id, monat, betrag, kalt, nk }
  let uebersprungen = 0;
  for (const { p, k } of alle) {
    const id = daten.get(`an_${k}`) ? daten.get(`m_${k}`) : "";
    if (!id) continue;
    for (const [mo, w] of Object.entries(p.monate)) {
      if (w === null) continue;
      const monat = `${j}-${String(mo).padStart(2, "0")}-01`;
      const key = `${id}|${monat}`;
      if (andere.has(key)) { uebersprungen++; continue; }
      const x = monate.get(key) || { mieter_id: id, monat, betrag: 0, kalt: 0, nk: 0 };
      x.betrag = rund(x.betrag + w); x.kalt = p.kalt; x.nk = p.nk;
      monate.set(key, x);
    }
  }
  const liste = [...monate.values()];
  const importId = crypto.randomUUID();
  const zahlungen = liste.filter((x) => x.betrag > 0).map((x) => ({
    mieter_id: x.mieter_id, monat: x.monat, datum: null, betrag: x.betrag, art: "miete", quelle: "excel",
    text: "immocloud-Mietübersicht", schluessel: `excel:${x.mieter_id}:${x.monat}`, import_id: importId,
  }));
  const nullMonate = new Set(liste.filter((x) => x.betrag <= 0).map((x) => `${x.mieter_id}|${x.monat}`));
  const veraltet = zs.filter((z) => z.quelle === "excel" && nullMonate.has(schluesselVon(z)));
  await db.neueZahlungen(zahlungen, { ersetzen: true });
  await db.loescheZahlungen(veraltet.map((z) => z.id));
  let sollNeu = 0;
  if (daten.get("soll")) {
    const posten = liste.filter((x) => !mitSoll.has(`${x.mieter_id}|${x.monat}`)).flatMap((x) => [
      x.kalt > 0 ? { mieter_id: x.mieter_id, monat: x.monat, art: "kaltmiete", bezeichnung: "Kaltmiete", betrag: x.kalt } : null,
      x.nk > 0 ? { mieter_id: x.mieter_id, monat: x.monat, art: "nebenkosten", bezeichnung: "Nebenkosten-Vorauszahlung", betrag: x.nk } : null,
    ]).filter(Boolean);
    if (posten.length) { await db.neueForderungen(posten); sollNeu = new Set(posten.map(schluesselVon)).size; }
  }
  await abgleichenViele(liste.map(({ mieter_id, monat }) => ({ mieter_id, monat })), { nachLoeschen: true });
  const mieterAnzahl = new Set(liste.map((x) => x.mieter_id)).size;
  melde(`${zahlungen.length} Monatsbeträge für ${mieterAnzahl} Mietparteien übernommen${sollNeu ? `, Soll für ${sollNeu} Monate angelegt` : ""}`
    + `${uebersprungen ? `; ${anzahl(uebersprungen, "Monat kam", "Monate kamen")} schon aus dem Kontoauszug` : ""}.`, "ok", { dauer: 9000 });
  return true;
}

