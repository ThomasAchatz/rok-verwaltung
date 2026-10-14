// ROK Verwaltung – Oberfläche (ohne Build-Schritt, reines ES-Modul)
import * as db from "./daten.js";
import {
  briefDaten, fuelleVorlage, platzhalterAus, vorlagenFehler,
  euro, datumDE, monatDE, ibanFormat, mieterName,
} from "./dokumente.js";

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const inhalt = $("#inhalt");
const MONATE_KURZ = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const ARTEN = [
  ["kaltmiete", "Kaltmiete"],
  ["nebenkosten", "Nebenkostenvorauszahlung"],
  ["strom", "Strompauschale"],
  ["internet", "Internetpauschale"],
  ["sonstiges", "Sonstiges"],
];
const ART_NAME = Object.fromEntries(ARTEN);
const TYP_NAME = {
  mahnung_1: "1. Mahnung",
  mahnung_2: "2. Mahnung",
  nachweis_jobcenter: "Nachweis an Kostenträger",
  antwort: "Antwortschreiben",
  sonstiges: "Schreiben",
};

const heuteISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const monatISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
function letzteMonate(anzahl) {
  const jetzt = new Date();
  const liste = [];
  for (let i = anzahl - 1; i >= 0; i--) liste.push(monatISO(new Date(jetzt.getFullYear(), jetzt.getMonth() - i, 1)));
  return liste;
}
const monatKurz = (iso) => MONATE_KURZ[Number(iso.slice(5, 7)) - 1];
const zahl = (text) => {
  if (text === "" || text == null) return 0;
  const n = Number(String(text).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};
const zahlFeld = (n) => (Number(n) || 0).toFixed(2).replace(".", ",");

function ibanGueltig(iban) {
  const s = (iban || "").replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  const umgestellt = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rest = 0;
  for (const ziffer of umgestellt) rest = (rest * 10 + Number(ziffer)) % 97;
  return rest === 1;
}

function melde(text, art = "info") {
  const el = document.createElement("div");
  el.className = `meldung meldung--${art}`;
  el.setAttribute("role", art === "fehler" ? "alert" : "status");
  el.textContent = text;
  $("#meldungen").append(el);
  setTimeout(() => el.remove(), art === "fehler" ? 8000 : 4500);
}

function herunterladen(bytes, dateiname, typ = "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
  const url = URL.createObjectURL(new Blob([bytes], { type: typ }));
  const a = Object.assign(document.createElement("a"), { href: url, download: dateiname });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const dateiTeil = (s) =>
  String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");

function monatsspanne(posten) {
  const monate = [...new Set(posten.map((f) => String(f.monat).slice(0, 7)))].sort();
  if (!monate.length) return "";
  const fmt = (ym) => `${MONATE_KURZ[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
  if (monate.length === 1) return fmt(monate[0]);
  const [a, b] = [monate[0], monate[monate.length - 1]];
  return a.slice(0, 4) === b.slice(0, 4)
    ? `${MONATE_KURZ[Number(a.slice(5, 7)) - 1]}–${fmt(b)}`
    : `${fmt(a)} – ${fmt(b)}`;
}

// Dialog mit Formular; liefert die Formulardaten oder null bei Abbruch
function dialogFormular(html, beiAnzeige) {
  const dlg = $("#dialog");
  dlg.innerHTML = `<form method="dialog">${html}</form>`;
  const form = $("form", dlg);
  beiAnzeige?.(form);
  dlg.showModal();
  $("input:not([type=hidden]), select", form)?.focus();
  return new Promise((fertig) => {
    form.addEventListener("submit", (e) => {
      if (e.submitter?.value === "abbrechen") return fertig(null);
      if (!form.reportValidity()) { e.preventDefault(); return; }
      fertig(new FormData(form));
    });
    dlg.addEventListener("close", () => fertig(null), { once: true });
  });
}

// ---------------------------------------------------------------------------
// Zustand
// ---------------------------------------------------------------------------
const zustand = {
  nutzer: null,
  profil: null,
  stamm: null,      // { objekte, wohnungen, kostentraeger }
  vorlagen: null,
  akte: null,       // geöffneter Mieter
};

async function ladeGrunddaten() {
  const [profil, stamm, vorlagen] = await Promise.all([db.ladeProfil(), db.ladeStammdaten(), db.ladeVorlagen()]);
  Object.assign(zustand, { profil, stamm, vorlagen });
}
const wohnungVon = (id) => zustand.stamm.wohnungen.find((w) => w.id === id) || null;
const objektVon = (id) => zustand.stamm.objekte.find((o) => o.id === id) || null;
const kostentraegerVon = (id) => zustand.stamm.kostentraeger.find((k) => k.id === id) || null;

// ---------------------------------------------------------------------------
// Anmeldung
// ---------------------------------------------------------------------------
function zeigeBereich(id) {
  for (const b of ["anmeldung", "keinzugriff", "app"]) $("#" + b).hidden = b !== id;
}

$("#anmeldeformular").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const fehler = $("#anmeldefehler");
  fehler.hidden = true;
  const knopf = $("button[type=submit]", form);
  knopf.disabled = true;
  knopf.textContent = "Anmelden …";
  try {
    const nutzer = await db.anmelden(form.email.value.trim(), form.passwort.value);
    form.reset();
    await betreten(nutzer);
  } catch (err) {
    fehler.textContent = /invalid login/i.test(err.message)
      ? "E-Mail oder Passwort stimmen nicht."
      : "Anmeldung fehlgeschlagen: " + err.message;
    fehler.hidden = false;
  } finally {
    knopf.disabled = false;
    knopf.textContent = "Anmelden";
  }
});

document.addEventListener("click", async (e) => {
  if (e.target.closest("[data-aktion=abmelden]")) {
    await db.abmelden();
    zeigeBereich("anmeldung");
  }
});

async function betreten(nutzer) {
  zustand.nutzer = nutzer;
  if (!(await db.istMitglied(nutzer.id))) {
    zeigeBereich("keinzugriff");
    return;
  }
  $("#nutzer-email").textContent = nutzer.email;
  zeigeBereich("app");
  inhalt.innerHTML = `<div class="laden">Daten werden geladen …</div>`;
  await ladeGrunddaten();
  await route();
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------
window.addEventListener("hashchange", () => route());

async function route() {
  if ($("#app").hidden) return;
  const [, teil = "uebersicht", id] = (location.hash || "#/uebersicht").split("/");
  for (const a of $$("[data-nav]")) {
    if (a.dataset.nav === teil) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  try {
    if (teil === "mieter" && id) await zeigeAkte(id);
    else if (teil === "mieter") await zeigeMieterliste();
    else if (teil === "vorlagen") await zeigeVorlagen();
    else if (teil === "briefkopf") await zeigeBriefkopf();
    else await zeigeUebersicht();
  } catch (err) {
    console.error(err);
    inhalt.innerHTML = `<div class="flaeche leer"><h2>Das hat nicht geklappt</h2><p>${esc(err.message)}</p>
      <button class="knopf" onclick="location.reload()">Seite neu laden</button></div>`;
  }
}

// ---------------------------------------------------------------------------
// Mietbuch-Leiste (Zahlungsstatus je Monat)
// ---------------------------------------------------------------------------
function mietbuch(forderungen, monate) {
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
const LEGENDE = `<div class="mietbuch-legende">
  <span><i style="background:var(--bezahlt-zart);border:1px solid #bcd8c6"></i>bezahlt</span>
  <span><i style="background:var(--teil-zart);border:1px solid #ecd09a"></i>teilweise offen</span>
  <span><i style="background:var(--offen)"></i>offen</span>
  <span><i style="border:1px dashed #cfd5de"></i>nichts erfasst</span>
</div>`;

function naechsterSchritt(m, vorgaenge) {
  const eigene = vorgaenge.filter((v) => v.mieter_id === m.id);
  const hat = (typ) => eigene.some((v) => v.typ === typ);
  const schritte = [];
  if (hat("mahnung_2")) schritte.push("Weitere Schritte prüfen");
  else if (hat("mahnung_1")) schritte.push("2. Mahnung");
  else schritte.push("1. Mahnung");
  if (m.kostentraeger && !hat("nachweis_jobcenter")) schritte.push("Nachweis an Kostenträger");
  return schritte.join(", ");
}

// ---------------------------------------------------------------------------
// Übersicht
// ---------------------------------------------------------------------------
async function zeigeUebersicht() {
  const monate = letzteMonate(4);
  const [liste, forderungen, vorgaenge] = await Promise.all([
    db.ladeUebersicht(),
    db.ladeForderungen({ abMonat: monate[0] }),
    db.ladeVorgaenge({ anzahl: 200 }),
  ]);
  const imRueckstand = liste.filter((m) => Number(m.offen_summe) > 0).sort((a, b) => b.offen_summe - a.offen_summe);
  const gesamt = imRueckstand.reduce((s, m) => s + Number(m.offen_summe), 0);
  const mitKT = imRueckstand.filter((m) => m.kostentraeger).length;
  const namen = Object.fromEntries(liste.map((m) => [m.id, m]));

  inhalt.innerHTML = `
    <div class="kopf">
      <div><h1>Übersicht</h1><p>${esc(zustand.profil?.firma || "")}, Stand ${datumDE(new Date())}</p></div>
    </div>
    <div class="lage">
      <div>
        <div class="lage__wert ${gesamt > 0 ? "lage__wert--offen" : ""}">${euro(gesamt)}</div>
        <div class="lage__text">offen über alle Mietverhältnisse</div>
      </div>
      <div>
        <div class="lage__wert">${imRueckstand.length} <span class="leise">von ${liste.length}</span></div>
        <div class="lage__text">Mietparteien im Rückstand</div>
      </div>
      <div>
        <div class="lage__wert">${mitKT}</div>
        <div class="lage__text">davon mit Kostenträger (Jobcenter, Sozialamt)</div>
      </div>
    </div>

    <div class="stapel">
      <section class="flaeche">
        <div class="flaeche__kopf"><h2>Handlungsbedarf</h2>${LEGENDE}</div>
        ${imRueckstand.length ? `
        <table class="tabelle">
          <thead><tr><th>Mietpartei</th><th>Letzte 4 Monate</th><th class="betrag">Offen</th><th class="nur-breit">Nächster Schritt</th></tr></thead>
          <tbody>
            ${imRueckstand.map((m) => `
              <tr class="klickbar" data-mieter="${esc(m.id)}">
                <td><a class="name" href="#/mieter/${esc(m.id)}">${esc(mieterName(m))}</a>
                  <div class="leise">${esc(m.objekt || "")}, ${esc(m.wohnung || "")}</div></td>
                <td>${mietbuch(forderungen.filter((f) => f.mieter_id === m.id), monate)}</td>
                <td class="betrag betrag--offen">${euro(m.offen_summe)}</td>
                <td class="nur-breit">${esc(naechsterSchritt(m, vorgaenge))}</td>
              </tr>`).join("")}
          </tbody>
        </table>` : `<div class="leer">Alle Mieten sind bezahlt. Nichts zu tun.</div>`}
      </section>

      <section class="flaeche">
        <div class="flaeche__kopf"><h2>Zuletzt erstellte Schreiben</h2></div>
        ${vorgaenge.length ? `<ul class="verlauf">
          ${vorgaenge.slice(0, 8).map((v) => `
            <li><strong>${esc(v.titel)}</strong> an
              <a href="#/mieter/${esc(v.mieter_id)}">${esc(mieterName(namen[v.mieter_id] || { nachname: "?" }))}</a>
              ${v.summe != null ? `über ${euro(v.summe)}` : ""}
              <div class="wann">${datumDE(v.erstellt_am)}</div></li>`).join("")}
        </ul>` : `<div class="leer">Noch keine Schreiben erstellt.</div>`}
      </section>
    </div>`;
  verknuepfeZeilen();
}

function verknuepfeZeilen() {
  for (const tr of $$("tr[data-mieter]", inhalt)) {
    tr.addEventListener("click", (e) => {
      if (e.target.closest("a, button, input")) return;
      location.hash = `#/mieter/${tr.dataset.mieter}`;
    });
  }
}

// ---------------------------------------------------------------------------
// Mieterliste
// ---------------------------------------------------------------------------
async function zeigeMieterliste() {
  const monate = letzteMonate(6);
  const [liste, forderungen] = await Promise.all([db.ladeUebersicht(), db.ladeForderungen({ abMonat: monate[0] })]);
  const gruppen = new Map();
  for (const m of liste) {
    const k = m.objekt || "Ohne Objekt";
    if (!gruppen.has(k)) gruppen.set(k, []);
    gruppen.get(k).push(m);
  }

  inhalt.innerHTML = `
    <div class="kopf">
      <div><h1>Mieter</h1><p>${liste.length} Mietparteien in ${gruppen.size} Objekten</p></div>
      <label class="feld" style="margin:0;min-width:240px"><span>Suchen</span>
        <input type="search" id="suche" placeholder="Name, Wohnung oder Aktenzeichen"></label>
    </div>
    <section class="flaeche">
      <div class="flaeche__kopf"><h2>Mietbuch der letzten 6 Monate</h2>${LEGENDE}</div>
      <table class="tabelle" id="mieterliste">
        <thead><tr><th>Mietpartei</th><th class="nur-breit">Wohnung</th><th>Zahlungen</th><th class="betrag nur-breit">Monatlich</th><th class="betrag">Offen</th></tr></thead>
        <tbody>
          ${[...gruppen.entries()].map(([objekt, mieter]) => `
            <tr class="gruppe"><td colspan="5">${esc(objekt)}</td></tr>
            ${mieter.map((m) => `
              <tr class="klickbar" data-mieter="${esc(m.id)}"
                  data-suche="${esc([mieterName(m), m.wohnung, m.objekt, m.aktenzeichen, m.kostentraeger].join(" ").toLowerCase())}">
                <td><a class="name" href="#/mieter/${esc(m.id)}">${esc(mieterName(m))}</a>
                  ${m.kostentraeger ? `<div><span class="marker marker--messing">${esc(m.kostentraeger)}</span></div>` : ""}</td>
                <td class="nur-breit">${esc(m.wohnung || "")}</td>
                <td>${mietbuch(forderungen.filter((f) => f.mieter_id === m.id), monate)}</td>
                <td class="betrag nur-breit">${euro(m.monatlich_gesamt)}</td>
                <td class="betrag ${Number(m.offen_summe) > 0 ? "betrag--offen" : "betrag--null"}">${euro(m.offen_summe)}</td>
              </tr>`).join("")}`).join("")}
        </tbody>
      </table>
    </section>`;
  verknuepfeZeilen();
  $("#suche").addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    for (const tr of $$("#mieterliste tr[data-suche]")) tr.hidden = q && !tr.dataset.suche.includes(q);
    for (const g of $$("#mieterliste tr.gruppe")) {
      let n = g.nextElementSibling, sichtbar = false;
      while (n && !n.classList.contains("gruppe")) { if (!n.hidden) sichtbar = true; n = n.nextElementSibling; }
      g.hidden = !sichtbar;
    }
  });
}

// ---------------------------------------------------------------------------
// Mieter-Akte
// ---------------------------------------------------------------------------
async function zeigeAkte(id) {
  const [mieter, forderungen, vorgaenge] = await Promise.all([
    db.ladeMieter(id),
    db.ladeForderungen({ mieterId: id }),
    db.ladeVorgaenge({ mieterId: id }),
  ]);
  const wohnung = wohnungVon(mieter.wohnung_id);
  const objekt = wohnung ? objektVon(wohnung.objekt_id) : null;
  const kostentraeger = kostentraegerVon(mieter.kostentraeger_id);
  const reihenfolge = ARTEN.map(([k]) => k);
  forderungen.sort((x, y) =>
    String(x.monat).localeCompare(String(y.monat)) || reihenfolge.indexOf(x.art) - reihenfolge.indexOf(y.art));
  const offen = forderungen.filter((f) => !f.bezahlt);
  const bezahlt = forderungen.filter((f) => f.bezahlt).sort((a, b) => String(b.monat).localeCompare(String(a.monat)));
  const vorherigeAuswahl = zustand.akte?.mieter.id === id ? zustand.akte.auswahl : null;
  const auswahl = new Set(offen.filter((f) => !vorherigeAuswahl || vorherigeAuswahl.has(f.id) || !zustand.akte.offenIds.has(f.id)).map((f) => f.id));
  zustand.akte = { mieter, forderungen, vorgaenge, wohnung, objekt, kostentraeger, auswahl, offenIds: new Set(offen.map((f) => f.id)) };
  const monatlich = Number(mieter.kaltmiete) + Number(mieter.nebenkosten_vz) + Number(mieter.strom_pauschale) + Number(mieter.internet_pauschale);
  const summeOffen = offen.reduce((s, f) => s + Number(f.betrag), 0);
  const hatMahnung1 = vorgaenge.some((v) => v.typ === "mahnung_1");

  inhalt.innerHTML = `
    <a class="zurueck" href="#/mieter">Zurück zur Mieterliste</a>
    <div class="akte__kopf">
      <h1>${esc(mieterName(mieter))}</h1>
      <div class="unter">
        <span>${esc(objekt?.bezeichnung || "Keine Wohnung zugeordnet")}${wohnung ? ", " + esc(wohnung.bezeichnung) : ""}</span>
        ${kostentraeger ? `<span class="marker marker--messing">${esc(kostentraeger.name)}${mieter.aktenzeichen ? ": " + esc(mieter.aktenzeichen) : ""}</span>` : ""}
        ${mieter.direktzahlung ? `<span class="marker">Direktzahlung Unterkunftskosten</span>` : ""}
        ${summeOffen > 0 ? `<span class="marker marker--offen">${euro(summeOffen)} offen</span>` : `<span class="marker marker--ok">Keine offenen Posten</span>`}
      </div>
    </div>

    <div class="briefe" role="group" aria-label="Brief erstellen">
      <span class="briefe__titel">Brief erstellen</span>
      <button class="knopf" data-brief="mahnung_1">1. Mahnung</button>
      <button class="knopf" data-brief="mahnung_2" ${hatMahnung1 ? "" : `title="Noch keine 1. Mahnung im Verlauf"`}>2. Mahnung</button>
      <button class="knopf" data-brief="nachweis_jobcenter" ${kostentraeger ? "" : `disabled title="Kein Kostenträger hinterlegt"`}>Nachweis an Kostenträger</button>
      <button class="knopf" disabled title="Folgt in der nächsten Ausbaustufe">Antwort mit KI-Entwurf</button>
      <span class="briefe__hinweis" id="briefhinweis"></span>
    </div>

    <div class="akte">
      <div class="stapel">
        <section class="flaeche">
          <div class="flaeche__kopf"><h2>Offene Posten</h2>
            <span class="leise">Ausgewählte Posten kommen in den Brief.</span></div>
          ${offen.length ? `
          <table class="tabelle postentabelle">
            <thead><tr>
              <th class="eng"><input type="checkbox" id="alle" aria-label="Alle auswählen"></th>
              <th>Monat</th><th>Position</th><th class="betrag">Betrag</th><th class="eng"></th></tr></thead>
            <tbody>
              ${offen.map((f) => `
                <tr>
                  <td><input type="checkbox" data-posten="${esc(f.id)}" ${auswahl.has(f.id) ? "checked" : ""} aria-label="Auswählen"></td>
                  <td>${esc(monatDE(f.monat))}</td>
                  <td>${esc(f.bezeichnung || ART_NAME[f.art] || f.art)}</td>
                  <td class="betrag">${euro(f.betrag)}</td>
                  <td><button class="knopf knopf--klein" data-bezahlt="${esc(f.id)}">Bezahlt</button></td>
                </tr>`).join("")}
            </tbody>
            <tfoot><tr><td></td><td colspan="2">Ausgewählt</td><td class="betrag" id="auswahlsumme"></td><td></td></tr></tfoot>
          </table>` : `<div class="leer">Keine offenen Posten. Neue Forderungen legen Sie über „Monatsmiete anlegen“ an.</div>`}
          <div class="flaeche__fuss knopfreihe">
            ${offen.length ? `<button class="knopf knopf--klein" id="auswahl-bezahlt">Ausgewählte als bezahlt markieren</button>` : ""}
            <button class="knopf knopf--klein" id="monat-anlegen">Monatsmiete anlegen</button>
            <button class="knopf knopf--klein" id="posten-neu">Einzelnen Posten hinzufügen</button>
          </div>
        </section>

        <details class="flaeche ausklapp">
          <summary>Bezahlte Posten (${bezahlt.length})</summary>
          ${bezahlt.length ? `<table class="tabelle"><tbody>
            ${bezahlt.slice(0, 36).map((f) => `
              <tr><td>${esc(monatDE(f.monat))}</td><td>${esc(f.bezeichnung || ART_NAME[f.art])}</td>
                <td class="betrag">${euro(f.betrag)}</td><td class="leise">${f.bezahlt_am ? "am " + datumDE(f.bezahlt_am) : ""}</td>
                <td class="eng"><button class="knopf knopf--klein knopf--leise" data-wiederoffen="${esc(f.id)}">Wieder öffnen</button></td></tr>`).join("")}
          </tbody></table>` : `<div class="leer">Noch nichts bezahlt.</div>`}
        </details>

        <details class="flaeche ausklapp" id="stammdaten">
          <summary>Stammdaten bearbeiten</summary>
          <form class="flaeche__inhalt" id="stammformular">${stammdatenFormular(mieter)}</form>
        </details>
      </div>

      <div class="stapel">
        <section class="flaeche">
          <div class="flaeche__kopf"><h2>Mietkonto</h2></div>
          <div class="flaeche__inhalt">
            <dl class="datenliste">
              <dt>IBAN</dt><dd class="iban">${esc(ibanFormat(mieter.mietkonto_iban)) || "–"}</dd>
              <dt>Inhaber</dt><dd>${esc(mieter.mietkonto_inhaber || "–")}</dd>
              <dt>Bank</dt><dd>${esc([mieter.mietkonto_bank, mieter.mietkonto_bic].filter(Boolean).join(", ") || "–")}</dd>
              <dt>Monatlich</dt><dd>${euro(monatlich)}</dd>
              <dt>Mietbeginn</dt><dd>${datumDE(mieter.mietbeginn) || "–"}</dd>
            </dl>
          </div>
        </section>
        ${kostentraeger ? `
        <section class="flaeche">
          <div class="flaeche__kopf"><h2>Kostenträger</h2></div>
          <div class="flaeche__inhalt">
            <dl class="datenliste">
              <dt>Stelle</dt><dd>${esc(kostentraeger.name)}</dd>
              ${kostentraeger.abteilung ? `<dt>Abteilung</dt><dd>${esc(kostentraeger.abteilung)}</dd>` : ""}
              <dt>Anschrift</dt><dd>${esc([kostentraeger.strasse, [kostentraeger.plz, kostentraeger.ort].filter(Boolean).join(" ")].filter(Boolean).join(", "))}</dd>
              <dt>Aktenzeichen</dt><dd>${esc(mieter.aktenzeichen || "–")}</dd>
              <dt>Direktzahlung</dt><dd>${mieter.direktzahlung ? "ja" : "nein"}</dd>
            </dl>
          </div>
        </section>` : ""}
        <section class="flaeche">
          <div class="flaeche__kopf"><h2>Zahlungen</h2></div>
          <div class="flaeche__inhalt">${mietbuch(forderungen, letzteMonate(6))}</div>
        </section>
        <section class="flaeche">
          <div class="flaeche__kopf"><h2>Verlauf</h2></div>
          ${vorgaenge.length ? `<ul class="verlauf">
            ${vorgaenge.map((v) => `<li><strong>${esc(v.titel)}</strong>${v.summe != null ? `, ${euro(v.summe)}` : ""}
              <div class="wann">${datumDE(v.erstellt_am)}${v.details?.hinweis ? " (" + esc(v.details.hinweis) + ")" : ""}</div></li>`).join("")}
          </ul>` : `<div class="leer">Noch keine Schreiben.</div>`}
        </section>
      </div>
    </div>`;

  aktualisiereAuswahl();
  $("#alle")?.addEventListener("change", (e) => {
    for (const cb of $$("[data-posten]")) cb.checked = e.target.checked;
    aktualisiereAuswahl();
  });
  for (const cb of $$("[data-posten]")) cb.addEventListener("change", aktualisiereAuswahl);
  for (const b of $$("[data-brief]")) b.addEventListener("click", () => erstelleBrief(b.dataset.brief, b));
  for (const b of $$("[data-bezahlt]")) b.addEventListener("click", () => markiere([b.dataset.bezahlt], true));
  for (const b of $$("[data-wiederoffen]")) b.addEventListener("click", () => markiere([b.dataset.wiederoffen], false));
  $("#auswahl-bezahlt")?.addEventListener("click", () => {
    const ids = [...zustand.akte.auswahl];
    if (!ids.length) return melde("Keine Posten ausgewählt.", "fehler");
    markiere(ids, true);
  });
  $("#monat-anlegen").addEventListener("click", monatAnlegen);
  $("#posten-neu").addEventListener("click", postenHinzufuegen);
  verknuepfeStammdaten();
}

function aktualisiereAuswahl() {
  const a = zustand.akte;
  a.auswahl = new Set($$("[data-posten]").filter((cb) => cb.checked).map((cb) => cb.dataset.posten));
  const ausgewaehlt = a.forderungen.filter((f) => a.auswahl.has(f.id));
  const summe = ausgewaehlt.reduce((s, f) => s + Number(f.betrag), 0);
  if ($("#auswahlsumme")) $("#auswahlsumme").textContent = euro(summe);
  const alle = $("#alle");
  if (alle) {
    const n = $$("[data-posten]").length;
    alle.checked = a.auswahl.size === n && n > 0;
    alle.indeterminate = a.auswahl.size > 0 && a.auswahl.size < n;
  }
  $("#briefhinweis").textContent = ausgewaehlt.length
    ? `Der Brief enthält ${ausgewaehlt.length} Posten (${monatsspanne(ausgewaehlt)}) über ${euro(summe)}. Er wird als Word-Datei heruntergeladen und im Verlauf vermerkt.`
    : "Wählen Sie unten mindestens einen offenen Posten für den Brief aus.";
}

async function erstelleBrief(typ, knopf) {
  const a = zustand.akte;
  const posten = a.forderungen.filter((f) => a.auswahl.has(f.id));
  if (!posten.length) return melde("Bitte mindestens einen offenen Posten auswählen.", "fehler");
  if (typ === "nachweis_jobcenter" && !a.kostentraeger) return melde("Für diesen Mieter ist kein Kostenträger hinterlegt.", "fehler");
  if (!a.mieter.mietkonto_iban) return melde("Für diesen Mieter ist kein Mietkonto (IBAN) hinterlegt.", "fehler");
  const vorlage = zustand.vorlagen.find((v) => v.schluessel === typ);
  if (!vorlage) return melde("Vorlage nicht gefunden: " + typ, "fehler");

  const text = knopf.textContent;
  knopf.disabled = true;
  knopf.textContent = "Wird erstellt …";
  try {
    const datei = await db.ladeVorlagenDatei(vorlage);
    const daten = briefDaten(typ, {
      profil: zustand.profil, mieter: a.mieter, wohnung: a.wohnung || {}, objekt: a.objekt || {},
      kostentraeger: a.kostentraeger, posten, vorgaenge: a.vorgaenge,
    });
    let bytes;
    try {
      bytes = fuelleVorlage(datei, daten);
    } catch (err) {
      throw new Error("Die Vorlage enthält einen Fehler: " + vorlagenFehler(err));
    }
    const name = `${heuteISO()}_${dateiTeil(TYP_NAME[typ])}_${dateiTeil(a.mieter.nachname)}.docx`;
    herunterladen(bytes, name);
    const titel = typ === "nachweis_jobcenter"
      ? `Nachweis an ${a.kostentraeger.name} (${monatsspanne(posten)})`
      : `${TYP_NAME[typ]} (${monatsspanne(posten)})`;
    await db.protokolliereVorgang({
      mieter_id: a.mieter.id, typ, titel, summe: daten.summe_zahl,
      details: { posten: posten.map((f) => f.id), vorlage: vorlage.storage_pfad ? "eigene" : "standard", datei: name },
    });
    melde(`${TYP_NAME[typ]} erstellt: ${name}`, "ok");
    await zeigeAkte(a.mieter.id);
  } catch (err) {
    console.error(err);
    melde(err.message, "fehler");
    knopf.disabled = false;
    knopf.textContent = text;
  }
}

async function markiere(ids, bezahlt) {
  try {
    await db.setzeBezahlt(ids, bezahlt, heuteISO());
    melde(bezahlt ? `${ids.length} Posten als bezahlt markiert.` : "Posten wieder geöffnet.", "ok");
    await zeigeAkte(zustand.akte.mieter.id);
  } catch (err) {
    melde(err.message, "fehler");
  }
}

async function monatAnlegen() {
  const m = zustand.akte.mieter;
  const teile = [
    ["kaltmiete", m.kaltmiete], ["nebenkosten", m.nebenkosten_vz],
    ["strom", m.strom_pauschale], ["internet", m.internet_pauschale],
  ].filter(([, b]) => Number(b) > 0);
  if (!teile.length) return melde("Für diesen Mieter ist keine Miete hinterlegt (Stammdaten).", "fehler");
  const vorhanden = new Set(zustand.akte.forderungen.map((f) => String(f.monat).slice(0, 7)));
  const vorschlag = new Date();
  while (vorhanden.has(monatISO(vorschlag).slice(0, 7))) vorschlag.setMonth(vorschlag.getMonth() + 1);

  const daten = await dialogFormular(`
    <h2>Monatsmiete anlegen</h2>
    <p class="leise">Legt die vereinbarten Bestandteile als offene Posten an.</p>
    <label class="feld"><span>Monat</span><input type="month" name="monat" required value="${monatISO(vorschlag).slice(0, 7)}"></label>
    <table class="tabelle" style="margin-bottom:1rem"><tbody>
      ${teile.map(([art, b]) => `<tr><td>${esc(ART_NAME[art])}</td><td class="betrag">${euro(b)}</td></tr>`).join("")}
    </tbody></table>
    <div class="knopfreihe">
      <button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button>
      <button class="knopf knopf--primaer" value="ok">Anlegen</button>
    </div>`);
  if (!daten) return;
  const monat = daten.get("monat") + "-01";
  const schonDa = new Set(zustand.akte.forderungen.filter((f) => String(f.monat).slice(0, 10) === monat).map((f) => f.art));
  const neu = teile.filter(([art]) => !schonDa.has(art)).map(([art, betrag]) => ({
    mieter_id: m.id, monat, art, bezeichnung: ART_NAME[art], betrag,
  }));
  if (!neu.length) return melde(`Für ${monatDE(monat)} sind bereits alle Bestandteile angelegt.`, "fehler");
  try {
    await db.neueForderungen(neu);
    melde(`${monatDE(monat)}: ${neu.length} Posten angelegt.`, "ok");
    await zeigeAkte(m.id);
  } catch (err) {
    melde(err.message, "fehler");
  }
}

async function postenHinzufuegen() {
  const daten = await dialogFormular(`
    <h2>Posten hinzufügen</h2>
    <div class="formraster">
      <label class="feld"><span>Monat</span><input type="month" name="monat" required value="${monatISO(new Date()).slice(0, 7)}"></label>
      <label class="feld"><span>Art</span><select name="art">${ARTEN.map(([k, n]) => `<option value="${k}">${esc(n)}</option>`).join("")}</select></label>
      <label class="feld breit"><span>Bezeichnung (optional)</span><input name="bezeichnung" placeholder="z. B. Nachzahlung Betriebskosten 2025"></label>
      <label class="feld"><span>Betrag in €</span><input name="betrag" inputmode="decimal" required pattern="[0-9]+([.,][0-9]{1,2})?" placeholder="0,00"></label>
    </div>
    <div class="knopfreihe">
      <button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button>
      <button class="knopf knopf--primaer" value="ok">Hinzufügen</button>
    </div>`);
  if (!daten) return;
  const betrag = zahl(daten.get("betrag"));
  if (!(betrag > 0)) return melde("Bitte einen gültigen Betrag eingeben.", "fehler");
  try {
    await db.neueForderungen([{
      mieter_id: zustand.akte.mieter.id,
      monat: daten.get("monat") + "-01",
      art: daten.get("art"),
      bezeichnung: daten.get("bezeichnung").trim() || ART_NAME[daten.get("art")],
      betrag,
    }]);
    melde("Posten hinzugefügt.", "ok");
    await zeigeAkte(zustand.akte.mieter.id);
  } catch (err) {
    melde(err.message, "fehler");
  }
}

// --- Stammdaten -------------------------------------------------------------
function stammdatenFormular(m) {
  const wohnungen = zustand.stamm.wohnungen
    .map((w) => ({ ...w, objekt: objektVon(w.objekt_id)?.bezeichnung || "" }))
    .sort((a, b) => (a.objekt + a.bezeichnung).localeCompare(b.objekt + b.bezeichnung));
  const f = (name, label, wert, attrs = "") =>
    `<label class="feld"><span>${label}</span><input name="${name}" value="${esc(wert ?? "")}" ${attrs}></label>`;
  const geld = (name, label) => f(name, label, zahlFeld(m[name]), `inputmode="decimal" pattern="[0-9]+([.,][0-9]{1,2})?"`);
  return `
    <div class="formgruppe"><h3>Person</h3><div class="formraster">
      <label class="feld"><span>Anrede</span><select name="anrede">
        ${["Herr", "Frau", "Divers", "Firma"].map((a) => `<option ${a === m.anrede ? "selected" : ""}>${a}</option>`).join("")}</select></label>
      ${f("vorname", "Vorname", m.vorname)}
      ${f("nachname", "Nachname", m.nachname, "required")}
      ${f("email", "E-Mail", m.email, `type="email"`)}
      ${f("telefon", "Telefon", m.telefon)}
    </div></div>
    <div class="formgruppe"><h3>Mietverhältnis</h3><div class="formraster">
      <label class="feld breit"><span>Wohnung</span><select name="wohnung_id">
        <option value="">Keine</option>
        ${wohnungen.map((w) => `<option value="${esc(w.id)}" ${w.id === m.wohnung_id ? "selected" : ""}>${esc(w.objekt)}, ${esc(w.bezeichnung)}</option>`).join("")}
      </select></label>
      ${f("mietbeginn", "Mietbeginn", m.mietbeginn, `type="date"`)}
      ${f("mietende", "Mietende", m.mietende, `type="date"`)}
      ${geld("kaltmiete", "Kaltmiete €")}
      ${geld("nebenkosten_vz", "Nebenkosten-VZ €")}
      ${geld("strom_pauschale", "Strompauschale €")}
      ${geld("internet_pauschale", "Internetpauschale €")}
    </div></div>
    <div class="formgruppe"><h3>Mietkonto</h3><div class="formraster">
      <label class="feld breit" id="ibanfeld"><span>IBAN</span>
        <input name="mietkonto_iban" value="${esc(ibanFormat(m.mietkonto_iban))}" autocomplete="off" spellcheck="false">
        <span class="feldhinweis" id="ibanhinweis" hidden>Die Prüfziffer dieser IBAN stimmt nicht.</span></label>
      ${f("mietkonto_inhaber", "Kontoinhaber", m.mietkonto_inhaber)}
      ${f("mietkonto_bank", "Bank", m.mietkonto_bank)}
      ${f("mietkonto_bic", "BIC", m.mietkonto_bic)}
    </div></div>
    <div class="formgruppe"><h3>Kostenträger</h3><div class="formraster">
      <label class="feld"><span>Stelle</span><select name="kostentraeger_id">
        <option value="">Keiner (Selbstzahler)</option>
        ${zustand.stamm.kostentraeger.map((k) => `<option value="${esc(k.id)}" ${k.id === m.kostentraeger_id ? "selected" : ""}>${esc(k.name)}</option>`).join("")}
      </select></label>
      ${f("aktenzeichen", "Aktenzeichen / BG-Nummer", m.aktenzeichen)}
    </div>
    <label class="checkfeld"><input type="checkbox" name="direktzahlung" ${m.direktzahlung ? "checked" : ""}> Unterkunftskosten werden direkt an uns gezahlt</label>
    </div>
    <label class="feld"><span>Notiz (intern)</span><textarea name="notiz" rows="3">${esc(m.notiz || "")}</textarea></label>
    <div class="knopfreihe"><button class="knopf knopf--primaer" type="submit">Stammdaten speichern</button></div>`;
}

function verknuepfeStammdaten() {
  const form = $("#stammformular");
  const ibanInput = form.mietkonto_iban;
  const pruefeIban = () => {
    const wert = ibanInput.value.trim();
    const ok = !wert || ibanGueltig(wert);
    $("#ibanhinweis").hidden = ok;
    $("#ibanfeld").classList.toggle("feld--warnung", !ok);
    return ok;
  };
  ibanInput.addEventListener("input", pruefeIban);
  pruefeIban();
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!pruefeIban() && !confirm("Die IBAN scheint fehlerhaft zu sein. Trotzdem speichern?")) return;
    const fd = new FormData(form);
    const felder = {};
    for (const k of ["anrede", "vorname", "nachname", "email", "telefon", "mietkonto_inhaber", "mietkonto_bank", "mietkonto_bic", "aktenzeichen", "notiz"]) {
      felder[k] = (fd.get(k) || "").trim() || null;
    }
    felder.nachname = felder.nachname || zustand.akte.mieter.nachname;
    felder.anrede = felder.anrede || "Herr";
    felder.wohnung_id = fd.get("wohnung_id") || null;
    felder.kostentraeger_id = fd.get("kostentraeger_id") || null;
    felder.mietbeginn = fd.get("mietbeginn") || null;
    felder.mietende = fd.get("mietende") || null;
    felder.direktzahlung = fd.get("direktzahlung") === "on";
    felder.mietkonto_iban = (fd.get("mietkonto_iban") || "").replace(/\s+/g, "").toUpperCase() || null;
    for (const k of ["kaltmiete", "nebenkosten_vz", "strom_pauschale", "internet_pauschale"]) {
      const n = zahl(fd.get(k));
      if (!Number.isFinite(n) || n < 0) return melde("Bitte gültige Beträge eingeben.", "fehler");
      felder[k] = n;
    }
    try {
      await db.speichereMieter(zustand.akte.mieter.id, felder);
      melde("Stammdaten gespeichert.", "ok");
      await zeigeAkte(zustand.akte.mieter.id);
    } catch (err) {
      melde(err.message, "fehler");
    }
  });
}

// ---------------------------------------------------------------------------
// Vorlagen
// ---------------------------------------------------------------------------
const PLATZHALTER = [
  ["v_firma, v_inhaber, v_strasse, v_plz, v_ort, v_telefon, v_email, v_web", "Briefkopf (Seite „Briefkopf“)"],
  ["datum", "Heutiges Datum"],
  ["frist", "Zahlungsfrist (1. Mahnung +14 Tage, 2. Mahnung +7 Tage)"],
  ["empf_name, empf_zusatz, empf_strasse, empf_plz_ort", "Empfänger (Mieter bzw. Kostenträger)"],
  ["briefanrede", "z. B. „Sehr geehrter Herr Bauer“"],
  ["mieter_name, mieter_vorname, mieter_nachname", "Mietpartei"],
  ["objekt, objekt_adresse, objekt_strasse, wohnung, mietbeginn", "Mietobjekt"],
  ["kostentraeger_name, aktenzeichen", "Kostenträger und Aktenzeichen"],
  ["konto_inhaber, konto_iban, konto_bic, konto_bank, verwendungszweck", "Mietkonto dieses Mieters"],
  ["#posten … monat, bezeichnung, betrag … /posten", "Tabellenzeile, die für jeden Posten wiederholt wird"],
  ["summe", "Summe der ausgewählten Posten"],
  ["letzte_mahnung_datum, mahnung_datum", "Datum der letzten 1. Mahnung bzw. letzten Mahnung"],
  ["#feld … /feld", "Text erscheint nur, wenn das Feld gefüllt ist (z. B. #kostentraeger_name)"],
];
const BEKANNTE = new Set(PLATZHALTER.flatMap(([k]) => k.replace(/[#/…]/g, " ").split(/[\s,]+/).filter(Boolean))
  .concat(["hat_nebenleistungen", "posten", "monat", "bezeichnung", "betrag", "feld"]));

function probeDaten(typ) {
  return briefDaten(typ, {
    profil: zustand.profil || { firma: "Probe" },
    mieter: { anrede: "Herr", vorname: "Max", nachname: "Probe", mietbeginn: "2024-01-01", aktenzeichen: "BG 0", mietkonto_iban: "DE00000000000000000000" },
    wohnung: { bezeichnung: "Whg. 1" },
    objekt: { bezeichnung: "Probeobjekt", strasse: "Probestraße 1", plz: "12345", ort: "Probestadt" },
    kostentraeger: { name: "Jobcenter Probe", strasse: "Weg 1", plz: "12345", ort: "Probestadt" },
    posten: [{ monat: "2026-01-01", art: "kaltmiete", bezeichnung: "Kaltmiete", betrag: 1 }],
    vorgaenge: [],
  });
}

async function zeigeVorlagen() {
  zustand.vorlagen = await db.ladeVorlagen();
  inhalt.innerHTML = `
    <div class="kopf"><div><h1>Vorlagen</h1>
      <p>Briefvorlagen als Word-Dateien. Eigene Vorlagen ersetzen den Standard, bis Sie ihn wiederherstellen.</p></div></div>
    <div class="stapel">
      <section class="flaeche">
        ${zustand.vorlagen.map((v) => `
          <div class="vorlage">
            <div>
              <h2>${esc(v.name)} ${v.storage_pfad ? `<span class="marker marker--messing">Eigene Vorlage</span>` : `<span class="marker">Standard</span>`}</h2>
              <p>${esc(v.beschreibung || "")}</p>
              ${v.storage_pfad ? `<p class="leise">Hochgeladen, zuletzt geändert am ${datumDE(v.aktualisiert_am)}</p>` : ""}
            </div>
            <div class="knopfreihe">
              <button class="knopf knopf--klein" data-laden="${esc(v.schluessel)}">Herunterladen</button>
              <label class="knopf knopf--klein">Eigene hochladen
                <input type="file" accept=".docx" data-hochladen="${esc(v.schluessel)}" hidden></label>
              ${v.storage_pfad ? `<button class="knopf knopf--klein knopf--gefahr" data-zuruecksetzen="${esc(v.schluessel)}">Standard wiederherstellen</button>` : ""}
            </div>
          </div>`).join("")}
      </section>
      <section class="flaeche">
        <div class="flaeche__kopf"><h2>Platzhalter für eigene Vorlagen</h2></div>
        <div class="flaeche__inhalt">
          <p class="leise">Platzhalter stehen in geschweiften Klammern im Word-Text, z. B. <code>{konto_iban}</code>.
            Am einfachsten laden Sie eine Standardvorlage herunter, ändern Texte und Gestaltung in Word und laden sie wieder hoch.
            Beim Hochladen wird die Vorlage geprüft.</p>
          <dl class="platzhalter">
            ${PLATZHALTER.map(([k, t]) => `<dt><code>{${esc(k)}}</code></dt><dd>${esc(t)}</dd>`).join("")}
          </dl>
          <p class="leise" style="margin-top:1rem">Die Mustertexte sind ein Ausgangspunkt. Vor dem echten Einsatz sollten sie rechtlich geprüft werden, z. B. durch Haus &amp; Grund.</p>
        </div>
      </section>
    </div>`;

  for (const b of $$("[data-laden]")) b.addEventListener("click", async () => {
    const v = zustand.vorlagen.find((x) => x.schluessel === b.dataset.laden);
    try {
      herunterladen(await db.ladeVorlagenDatei(v), `Vorlage_${dateiTeil(v.name)}.docx`);
    } catch (err) { melde(err.message, "fehler"); }
  });
  for (const input of $$("[data-hochladen]")) input.addEventListener("change", async () => {
    const datei = input.files[0];
    input.value = "";
    if (!datei) return;
    if (!/\.docx$/i.test(datei.name)) return melde("Bitte eine Word-Datei (.docx) wählen.", "fehler");
    const typ = input.dataset.hochladen;
    try {
      const buf = await datei.arrayBuffer();
      const gefunden = platzhalterAus(buf);
      try { fuelleVorlage(buf, probeDaten(typ)); }
      catch (err) { return melde("Vorlage nicht verwendbar: " + vorlagenFehler(err), "fehler"); }
      await db.ladeVorlageHoch(typ, datei);
      const unbekannt = gefunden.filter((p) => !BEKANNTE.has(p));
      melde(unbekannt.length
        ? `Vorlage hochgeladen. Unbekannte Platzhalter bleiben leer: ${unbekannt.join(", ")}`
        : "Vorlage hochgeladen und geprüft.", unbekannt.length ? "info" : "ok");
      await zeigeVorlagen();
    } catch (err) { melde(err.message, "fehler"); }
  });
  for (const b of $$("[data-zuruecksetzen]")) b.addEventListener("click", async () => {
    const v = zustand.vorlagen.find((x) => x.schluessel === b.dataset.zuruecksetzen);
    if (!confirm(`Eigene Vorlage „${v.name}“ löschen und Standard wiederherstellen?`)) return;
    try {
      await db.vorlageZuruecksetzen(v);
      melde("Standardvorlage wiederhergestellt.", "ok");
      await zeigeVorlagen();
    } catch (err) { melde(err.message, "fehler"); }
  });
}

// ---------------------------------------------------------------------------
// Briefkopf
// ---------------------------------------------------------------------------
async function zeigeBriefkopf() {
  const p = (zustand.profil = await db.ladeProfil()) || {};
  const f = (name, label, attrs = "") =>
    `<label class="feld"><span>${label}</span><input name="${name}" value="${esc(p[name] ?? "")}" ${attrs}></label>`;
  inhalt.innerHTML = `
    <div class="kopf"><div><h1>Briefkopf</h1><p>Diese Angaben erscheinen in allen Schreiben als Absender.</p></div></div>
    <section class="flaeche"><form class="flaeche__inhalt" id="profilformular">
      <div class="formraster">
        ${f("firma", "Firma", "required")}${f("inhaber", "Inhaber / Unterzeichner")}
        ${f("strasse", "Straße und Hausnummer")}${f("plz", "PLZ")}${f("ort", "Ort")}
        ${f("telefon", "Telefon")}${f("email", "E-Mail", `type="email"`)}${f("web", "Website")}
      </div>
      <div class="knopfreihe"><button class="knopf knopf--primaer" type="submit">Briefkopf speichern</button></div>
    </form></section>`;
  $("#profilformular").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const felder = Object.fromEntries(["firma", "inhaber", "strasse", "plz", "ort", "telefon", "email", "web"]
      .map((k) => [k, (fd.get(k) || "").trim() || null]));
    try {
      zustand.profil = await db.speichereProfil(felder);
      melde("Briefkopf gespeichert.", "ok");
    } catch (err) { melde(err.message, "fehler"); }
  });
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
db.beiAnmeldeWechsel((ereignis) => {
  if (ereignis === "SIGNED_OUT") zeigeBereich("anmeldung");
});

(async () => {
  try {
    const nutzer = await db.aktuellerNutzer();
    if (nutzer) await betreten(nutzer);
    else zeigeBereich("anmeldung");
  } catch (err) {
    console.error(err);
    zeigeBereich("anmeldung");
    const f = $("#anmeldefehler");
    f.textContent = "Verbindung zur Datenbank fehlgeschlagen: " + err.message;
    f.hidden = false;
  }
})();
