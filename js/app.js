// ROK Verwaltung – Oberfläche (ohne Build-Schritt, reines ES-Modul)
import * as db from "./daten.js";
import {
  briefDaten, antwortDaten, fuelleVorlage, platzhalterAus, vorlagenFehler,
  euro, datumDE, monatDE, ibanFormat, mieterName,
} from "./dokumente.js";
import { zeigeDokument } from "./vorschau.js";
import {
  $, $$, esc, melde, herunterladen, dateiTeil, dialogFormular, heuteISO,
  zustand, wohnungVon, objektVon, kostentraegerVon,
} from "./helfer.js";
import * as postfach from "./postfach.js";
import * as start from "./start.js";
import * as ablage from "./ablage.js";
import * as stamm from "./stammdaten.js";
import { oeffneChat } from "./chat.js";
import {
  MONATE_KURZ, monatISO, letzteMonate, mietbuch, LEGENDE, naechsterSchritt, mieterZeile, schreibenKachel, oeffneSchreiben, emailDaten,
} from "./bausteine.js";

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------
const inhalt = $("#inhalt");
const ARTEN = [
  ["kaltmiete", "Kaltmiete"],
  ["nebenkosten", "Nebenkostenvorauszahlung"],
  ["strom", "Strompauschale"],
  ["internet", "Internetpauschale"],
  ["sonstiges", "Sonstiges"],
];
const ART_NAME = Object.fromEntries(ARTEN);
const ART_REIHE = ARTEN.map(([k]) => k);
const TYP_NAME = {
  mahnung_1: "1. Mahnung",
  mahnung_2: "2. Mahnung",
  nachweis_jobcenter: "Nachweis an Kostenträger",
  antwort: "Antwortschreiben",
  sonstiges: "Schreiben",
};

const zahl = (text) => {
  if (text === "" || text == null) return 0;
  const n = Number(String(text).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};
const zahlFeld = (n) => (Number(n) || 0).toFixed(2).replace(".", ",");
const sortiereForderungen = (liste) =>
  liste.sort((x, y) => String(x.monat).localeCompare(String(y.monat)) || ART_REIHE.indexOf(x.art) - ART_REIHE.indexOf(y.art));
function nachMonat(liste) {
  const gruppen = new Map();
  for (const f of liste) {
    const k = String(f.monat).slice(0, 7);
    if (!gruppen.has(k)) gruppen.set(k, []);
    gruppen.get(k).push(f);
  }
  return [...gruppen.entries()];
}

function ibanGueltig(iban) {
  const s = (iban || "").replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  const umgestellt = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rest = 0;
  for (const ziffer of umgestellt) rest = (rest * 10 + Number(ziffer)) % 97;
  return rest === 1;
}


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

// ---------------------------------------------------------------------------
// Zustand
// ---------------------------------------------------------------------------

async function ladeGrunddaten() {
  const [profil, stamm, vorlagen] = await Promise.all([db.ladeProfil(), db.ladeStammdaten(), db.ladeVorlagen()]);
  Object.assign(zustand, { profil, stamm, vorlagen });
  postfach.ladeKiStatus(); // im Hintergrund: Ist die KI eingerichtet?
}

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
  if (e.target.closest("[data-aktion=chat]")) return oeffneChat();
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
  const navTeil = { schreiben: "postfach", entwurf: "postfach", vorlagen: "einstellungen", briefkopf: "einstellungen", objekt: "uebersicht", stammdaten: "mieter" }[teil] || teil;
  for (const a of $$("[data-nav]")) {
    if (a.dataset.nav === navTeil) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  postfach.aktualisiereZaehler();
  try {
    if (teil === "mieter" && id) await zeigeAkte(id);
    else if (teil === "mieter") await zeigeMieterliste();
    else if (teil === "postfach" && id) await postfach.zeigeNachricht(id);
    else if (teil === "postfach") await postfach.zeigePostfach();
    else if (teil === "schreiben") await postfach.zeigeNeuesSchreiben(id || null);
    else if (teil === "entwurf" && id) await postfach.zeigeNeuesSchreiben(null, id);
    else if (teil === "objekt" && id) await start.zeigeObjekt(id);
    else if (teil === "wissen") await ablage.zeigeWissen();
    else if (teil === "vorlagen") await zeigeVorlagen();
    else if (teil === "stammdaten") await stamm.zeigeStammdaten();
    else if (teil === "einstellungen" || teil === "briefkopf") await postfach.zeigeEinstellungen();
    else await start.zeigeStart();
    window.scrollTo(0, 0);
  } catch (err) {
    console.error(err);
    inhalt.innerHTML = `<div class="flaeche leer"><h2>Das hat nicht geklappt</h2><p>${esc(err.message)}</p>
      <button class="knopf" id="neu-laden">Seite neu laden</button></div>`;
    $("#neu-laden").addEventListener("click", () => location.reload());
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
    const k = m.objekt_id || "";
    if (!gruppen.has(k)) gruppen.set(k, []);
    gruppen.get(k).push(m);
  }

  inhalt.innerHTML = `
    <div class="kopf">
      <div><h1>Mieter</h1><p>${liste.length} Mietparteien in ${gruppen.size} Objekten</p>
        <p class="knopfreihe"><button type="button" class="knopf knopf--klein" id="mieter-neu">+ Neue Mietpartei</button>
          <a class="knopf knopf--klein" href="#/stammdaten">Häuser &amp; Wohnungen</a></p></div>
      <label class="feld suchfeld"><span>Suchen</span>
        <input type="search" id="suche" placeholder="Name, Wohnung oder Aktenzeichen"></label>
    </div>
    <section class="flaeche">
      <div class="flaeche__kopf"><h2>Zahlungen der letzten 6 Monate</h2>${LEGENDE}</div>
      <div id="mieterliste">
        ${[...gruppen.entries()].map(([objektId, mieter]) => `
          <div class="objektgruppe">
            <h3 class="objektgruppe__titel">${objektId ? `<a href="#/objekt/${esc(objektId)}">${esc(mieter[0].objekt)}</a>` : "Ohne Haus"} <span class="leise">${mieter.length} Mietparteien</span></h3>
            <div class="zeilen">
              ${mieter.map((m) => `<div data-suche="${esc([mieterName(m), m.wohnung, m.objekt, m.aktenzeichen, m.kostentraeger].join(" ").toLowerCase())}">
                ${mieterZeile(m, forderungen, monate)}</div>`).join("")}
            </div>
          </div>`).join("")}
        <div class="leer" id="keintreffer" hidden>Keine Mietpartei gefunden.</div>
      </div>
    </section>`;

  $("#mieter-neu").addEventListener("click", () => stamm.neueMietpartei());
  $("#suche").addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    let treffer = 0;
    for (const z of $$("#mieterliste [data-suche]")) {
      z.hidden = q && !z.dataset.suche.includes(q);
      if (!z.hidden) treffer++;
    }
    for (const g of $$("#mieterliste .objektgruppe")) g.hidden = !$$("[data-suche]", g).some((z) => !z.hidden);
    $("#keintreffer").hidden = treffer > 0;
  });
}

// ---------------------------------------------------------------------------
// Mieter-Akte
// ---------------------------------------------------------------------------
async function zeigeAkte(id) {
  const [mieter, forderungen, vorgaenge, nachrichten, antworten, aufgaben, dokumente] = await Promise.all([
    db.ladeMieter(id),
    db.ladeForderungen({ mieterId: id }),
    db.ladeVorgaenge({ mieterId: id }),
    db.ladeNachrichten({ mieterId: id, anzahl: 8 }).catch(() => []),
    db.ladeAntworten({ mieterId: id, anzahl: 20 }).catch(() => []),
    db.ladeAufgaben({ mieterId: id }).catch(() => []),
    db.ladeDokumente({ mieterId: id }).catch(() => []),
  ]);
  const entwuerfe = antworten.filter((a) => a.status === "entwurf");
  sortiereForderungen(forderungen);
  const wohnung = wohnungVon(mieter.wohnung_id);
  const objekt = wohnung ? objektVon(wohnung.objekt_id) : null;
  const kostentraeger = kostentraegerVon(mieter.kostentraeger_id);
  const offen = forderungen.filter((f) => !f.bezahlt);
  const bezahlt = forderungen.filter((f) => f.bezahlt);
  const vorher = zustand.akte?.mieter.id === id ? zustand.akte : null;
  const auswahl = new Set(offen.filter((f) => !vorher || vorher.auswahl.has(f.id) || !vorher.offenIds.has(f.id)).map((f) => f.id));
  zustand.akte = { mieter, forderungen, vorgaenge, wohnung, objekt, kostentraeger, auswahl, offenIds: new Set(offen.map((f) => f.id)) };
  const monatlich = Number(mieter.kaltmiete) + Number(mieter.nebenkosten_vz) + Number(mieter.strom_pauschale) + Number(mieter.internet_pauschale);
  const summeOffen = offen.reduce((s, f) => s + Number(f.betrag), 0);
  const hatMahnung1 = vorgaenge.some((v) => v.typ === "mahnung_1");

  inhalt.innerHTML = `
    <a class="zurueck" href="#/mieter">Zurück zur Mieterliste</a>
    <div class="akte__kopf">
      <h1>${esc(mieterName(mieter))}</h1>
      <div class="unter">
        <span>${objekt ? `<a href="#/objekt/${esc(objekt.id)}">${esc(objekt.bezeichnung)}</a>` : "Keine Wohnung zugeordnet"}${wohnung ? ", " + esc(wohnung.bezeichnung) : ""}</span>
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
      <a class="knopf knopf--hell" href="#/schreiben/${esc(mieter.id)}">Schreiben mit KI</a>
      <span class="briefe__hinweis" id="briefhinweis"></span>
    </div>

    <div class="akte">
      <div class="stapel">
        <section class="flaeche">
          <div class="flaeche__kopf"><h2>Offene Posten</h2>
            ${offen.length ? `<label class="checkfeld checkfeld--klein"><input type="checkbox" id="alle"> Alle auswählen</label>` : ""}</div>
          ${offen.length ? `
            <div class="posten">
              ${nachMonat(offen).map(([ym, liste]) => `
                <div class="monat" data-monatsgruppe="${ym}">
                  <label class="monat__kopf">
                    <input type="checkbox" data-monat="${ym}" aria-label="${esc(monatDE(ym + "-01"))} auswählen">
                    <span class="monat__name">${esc(monatDE(ym + "-01"))}</span>
                    <span class="monat__summe">${euro(liste.reduce((s, f) => s + Number(f.betrag), 0))}</span>
                  </label>
                  ${liste.map((f) => `
                    <div class="posten__zeile">
                      <label class="posten__wahl">
                        <input type="checkbox" data-posten="${esc(f.id)}" data-von="${ym}" ${auswahl.has(f.id) ? "checked" : ""}>
                        <span>${esc(f.bezeichnung || ART_NAME[f.art] || f.art)}</span>
                      </label>
                      <span class="posten__betrag">${euro(f.betrag)}</span>
                      <button class="knopf knopf--klein" data-bezahlt="${esc(f.id)}">Bezahlt</button>
                    </div>`).join("")}
                </div>`).join("")}
            </div>
            <div class="auswahlsumme"><span>Ausgewählt für den Brief</span><strong id="auswahlsumme"></strong></div>`
          : `<div class="leer">Keine offenen Posten. Neue Forderungen legen Sie über „Monatsmiete anlegen“ an.</div>`}
          <div class="flaeche__fuss knopfreihe">
            ${offen.length ? `<button class="knopf knopf--klein" id="auswahl-bezahlt">Ausgewählte als bezahlt markieren</button>` : ""}
            <button class="knopf knopf--klein" id="monat-anlegen">Monatsmiete anlegen</button>
            <button class="knopf knopf--klein" id="posten-neu">Einzelnen Posten hinzufügen</button>
          </div>
        </section>

        <details class="flaeche ausklapp">
          <summary>Bezahlte Posten (${bezahlt.length})</summary>
          ${bezahlt.length ? `<div class="bezahlt">
            ${nachMonat(bezahlt).reverse().map(([ym, liste]) => `
              <div class="bezahlt__monat">
                <div class="bezahlt__kopf">
                  <span class="monat__name">${esc(monatDE(ym + "-01"))}</span>
                  <span class="leise">${liste[0].bezahlt_am ? "bezahlt am " + datumDE(liste[0].bezahlt_am) : ""}</span>
                  <span class="monat__summe">${euro(liste.reduce((s, f) => s + Number(f.betrag), 0))}</span>
                </div>
                <ul class="bezahlt__liste">
                  ${liste.map((f) => `<li><span>${esc(f.bezeichnung || ART_NAME[f.art])}</span>
                    <span class="posten__betrag">${euro(f.betrag)}</span>
                    <button class="textknopf" data-wiederoffen="${esc(f.id)}">wieder öffnen</button></li>`).join("")}
                </ul>
              </div>`).join("")}
          </div>` : `<div class="leer">Noch nichts bezahlt.</div>`}
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
          <div class="flaeche__kopf"><h2>Nachrichten</h2><a class="leise" href="#/schreiben/${esc(mieter.id)}">Neues Schreiben</a></div>
          ${entwuerfe.length ? `<div class="zeilen">${entwuerfe.map((a) => `<a class="entwurfzeile" href="${a.nachricht_id ? `#/postfach/${esc(a.nachricht_id)}` : `#/entwurf/${esc(a.id)}`}">
              <span><span class="marker marker--messing">Entwurf</span> ${esc(a.betreff || "(ohne Betreff)")}</span><span class="leise">${datumDE(a.aktualisiert_am)}</span></a>`).join("")}</div>` : ""}
          ${nachrichten.length
            ? `<div class="posts">${nachrichten.map((n) => postfach.nachrichtZeile(n, { [mieter.id]: mieterName(mieter) })).join("")}</div>`
            : entwuerfe.length ? "" : `<div class="leer">Keine Nachrichten von dieser Mietpartei.</div>`}
        </section>
        <section class="flaeche" id="notizen">
          <div class="flaeche__kopf"><h2>Notizen &amp; Wiedervorlagen</h2><button type="button" class="knopf knopf--klein" id="notiz-neu">+ Notiz</button></div>
          ${start.todoListe(start.aufgabenKurz(aufgaben), { leer: "Keine offenen Notizen." })}
          <div class="flaeche__fuss"><button type="button" class="knopf knopf--klein knopf--ki" id="mh-pruefen">Mieterhöhung prüfen</button></div>
        </section>
        ${dokumente.length ? `
        <details class="flaeche ausklapp">
          <summary>Dokumente (${dokumente.length})</summary>
          ${ablage.dokumentListe(dokumente)}
        </details>` : ""}
        <section class="flaeche">
          <div class="flaeche__kopf"><h2>Schreiben</h2></div>
          ${vorgaenge.length
            ? `<div class="kacheln kacheln--eng">${vorgaenge.map((v) => schreibenKachel(v)).join("")}</div>`
            : `<div class="leer">Noch keine Schreiben.</div>`}
        </section>
      </div>
    </div>`;

  aktualisiereAuswahl();
  $("#alle")?.addEventListener("change", (e) => {
    for (const cb of $$("[data-posten]")) cb.checked = e.target.checked;
    aktualisiereAuswahl();
  });
  for (const cb of $$("[data-monat]")) cb.addEventListener("change", () => {
    for (const p of $$(`[data-posten][data-von="${cb.dataset.monat}"]`)) p.checked = cb.checked;
    aktualisiereAuswahl();
  });
  for (const cb of $$("[data-posten]")) cb.addEventListener("change", aktualisiereAuswahl);
  for (const b of $$("[data-brief]")) b.addEventListener("click", () => erstelleBrief(b.dataset.brief, b));
  for (const b of $$("[data-bezahlt]")) b.addEventListener("click", () => markiere([b.dataset.bezahlt], true));
  for (const b of $$("[data-wiederoffen]")) b.addEventListener("click", () => markiere([b.dataset.wiederoffen], false));
  for (const b of $$("[data-schreiben]")) b.addEventListener("click", () =>
    oeffneSchreiben(vorgaenge.find((v) => v.id === b.dataset.schreiben), mieter));
  $("#auswahl-bezahlt")?.addEventListener("click", () => {
    const ids = [...zustand.akte.auswahl];
    if (!ids.length) return melde("Keine Posten ausgewählt.", "fehler");
    markiere(ids, true);
  });
  const nachher = () => zeigeAkte(id);
  start.verbindeTodos($("#notizen"), { aufgaben, nachher });
  ablage.verbindeListen(inhalt, { dokumente, nachher });
  $("#notiz-neu").addEventListener("click", () => start.aufgabeDialog({ mieter_id: id, objekt_id: objekt?.id || null }, { nachher }));
  $("#mh-pruefen").addEventListener("click", () => start.mieterhoehungPruefen(mieter, aufgaben, nachher));
  $("#monat-anlegen").addEventListener("click", monatAnlegen);
  $("#posten-neu").addEventListener("click", postenHinzufuegen);
  verknuepfeStammdaten();
}

function aktualisiereAuswahl() {
  const a = zustand.akte;
  const boxen = $$("[data-posten]");
  a.auswahl = new Set(boxen.filter((cb) => cb.checked).map((cb) => cb.dataset.posten));
  const ausgewaehlt = a.forderungen.filter((f) => a.auswahl.has(f.id));
  const summe = ausgewaehlt.reduce((s, f) => s + Number(f.betrag), 0);
  if ($("#auswahlsumme")) $("#auswahlsumme").textContent = euro(summe);
  const setze = (cb, liste) => {
    const n = liste.filter((x) => x.checked).length;
    cb.checked = n === liste.length && n > 0;
    cb.indeterminate = n > 0 && n < liste.length;
  };
  if ($("#alle")) setze($("#alle"), boxen);
  for (const cb of $$("[data-monat]")) setze(cb, boxen.filter((b) => b.dataset.von === cb.dataset.monat));
  $("#briefhinweis").textContent = ausgewaehlt.length
    ? `Der Brief enthält ${ausgewaehlt.length} Posten (${monatsspanne(ausgewaehlt)}) über ${euro(summe)}. Sie sehen ihn zuerst in der Vorschau.`
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
  knopf.textContent = "Wird vorbereitet …";
  let bytes, daten;
  try {
    const datei = await db.ladeVorlagenDatei(vorlage);
    daten = briefDaten(typ, {
      profil: zustand.profil, mieter: a.mieter, wohnung: a.wohnung || {}, objekt: a.objekt || {},
      kostentraeger: a.kostentraeger, posten, vorgaenge: a.vorgaenge,
    });
    try {
      bytes = fuelleVorlage(datei, daten);
    } catch (err) {
      throw new Error("Die Vorlage enthält einen Fehler: " + vorlagenFehler(err));
    }
  } catch (err) {
    console.error(err);
    melde(err.message, "fehler");
    return;
  } finally {
    knopf.disabled = false;
    knopf.textContent = text;
  }

  const dateiname = `${heuteISO()}_${dateiTeil(TYP_NAME[typ])}_${dateiTeil(a.mieter.nachname)}.docx`;
  const titel = typ === "nachweis_jobcenter"
    ? `Nachweis an ${a.kostentraeger.name} (${monatsspanne(posten)})`
    : `${TYP_NAME[typ]} (${monatsspanne(posten)})`;
  const vorgangId = crypto.randomUUID();
  let ablageLaeuft = null;

  const gespeichert = await zeigeDokument({
    titel,
    untertitel: `${mieterName(a.mieter)}, ${posten.length} Posten über ${daten.summe}`,
    bytes,
    dateiname,
    hinweis: "Noch nicht gespeichert. Beim Herunterladen, Drucken oder Versenden wird das Schreiben im Verlauf abgelegt.",
    email: emailDaten(typ, a.mieter, a.kostentraeger, titel),
    melde,
    vorAbschluss: async () => {
      await db.archiviereSchreiben({
        vorgangId,
        mieterId: a.mieter.id,
        bytes,
        vorgang: {
          typ, titel, summe: daten.summe_zahl,
          details: { posten: posten.map((f) => f.id), vorlage: vorlage.storage_pfad ? "eigene" : "standard", datei: dateiname },
        },
      });
      const h = $("#dialog [data-v=hinweis]");
      if (h) h.textContent = "Im Verlauf gespeichert.";
      // Zusätzlich in die Ablage (Word-Datei); an die KI gehen nur Titel und Empfänger, kein Inhalt (IBAN!)
      const jc = typ === "nachweis_jobcenter";
      ablageLaeuft = ablage.automatischAblegen({
        quelle: { vorgang_id: vorgangId },
        richtung: "ausgang",
        art: typ.startsWith("mahnung") ? "Mahnung" : "Brief", artFest: true,
        objektId: a.objekt?.id || null, mieterId: a.mieter.id,
        gegenueber: jc ? a.kostentraeger?.name : mieterName(a.mieter),
        gegenueberKurz: jc ? null : a.mieter.nachname,
        kiText: { titel, text: `${TYP_NAME[typ]} an ${jc ? a.kostentraeger?.name : "die Mietpartei"} ${mieterName(a.mieter)}` },
        zusammenfassung: `${titel}, ${posten.length} Posten über ${daten.summe}`,
        datei: async () => ({ blob: new Blob([bytes], { type: ablage.DOCX_TYP }), typ: ablage.DOCX_TYP }),
      }, { meldung: false });
      ablageLaeuft.then((doc) => {
        const h2 = $("#dialog [data-v=hinweis]");
        if (doc && h2) h2.textContent += ` Abgelegt in „${ablage.ordnerAnzeige(doc.ordner)}“.`;
      });
    },
  });
  if (gespeichert) {
    melde(`${TYP_NAME[typ]} im Verlauf gespeichert.`, "ok");
    await zeigeAkte(a.mieter.id);
    if (ablageLaeuft) ablageLaeuft.then((doc) => ablage.zeigeAblageMeldung(doc, { nachher: () => zeigeAkte(a.mieter.id) }));
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
  vorschlag.setDate(1);
  while (vorhanden.has(monatISO(vorschlag).slice(0, 7))) vorschlag.setMonth(vorschlag.getMonth() + 1);

  const daten = await dialogFormular(`
    <h2>Monatsmiete anlegen</h2>
    <p class="leise">Legt die vereinbarten Bestandteile als offene Posten an.</p>
    <label class="feld"><span>Monat</span><input type="month" name="monat" required value="${monatISO(vorschlag).slice(0, 7)}"></label>
    <ul class="dialogliste">
      ${teile.map(([art, b]) => `<li><span>${esc(ART_NAME[art])}</span><span class="posten__betrag">${euro(b)}</span></li>`).join("")}
    </ul>
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
    <div class="formgruppe"><h3>Für die Mieterhöhung</h3><div class="formraster">
      <label class="feld"><span>Mietart</span><select name="mietart">
        ${[["normal", "Normale Miete"], ["staffel", "Staffelmiete"], ["index", "Indexmiete"]].map(([k, n]) => `<option value="${k}" ${k === (m.mietart || "normal") ? "selected" : ""}>${n}</option>`).join("")}
      </select></label>
      ${f("vergleichsmiete_qm", "Vergleichsmiete €/m² (Mietspiegel)", m.vergleichsmiete_qm != null ? zahlFeld(m.vergleichsmiete_qm) : "", `inputmode="decimal" pattern="[0-9]+([.,][0-9]{1,2})?" placeholder="z. B. 8,50"`)}
      ${f("letzte_erhoehung_am", "Letzte Mieterhöhung am", m.letzte_erhoehung_am, `type="date"`)}
      ${f("kaltmiete_vorher", "Kaltmiete davor €", m.kaltmiete_vorher != null ? zahlFeld(m.kaltmiete_vorher) : "", `inputmode="decimal" pattern="[0-9]+([.,][0-9]{1,2})?"`)}
      <label class="feld"><span>Wohnfläche</span><input value="${esc(wohnungVon(m.wohnung_id)?.flaeche_qm != null ? String(wohnungVon(m.wohnung_id).flaeche_qm).replace(".", ",") + " m²" : "nicht erfasst")}" readonly tabindex="-1"></label>
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
    felder.mietart = fd.get("mietart") || "normal";
    felder.letzte_erhoehung_am = fd.get("letzte_erhoehung_am") || null;
    for (const k of ["vergleichsmiete_qm", "kaltmiete_vorher"]) {
      const roh = String(fd.get(k) || "").trim();
      const n = roh ? zahl(roh) : null;
      if (n != null && (!Number.isFinite(n) || n < 0)) return melde("Bitte gültige Zahlen eingeben.", "fehler");
      felder[k] = n;
    }
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
// Bekannte Platzhalter (vollständige Liste mit Erklärung: PLATZHALTER.md im Repo)
const BEKANNTE = new Set([
  "v_firma", "v_inhaber", "v_strasse", "v_plz", "v_ort", "v_telefon", "v_email", "v_web",
  "datum", "frist", "empf_name", "empf_zusatz", "empf_strasse", "empf_plz_ort", "briefanrede",
  "mieter_name", "mieter_vorname", "mieter_nachname", "objekt", "objekt_adresse", "objekt_strasse",
  "wohnung", "mietbeginn", "kostentraeger_name", "aktenzeichen", "konto_inhaber", "konto_iban",
  "konto_bic", "konto_bank", "verwendungszweck", "posten", "monat", "bezeichnung", "betrag", "summe",
  "hat_nebenleistungen", "letzte_mahnung_datum", "mahnung_datum", "betreff", "absaetze", "absatz",
]);

// Beispieldaten für die Vorschau einer Vorlage (erfunden)
function beispielDaten(typ) {
  if (typ === "antwort") {
    return antwortDaten({
      profil: zustand.profil || { firma: "Beispiel" },
      mieter: { anrede: "Frau", vorname: "Erika", nachname: "Beispiel" },
      wohnung: { bezeichnung: "2. OG rechts" },
      objekt: { bezeichnung: "MFH Beispielweg 5", strasse: "Beispielweg 5", plz: "12345", ort: "Musterstadt" },
      empfaenger: { name: "Frau Erika Beispiel", zusatz: "Wohnung 2. OG rechts", strasse: "Beispielweg 5", plz_ort: "12345 Musterstadt" },
      betreff: "Ihre Nachricht vom 12.10.: Heizung im Bad",
      text: "Sehr geehrte Frau Beispiel,\n\nvielen Dank für Ihre Nachricht. Wir haben die Haustechnik beauftragt. Die Firma meldet sich innerhalb von zwei Werktagen bei Ihnen für einen Termin.\n\nBitte sorgen Sie dafür, dass die Wohnung zum Termin zugänglich ist.",
    });
  }
  return briefDaten(typ, {
    profil: zustand.profil || { firma: "Beispiel" },
    mieter: {
      anrede: "Frau", vorname: "Erika", nachname: "Beispiel", mietbeginn: "2024-04-01", aktenzeichen: "BG 00000//0000000",
      mietkonto_inhaber: `${zustand.profil?.firma || "Vermieter"} – Mietkonto Beispiel`,
      mietkonto_iban: "DE60123456780004711099", mietkonto_bic: "MUSTDEXXXXX", mietkonto_bank: "Musterbank",
    },
    wohnung: { bezeichnung: "2. OG rechts" },
    objekt: { bezeichnung: "MFH Beispielweg 5", strasse: "Beispielweg 5", plz: "12345", ort: "Musterstadt" },
    kostentraeger: { name: "Jobcenter Musterstadt", abteilung: "Leistungsabteilung", strasse: "Agenturplatz 1", plz: "12345", ort: "Musterstadt" },
    posten: [
      { monat: "2026-09-01", art: "kaltmiete", bezeichnung: "Kaltmiete", betrag: 450 },
      { monat: "2026-09-01", art: "nebenkosten", bezeichnung: "Nebenkostenvorauszahlung", betrag: 160 },
      { monat: "2026-09-01", art: "strom", bezeichnung: "Strompauschale", betrag: 45 },
    ],
    vorgaenge: [{ typ: "mahnung_1", erstellt_am: "2026-09-20T10:00:00+02:00" }],
  });
}

async function zeigeVorlagen() {
  zustand.vorlagen = await db.ladeVorlagen();
  inhalt.innerHTML = `
    <a class="zurueck" href="#/einstellungen">Zu den Einstellungen</a>
    <div class="kopf"><div><h1>Vorlagen</h1>
      <p>Briefvorlagen als Word-Dateien. Eine hochgeladene eigene Vorlage ersetzt den Standard, bis Sie ihn wiederherstellen.</p></div></div>
    <section class="flaeche">
      ${zustand.vorlagen.map((v) => `
        <div class="vorlage">
          <div>
            <h2>${esc(v.name)} ${v.storage_pfad ? `<span class="marker marker--messing">Eigene Vorlage</span>` : `<span class="marker">Standard</span>`}</h2>
            <p>${esc(v.beschreibung || "")}</p>
            ${v.storage_pfad ? `<p class="leise">Hochgeladen, zuletzt geändert am ${datumDE(v.aktualisiert_am)}</p>` : ""}
          </div>
          <div class="knopfreihe">
            <button class="knopf knopf--klein knopf--primaer" data-ansehen="${esc(v.schluessel)}">Ansehen</button>
            <button class="knopf knopf--klein" data-laden="${esc(v.schluessel)}">Zum Bearbeiten herunterladen</button>
            <label class="knopf knopf--klein">Eigene hochladen
              <input type="file" accept=".docx" data-hochladen="${esc(v.schluessel)}" hidden></label>
            ${v.storage_pfad ? `<button class="knopf knopf--klein knopf--gefahr" data-zuruecksetzen="${esc(v.schluessel)}">Standard wiederherstellen</button>` : ""}
          </div>
        </div>`).join("")}
    </section>
    <p class="leise fussnote">Die Mustertexte sind ein Ausgangspunkt. Vor dem echten Einsatz sollten sie rechtlich geprüft werden, z. B. durch Haus &amp; Grund.</p>`;

  for (const b of $$("[data-ansehen]")) b.addEventListener("click", async () => {
    const v = zustand.vorlagen.find((x) => x.schluessel === b.dataset.ansehen);
    try {
      const datei = await db.ladeVorlagenDatei(v);
      let bytes;
      try { bytes = fuelleVorlage(datei, beispielDaten(v.schluessel)); }
      catch (err) { return melde("Die Vorlage enthält einen Fehler: " + vorlagenFehler(err), "fehler"); }
      await zeigeDokument({
        titel: `Vorlage: ${v.name}`,
        untertitel: "Mit erfundenen Beispieldaten befüllt",
        bytes,
        dateiname: `Beispiel_${dateiTeil(v.name)}.docx`,
        hinweis: "So sieht das Schreiben aus. Die eingesetzten Daten sind Beispiele.",
        melde,
      });
    } catch (err) { melde(err.message, "fehler"); }
  });
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
      try { fuelleVorlage(buf, beispielDaten(typ)); }
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
// Als App installieren (PWA)
// ---------------------------------------------------------------------------
const istApp = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const istIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
let installAngebot = null;

function zeigeInstallKnopf(sichtbar) {
  for (const k of $$("[data-aktion=installieren]")) k.hidden = !sichtbar;
}
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installAngebot = e;
  zeigeInstallKnopf(true);
});
window.addEventListener("appinstalled", () => {
  installAngebot = null;
  zeigeInstallKnopf(false);
  melde("App installiert. Sie finden sie jetzt bei Ihren Apps.", "ok");
});
// iOS kennt keinen Installieren-Dialog: dort erklären wir den Weg über „Teilen“
if (istIOS() && !istApp()) zeigeInstallKnopf(true);

document.addEventListener("click", async (e) => {
  if (!e.target.closest("[data-aktion=installieren]")) return;
  if (installAngebot) {
    installAngebot.prompt();
    await installAngebot.userChoice.catch(() => null);
    installAngebot = null;
    zeigeInstallKnopf(false);
    return;
  }
  await dialogFormular(`
    <h2>Als App installieren</h2>
    ${istIOS() ? `
      <ol class="anleitung">
        <li>Diese Seite in <strong>Safari</strong> öffnen.</li>
        <li>Unten (iPad: oben) auf <strong>Teilen</strong> tippen, das Quadrat mit dem Pfeil nach oben.</li>
        <li><strong>„Zum Home-Bildschirm“</strong> wählen. Falls nicht sichtbar: in der Liste nach unten scrollen.</li>
        <li>Auf <strong>Hinzufügen</strong> tippen. Die App „ROK“ liegt jetzt auf dem Home-Bildschirm.</li>
      </ol>` : `
      <p>Im Browser-Menü (⋮ oben rechts) „App installieren“ bzw. „Zum Startbildschirm hinzufügen“ wählen.
        In Chrome und Edge am Computer gibt es dafür auch ein Symbol rechts in der Adressleiste.</p>`}
    <div class="knopfreihe"><button class="knopf knopf--primaer" value="ok">Verstanden</button></div>`);
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) => console.warn("Service Worker:", err));
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
