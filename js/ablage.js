// Ablage: Fotos/PDFs erfassen (ins Postfach oder als Dokument), Dokumente je Haus, Wissen, Handwerker
// Die KI liest und schlägt Ablage, Namen und Ordner vor. Abgelegt wird erst nach „Ablegen“.
import * as db from "./daten.js";
import { datumDE, mieterName } from "./dokumente.js";
import { $, $$, esc, melde, dialogFormular, frage, heuteISO, dateiTeil, zustand, objektVon } from "./helfer.js";
import {
  ICON_KI, istEmail, norm, geheZu, mieterListe, mieterOptionen, mikroKnopf, verbindeDiktat, wartehinweis, verkleinere, alsBase64,
} from "./ui.js";

export const DOKUMENT_ORDNER = [
  "Rechnungen", "Verträge", "Versorger", "Versicherungen", "Behörden & Steuern", "Handwerker & Angebote", "Mietverhältnisse", "Sonstiges",
];
export const DOKUMENT_ARTEN = ["Rechnung", "Vertrag", "Bescheid", "Abrechnung", "Angebot", "Mahnung", "Brief", "Protokoll", "Notiz", "Sonstiges"];
export const WISSEN_ORDNER = [
  "Abläufe & Hausordnung", "Heizung", "Wasser & Sanitär", "Strom", "Schlüssel & Schließanlage", "Zähler", "Dach & Fassade",
  "Dienstleister & Verträge", "Sonstiges",
];
const GEWERKE = ["Heizung & Sanitär", "Elektro", "Hausmeister", "Schlüssel & Schließanlage", "Maler", "Dach", "Reinigung", "Garten", "Schädlingsbekämpfung"];
const MAX_DATEI = 15 * 1024 * 1024;
const MAX_PDF_KI = 8 * 1024 * 1024;

const optionen = (liste, gewaehlt) => liste.map((x) => `<option ${x === gewaehlt ? "selected" : ""}>${esc(x)}</option>`).join("");
const hausOptionen = (gewaehlt, leer = "Allgemein (kein bestimmtes Haus)") =>
  `<option value="">${esc(leer)}</option>` +
  zustand.stamm.objekte.map((o) => `<option value="${esc(o.id)}" ${o.id === gewaehlt ? "selected" : ""}>${esc(o.bezeichnung)}</option>`).join("");

/** Kurzname eines Hauses für Dateinamen: „Lindenstraße 14“ → „Lindenstr14“ */
export function objektKurz(o) {
  if (!o) return "Allgemein";
  return dateiTeil(String(o.strasse || o.bezeichnung || "").replace(/stra(ß|ss)e/gi, "str")).replace(/-/g, "");
}
export function dokumentTitel({ datum, objekt, absender, art }) {
  return [datum, objektKurz(objekt), dateiTeil(absender || "").replace(/-/g, "").slice(0, 30), dateiTeil(art || "").replace(/-/g, "")]
    .filter(Boolean).join("_");
}

async function istPdfDatei(datei) {
  const kopf = new Uint8Array(await datei.slice(0, 5).arrayBuffer());
  return String.fromCharCode(...kopf) === "%PDF-";
}

// ---------------------------------------------------------------------------
// Foto oder PDF erfassen
// objektId: Haus vorbelegen (null = Allgemein), nurAblage: kein Postfach (z. B. auf der Seite eines Hauses)
// ---------------------------------------------------------------------------
export async function erfasse(datei, { objektId, nurAblage = false } = {}) {
  if (!datei) return;
  if (datei.size > MAX_DATEI) return melde("Die Datei ist zu groß (höchstens 15 MB).", "fehler");
  const pdf = datei.type === "application/pdf" || /\.pdf$/i.test(datei.name || "");
  let blob, base64 = null, vorschau = null;
  try {
    if (pdf) {
      if (!(await istPdfDatei(datei))) return melde("Das ist keine gültige PDF-Datei.", "fehler");
      blob = new Blob([datei], { type: "application/pdf" });
      if (blob.size <= MAX_PDF_KI) base64 = await alsBase64(blob);
    } else {
      const bild = await verkleinere(datei, 2000);
      ({ blob, base64 } = bild);
      vorschau = bild.url;
    }
  } catch (err) {
    return melde("Die Datei konnte nicht gelesen werden: " + err.message, "fehler");
  }

  let erkannt = {};
  if (zustand.ki?.ki && base64) {
    const warte = wartehinweis(pdf ? "Die KI liest das PDF …" : "Die KI liest das Foto …");
    try {
      erkannt = await db.funktion("ki", { aktion: "brief_lesen", bild: { daten: base64, typ: pdf ? "application/pdf" : "image/jpeg" } });
      if (erkannt.lesbar === false) melde("Schwer lesbar. Bitte die Angaben prüfen.", "info");
    } catch (err) {
      melde(err.message, "fehler");
    } finally {
      await warte.ende();
    }
  } else if (zustand.ki?.ki && pdf) {
    melde("Das PDF ist zu groß für die KI. Bitte die Angaben selbst eintragen.", "info");
  }

  const mieterL = await mieterListe();
  const ziel = nurAblage ? "dokument" : erkannt.eingang === "anfrage" ? "anfrage" : erkannt.eingang ? "dokument" : "anfrage";
  const hausStart = objektId !== undefined ? objektId : erkannt.objekt_id || null;
  const datumStart = erkannt.datum || heuteISO();
  const absenderStart = erkannt.absender_kurz || erkannt.absender_name || "";
  const artStart = erkannt.art || "Sonstiges";
  const name = norm(erkannt.absender_name);
  const mieterVermutet = erkannt.mieter_id ||
    (name ? mieterL.find((m) => name.includes(norm(m.nachname)) && (!m.vorname || name.includes(norm(m.vorname))))?.id : null) || null;

  const daten = await dialogFormular(`
    <h2>${pdf ? "PDF" : "Foto"} erfassen</h2>
    ${vorschau ? `<img class="fotovorschau" src="${vorschau}" alt="Vorschau">` : `<p class="dateizeile"><span class="dok__icon">PDF</span> ${esc(datei.name || "Dokument.pdf")} <span class="leise">(${(blob.size / 1048576).toFixed(1).replace(".", ",")} MB)</span></p>`}
    <p class="leise">${erkannt.betreff ? "Von der KI gelesen. Bitte kurz prüfen." : zustand.ki?.ki ? "Bitte die Angaben eintragen." : "Die KI ist noch nicht eingerichtet. Bitte die Angaben selbst eintragen."}</p>
    ${nurAblage ? "" : `
    <div class="wahl" role="radiogroup" aria-label="Wohin damit?">
      <label><input type="radio" name="ziel" value="anfrage" ${ziel === "anfrage" ? "checked" : ""}> <span><strong>Ins Postfach</strong><br><span class="leise">Jemand will etwas, braucht eine Antwort</span></span></label>
      <label><input type="radio" name="ziel" value="dokument" ${ziel === "dokument" ? "checked" : ""}> <span><strong>In die Ablage</strong><br><span class="leise">Rechnung, Vertrag, Bescheid …</span></span></label>
    </div>`}
    <fieldset class="gruppe" data-ziel="dokument">
      <div class="formraster formraster--zwei">
        <label class="feld"><span>Haus</span><select name="objekt_id">${hausOptionen(hausStart)}</select></label>
        <label class="feld"><span>Mietpartei (optional)</span><select name="mieter_id">${mieterOptionen(mieterL, erkannt.mieter_id || null)}</select></label>
        <label class="feld"><span>Ordner</span><select name="ordner">${optionen(DOKUMENT_ORDNER, erkannt.ordner || "Sonstiges")}</select></label>
        <label class="feld"><span>Art</span><select name="art">${optionen(DOKUMENT_ARTEN, artStart)}</select></label>
        <label class="feld"><span>Absender (kurz)</span><input name="absender" value="${esc(absenderStart)}" maxlength="80" placeholder="z. B. Stadtwerke"></label>
        <label class="feld"><span>Datum des Schreibens</span><input type="date" name="datum" value="${esc(datumStart)}" required></label>
      </div>
      <label class="feld"><span>Name in der Ablage</span><input name="titel" required maxlength="160" spellcheck="false"></label>
      <label class="feld"><span>Kurz zusammengefasst</span><textarea name="zusammenfassung" rows="2">${esc(erkannt.zusammenfassung || "")}</textarea></label>
    </fieldset>
    ${nurAblage ? "" : `
    <fieldset class="gruppe" data-ziel="anfrage">
      <label class="feld"><span>Absender</span><input name="absender_voll" value="${esc(erkannt.absender_name || "")}"></label>
      <label class="feld"><span>Mietpartei</span><select name="mieter_id">${mieterOptionen(mieterL, mieterVermutet)}</select></label>
      <label class="feld"><span>Betreff</span><input name="betreff" required value="${esc(erkannt.betreff || "")}"></label>
      <label class="feld"><span>Text</span>
        <span class="diktat"><textarea name="text" rows="7">${esc(erkannt.text || "")}</textarea>${mikroKnopf()}</span></label>
    </fieldset>`}
    <div class="knopfreihe">
      <button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button>
      <button class="knopf knopf--primaer" value="ok" data-sichtbar="dokument">Ablegen</button>
      ${nurAblage ? "" : `<button class="knopf knopf--primaer" value="ok" data-sichtbar="anfrage">Ins Postfach</button>`}
    </div>`, {
    breit: true,
    vorbereiten: (form) => {
      verbindeDiktat(form);
      const zeige = () => {
        const z = nurAblage ? "dokument" : form.querySelector("[name=ziel]:checked")?.value || "anfrage";
        for (const f of $$("fieldset[data-ziel]", form)) { f.disabled = f.dataset.ziel !== z; f.hidden = f.disabled; }
        for (const k of $$("[data-sichtbar]", form)) k.hidden = k.dataset.sichtbar !== z;
      };
      for (const r of $$("[name=ziel]", form)) r.addEventListener("change", zeige);
      zeige();
      // Name nach dem Schema Datum_Haus_Absender_Art, bis Robert ihn selbst ändert
      const dok = $("fieldset[data-ziel=dokument]", form);
      const titel = $("[name=titel]", dok);
      let vonHand = false;
      const setze = () => {
        if (vonHand) return;
        titel.value = dokumentTitel({
          datum: $("[name=datum]", dok).value, objekt: objektVon($("[name=objekt_id]", dok).value),
          absender: $("[name=absender]", dok).value, art: $("[name=art]", dok).value,
        });
      };
      titel.addEventListener("input", () => { vonHand = true; });
      for (const n of ["datum", "objekt_id", "absender", "art"]) $(`[name=${n}]`, dok).addEventListener(n === "absender" ? "input" : "change", setze);
      setze();
    },
  });
  if (vorschau) setTimeout(() => URL.revokeObjectURL(vorschau), 5000);
  if (!daten) return;

  const typ = pdf ? "application/pdf" : "image/jpeg";
  const endung = pdf ? "pdf" : "jpg";
  if (nurAblage || daten.get("ziel") === "dokument") {
    const objekt_id = daten.get("objekt_id") || null;
    try {
      await db.legeDokumentAb({
        objekt_id,
        mieter_id: daten.get("mieter_id") || null,
        ordner: daten.get("ordner"),
        art: daten.get("art"),
        absender: String(daten.get("absender") || "").trim() || null,
        datum: daten.get("datum") || null,
        titel: String(daten.get("titel") || "").trim(),
        zusammenfassung: String(daten.get("zusammenfassung") || "").trim() || null,
        pfad: `${objekt_id || "allgemein"}/${crypto.randomUUID()}.${endung}`,
        typ, groesse: blob.size,
      }, blob);
      melde("Abgelegt.", "ok");
      geheZu(`#/objekt/${objekt_id || "allgemein"}`);
    } catch (err) {
      melde(err.message, "fehler");
    }
    return;
  }

  // Ins Postfach
  const m = mieterL.find((x) => x.id === daten.get("mieter_id"));
  try {
    const n = await db.neueNachricht({
      quelle: "brief",
      status: "offen",
      absender_name: String(daten.get("absender_voll") || "").trim() || (m ? mieterName(m) : null),
      absender_email: istEmail(erkannt.absender_email) ? erkannt.absender_email : m?.email || null,
      mieter_id: m?.id || null,
      zuordnung: m ? "manuell" : null,
      betreff: String(daten.get("betreff") || "").trim(),
      text: String(daten.get("text") || "").trim(),
    });
    const pfad = `${n.id}/1_brief.${endung}`;
    try {
      await db.ladeFotoHoch(pfad, blob);
      await db.aendereNachricht(n.id, { anhaenge: [{ name: `Brief.${endung}`, typ, groesse: blob.size, pfad }] });
    } catch (err) {
      melde(err.message, "fehler");
    }
    if (zustand.ki?.ki) {
      const warte = wartehinweis("Die KI ordnet die Nachricht ein …");
      try { await db.funktion("ki", { aktion: "einordnen", nachricht_id: n.id }); }
      catch (err) { melde("Einordnen nicht möglich: " + err.message, "fehler"); }
      finally { await warte.ende(); }
    }
    geheZu(`#/postfach/${n.id}`);
  } catch (err) {
    melde(err.message, "fehler");
  }
}

// ---------------------------------------------------------------------------
// Listen (für die Seite eines Hauses und die Wissen-Seite)
// ---------------------------------------------------------------------------
function nachOrdner(liste, reihenfolge) {
  const gruppen = new Map(reihenfolge.map((o) => [o, []]));
  for (const x of liste) {
    const k = gruppen.has(x.ordner) ? x.ordner : "Sonstiges";
    if (!gruppen.has(k)) gruppen.set(k, []);
    gruppen.get(k).push(x);
  }
  return [...gruppen.entries()].filter(([, l]) => l.length);
}

export function dokumentListe(liste, { leer = "Keine Dokumente." } = {}) {
  if (!liste.length) return `<div class="leer">${esc(leer)}</div>`;
  return nachOrdner(liste, DOKUMENT_ORDNER).map(([ordner, l]) => `
    <div class="ordner"><h3 class="ordner__titel">${esc(ordner)} <span class="leise">${l.length}</span></h3>
      ${l.map((d) => `
        <button type="button" class="dok" data-dok="${esc(d.id)}">
          <span class="dok__icon ${d.typ === "application/pdf" ? "" : "dok__icon--bild"}">${d.typ === "application/pdf" ? "PDF" : "Foto"}</span>
          <span class="dok__text"><span class="dok__titel">${esc(d.titel).replace(/_/g, "_<wbr>")}</span>
            <span class="leise">${esc([d.datum ? datumDE(d.datum) : "", d.art, d.zusammenfassung].filter(Boolean).join(" · "))}</span></span>
        </button>`).join("")}
    </div>`).join("");
}

export function wissenListe(liste, { leer = "Noch kein Wissen zu diesem Haus. Einfach einsprechen, was wichtig ist." } = {}) {
  if (!liste.length) return `<div class="leer">${esc(leer)}</div>`;
  return nachOrdner(liste, WISSEN_ORDNER).map(([ordner, l]) => `
    <div class="ordner"><h3 class="ordner__titel">${esc(ordner)} <span class="leise">${l.length}</span></h3>
      <div class="wissensliste">${l.map((w) => `
        <button type="button" class="wissen ${w.aktiv ? "" : "wissen--aus"}" data-wissen="${esc(w.id)}">
          <span class="wissen__titel">${esc(w.titel)}${w.aktiv ? "" : ` <span class="marker marker--leise">ausgeschaltet</span>`}</span>
          <span class="wissen__text">${esc(w.inhalt)}</span>
        </button>`).join("")}</div>
    </div>`).join("");
}

export function dienstleisterListe(liste, { leer = "Noch keine Handwerker eingetragen." } = {}) {
  if (!liste.length) return `<div class="leer">${esc(leer)}</div>`;
  return `<div class="zeilen">${liste.map((d) => `
    <div class="dienst ${d.aktiv ? "" : "dienst--aus"}">
      <button type="button" class="dienst__haupt" data-dienst="${esc(d.id)}">
        <span class="dienst__name">${esc(d.name)}</span>
        <span class="leise">${esc([d.gewerk, d.objekt_id ? objektVon(d.objekt_id)?.bezeichnung : "alle Häuser", d.aktiv ? "" : "ausgeschaltet"].filter(Boolean).join(" · "))}</span>
      </button>
      ${d.telefon ? `<a class="knopf knopf--klein" href="tel:${esc(String(d.telefon).replace(/[^\d+]/g, ""))}">${esc(d.telefon)}</a>` : ""}
    </div>`).join("")}</div>`;
}

export function verbindeListen(root, { dokumente = [], wissen = [], dienstleister = [], objektId, nachher }) {
  for (const b of $$("[data-dok]", root)) b.addEventListener("click", () => oeffneDokument(dokumente.find((d) => d.id === b.dataset.dok), { nachher }));
  for (const b of $$("[data-wissen]", root)) b.addEventListener("click", () => bearbeiteWissen(wissen.find((w) => w.id === b.dataset.wissen), { nachher }));
  for (const b of $$("[data-dienst]", root)) b.addEventListener("click", () => bearbeiteDienstleister(dienstleister.find((d) => d.id === b.dataset.dienst), { nachher, objektId }));
}

// ---------------------------------------------------------------------------
// Ein Dokument ansehen und bearbeiten
// ---------------------------------------------------------------------------
async function oeffneDokument(d, { nachher }) {
  if (!d) return;
  const mieterL = await mieterListe();
  const pdf = d.typ === "application/pdf";
  const daten = await dialogFormular(`
    <h2 class="umbruch">${esc(d.titel)}</h2>
    ${pdf ? "" : `<a data-ansehen target="_blank" rel="noopener"><img class="fotovorschau" alt="Dokument"></a>`}
    ${d.zusammenfassung ? `<p>${esc(d.zusammenfassung)}</p>` : ""}
    <p class="knopfreihe">
      <a class="knopf knopf--klein" data-ansehen target="_blank" rel="noopener">${pdf ? "PDF öffnen" : "In voller Größe"}</a>
      <a class="knopf knopf--klein" data-laden>Herunterladen</a>
    </p>
    <details class="ausklapp ausklapp--innen"><summary>Angaben ändern</summary>
      <div class="formraster formraster--zwei">
        <label class="feld breit"><span>Name</span><input name="titel" required maxlength="160" value="${esc(d.titel)}"></label>
        <label class="feld"><span>Haus</span><select name="objekt_id">${hausOptionen(d.objekt_id)}</select></label>
        <label class="feld"><span>Mietpartei</span><select name="mieter_id">${mieterOptionen(mieterL, d.mieter_id)}</select></label>
        <label class="feld"><span>Ordner</span><select name="ordner">${optionen(DOKUMENT_ORDNER, d.ordner)}</select></label>
        <label class="feld"><span>Art</span><select name="art">${optionen(DOKUMENT_ARTEN, d.art || "Sonstiges")}</select></label>
        <label class="feld"><span>Datum</span><input type="date" name="datum" value="${esc(d.datum || "")}"></label>
        <label class="feld"><span>Absender</span><input name="absender" value="${esc(d.absender || "")}"></label>
      </div>
    </details>
    <div class="knopfreihe">
      <button class="knopf knopf--gefahr knopf--links" value="loeschen" formnovalidate>Löschen</button>
      <button class="knopf" value="abbrechen" formnovalidate>Schließen</button>
      <button class="knopf knopf--primaer" value="ok">Speichern</button>
    </div>`, {
    breit: true,
    vorbereiten: async (form) => {
      try {
        const [ansehen, laden] = await Promise.all([db.dateiAdresse("dokumente", d.pfad), db.dateiAdresse("dokumente", d.pfad, { download: true })]);
        for (const a of $$("[data-ansehen]", form)) a.href = ansehen;
        $("[data-laden]", form).href = laden;
        const img = $("img", form);
        if (img) img.src = ansehen;
      } catch (err) { melde(err.message, "fehler"); }
    },
  });
  if (!daten) return;
  try {
    if (daten.get("_aktion") === "loeschen") {
      if (!(await frage("Dokument löschen?", `<p>„${esc(d.titel)}“ wird endgültig gelöscht.</p>`, "Löschen", { gefahr: true }))) return;
      await db.loescheDokument(d);
      melde("Dokument gelöscht.", "ok");
    } else {
      await db.aendereDokument(d.id, {
        titel: String(daten.get("titel")).trim() || d.titel,
        objekt_id: daten.get("objekt_id") || null,
        mieter_id: daten.get("mieter_id") || null,
        ordner: daten.get("ordner"),
        art: daten.get("art"),
        datum: daten.get("datum") || null,
        absender: String(daten.get("absender") || "").trim() || null,
      });
      melde("Gespeichert.", "ok");
    }
    nachher();
  } catch (err) {
    melde(err.message, "fehler");
  }
}

// ---------------------------------------------------------------------------
// Wissen
// ---------------------------------------------------------------------------
export async function zeigeWissen() {
  const [liste, dienstleister] = await Promise.all([db.ladeWissen(), db.ladeDienstleister().catch(() => [])]);
  const gruppen = [{ titel: "Gilt für alle Häuser", id: null }, ...zustand.stamm.objekte.map((o) => ({ titel: o.bezeichnung, id: o.id }))];
  $("#inhalt").innerHTML = `
    <div class="kopf">
      <div><h1>Wissen</h1>
        <p>Das weiß die KI, wenn sie Antworten entwirft: Abläufe, Technik, Ansprechpartner. Je konkreter, desto besser.</p></div>
      <div class="knopfreihe">
        <button type="button" class="knopf knopf--primaer" id="sprechen">${ICON_KI} Einsprechen</button>
        <button type="button" class="knopf" id="tippen">Eintrag tippen</button>
      </div>
    </div>
    <div class="banner banner--leise">Bitte keine Bankdaten und nichts Persönliches über einzelne Mieter eintragen. Das holt sich die KI aus der Akte, die IBAN bekommt sie nie.</div>
    <div class="stapel">
      ${gruppen.map((g, i) => {
        const eintraege = liste.filter((w) => (w.objekt_id || null) === g.id);
        return `<details class="flaeche ausklapp" ${i === 0 ? "open" : ""}>
          <summary>${esc(g.titel)} (${eintraege.length})</summary>
          ${wissenListe(eintraege, { leer: "Noch keine Einträge." })}
        </details>`;
      }).join("")}
      <details class="flaeche ausklapp">
        <summary>Handwerker &amp; Dienstleister (${dienstleister.length})</summary>
        ${dienstleisterListe(dienstleister)}
        <div class="flaeche__fuss"><button type="button" class="knopf knopf--klein" id="dienst-neu">Hinzufügen</button></div>
      </details>
    </div>`;
  const nachher = () => zeigeWissen();
  verbindeListen($("#inhalt"), { wissen: liste, dienstleister, nachher });
  $("#sprechen").addEventListener("click", () => wissenEinsprechen({ nachher }));
  $("#tippen").addEventListener("click", () => bearbeiteWissen(null, { nachher }));
  $("#dienst-neu").addEventListener("click", () => bearbeiteDienstleister(null, { nachher }));
}

/** Wissenseintrag bearbeiten; w ohne id = neuer Eintrag (auch vorbelegt, z. B. von der KI) */
export async function bearbeiteWissen(w, { nachher = () => {}, hinweis = "" } = {}) {
  w = w || {};
  const neu = !w.id;
  const daten = await dialogFormular(`
    <h2>${neu ? "Neuer Eintrag" : "Eintrag bearbeiten"}</h2>
    ${hinweis ? `<p class="ki-vorschlag">${esc(hinweis)}</p>` : ""}
    <label class="feld"><span>Titel</span><input name="titel" required maxlength="150" value="${esc(w.titel || "")}" placeholder="z. B. Heizung Lindenstraße: Druck nachfüllen"></label>
    <div class="formraster formraster--zwei">
      <label class="feld"><span>Gilt für</span><select name="objekt_id">${hausOptionen(w.objekt_id || null, "Alle Häuser")}</select></label>
      <label class="feld"><span>Ordner</span><select name="ordner">${optionen(WISSEN_ORDNER, w.ordner || "Sonstiges")}</select></label>
    </div>
    <label class="feld"><span>Inhalt</span>
      <span class="diktat"><textarea name="inhalt" rows="8" required placeholder="z. B. Druck an der Heizung soll zwischen 1,2 und 1,8 bar liegen. Nachfüllen: Hahn links unten, Schlauch hängt daneben.">${esc(w.inhalt || "")}</textarea>${mikroKnopf()}</span></label>
    <label class="checkfeld"><input type="checkbox" name="aktiv" ${w.aktiv === false ? "" : "checked"}> Aktiv (die KI nutzt diesen Eintrag)</label>
    <div class="knopfreihe">
      ${neu ? "" : `<button class="knopf knopf--gefahr knopf--links" value="loeschen" formnovalidate>Löschen</button>`}
      <button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button>
      <button class="knopf knopf--primaer" value="ok">Speichern</button>
    </div>`, { breit: true, vorbereiten: verbindeDiktat });
  if (!daten) return;
  try {
    if (daten.get("_aktion") === "loeschen") {
      if (!(await frage("Eintrag löschen?", `<p>„${esc(w.titel)}“ wird gelöscht.</p>`, "Löschen", { gefahr: true }))) return;
      await db.loescheWissen(w.id);
      melde("Eintrag gelöscht.", "ok");
    } else {
      await db.speichereWissen(w.id, {
        titel: String(daten.get("titel")).trim(),
        inhalt: String(daten.get("inhalt")).trim(),
        objekt_id: daten.get("objekt_id") || null,
        ordner: daten.get("ordner"),
        aktiv: daten.get("aktiv") === "on",
      });
      melde("Gespeichert.", "ok");
    }
    nachher();
  } catch (err) {
    melde(err.message, "fehler");
  }
}

/** Wissen frei einsprechen; die KI macht daraus einen Eintrag mit Haus und Ordner (zum Prüfen) */
export async function wissenEinsprechen({ objektId = null, nachher = () => {} } = {}) {
  const kiDa = !!zustand.ki?.ki;
  const daten = await dialogFormular(`
    <h2>Wissen einsprechen</h2>
    <p class="leise">Einfach erzählen, z. B. „In der Lindenstraße ist der Heizungskeller hinter der zweiten Tür links, Schlüssel hängt beim Hausmeister.“
      ${kiDa ? "Die KI macht daraus einen sauberen Eintrag und schlägt Haus und Ordner vor." : ""}</p>
    <label class="feld"><span>Was soll die App wissen?</span>
      <span class="diktat"><textarea name="text" rows="7" required></textarea>${mikroKnopf()}</span></label>
    <div class="knopfreihe">
      <button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button>
      <button class="knopf knopf--primaer" value="ok">${kiDa ? `${ICON_KI} Ordnen lassen` : "Weiter"}</button>
    </div>`, {
    breit: true,
    vorbereiten: (form) => {
      verbindeDiktat(form);
      if (window.SpeechRecognition || window.webkitSpeechRecognition) setTimeout(() => $("[data-diktat]", form)?.click(), 150);
    },
  });
  if (!daten) return;
  const text = String(daten.get("text") || "").trim();
  if (!text) return;
  if (!kiDa) return bearbeiteWissen({ inhalt: text, objekt_id: objektId, ordner: "Sonstiges" }, { nachher });
  const warte = wartehinweis("Die KI ordnet das Wissen …");
  let r = null;
  try {
    r = await db.funktion("ki", { aktion: "wissen_ordnen", text, objekt_id: objektId });
  } catch (err) {
    melde(err.message, "fehler");
  } finally {
    await warte.ende();
  }
  return bearbeiteWissen(r ? { ...r, aktiv: true } : { inhalt: text, objekt_id: objektId }, {
    nachher, hinweis: r ? "Von der KI geordnet. Bitte prüfen und speichern." : "",
  });
}

// ---------------------------------------------------------------------------
// Handwerker und Dienstleister
// ---------------------------------------------------------------------------
export async function bearbeiteDienstleister(d, { nachher = () => {}, objektId = null } = {}) {
  d = d || { objekt_id: objektId };
  const neu = !d.id;
  const daten = await dialogFormular(`
    <h2>${neu ? "Handwerker hinzufügen" : esc(d.name)}</h2>
    <div class="formraster formraster--zwei">
      <label class="feld"><span>Name / Firma</span><input name="name" required maxlength="120" value="${esc(d.name || "")}"></label>
      <label class="feld"><span>Gewerk</span><input name="gewerk" list="gewerke" maxlength="60" value="${esc(d.gewerk || "")}" placeholder="z. B. Heizung &amp; Sanitär"></label>
      <label class="feld"><span>Telefon</span><input name="telefon" type="tel" maxlength="40" value="${esc(d.telefon || "")}"></label>
      <label class="feld"><span>E-Mail (für Aufträge)</span><input name="email" type="email" maxlength="120" value="${esc(d.email || "")}"></label>
      <label class="feld breit"><span>Zuständig für</span><select name="objekt_id">${hausOptionen(d.objekt_id || null, "Alle Häuser")}</select></label>
    </div>
    <datalist id="gewerke">${GEWERKE.map((g) => `<option value="${esc(g)}">`).join("")}</datalist>
    <label class="feld"><span>Notiz (z. B. Notdienst, Ansprechpartner)</span><textarea name="notiz" rows="2">${esc(d.notiz || "")}</textarea></label>
    <label class="checkfeld"><input type="checkbox" name="aktiv" ${d.aktiv === false ? "" : "checked"}> Aktiv (wird der KI und bei Aufträgen angeboten)</label>
    <div class="knopfreihe">
      ${neu ? "" : `<button class="knopf knopf--gefahr knopf--links" value="loeschen" formnovalidate>Löschen</button>`}
      <button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button>
      <button class="knopf knopf--primaer" value="ok">Speichern</button>
    </div>`, { breit: true });
  if (!daten) return;
  try {
    if (daten.get("_aktion") === "loeschen") {
      if (!(await frage("Löschen?", `<p>„${esc(d.name)}“ wird aus der Liste gelöscht.</p>`, "Löschen", { gefahr: true }))) return;
      await db.loescheDienstleister(d.id);
      melde("Gelöscht.", "ok");
    } else {
      const email = String(daten.get("email") || "").trim();
      if (email && !istEmail(email)) return melde("Die E-Mail-Adresse sieht nicht richtig aus.", "fehler");
      await db.speichereDienstleister(d.id, {
        name: String(daten.get("name")).trim(),
        gewerk: String(daten.get("gewerk") || "").trim() || null,
        telefon: String(daten.get("telefon") || "").trim() || null,
        email: email || null,
        objekt_id: daten.get("objekt_id") || null,
        notiz: String(daten.get("notiz") || "").trim() || null,
        aktiv: daten.get("aktiv") === "on",
      });
      melde("Gespeichert.", "ok");
    }
    nachher();
  } catch (err) {
    melde(err.message, "fehler");
  }
}
