// Stammdaten anlegen und pflegen: Häuser, Wohnungen, Kostenträger, neue Mietparteien.
// Details einer Mietpartei (Miete, Konto, Mieterhöhung) bleiben in der Akte („Stammdaten bearbeiten“).
import * as db from "./daten.js";
import { mieterName } from "./dokumente.js";
import { $, $$, esc, melde, dialogFormular, frage, zustand, objektVon, wohnungVon, brotkrumen, KRUMEN } from "./helfer.js";
import { geheZu } from "./ui.js";

const inhalt = () => $("#inhalt");
const ICON_PLUS = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>`;
const KT_ARTEN = [["jobcenter", "Jobcenter"], ["sozialamt", "Sozialamt"], ["sonstige", "Sonstige Stelle"]];

// „1.234,50“ / „1234.5“ → Zahl; leer → null
const zahl = (roh) => {
  const s = String(roh ?? "").trim().replace(/\s|€|m²/g, "");
  if (!s) return null;
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
};
const zahlText = (n) => (n == null ? "" : String(n).replace(".", ","));
const text = (fd, k) => String(fd.get(k) || "").trim() || null;
const heute = () => new Date().toLocaleDateString("sv-SE");

async function stammNeu() {
  zustand.stamm = await db.ladeStammdaten();
}
// Aktuelle Mietpartei einer Wohnung (ohne Auszug oder Auszug in der Zukunft)
const aktuelle = (mieter, wohnungId) =>
  mieter.filter((m) => m.wohnung_id === wohnungId && (!m.mietende || m.mietende >= heute()));

// ---------------------------------------------------------------------------
// Übersicht
// ---------------------------------------------------------------------------
export async function zeigeStammdaten() {
  await stammNeu();
  const mieter = await db.ladeMieterKurz();
  const { objekte, wohnungen, kostentraeger } = zustand.stamm;
  const ohneWohnung = mieter.filter((m) => !m.wohnung_id);
  const sortiert = (liste) => [...liste].sort((a, b) => a.bezeichnung.localeCompare(b.bezeichnung, "de", { numeric: true }));

  inhalt().innerHTML = `
    ${brotkrumen([...KRUMEN.einstellungen, { text: "Häuser, Wohnungen & Mieter" }])}
    <div class="kopf">
      <div><h1>Häuser, Wohnungen &amp; Mieter</h1>
        <p>Hier legt ihr die Grunddaten an. Miete, Konto und Kostenträger einer Mietpartei stehen danach in ihrer Akte.</p></div>
      <div class="knopfreihe">
        <button type="button" class="knopf knopf--primaer" id="mieter-neu">${ICON_PLUS} Neue Mietpartei</button>
        <button type="button" class="knopf" id="haus-neu">${ICON_PLUS} Neues Haus</button>
      </div>
    </div>
    ${objekte.length ? "" : `<section class="flaeche leer"><p>Noch kein Haus angelegt. Fangt mit „Neues Haus“ an.</p></section>`}
    ${objekte.map((o) => {
      const whg = sortiert(wohnungen.filter((w) => w.objekt_id === o.id));
      return `
      <section class="flaeche stamm-haus">
        <div class="flaeche__kopf">
          <div><h2>${esc(o.bezeichnung)}</h2>
            <span class="leise">${esc([o.strasse, [o.plz, o.ort].filter(Boolean).join(" ")].filter(Boolean).join(", "))}${o.kuerzel ? ` · Kürzel ${esc(o.kuerzel)}` : ""}</span></div>
          <button type="button" class="knopf knopf--klein" data-haus="${esc(o.id)}">Bearbeiten</button>
        </div>
        <div class="zeilen">
          ${whg.length ? whg.map((w) => {
            const jetzt = aktuelle(mieter, w.id);
            return `
            <div class="stamm-zeile">
              <button type="button" class="stamm-zeile__haupt" data-wohnung="${esc(w.id)}">
                <span class="stamm-zeile__name">${esc(w.bezeichnung)}</span>
                <span class="leise">${esc([w.flaeche_qm != null ? `${zahlText(w.flaeche_qm)} m²` : "", w.zimmer != null ? `${zahlText(w.zimmer)} Zi.` : ""].filter(Boolean).join(" · ") || "Größe fehlt")}</span>
              </button>
              <span class="stamm-zeile__mieter">${jetzt.length
                ? jetzt.map((m) => `<a href="#/mieter/${esc(m.id)}">${esc(mieterName(m))}</a>`).join(", ")
                : `<button type="button" class="knopf knopf--klein" data-mieter-neu="${esc(w.id)}">${ICON_PLUS} Mietpartei</button>`}</span>
            </div>`;
          }).join("") : `<div class="leer">Noch keine Wohnungen.</div>`}
        </div>
        <div class="flaeche__fuss knopfreihe">
          <button type="button" class="knopf knopf--klein" data-wohnung-neu="${esc(o.id)}">${ICON_PLUS} Wohnung</button>
          <button type="button" class="knopf knopf--klein" data-wohnungen-viele="${esc(o.id)}">Mehrere Wohnungen anlegen</button>
          <a class="knopf knopf--klein" href="#/objekt/${esc(o.id)}">Zur Hausseite</a>
        </div>
      </section>`;
    }).join("")}
    ${ohneWohnung.length ? `
    <section class="flaeche">
      <div class="flaeche__kopf"><h2>Ohne Wohnung</h2><span class="leise">z. B. ausgezogen oder noch nicht zugeordnet</span></div>
      <div class="zeilen">${ohneWohnung.map((m) => `<div class="stamm-zeile"><a class="stamm-zeile__haupt" href="#/mieter/${esc(m.id)}"><span class="stamm-zeile__name">${esc(mieterName(m))}</span></a></div>`).join("")}</div>
    </section>` : ""}
    <section class="flaeche">
      <div class="flaeche__kopf"><h2>Kostenträger</h2><span class="leise">Jobcenter, Sozialamt …</span></div>
      <div class="zeilen">
        ${kostentraeger.length ? kostentraeger.map((k) => `
          <div class="stamm-zeile">
            <button type="button" class="stamm-zeile__haupt" data-kt="${esc(k.id)}">
              <span class="stamm-zeile__name">${esc(k.name)}</span>
              <span class="leise">${esc([k.abteilung, [k.plz, k.ort].filter(Boolean).join(" ")].filter(Boolean).join(" · "))}</span>
            </button>
          </div>`).join("") : `<div class="leer">Noch keine Kostenträger.</div>`}
      </div>
      <div class="flaeche__fuss knopfreihe"><button type="button" class="knopf knopf--klein" id="kt-neu">${ICON_PLUS} Kostenträger</button></div>
    </section>`;

  const neu = () => zeigeStammdaten();
  $("#haus-neu").addEventListener("click", () => hausDialog(null, neu));
  $("#mieter-neu").addEventListener("click", () => neueMietpartei({ nachher: neu }));
  $("#kt-neu").addEventListener("click", () => kostentraegerDialog(null, neu));
  for (const b of $$("[data-haus]")) b.addEventListener("click", () => hausDialog(objektVon(b.dataset.haus), neu));
  for (const b of $$("[data-wohnung]")) b.addEventListener("click", () => wohnungDialog(wohnungVon(b.dataset.wohnung), { mieter, nachher: neu }));
  for (const b of $$("[data-wohnung-neu]")) b.addEventListener("click", () => wohnungDialog({ objekt_id: b.dataset.wohnungNeu }, { mieter, nachher: neu }));
  for (const b of $$("[data-wohnungen-viele]")) b.addEventListener("click", () => mehrereWohnungen(b.dataset.wohnungenViele, neu));
  for (const b of $$("[data-mieter-neu]")) b.addEventListener("click", () => neueMietpartei({ wohnungId: b.dataset.mieterNeu, nachher: neu }));
  for (const b of $$("[data-kt]")) b.addEventListener("click", () => kostentraegerDialog(zustand.stamm.kostentraeger.find((k) => k.id === b.dataset.kt), neu));
}

// ---------------------------------------------------------------------------
// Haus
// ---------------------------------------------------------------------------
export async function hausDialog(o, nachher = () => {}) {
  o = o || {};
  const vorhanden = !!o.id;
  const daten = await dialogFormular(`
    <h2>${vorhanden ? "Haus bearbeiten" : "Neues Haus"}</h2>
    <div class="formraster formraster--zwei">
      <label class="feld breit"><span>Bezeichnung</span><input name="bezeichnung" required maxlength="100" value="${esc(o.bezeichnung || "")}" placeholder="z. B. MFH Musterstraße 5"></label>
      <label class="feld breit"><span>Straße und Hausnummer</span><input name="strasse" required maxlength="100" value="${esc(o.strasse || "")}"></label>
      <label class="feld"><span>PLZ</span><input name="plz" required maxlength="10" inputmode="numeric" value="${esc(o.plz || "")}"></label>
      <label class="feld"><span>Ort</span><input name="ort" required maxlength="80" value="${esc(o.ort || "")}"></label>
      <label class="feld"><span>Orts-Kürzel für Dateinamen</span><input name="kuerzel" maxlength="10" value="${esc(o.kuerzel || "")}" placeholder="z. B. SR"></label>
      <label class="feld"><span>Kappungsgrenze</span><select name="kappungsgrenze">
        <option value="20" ${Number(o.kappungsgrenze) !== 15 ? "selected" : ""}>20 % (Normalfall)</option>
        <option value="15" ${Number(o.kappungsgrenze) === 15 ? "selected" : ""}>15 % (angespannter Markt)</option></select></label>
      <label class="feld breit"><span>Notiz (intern)</span><textarea name="notiz" rows="2">${esc(o.notiz || "")}</textarea></label>
    </div>
    <div class="knopfreihe">
      ${vorhanden ? `<button class="knopf knopf--gefahr knopf--links" value="loeschen" formnovalidate>Löschen</button>` : ""}
      <button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button>
      <button class="knopf knopf--primaer" value="ok">Speichern</button>
    </div>`, { breit: true });
  if (!daten) return;
  try {
    if (daten.get("_aktion") === "loeschen") {
      const whg = zustand.stamm.wohnungen.filter((w) => w.objekt_id === o.id).length;
      if (whg) return melde(`Das Haus hat noch ${whg} ${whg === 1 ? "Wohnung" : "Wohnungen"}. Bitte zuerst die Wohnungen löschen.`, "fehler");
      if (!(await frage("Haus löschen?", `<p>„${esc(o.bezeichnung)}“ wird gelöscht, mit dem Wissen und den Handwerkern, die nur für dieses Haus eingetragen sind.
        Notizen und Dokumente bleiben erhalten, gehören dann aber zu keinem Haus mehr.</p>`, "Löschen", { gefahr: true }))) return;
      await db.loescheObjekt(o.id);
      melde("Haus gelöscht.", "ok");
    } else {
      const felder = {
        bezeichnung: text(daten, "bezeichnung"), strasse: text(daten, "strasse"), plz: text(daten, "plz"), ort: text(daten, "ort"),
        kuerzel: text(daten, "kuerzel")?.toUpperCase() || null, kappungsgrenze: Number(daten.get("kappungsgrenze")) === 15 ? 15 : 20,
        notiz: text(daten, "notiz"),
      };
      await db.speichereObjekt(o.id || null, felder);
      melde(vorhanden ? "Haus gespeichert." : "Haus angelegt. Jetzt die Wohnungen hinzufügen.", "ok");
    }
    await stammNeu();
    nachher();
  } catch (err) {
    melde(err.message, "fehler");
  }
}

// ---------------------------------------------------------------------------
// Wohnung
// ---------------------------------------------------------------------------
async function wohnungDialog(w, { mieter = [], nachher = () => {} } = {}) {
  const vorhanden = !!w.id;
  const haus = objektVon(w.objekt_id);
  const bewohner = vorhanden ? mieter.filter((m) => m.wohnung_id === w.id) : [];
  const daten = await dialogFormular(`
    <h2>${vorhanden ? "Wohnung bearbeiten" : "Neue Wohnung"}</h2>
    <p class="leise">${esc(haus?.bezeichnung || "")}</p>
    <div class="formraster formraster--zwei">
      <label class="feld breit"><span>Bezeichnung</span><input name="bezeichnung" required maxlength="60" value="${esc(w.bezeichnung || "")}" placeholder="z. B. WHG 08 oder 1. OG links"></label>
      <label class="feld"><span>Wohnfläche m²</span><input name="flaeche_qm" inputmode="decimal" value="${esc(zahlText(w.flaeche_qm))}" placeholder="z. B. 62,5"></label>
      <label class="feld"><span>Zimmer</span><input name="zimmer" inputmode="decimal" value="${esc(zahlText(w.zimmer))}" placeholder="z. B. 2,5"></label>
    </div>
    ${bewohner.length ? `<p class="leise">Mietparteien: ${bewohner.map((m) => esc(mieterName(m))).join(", ")}</p>` : ""}
    <div class="knopfreihe">
      ${vorhanden ? `<button class="knopf knopf--gefahr knopf--links" value="loeschen" formnovalidate>Löschen</button>` : ""}
      <button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button>
      <button class="knopf knopf--primaer" value="ok">Speichern</button>
    </div>`);
  if (!daten) return;
  try {
    if (daten.get("_aktion") === "loeschen") {
      if (bewohner.length) return melde("In dieser Wohnung sind noch Mietparteien eingetragen. Bitte sie zuerst in der Akte einer anderen Wohnung zuordnen.", "fehler");
      if (!(await frage("Wohnung löschen?", `<p>„${esc(w.bezeichnung)}“ wird gelöscht.</p>`, "Löschen", { gefahr: true }))) return;
      await db.loescheWohnung(w.id);
      melde("Wohnung gelöscht.", "ok");
    } else {
      const flaeche = zahl(daten.get("flaeche_qm")), zimmer = zahl(daten.get("zimmer"));
      if (Number.isNaN(flaeche) || Number.isNaN(zimmer)) return melde("Bitte Fläche und Zimmer als Zahl eingeben.", "fehler");
      await db.speichereWohnung(w.id || null, { objekt_id: w.objekt_id, bezeichnung: text(daten, "bezeichnung"), flaeche_qm: flaeche, zimmer });
      melde("Wohnung gespeichert.", "ok");
    }
    await stammNeu();
    nachher();
  } catch (err) {
    melde(err.message, "fehler");
  }
}

// Viele Wohnungen auf einmal: „WHG 01“ bis „WHG 12“ oder eine Liste
async function mehrereWohnungen(objektId, nachher) {
  const haus = objektVon(objektId);
  const daten = await dialogFormular(`
    <h2>Mehrere Wohnungen anlegen</h2>
    <p class="leise">${esc(haus?.bezeichnung || "")}</p>
    <div class="formraster formraster--zwei">
      <label class="feld"><span>Anzahl</span><input name="anzahl" type="number" min="1" max="60" value="12"></label>
      <label class="feld"><span>Beginnen bei Nr.</span><input name="start" type="number" min="0" max="999" value="1"></label>
      <label class="feld breit"><span>Name</span><input name="muster" value="WHG {nr}" maxlength="40">
        <span class="feldhinweis feldhinweis--leise">{nr} wird zur Nummer, zweistellig: WHG 01, WHG 02 …</span></label>
    </div>
    <label class="feld"><span>Oder eigene Liste (eine Wohnung pro Zeile, optional „; Fläche; Zimmer“)</span>
      <textarea name="liste" rows="4" placeholder="EG links; 58; 2&#10;EG rechts; 64,5; 3"></textarea></label>
    <p class="leise" data-vorschau></p>
    <div class="knopfreihe">
      <button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button>
      <button class="knopf knopf--primaer" value="ok">Anlegen</button>
    </div>`, {
    breit: true,
    vorbereiten: (form) => {
      const zeige = () => { $("[data-vorschau]", form).textContent = "Wird angelegt: " + liste(new FormData(form)).map((w) => w.bezeichnung).join(", "); };
      form.addEventListener("input", zeige);
      zeige();
    },
  });
  if (!daten) return;
  const neue = liste(daten);
  const vorhanden = new Set(zustand.stamm.wohnungen.filter((w) => w.objekt_id === objektId).map((w) => w.bezeichnung.toLowerCase()));
  const doppelt = neue.filter((w) => vorhanden.has(w.bezeichnung.toLowerCase()));
  if (!neue.length) return melde("Keine Wohnung angegeben.", "fehler");
  if (neue.some((w) => Number.isNaN(w.flaeche_qm) || Number.isNaN(w.zimmer))) return melde("Fläche und Zimmer bitte als Zahl eingeben.", "fehler");
  if (doppelt.length && !(await frage("Schon vorhanden", `<p>${esc(doppelt.map((w) => w.bezeichnung).join(", "))} gibt es schon. Diese werden übersprungen.</p>`, "Rest anlegen"))) return;
  try {
    let n = 0;
    for (const w of neue.filter((x) => !vorhanden.has(x.bezeichnung.toLowerCase()))) {
      await db.speichereWohnung(null, { objekt_id: objektId, ...w });
      n++;
    }
    melde(`${n} ${n === 1 ? "Wohnung" : "Wohnungen"} angelegt.`, "ok");
    await stammNeu();
    nachher();
  } catch (err) {
    melde(err.message, "fehler");
  }

  function liste(fd) {
    const eigene = String(fd.get("liste") || "").split(/\n+/).map((z) => z.trim()).filter(Boolean);
    if (eigene.length) {
      return eigene.slice(0, 100).map((z) => {
        const [b, f, zi] = z.split(";").map((t) => t.trim());
        return { bezeichnung: b.slice(0, 60), flaeche_qm: zahl(f), zimmer: zahl(zi) };
      }).filter((w) => w.bezeichnung);
    }
    const anzahl = Math.min(60, Math.max(0, Number(fd.get("anzahl")) || 0));
    const start = Math.max(0, Number(fd.get("start")) || 0);
    const muster = String(fd.get("muster") || "WHG {nr}");
    return Array.from({ length: anzahl }, (_, i) => {
      const nr = String(start + i).padStart(2, "0");
      return { bezeichnung: (muster.includes("{nr}") ? muster.replace("{nr}", nr) : `${muster} ${nr}`).trim().slice(0, 60), flaeche_qm: null, zimmer: null };
    });
  }
}

// ---------------------------------------------------------------------------
// Kostenträger
// ---------------------------------------------------------------------------
async function kostentraegerDialog(k, nachher) {
  k = k || {};
  const vorhanden = !!k.id;
  const daten = await dialogFormular(`
    <h2>${vorhanden ? "Kostenträger bearbeiten" : "Neuer Kostenträger"}</h2>
    <div class="formraster formraster--zwei">
      <label class="feld"><span>Art</span><select name="art">${KT_ARTEN.map(([w, n]) => `<option value="${w}" ${w === (k.art || "jobcenter") ? "selected" : ""}>${n}</option>`).join("")}</select></label>
      <label class="feld"><span>Name</span><input name="name" required maxlength="120" value="${esc(k.name || "")}" placeholder="z. B. Jobcenter Musterstadt"></label>
      <label class="feld breit"><span>Abteilung (optional)</span><input name="abteilung" maxlength="120" value="${esc(k.abteilung || "")}"></label>
      <label class="feld breit"><span>Straße und Hausnummer</span><input name="strasse" maxlength="100" value="${esc(k.strasse || "")}"></label>
      <label class="feld"><span>PLZ</span><input name="plz" maxlength="10" value="${esc(k.plz || "")}"></label>
      <label class="feld"><span>Ort</span><input name="ort" maxlength="80" value="${esc(k.ort || "")}"></label>
      <label class="feld"><span>Telefon</span><input name="telefon" maxlength="40" value="${esc(k.telefon || "")}"></label>
      <label class="feld"><span>E-Mail</span><input name="email" type="email" maxlength="120" value="${esc(k.email || "")}"></label>
    </div>
    <div class="knopfreihe">
      ${vorhanden ? `<button class="knopf knopf--gefahr knopf--links" value="loeschen" formnovalidate>Löschen</button>` : ""}
      <button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button>
      <button class="knopf knopf--primaer" value="ok">Speichern</button>
    </div>`, { breit: true });
  if (!daten) return;
  try {
    if (daten.get("_aktion") === "loeschen") {
      if (!(await frage("Kostenträger löschen?", `<p>„${esc(k.name)}“ wird gelöscht. Mietparteien, die ihm zugeordnet sind, gelten danach als Selbstzahler.</p>`, "Löschen", { gefahr: true }))) return;
      await db.loescheKostentraeger(k.id);
      melde("Kostenträger gelöscht.", "ok");
    } else {
      const felder = Object.fromEntries(["name", "abteilung", "strasse", "plz", "ort", "telefon", "email"].map((f) => [f, text(daten, f)]));
      felder.art = KT_ARTEN.some(([w]) => w === daten.get("art")) ? daten.get("art") : "sonstige";
      await db.speichereKostentraeger(k.id || null, felder);
      melde("Kostenträger gespeichert.", "ok");
    }
    await stammNeu();
    nachher();
  } catch (err) {
    melde(err.message, "fehler");
  }
}

// ---------------------------------------------------------------------------
// Neue Mietpartei (das Nötigste; der Rest in der Akte)
// ---------------------------------------------------------------------------
export async function neueMietpartei({ wohnungId = null, nachher = () => {} } = {}) {
  if (!zustand.stamm.wohnungen.length) return melde("Bitte zuerst ein Haus mit Wohnungen anlegen.", "fehler");
  const whg = zustand.stamm.wohnungen
    .map((w) => ({ ...w, haus: objektVon(w.objekt_id)?.bezeichnung || "" }))
    .sort((a, b) => (a.haus + a.bezeichnung).localeCompare(b.haus + b.bezeichnung, "de", { numeric: true }));
  const daten = await dialogFormular(`
    <h2>Neue Mietpartei</h2>
    <p class="leise">Das Wichtigste reicht. Konto, Pauschalen und Angaben zur Mieterhöhung trägst du danach in der Akte nach.</p>
    <div class="formraster formraster--zwei">
      <label class="feld"><span>Anrede</span><select name="anrede">${["Frau", "Herr", "Divers", "Firma"].map((a) => `<option>${a}</option>`).join("")}</select></label>
      <label class="feld"><span>Vorname</span><input name="vorname" maxlength="80" autocomplete="off"></label>
      <label class="feld breit"><span>Nachname (oder Firma)</span><input name="nachname" required maxlength="100" autocomplete="off"></label>
      <label class="feld breit"><span>Wohnung</span><select name="wohnung_id" required>
        <option value="">Bitte wählen</option>
        ${whg.map((w) => `<option value="${esc(w.id)}" ${w.id === wohnungId ? "selected" : ""}>${esc(w.haus)}, ${esc(w.bezeichnung)}</option>`).join("")}
      </select></label>
      <label class="feld"><span>Mietbeginn</span><input name="mietbeginn" type="date"></label>
      <label class="feld"><span>Kaltmiete €</span><input name="kaltmiete" required inputmode="decimal" placeholder="z. B. 480"></label>
      <label class="feld"><span>Nebenkosten-VZ €</span><input name="nebenkosten_vz" required inputmode="decimal" placeholder="z. B. 170"></label>
      <label class="feld"><span>E-Mail</span><input name="email" type="email" autocomplete="off"></label>
      <label class="feld"><span>Telefon</span><input name="telefon" autocomplete="off"></label>
      <label class="feld"><span>Kostenträger</span><select name="kostentraeger_id">
        <option value="">Keiner (Selbstzahler)</option>
        ${zustand.stamm.kostentraeger.map((k) => `<option value="${esc(k.id)}">${esc(k.name)}</option>`).join("")}
      </select></label>
      <label class="feld"><span>Aktenzeichen / BG-Nummer</span><input name="aktenzeichen" maxlength="60" autocomplete="off"></label>
    </div>
    <div class="knopfreihe">
      <button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button>
      <button class="knopf knopf--primaer" value="ok">Anlegen und Akte öffnen</button>
    </div>`, { breit: true });
  if (!daten) return;
  const kalt = zahl(daten.get("kaltmiete")), nk = zahl(daten.get("nebenkosten_vz"));
  if (kalt == null || nk == null || Number.isNaN(kalt) || Number.isNaN(nk)) return melde("Bitte Kaltmiete und Nebenkosten als Betrag eingeben.", "fehler");
  try {
    const m = await db.neuerMieter({
      anrede: daten.get("anrede") || "Herr", vorname: text(daten, "vorname"), nachname: text(daten, "nachname"),
      wohnung_id: daten.get("wohnung_id") || null, mietbeginn: daten.get("mietbeginn") || null,
      kaltmiete: kalt, nebenkosten_vz: nk, strom_pauschale: 0, internet_pauschale: 0,
      email: text(daten, "email"), telefon: text(daten, "telefon"),
      kostentraeger_id: daten.get("kostentraeger_id") || null, aktenzeichen: text(daten, "aktenzeichen"),
      direktzahlung: false, mietart: "normal",
    });
    zustand.mieterKurz = null;
    melde(`${mieterName(m)} angelegt.`, "ok");
    geheZu(`#/mieter/${m.id}`);
  } catch (err) {
    melde(err.message, "fehler");
    nachher();
  }
}
