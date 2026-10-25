// Übersicht als priorisierte To-do-Liste, Seiten je Haus, Notizen mit Wiedervorlage
// Grundsatz: Die KI schlägt nur vor (Antwort, Datum). Gespeichert wird erst per Klick.
import * as db from "./daten.js";
import { euro, datumDE, mieterName } from "./dokumente.js";
import { $, $$, esc, melde, dialogFormular, frage, heuteISO, zustand, objektVon, wohnungVon, brotkrumen, KRUMEN } from "./helfer.js";
import {
  ICON_KI, ICON_KAMERA, ICON_MIKRO, kurz, norm, geheZu, mieterListe, mieterOptionen, mikroKnopf, verbindeDiktat, wartehinweis,
  ortVon, suchauswahlHtml, verbindeSuchauswahl,
} from "./ui.js";
import { letzteMonate, mieterZeile, LEGENDE, naechsterSchritt, schreibenKachel, oeffneSchreiben } from "./bausteine.js";
import * as ablage from "./ablage.js";
import * as kontakte from "./kontakte.js";
import * as postfach from "./postfach.js"; // nur zur Laufzeit benutzt (Kreis start↔postfach)

const inhalt = () => $("#inhalt");
const ICON_PLUS = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>`;
const ICON_HAKEN = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M9.5 16.2 5.3 12l-1.4 1.4 5.6 5.6L20.1 8.4 18.7 7z"/></svg>`;
const SICHTBAR = 8; // so viele Punkte zeigt die Liste zuerst

// --- Datum ---------------------------------------------------------------------
const tag = (iso) => new Date(String(iso).slice(0, 10) + "T12:00:00");
const tageBis = (iso, heute = heuteISO()) => Math.round((tag(iso) - tag(heute)) / 86400000);
const plusTage = (iso, n) => {
  const d = tag(iso);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const kurzDatum = (iso) => `${String(iso).slice(8, 10)}.${String(iso).slice(5, 7)}.`;
function wannText(iso) {
  const t = tageBis(iso);
  if (t === 0) return "heute";
  if (t === 1) return "morgen";
  if (t === -1) return "gestern";
  if (t < 0) return `seit ${-t} Tagen`;
  if (t <= 6) return `in ${t} Tagen`;
  return kurzDatum(iso);
}
/** Frist einer Nachricht: bestätigt (von Robert) oder von der KI erkannt */
export const fristVon = (n) => (n.frist_bestaetigt ? n.frist : n.frist || n.ki_frist) || null;

// ---------------------------------------------------------------------------
// Was ist zu tun? Alles aus Nachrichten, Notizen, Rückständen und Entwürfen, nach Dringlichkeit
// ---------------------------------------------------------------------------
// stufe 0 = überfällig/sehr knapp, 1 = bald/dringend, 2 = normal, 3 = wenn Zeit ist
function sammle({ nachrichten = [], aufgaben = [], rueckstand = [], vorgaenge = [], entwuerfe = [], namen = {}, kontaktListe = [], orte = {} }) {
  const heute = heuteISO();
  const jetzt = [], spaeter = [], rueck = [];
  // Wo spielt es? Haus und Wohnung der Mietpartei, sonst das Haus, sonst „Allgemein“
  const hausName = (id) => objektVon(id)?.bezeichnung || "";
  const ortVon = ({ mieterId = null, objektId = null, ki = false, leer = "Allgemein" } = {}) =>
    mieterId && orte[mieterId] ? `${orte[mieterId]}${ki ? " (KI-Vorschlag)" : ""}`
      : objektId && hausName(objektId) ? `${hausName(objektId)}, ganzes Haus` : leer;
  const stufeFuer = (iso) => { const t = tageBis(iso); return t <= 3 ? 0 : t <= 7 ? 1 : 2; };

  for (const n of nachrichten) {
    const wer = (n.mieter_id && namen[n.mieter_id]) || n.absender_name || n.absender_email || "Unbekannt";
    const amt = n.ki_kategorie === "Amt/Jobcenter";
    const frist = fristVon(n);
    const marken = [
      amt ? `<span class="marker marker--messing">Amt/Jobcenter</span>` : "",
      n.ki_dringlichkeit === "hoch" ? `<span class="marker marker--offen">dringend</span>` : "",
      n.status === "neu" ? `<span class="marker marker--neu">neu</span>` : "",
      n.ki_schritte?.status === "fertig" && n.status !== "beantwortet" ? `<span class="marker marker--ki">Antwort + Auftrag bereit</span>` : "",
    ].join("");
    if (frist) {
      jetzt.push({
        ort: ortVon({ mieterId: n.mieter_id, objektId: n.objekt_id, ki: n.zuordnung === "ki", leer: "nicht zugeordnet" }),
        art: "Frist", stufe: stufeFuer(frist), datum: frist, href: `#/postfach/${n.id}`,
        titel: n.betreff || "(ohne Betreff)", unter: wer, marken,
        wann: `Frist ${kurzDatum(frist)}`, wannNot: tageBis(frist) <= 3,
        hinweis: n.frist_bestaetigt ? "" : "von der KI erkannt, bitte prüfen",
      });
    } else {
      jetzt.push({
        ort: ortVon({ mieterId: n.mieter_id, objektId: n.objekt_id, ki: n.zuordnung === "ki", leer: "nicht zugeordnet" }),
        art: "Nachricht", stufe: n.ki_dringlichkeit === "hoch" ? 1 : n.status === "neu" ? 2 : 3,
        datum: String(n.eingang_am).slice(0, 10), href: `#/postfach/${n.id}`,
        titel: n.betreff || "(ohne Betreff)", unter: [wer, n.ki_zusammenfassung ? kurz(n.ki_zusammenfassung, 110) : ""].filter(Boolean).join(" · "),
        marken, wann: tageBis(String(n.eingang_am).slice(0, 10)) === 0 ? "heute" : kurzDatum(String(n.eingang_am).slice(0, 10)),
      });
    }
  }

  for (const a of aufgaben) {
    const bezug = a.mieter_id ? namen[a.mieter_id] : a.kontakt_id ? kontakte.kontaktName(kontakte.kontaktVon(a.kontakt_id)) : a.dienstleister?.name ? a.dienstleister.name : a.objekt_id ? objektVon(a.objekt_id)?.bezeichnung : "";
    const eintrag = {
      art: a.faellig_am ? (a.mieter_id || a.objekt_id || a.kontakt_id || a.dienstleister_id ? "Wiedervorlage" : "To-do") : "Notiz", aufgabe: a, titel: a.titel,
      ort: ortVon({ mieterId: a.mieter_id, objektId: a.objekt_id }),
      unter: [bezug, a.antwort ? "KI-Antwort liegt vor" : ""].filter(Boolean).join(" · "),
      marken: "",
    };
    if (!a.faellig_am) {
      jetzt.push({ ...eintrag, stufe: 3, datum: String(a.erstellt_am).slice(0, 10), wann: "" });
      continue;
    }
    const ab = plusTage(a.faellig_am, -(a.vorlauf_tage ?? 7));
    const x = { ...eintrag, datum: a.faellig_am, wann: wannText(a.faellig_am), wannNot: tageBis(a.faellig_am) <= 1 };
    if (ab <= heute) jetzt.push({ ...x, stufe: stufeFuer(a.faellig_am) });
    else spaeter.push({ ...x, stufe: 3, wann: kurzDatum(a.faellig_am), unter: [x.unter, `erscheint ab ${datumDE(ab)}`].filter(Boolean).join(" · ") });
  }

  // Mahnung fällig: Rückstand und seit 14 Tagen kein Schreiben dazu
  const mahnTypen = ["mahnung_1", "mahnung_2", "nachweis_jobcenter"];
  for (const m of rueckstand) {
    const letzte = vorgaenge.filter((v) => v.mieter_id === m.id && mahnTypen.includes(v.typ)).map((v) => v.erstellt_am).sort().pop();
    const mahnen = !(letzte && tageBis(String(letzte).slice(0, 10)) > -14);
    // Rückstände stehen im eigenen Filter „Rückstände“, nicht mehr in „Zu erledigen“
    rueck.push({
      ort: [m.objekt, m.wohnung].filter(Boolean).join(", "),
      art: mahnen ? "Rückstand · Mahnung fällig" : "Rückstand", stufe: mahnen ? 2 : 3, datum: m.aeltester_offener_monat || heute, href: `#/mieter/${m.id}`,
      titel: `${mieterName(m)}: ${euro(m.offen_summe)} offen`,
      unter: `Als Nächstes: ${naechsterSchritt(m, vorgaenge)}`,
      marken: m.kostentraeger ? `<span class="marker marker--messing">${esc(m.kostentraeger)}</span>` : "",
      wann: letzte ? `zuletzt ${kurzDatum(String(letzte).slice(0, 10))}` : "",
    });
  }

  for (const a of entwuerfe) {
    jetzt.push({
      ort: a.mieter_id ? ortVon({ mieterId: a.mieter_id }) : a.objekt_id ? `${hausName(a.objekt_id)}, alle Mietparteien` : "",
      art: a.art === "auftrag" ? "Auftrag" : "Entwurf", stufe: 3, datum: String(a.aktualisiert_am || a.erstellt_am).slice(0, 10),
      href: a.nachricht_id ? `#/postfach/${a.nachricht_id}` : `#/entwurf/${a.id}`,
      titel: a.betreff || "(ohne Betreff)", unter: a.art === "auftrag" ? `an ${a.empfaenger_name || "Handwerker"}, noch nicht gesendet` : "liegt bereit, noch nicht gesendet",
      marken: "", wann: "",
    });
  }

  // Geburtstage von Kontakten (jedes Jahr, ab 7 Tagen vorher)
  jetzt.push(...kontakte.geburtstagTodos(kontaktListe, heute));

  const ordnen = (x, y) => x.stufe - y.stufe || String(x.datum).localeCompare(String(y.datum));
  return { jetzt: jetzt.sort(ordnen), spaeter: spaeter.sort(ordnen), rueck: rueck.sort((x, y) => x.stufe - y.stufe) };
}

// Design B: „Die KI hat vorbereitet“ – Schadensmeldungen mit fertigen Entwürfen, sonstige Entwürfe (höchstens 3 Karten)
function vorbereitetHtml(nachrichten, entwuerfe, orte) {
  if (!document.documentElement.classList.contains("design-b")) return "";
  const ort = (n) => (n.mieter_id && orte[n.mieter_id]) || (n.objekt_id && objektVon(n.objekt_id)?.bezeichnung) || "";
  const schritte = nachrichten.filter((n) => n.ki_schritte?.status === "fertig" && n.status !== "beantwortet");
  const ids = new Set(schritte.flatMap((n) => [n.ki_schritte.antwort_id, n.ki_schritte.auftrag_id]));
  const karten = [
    ...schritte.map((n) => ({
      ort: ["Schaden", ort(n)].filter(Boolean).join(" · "), titel: n.betreff || "(ohne Betreff)",
      text: n.ki_schritte.dienstleister
        ? `Antwort an ${n.absender_name || "die Mietpartei"} und Auftrag an ${n.ki_schritte.dienstleister.name} liegen bereit.`
        : `Antwort an ${n.absender_name || "die Mietpartei"} liegt bereit.`,
      href: `#/postfach/${n.id}`, knopf: "Ansehen und senden",
    })),
    ...entwuerfe.filter((a) => !ids.has(a.id)).map((a) => ({
      ort: a.art === "auftrag" ? "Auftrag" : "Entwurf", titel: a.betreff || "(ohne Betreff)",
      text: `An ${a.empfaenger_name || a.empfaenger_email || "–"}, noch nicht gesendet.`,
      href: a.nachricht_id ? `#/postfach/${a.nachricht_id}` : `#/entwurf/${a.id}`, knopf: "Öffnen",
    })),
  ].slice(0, 3);
  if (!karten.length) return "";
  return `
    <section class="flaeche vorbereitet" aria-label="Von der KI vorbereitet">
      <div class="vorbereitet__kopf"><h2>${ICON_KI} Die KI hat vorbereitet</h2><span>Nichts geht ohne dein Ja raus</span></div>
      <div class="vorbereitet__karten">${karten.map((k) => `
        <div class="vorschlagkarte">
          <span class="vorschlagkarte__ort">${esc(k.ort)}</span>
          <span class="vorschlagkarte__titel">${esc(k.titel)}</span>
          <span class="vorschlagkarte__text">${esc(k.text)}</span>
          <div class="knopfreihe"><a class="knopf knopf--primaer knopf--klein" href="${esc(k.href)}">${esc(k.knopf)}</a></div>
        </div>`).join("")}</div>
    </section>`;
}

function todoZeile(t) {
  const kopf = `
      <span class="todo__art">${esc(t.art)}${t.ort ? `<span class="todo__ort"> · ${esc(t.ort)}</span>` : ""}</span>
      <span class="todo__titel">${esc(t.titel)}</span>
      ${t.unter || t.marken || t.hinweis ? `<span class="todo__unter">${t.marken}${t.unter ? `<span>${esc(t.unter)}</span>` : ""}${t.hinweis ? `<em>${esc(t.hinweis)}</em>` : ""}</span>` : ""}`;
  const haupt = t.aufgabe
    ? `<button type="button" class="todo__haupt" data-aufgabe="${esc(t.aufgabe.id)}">${kopf}</button>`
    : `<a class="todo__haupt" href="${esc(t.href)}">${kopf}</a>`;
  return `
    <div class="todo todo--s${t.stufe}">
      ${haupt}
      <span class="todo__wann ${t.wannNot ? "todo__wann--not" : ""}">${esc(t.wann || "")}</span>
      ${t.aufgabe ? `<button type="button" class="todo__haken" data-erledigt="${esc(t.aufgabe.id)}" title="Erledigt" aria-label="Erledigt: ${esc(t.titel)}">${ICON_HAKEN}</button>`
        : t.geburtstag ? `<button type="button" class="todo__haken" data-geburtstag="${esc(t.geburtstag.id)}" data-jahr="${t.geburtstag.jahr}" title="Gratuliert" aria-label="Gratuliert: ${esc(t.titel)}">${ICON_HAKEN}</button>`
        : `<span class="todo__haken todo__haken--leer" aria-hidden="true"></span>`}
    </div>`;
}

// Erledigtes (Filter „Erledigt“ auf der Übersicht): schlicht, mit „Wieder öffnen“ bei Notizen
const ICON_ZURUECK = `<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M12.5 8c-2.65 0-5.05 1-6.9 2.6L2 7v9h9l-3.62-3.62A7.95 7.95 0 0 1 20.1 16l2.37-.78A10.5 10.5 0 0 0 12.5 8z"/></svg>`;
function erledigtZeile(t) {
  const kopf = `
      <span class="todo__art">${esc(t.art)}${t.ort ? `<span class="todo__ort"> · ${esc(t.ort)}</span>` : ""}</span>
      <span class="todo__titel">${esc(t.titel)}</span>
      ${t.unter ? `<span class="todo__unter"><span>${esc(t.unter)}</span></span>` : ""}`;
  return `
    <div class="todo todo--erledigt">
      ${t.aufgabe ? `<button type="button" class="todo__haupt" data-aufgabe="${esc(t.aufgabe.id)}">${kopf}</button>` : `<a class="todo__haupt" href="${esc(t.href)}">${kopf}</a>`}
      <span class="todo__wann">${esc(t.wann || "")}</span>
      ${t.aufgabe ? `<button type="button" class="todo__haken todo__haken--zurueck" data-wieder="${esc(t.aufgabe.id)}" title="Wieder öffnen" aria-label="Wieder öffnen: ${esc(t.titel)}">${ICON_ZURUECK}</button>`
        : `<span class="todo__haken todo__haken--leer" aria-hidden="true"></span>`}
    </div>`;
}

/** Erledigtes der letzten Zeit: Notizen/Wiedervorlagen, beantwortete Nachrichten, Gratulationen dieses Jahr */
async function sammleErledigt({ namen = {}, kontaktListe = [] }) {
  const [aufgaben, nachrichten] = await Promise.all([
    db.ladeAufgaben({ status: "erledigt" }).catch(() => []),
    db.ladeNachrichten({ status: ["beantwortet", "erledigt"], anzahl: 40 }).catch(() => []),
  ]);
  const jahr = Number(heuteISO().slice(0, 4));
  const liste = [
    ...aufgaben.map((a) => ({
      art: a.faellig_am ? "Wiedervorlage" : "Notiz", aufgabe: a, titel: a.titel,
      zeit: a.erledigt_am || a.aktualisiert_am || a.erstellt_am,
      unter: [a.mieter_id ? namen[a.mieter_id] : a.kontakt_id ? kontakte.kontaktName(kontakte.kontaktVon(a.kontakt_id)) : a.dienstleister?.name || (a.objekt_id ? objektVon(a.objekt_id)?.bezeichnung : ""),
        a.faellig_am ? `war fällig ${datumDE(a.faellig_am)}` : ""].filter(Boolean).join(" · "),
    })),
    ...nachrichten.map((n) => ({
      art: n.status === "beantwortet" ? "Beantwortet" : "Nachricht erledigt", href: `#/postfach/${n.id}`, titel: n.betreff || "(ohne Betreff)",
      zeit: n.eingang_am, unter: (n.mieter_id && namen[n.mieter_id]) || n.absender_name || n.absender_email || "",
    })),
    ...kontaktListe.filter((k) => Number(k.geburtstag_erledigt) === jahr).map((k) => ({
      art: "Geburtstag", href: `#/kontakt/${k.id}`, titel: kontakte.kontaktName(k), zeit: null, unter: "gratuliert",
    })),
  ];
  liste.sort((x, y) => String(y.zeit || "").localeCompare(String(x.zeit || "")));
  return liste.map((t) => ({ ...t, wann: t.zeit ? (t.aufgabe ? `erledigt ${kurzDatum(String(t.zeit).slice(0, 10))}` : kurzDatum(String(t.zeit).slice(0, 10))) : "" }));
}

function todoListe({ jetzt, spaeter }, { leer = "Nichts zu tun. Schön!" } = {}) {
  const erste = jetzt.slice(0, SICHTBAR), rest = jetzt.slice(SICHTBAR);
  return `
    ${jetzt.length ? `<div class="todos">${erste.map(todoZeile).join("")}</div>` : `<div class="leer">${esc(leer)}</div>`}
    ${rest.length ? `<details class="mehr"><summary>${rest.length} weitere anzeigen</summary><div class="todos">${rest.map(todoZeile).join("")}</div></details>` : ""}
    ${spaeter.length ? `<details class="mehr"><summary>Später (${spaeter.length} Wiedervorlagen)</summary><div class="todos">${spaeter.map(todoZeile).join("")}</div></details>` : ""}`;
}

function verbindeTodos(root, { aufgaben, nachher }) {
  for (const b of $$("[data-aufgabe]", root)) {
    b.addEventListener("click", () => aufgabeDialog(aufgaben.find((a) => a.id === b.dataset.aufgabe), { nachher }));
  }
  for (const b of $$("[data-geburtstag]", root)) {
    b.addEventListener("click", async () => {
      b.disabled = true;
      try {
        await db.speichereKontakt(b.dataset.geburtstag, { geburtstag_erledigt: Number(b.dataset.jahr) });
        await kontakte.kontakteListe(true);
        melde("Erledigt. Nächstes Jahr erinnert die App wieder.", "ok");
        nachher();
      } catch (err) {
        b.disabled = false;
        melde(err.message, "fehler");
      }
    });
  }
  for (const b of $$("[data-wieder]", root)) {
    b.addEventListener("click", async () => {
      b.disabled = true;
      try {
        await db.speichereAufgabe(b.dataset.wieder, { status: "offen", erledigt_am: null });
        melde("Wieder offen.", "ok");
        nachher();
      } catch (err) {
        b.disabled = false;
        melde(err.message, "fehler");
      }
    });
  }
  for (const b of $$("[data-erledigt]", root)) {
    b.addEventListener("click", async () => {
      b.disabled = true;
      try {
        await db.speichereAufgabe(b.dataset.erledigt, { status: "erledigt", erledigt_am: new Date().toISOString() });
        melde("Erledigt.", "ok");
        nachher();
      } catch (err) {
        b.disabled = false;
        melde(err.message, "fehler");
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Übersicht
// ---------------------------------------------------------------------------
export async function zeigeStart() {
  const monate = letzteMonate(4);
  const [liste, forderungen, vorgaenge, nachrichten, aufgaben, antworten, mieterL, kontaktListe] = await Promise.all([
    db.ladeUebersicht(),
    db.ladeForderungen({ abMonat: monate[0] }),
    db.ladeVorgaenge({ anzahl: 200 }),
    db.ladeNachrichten({ status: ["neu", "offen"], anzahl: 100 }).catch(() => []),
    db.ladeAufgaben().catch(() => []),
    db.ladeAntworten({ anzahl: 50 }).catch(() => []),
    mieterListe(),
    kontakte.kontakteListe(true),
  ]);
  const namen = Object.fromEntries(mieterL.map((m) => [m.id, mieterName(m)]));
  const rueckstand = liste.filter((m) => Number(m.offen_summe) > 0).sort((a, b) => b.offen_summe - a.offen_summe);
  const gesamt = rueckstand.reduce((s, m) => s + Number(m.offen_summe), 0);
  const entwuerfe = antworten.filter((a) => a.status === "entwurf");
  const orte = Object.fromEntries(liste.map((m) => [m.id, [m.objekt, m.wohnung].filter(Boolean).join(", ")]));
  // Neue Schadensmeldungen: Antwort und Handwerker-Auftrag im Hintergrund vorbereiten („Ja und Ja“)
  postfach.bereiteImHintergrundVor(nachrichten).catch(() => null);
  const todos = sammle({ nachrichten, aufgaben, rueckstand, vorgaenge, entwuerfe, namen, kontaktListe, orte });
  const dringend = todos.jetzt.filter((t) => t.stufe <= 1).length;
  const wiedervorlagen = [...todos.jetzt.filter((t) => t.art === "Wiedervorlage" || t.art === "To-do"), ...todos.spaeter]
    .sort((x, y) => String(x.datum).localeCompare(String(y.datum)));
  const filter = ["alle", "eilig", "wiedervorlage", "rueckstand", "erledigt"].includes(zustand.startFilter) ? zustand.startFilter : "alle";
  const neu = nachrichten.filter((n) => n.status === "neu").length;
  const nachName = Object.fromEntries(liste.map((m) => [m.id, m]));

  // Häuser mit offenen Punkten
  const haeuser = zustand.stamm.objekte.map((o) => {
    const leute = liste.filter((m) => m.objekt_id === o.id);
    const ids = new Set(leute.map((m) => m.id));
    const offen = leute.reduce((s, m) => s + Number(m.offen_summe || 0), 0);
    const punkte = todos.jetzt.filter((t) =>
      (t.aufgabe && (t.aufgabe.objekt_id === o.id || ids.has(t.aufgabe.mieter_id))) ||
      (t.href && [...ids].some((id) => t.href === `#/mieter/${id}`)) ||
      nachrichten.some((n) => (ids.has(n.mieter_id) || n.objekt_id === o.id) && t.href === `#/postfach/${n.id}`)).length;
    return { o, leute: leute.length, offen, punkte };
  });

  inhalt().innerHTML = `
    <div class="kopf">
      <div><h1>Übersicht</h1><p>${esc(zustand.profil?.firma || "")}, ${datumDE(new Date())}</p></div>
      <div class="knopfreihe">
        <button type="button" class="knopf knopf--primaer" id="notiz-neu">${ICON_PLUS} Notiz</button>
        <button type="button" class="knopf" id="einsprechen" title="Gespräch festhalten: die KI ordnet es dem Kontakt zu">${ICON_MIKRO} Notiz einsprechen</button>
        <label class="knopf">${ICON_KAMERA} Foto / Datei<input type="file" accept="image/*,application/pdf,.docx,.xlsx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" id="erfassen" multiple hidden></label>
      </div>
    </div>
    <div class="lage lage--kompakt">
      <div class="lage__kachel">
        <div class="lage__wert ${dringend ? "lage__wert--offen" : ""}">${todos.jetzt.length}</div>
        <div class="lage__text">zu erledigen</div>
        ${dringend ? `<button type="button" class="lage__zusatz lage__zusatz--offen" data-filter="eilig">${dringend} davon eilig</button>` : `<span class="lage__zusatz">nichts Eiliges</span>`}
        <div class="lage__mehr">
          ${wiedervorlagen.length ? `<button type="button" class="lage__link" data-filter="wiedervorlage">${wiedervorlagen.length} ${wiedervorlagen.length === 1 ? "Wiedervorlage" : "Wiedervorlagen"}</button>` : ""}
          <button type="button" class="lage__link" data-filter="erledigt">Erledigtes ansehen</button>
        </div>
      </div>
      <a class="lage__kachel" href="#/postfach">
        <div class="lage__wert">${neu}</div>
        <div class="lage__text">${neu === 1 ? "neue Nachricht" : "neue Nachrichten"}</div>
        <span class="lage__zusatz">im Postfach</span>
      </a>
      <button type="button" class="lage__kachel" id="zu-rueckstand" ${rueckstand.length ? "" : "disabled"}>
        <div class="lage__wert ${gesamt > 0 ? "lage__wert--offen" : ""}">${euro(gesamt)}</div>
        <div class="lage__text">Mietrückstand</div>
        <span class="lage__zusatz">${rueckstand.length ? `${rueckstand.length} von ${liste.length} Mietparteien` : "alles bezahlt"}</span>
      </button>
    </div>
    ${vorbereitetHtml(nachrichten, entwuerfe, orte)}

    <div class="start">
      <section class="flaeche start__liste" id="zu-erledigen">
        <div class="flaeche__kopf"><h2>Zu erledigen</h2><span class="leise" id="todo-sortierung">das Dringendste zuerst</span></div>
        <div class="reiter reiter--filter" role="group" aria-label="Anzeigen">
          ${[["alle", "Alle", todos.jetzt.length], ["eilig", "Eilig", dringend], ["wiedervorlage", "Wiedervorlagen", wiedervorlagen.length], ["rueckstand", "Rückstände", todos.rueck.length], ["erledigt", "Erledigt", null]]
            .map(([w, t, n]) => `<button type="button" class="reiter__knopf" data-filter="${w}" aria-pressed="${w === filter}">${t}${n != null ? ` <span class="reiter__zahl">${n}</span>` : ""}</button>`).join("")}
        </div>
        <div id="todo-inhalt"></div>
      </section>

      <div class="stapel">
        <section class="flaeche">
          <div class="flaeche__kopf"><h2>Häuser</h2></div>
          <div class="haeuser">
            ${haeuser.map(({ o, leute, offen, punkte }) => `
              <a class="haus" href="#/objekt/${esc(o.id)}">
                <span class="haus__name">${esc(o.bezeichnung)}</span>
                <span class="leise">${esc([o.strasse, o.ort].filter(Boolean).join(", "))}</span>
                <span class="haus__zahlen">
                  <span>${leute} Mietparteien</span>
                  ${punkte ? `<span class="marker">${punkte} zu erledigen</span>` : ""}
                  ${offen > 0 ? `<span class="marker marker--offen">${euro(offen)} offen</span>` : ""}
                </span>
              </a>`).join("")}
            <a class="haus haus--allgemein" href="#/objekt/allgemein">
              <span class="haus__name">Allgemein</span>
              <span class="leise">Unterlagen und Wissen, die zu keinem Haus gehören</span>
            </a>
          </div>
        </section>

        <details class="flaeche ausklapp" id="rueckstaende">
          <summary>Mietrückstände (${rueckstand.length})</summary>
          ${LEGENDE.replace('class="mietbuch-legende"', 'class="mietbuch-legende mietbuch-legende--innen"')}
          ${rueckstand.length
            ? `<div class="zeilen">${rueckstand.map((m) => mieterZeile(m, forderungen, monate,
                `<span class="zeile__schritt">Als Nächstes: ${esc(naechsterSchritt(m, vorgaenge))}</span>`, true)).join("")}</div>`
            : `<div class="leer">Alle Mieten sind bezahlt.</div>`}
        </details>

        <details class="flaeche ausklapp">
          <summary>Zuletzt erstellte Schreiben</summary>
          ${vorgaenge.length
            ? `<div class="kacheln kacheln--eng">${vorgaenge.slice(0, 6).map((v) => schreibenKachel(v, mieterName(nachName[v.mieter_id] || { nachname: "?" }))).join("")}</div>`
            : `<div class="leer">Noch keine Schreiben erstellt.</div>`}
        </details>
      </div>
    </div>`;

  // Filter über der Liste (bleibt beim Zurückkommen erhalten)
  let erledigtCache = null;
  const zeigeFilter = async (f, { scrollen = false } = {}) => {
    zustand.startFilter = f;
    for (const b of $$(".reiter--filter [data-filter]", inhalt())) b.setAttribute("aria-pressed", String(b.dataset.filter === f));
    const ziel = $("#todo-inhalt");
    $("#todo-sortierung").textContent = f === "wiedervorlage" ? "nach Datum" : f === "rueckstand" ? "Mahnung fällig zuerst" : f === "erledigt" ? "das Neueste zuerst" : "das Dringendste zuerst";
    if (f === "erledigt") {
      ziel.innerHTML = `<div class="leer">Lädt …</div>`;
      erledigtCache ||= await sammleErledigt({ namen, kontaktListe });
      if (zustand.startFilter !== "erledigt") return;
      const erste = erledigtCache.slice(0, 15), rest = erledigtCache.slice(15, 60);
      ziel.innerHTML = erledigtCache.length
        ? `<div class="todos">${erste.map(erledigtZeile).join("")}</div>
           ${rest.length ? `<details class="mehr"><summary>${rest.length} ältere anzeigen</summary><div class="todos">${rest.map(erledigtZeile).join("")}</div></details>` : ""}`
        : `<div class="leer">Noch nichts erledigt.</div>`;
      const alle = erledigtCache.filter((t) => t.aufgabe).map((t) => t.aufgabe);
      verbindeTodos(ziel, { aufgaben: alle, nachher: zeigeStart });
    } else {
      ziel.innerHTML = f === "eilig"
        ? todoListe({ jetzt: todos.jetzt.filter((t) => t.stufe <= 1), spaeter: [] }, { leer: "Nichts Eiliges. Gut so!" })
        : f === "wiedervorlage"
        ? todoListe({ jetzt: wiedervorlagen, spaeter: [] }, { leer: "Keine Wiedervorlagen." })
        : f === "rueckstand"
        ? todoListe({ jetzt: todos.rueck, spaeter: [] }, { leer: "Keine Rückstände. Alles bezahlt." })
        : todoListe(todos);
      verbindeTodos(ziel, { aufgaben, nachher: zeigeStart });
    }
    if (scrollen) $("#zu-erledigen").scrollIntoView({ behavior: "smooth", block: "start" });
  };
  for (const b of $$("[data-filter]", inhalt())) {
    b.addEventListener("click", () => zeigeFilter(b.dataset.filter, { scrollen: !!b.closest(".lage") }));
  }
  await zeigeFilter(filter);
  $("#zu-rueckstand").addEventListener("click", () => {
    const d = $("#rueckstaende");
    d.open = true;
    d.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("#notiz-neu").addEventListener("click", () => aufgabeDialog(null, { nachher: zeigeStart }));
  $("#einsprechen").addEventListener("click", () => kontakte.notizEinsprechen());
  $("#erfassen").addEventListener("change", (e) => { const d = [...e.target.files]; e.target.value = ""; ablage.erfasseAlle(d); });
  for (const b of $$("[data-schreiben]", inhalt())) {
    b.addEventListener("click", async () => {
      const v = vorgaenge.find((x) => x.id === b.dataset.schreiben);
      const m = v && (await db.ladeMieter(v.mieter_id).catch(() => null));
      oeffneSchreiben(v, m);
    });
  }
}

// ---------------------------------------------------------------------------
// Seite eines Hauses (oder „Allgemein“): Zu erledigen, Mietparteien, Dokumente, Wissen, Handwerker
// ---------------------------------------------------------------------------
export async function zeigeObjekt(id) {
  const allgemein = id === "allgemein";
  const o = allgemein ? null : objektVon(id);
  if (!allgemein && !o) throw new Error("Dieses Haus gibt es nicht (mehr).");
  const objektId = allgemein ? null : o.id;
  const monate = letzteMonate(6);
  const [liste, forderungen, vorgaenge, nachrichten, aufgaben, antworten, dokumente, wissen, dienstleister, mieterL] = await Promise.all([
    ablage.ordnerListe().then(() => db.ladeUebersicht()),
    allgemein ? [] : db.ladeForderungen({ abMonat: monate[0] }),
    db.ladeVorgaenge({ anzahl: 200 }),
    db.ladeNachrichten({ status: ["neu", "offen"], anzahl: 100 }).catch(() => []),
    db.ladeAufgaben().catch(() => []),
    db.ladeAntworten({ anzahl: 50 }).catch(() => []),
    db.ladeDokumente({ objektId }).catch(() => []),
    db.ladeWissen().catch(() => []),
    db.ladeDienstleister().catch(() => []),
    mieterListe(),
  ]);
  const namen = Object.fromEntries(mieterL.map((m) => [m.id, mieterName(m)]));
  const leute = allgemein ? [] : liste.filter((m) => m.objekt_id === o.id);
  const ids = new Set(leute.map((m) => m.id));
  const gehoertHierher = (x) => (allgemein ? !x.mieter_id && !x.objekt_id : x.objekt_id === o.id || ids.has(x.mieter_id));
  const todos = sammle({
    nachrichten: nachrichten.filter((n) => (allgemein ? !n.mieter_id && !n.objekt_id : ids.has(n.mieter_id) || n.objekt_id === o.id)),
    aufgaben: aufgaben.filter(gehoertHierher),
    rueckstand: leute.filter((m) => Number(m.offen_summe) > 0),
    vorgaenge,
    entwuerfe: antworten.filter((a) => a.status === "entwurf" && (allgemein ? !a.mieter_id : ids.has(a.mieter_id))),
    namen,
  });
  const wissenHier = wissen.filter((w) => (w.objekt_id || null) === objektId);
  const dienstHier = dienstleister.filter((d) => !d.objekt_id || d.objekt_id === objektId);
  const titel = allgemein ? "Allgemein" : o.bezeichnung;
  const neuLaden = () => zeigeObjekt(id);

  inhalt().innerHTML = `
    ${brotkrumen([...KRUMEN.objekte, { text: titel }])}
    <div class="kopf">
      <div><h1>${esc(titel)}</h1>
        <p>${allgemein ? "Unterlagen, Wissen und Notizen, die zu keinem bestimmten Haus gehören." : esc([o.strasse, [o.plz, o.ort].filter(Boolean).join(" ")].filter(Boolean).join(", "))}</p></div>
      <div class="knopfreihe">
        <button type="button" class="knopf knopf--primaer" id="notiz-neu">${ICON_PLUS} Notiz</button>
        <label class="knopf">${ICON_KAMERA} Dokument ablegen<input type="file" accept="image/*,application/pdf,.docx,.xlsx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" id="erfassen" multiple hidden></label>
        <button type="button" class="knopf" id="wissen-sprechen">${ICON_KI} Wissen einsprechen</button>
        ${allgemein ? "" : `<a class="knopf" href="#/schreiben/h-${esc(o.id)}">An alle Mietparteien schreiben</a>`}
      </div>
    </div>
    <div class="stapel">
      <details class="flaeche ausklapp" open>
        <summary>Zu erledigen (${todos.jetzt.length})</summary>
        ${todoListe(todos, { leer: "Für dieses Haus ist gerade nichts offen." })}
      </details>
      ${allgemein ? "" : `
      <details class="flaeche ausklapp" open>
        <summary>Mietparteien (${leute.length})</summary>
        ${leute.length ? `${LEGENDE.replace('class="mietbuch-legende"', 'class="mietbuch-legende mietbuch-legende--innen"')}
          <div class="zeilen">${leute.map((m) => mieterZeile(m, forderungen, monate)).join("")}</div>` : `<div class="leer">Keine Mietparteien erfasst.</div>`}
      </details>`}
      <details class="flaeche ausklapp" ${dokumente.length && dokumente.length <= 12 ? "open" : ""}>
        <summary>Dokumente (${dokumente.length})</summary>
        ${ablage.ablegeflaecheHtml({ text: "Dateien hierher ziehen", klein: true })}
        ${ablage.dokumentListe(dokumente, { leer: "Noch keine Dokumente. Mit „Dokument ablegen“ ein Foto oder PDF hinzufügen." })}
        <div class="flaeche__fuss knopfreihe">
          <a class="knopf knopf--klein knopf--primaer" href="#/ablage/${esc(id)}">Alle Ordner öffnen</a>
          <button type="button" class="knopf knopf--klein" id="ordner-bearbeiten">Ordner bearbeiten</button>
          ${dokumente.length ? `<button type="button" class="knopf knopf--klein" id="zip">Als ZIP herunterladen</button>` : ""}
        </div>
      </details>
      <details class="flaeche ausklapp">
        <summary>Wissen (${wissenHier.length})</summary>
        ${ablage.wissenListe(wissenHier)}
        <div class="flaeche__fuss knopfreihe"><button type="button" class="knopf knopf--klein" id="wissen-neu">Eintrag tippen</button></div>
      </details>
      <details class="flaeche ausklapp">
        <summary>Handwerker &amp; Dienstleister (${dienstHier.length})</summary>
        ${ablage.dienstleisterListe(dienstHier)}
        <div class="flaeche__fuss knopfreihe"><button type="button" class="knopf knopf--klein" id="dienst-neu">${ICON_PLUS} Hinzufügen</button></div>
      </details>
      ${allgemein ? "" : `
      <details class="flaeche ausklapp">
        <summary>Einstellungen zum Haus</summary>
        <form class="flaeche__inhalt" id="hausformular">
          <label class="feld"><span>Orts-Kürzel für Dateinamen</span>
            <input name="kuerzel" value="${esc(o.kuerzel || "")}" maxlength="10" placeholder="z. B. SR" autocomplete="off" style="max-width: 8rem">
            <span class="feldhinweis feldhinweis--leise">Dateinamen: ${esc(ablage.dokumentTitel({ datum: heuteISO(), objekt: { ...o, kuerzel: o.kuerzel || "SR" }, art: "Rechnung", details: "Sanitär Gruber_102,89" }))}</span></label>
          <label class="feld"><span>Kappungsgrenze für Mieterhöhungen</span>
            <select name="kappungsgrenze">
              <option value="20" ${Number(o.kappungsgrenze) !== 15 ? "selected" : ""}>20 % in drei Jahren (Normalfall)</option>
              <option value="15" ${Number(o.kappungsgrenze) === 15 ? "selected" : ""}>15 % in drei Jahren (Gemeinde mit angespanntem Wohnungsmarkt)</option>
            </select>
            <span class="feldhinweis feldhinweis--leise">Ob 15 % gelten, legt das Land per Verordnung fest. Im Zweifel bei Haus &amp; Grund nachfragen.</span></label>
          <div class="knopfreihe"><button class="knopf knopf--primaer" type="submit">Speichern</button></div>
        </form>
      </details>`}
    </div>`;

  verbindeTodos(inhalt(), { aufgaben, nachher: neuLaden });
  ablage.verbindeListen(inhalt(), { dokumente, wissen: wissenHier, dienstleister: dienstHier, objektId, nachher: neuLaden });
  $("#notiz-neu").addEventListener("click", () => aufgabeDialog({ objekt_id: objektId }, { nachher: neuLaden }));
  $("#erfassen").addEventListener("change", (e) => { const d = [...e.target.files]; e.target.value = ""; ablage.erfasseAlle(d, { objektId, nurAblage: true }); });
  ablage.verbindeAblegeflaeche($("[data-ablegeflaeche]", inhalt()), { objektId, nurAblage: true });
  $("#wissen-sprechen").addEventListener("click", () => ablage.wissenEinsprechen({ objektId, nachher: neuLaden }));
  $("#wissen-neu").addEventListener("click", () => ablage.bearbeiteWissen({ objekt_id: objektId }, { nachher: neuLaden }));
  $("#dienst-neu").addEventListener("click", () => ablage.bearbeiteDienstleister({ objekt_id: objektId }, { nachher: neuLaden }));
  $("#ordner-bearbeiten").addEventListener("click", () => ablage.ordnerBearbeiten({ nachher: neuLaden }));
  $("#zip")?.addEventListener("click", () => ablage.zipExport({ objektId }));
  $("#hausformular")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const f = new FormData(e.currentTarget);
      const neu = await db.speichereObjekt(o.id, {
        kappungsgrenze: Number(f.get("kappungsgrenze")),
        kuerzel: String(f.get("kuerzel") || "").trim().toUpperCase() || null,
      });
      Object.assign(objektVon(o.id) || {}, neu);
      Object.assign(o, neu);
      melde("Gespeichert.", "ok");
    } catch (err) { melde(err.message, "fehler"); }
  });
}

// ---------------------------------------------------------------------------
// Notiz / Wiedervorlage anlegen oder bearbeiten
// a: vorhandene Aufgabe (mit id) oder Vorbelegung { titel, notiz, mieter_id, objekt_id, nachricht_id, faellig_am }
// ---------------------------------------------------------------------------
/** „m:<id>“ | „d:<id>“ | „k:<id>“ → Spalten der Aufgabe */
function bezugFelder(wert) {
  const w = String(wert || "");
  const id = w.slice(2) || null;
  return { mieter_id: w.startsWith("m:") ? id : null, dienstleister_id: w.startsWith("d:") ? id : null, kontakt_id: w.startsWith("k:") ? id : null };
}

export async function aufgabeDialog(a = null, { nachher = () => {}, vorschlag = null } = {}) {
  a = a || {};
  const [mieterL, kontaktListe, dienstL] = await Promise.all([mieterListe(), kontakte.kontakteListe(), db.ladeDienstleister().catch(() => [])]);
  const vorhanden = !!a.id;
  // Ein Feld „Betrifft“ mit Suche: Mietparteien, Handwerker, Sonstige
  const bezugListe = [
    { wert: "", name: "Niemand bestimmtes", gruppe: "" },
    ...mieterL.map((m) => ({ wert: `m:${m.id}`, name: mieterName(m), zusatz: ortVon(m), gruppe: "Mietparteien", nachname: m.nachname })),
    ...dienstL.filter((d) => d.aktiv !== false || d.id === a.dienstleister_id).map((d) => ({ wert: `d:${d.id}`, name: d.name, zusatz: d.gewerk || "", gruppe: "Handwerker" })),
    ...kontaktListe.map((k) => ({ wert: `k:${k.id}`, name: kontakte.kontaktName(k), zusatz: [k.vorname || k.nachname ? k.firma : "", k.rolle].filter(Boolean).join(" · "), gruppe: "Sonstige" })),
  ];
  const bezugStart = a.mieter_id ? `m:${a.mieter_id}` : a.dienstleister_id ? `d:${a.dienstleister_id}` : a.kontakt_id ? `k:${a.kontakt_id}` : "";
  const bezugName = bezugListe.find((x) => x.wert === bezugStart && x.wert)?.name || "";
  const kiDa = !!zustand.ki?.ki;
  // Bestehendes To-do ohne jede Zuordnung: Häkchen „Nur To-do“ gesetzt
  const nurTodoStart = vorhanden && !!a.faellig_am && !a.mieter_id && !a.objekt_id && !a.kontakt_id && !a.dienstleister_id;
  const faellig = vorschlag?.wiedervorlage || a.faellig_am || "";
  const abgelegt = vorhanden ? await db.ladeAbgelegte("aufgabe_id", [a.id]).catch(() => []) : [];
  const daten = await dialogFormular(`
    <h2>${vorhanden ? "Notiz" : "Neue Notiz"}</h2>
    ${abgelegt.length ? `<p>${ablage.abgelegtHtml(abgelegt)}</p>` : ""}
    <label class="feld"><span>Worum geht es?</span>
      <span class="diktat"><input name="titel" required maxlength="200" value="${esc(a.titel || "")}" placeholder="z. B. Check Möglichkeit Mieterhöhung Huber" autocomplete="off">${mikroKnopf()}</span></label>
    <label class="feld"><span>Notiz (optional)</span>
      <span class="diktat"><textarea name="notiz" rows="3">${esc(a.notiz || "")}</textarea>${mikroKnopf()}</span></label>
    <label class="checkfeld"><input type="checkbox" name="nur_todo" ${nurTodoStart ? "checked" : ""}>
      Nur To-do (keiner Person und keinem Haus zuordnen) – erscheint in der Übersicht zum Fälligkeitsdatum</label>
    <div data-zuordnung ${nurTodoStart ? "hidden" : ""}>
    ${suchauswahlHtml({ label: "Betrifft (Mieter, Handwerker, Sonstige)", placeholder: "Name suchen …", wert: bezugName, name: "bezug", versteckt: bezugStart, inline: true })}
    </div>
    <div class="formraster formraster--zwei">
      <label class="feld" data-zuordnung ${nurTodoStart ? "hidden" : ""}><span>Haus</span><select name="objekt_id">
        <option value="">–</option>
        ${zustand.stamm.objekte.map((o) => `<option value="${esc(o.id)}" ${o.id === a.objekt_id ? "selected" : ""}>${esc(o.bezeichnung)}</option>`).join("")}
      </select></label>
      <label class="feld"><span data-datum-titel>${nurTodoStart ? "Fällig am" : "Wiedervorlage am"}</span><input type="date" name="faellig_am" value="${esc(faellig)}" min="2020-01-01" max="2099-12-31">
        ${vorschlag?.wiedervorlage && vorschlag.wiedervorlage !== a.faellig_am ? `<span class="feldhinweis">Vorschlag der KI – mit „Speichern“ übernehmen.</span>` : ""}</label>
      <label class="feld"><span>In der Liste zeigen ab … Tage vorher</span><input type="number" name="vorlauf_tage" min="0" max="60" value="${esc(a.vorlauf_tage ?? 7)}"></label>
    </div>
    ${a.antwort ? `<div class="ki-antwort"><strong>${ICON_KI} Einschätzung der KI</strong>${vorschlag ? "" : ` <span class="leise">(vom ${esc(datumDE(a.aktualisiert_am))})</span>`}
      <p>${esc(a.antwort)}</p>
      ${vorschlag?.fehlend?.length ? `<p class="leise">Für eine sichere Antwort fehlt: ${esc(vorschlag.fehlend.join(", "))}.</p>` : ""}
      <p class="leise">Nur ein Vorschlag, keine Rechtsberatung.</p></div>` : ""}
    <div class="knopfreihe">
      ${vorhanden ? `<button class="knopf knopf--gefahr knopf--links" value="loeschen" formnovalidate>Löschen</button>` : ""}
      <button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button>
      ${kiDa ? `<button class="knopf knopf--ki" value="pruefen" data-zuordnung ${nurTodoStart ? "hidden" : ""}>${ICON_KI} Mit KI prüfen</button>` : ""}
      <button class="knopf" value="ablage" title="Notiz speichern und als PDF in die Ablage legen">In Ablage</button>
      ${vorhanden && a.status !== "erledigt" ? `<button class="knopf" value="erledigt">Erledigt</button>` : ""}
      <button class="knopf knopf--primaer" value="ok">Speichern</button>
    </div>`, {
    breit: true,
    vorbereiten: (form) => {
      verbindeDiktat(form);
      // „Nur To-do“: Zuordnung ausblenden, Datum heißt „Fällig am“ (leer = heute)
      form.nur_todo.addEventListener("change", () => {
        const an = form.nur_todo.checked;
        for (const el of $$("[data-zuordnung]", form)) el.hidden = an;
        $("[data-datum-titel]", form).textContent = an ? "Fällig am" : "Wiedervorlage am";
        if (an && !form.faellig_am.value) form.faellig_am.value = heuteISO();
      });
      // „In der Ablage“ öffnet das Dokument (der Notiz-Dialog schließt sich dabei)
      for (const b of $$("[data-abgelegt]", form)) {
        b.addEventListener("click", () => {
          const d = abgelegt.find((x) => x.id === b.dataset.abgelegt);
          $("#dialog").close();
          setTimeout(() => ablage.oeffneDokument(d, { nachher }), 0);
        });
      }
      // Mietpartei anhand des Nachnamens im Titel vorschlagen, solange niemand von Hand gewählt ist
      let vonHand = !!bezugStart;
      let automatisch = false;
      const bezug = verbindeSuchauswahl($(".suchauswahl", form), bezugListe, () => { vonHand = true; });
      // Haus passend zur Mietpartei vorbelegen, solange keins gewählt ist
      form.bezug.addEventListener("change", () => {
        const m = form.bezug.value.startsWith("m:") && mieterL.find((x) => x.id === form.bezug.value.slice(2));
        const haus = m && wohnungVon(m.wohnung_id)?.objekt_id;
        if (haus && !form.objekt_id.value) form.objekt_id.value = haus;
      });
      form.titel.addEventListener("input", () => {
        if (vonHand) return;
        const t = ` ${norm(form.titel.value).replace(/[^a-z0-9]+/g, " ")} `;
        const treffer = bezugListe.filter((x) => x.nachname && t.includes(` ${norm(x.nachname).replace(/[^a-z0-9]+/g, " ").trim()} `));
        if (treffer.length === 1) { bezug.setze(treffer[0].wert); automatisch = true; }
        else if (automatisch) { bezug.setze(""); automatisch = false; }
      });
    },
  });
  if (!daten) return;
  const aktion = daten.get("_aktion");
  try {
    if (aktion === "loeschen") {
      if (!(await frage("Notiz löschen?", `<p>„${esc(a.titel)}“ wird gelöscht.</p>`, "Löschen", { gefahr: true }))) return;
      await db.loescheAufgabe(a.id);
      melde("Notiz gelöscht.", "ok");
      return nachher();
    }
    const titel = String(daten.get("titel") || "").trim();
    if (!titel) return melde("Bitte kurz eintragen, worum es geht.", "fehler");
    const vorlauf = Math.min(60, Math.max(0, Number(daten.get("vorlauf_tage")) || 0));
    const nurTodo = daten.get("nur_todo") === "on";
    const felder = {
      titel,
      notiz: String(daten.get("notiz") || "").trim() || null,
      ...bezugFelder(nurTodo ? "" : daten.get("bezug")),
      objekt_id: nurTodo ? null : daten.get("objekt_id") || null,
      faellig_am: daten.get("faellig_am") || (nurTodo ? heuteISO() : null),
      vorlauf_tage: vorlauf,
    };
    if (!vorhanden && a.nachricht_id) felder.nachricht_id = a.nachricht_id;
    if (aktion === "erledigt") Object.assign(felder, { status: "erledigt", erledigt_am: new Date().toISOString() });
    const gespeichert = await db.speichereAufgabe(a.id, felder);
    if (aktion === "pruefen") return pruefeMitKi(gespeichert, nachher);
    if (aktion === "ablage") {
      nachher();
      return ablage.inAblageDialog(eintragNotiz(gespeichert), { nachher, schon: abgelegt });
    }
    melde(aktion === "erledigt" ? "Erledigt." : "Notiz gespeichert.", "ok");
    nachher();
  } catch (err) {
    melde(err.message, "fehler");
  }
}

// Notiz als PDF für die Ablage
function eintragNotiz(a) {
  const m = a.mieter_id ? zustand.mieterKurz?.find?.((x) => x.id === a.mieter_id) : null;
  const hausId = a.objekt_id || (m ? wohnungVon(m.wohnung_id)?.objekt_id : null) || null;
  const haus = hausId ? objektVon(hausId) : null;
  return {
    quelle: { aufgabe_id: a.id },
    richtung: "notiz",
    art: "Notiz", artFest: true,
    datum: heuteISO(),
    objektId: hausId,
    mieterId: a.mieter_id || null,
    gegenueber: m ? mieterName(m) : haus?.bezeichnung || "",
    gegenueberKurz: m?.nachname || null,
    kiText: { titel: a.titel, text: [a.notiz, a.antwort].filter(Boolean).join("\n\n") },
    zusammenfassung: a.titel,
    beschreibung: "Die Notiz wird als PDF abgelegt (mit Einschätzung der KI, falls vorhanden).",
    datei: async () => {
      const mieterL = await mieterListe().catch(() => []);
      const mp = mieterL.find((x) => x.id === a.mieter_id);
      return ablage.pdfEintrag({
        titel: a.titel,
        angaben: [
          ["Erstellt", datumDE(a.erstellt_am || new Date())], ["Wiedervorlage", a.faellig_am ? datumDE(a.faellig_am) : ""],
          ["Status", a.status === "erledigt" ? "erledigt" : "offen"], ["Mietpartei", mp ? mieterName(mp) : ""], ["Haus", haus?.bezeichnung || ""],
        ],
        text: a.notiz || "",
        abschnitte: a.antwort ? [{ titel: "Einschätzung der KI (keine Rechtsberatung)", text: a.antwort }] : [],
      })();
    },
  };
}

// Notiz von der KI prüfen lassen. Die Antwort wird gespeichert; das Datum nur als Vorschlag gezeigt.
async function pruefeMitKi(a, nachher) {
  const warte = wartehinweis("Die KI prüft die Notiz …");
  let r = null;
  try {
    r = await db.funktion("ki", { aktion: "notiz_pruefen", aufgabe_id: a.id });
    a = await db.speichereAufgabe(a.id, { antwort: r.antwort });
  } catch (err) {
    melde("Prüfen nicht möglich: " + err.message, "fehler");
  } finally {
    await warte.ende();
  }
  return aufgabeDialog(a, { nachher, vorschlag: r });
}

/** Mieterhöhung für eine Mietpartei prüfen: vorhandene Notiz nutzen oder anlegen, dann die KI fragen */
export async function mieterhoehungPruefen(mieter, aufgaben, nachher) {
  if (!zustand.ki?.ki) return melde("Die KI ist noch nicht eingerichtet (Einstellungen).", "fehler");
  let a = aufgaben.find((x) => /miet\w*erh(ö|oe)h/i.test(x.titel));
  try {
    a = a || await db.speichereAufgabe(null, { titel: `Check Möglichkeit Mieterhöhung ${mieter.nachname}`, mieter_id: mieter.id });
  } catch (err) {
    return melde(err.message, "fehler");
  }
  return pruefeMitKi(a, nachher);
}

/** Kompakte Liste von Notizen (z. B. in der Mieterakte) */
export function aufgabenKurz(aufgaben) {
  return sammle({ aufgaben });
}
export { todoListe, verbindeTodos };
