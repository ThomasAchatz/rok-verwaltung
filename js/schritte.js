// „Was als Nächstes?“ in einem Vorgang: nach einer Antwort (oder auf der Vorgangsseite) schlägt die KI
// 1–3 nächste Schritte vor (z. B. Hausmeister informieren, Wiedervorlage). Ein Klick öffnet nur einen
// vorbelegten Entwurf bzw. den Notiz-Dialog im selben Vorgang – gesendet wird nie automatisch.
import * as db from "./daten.js";
import { $, esc, melde, dialogFormular, zustand } from "./helfer.js";
import { datumDE } from "./dokumente.js";
import { ICON_KI, geheZu, mikroKnopf, verbindeDiktat } from "./ui.js";

const AN_TEXT = { mieter: "Mietpartei", handwerker: "Handwerker", kontakt: "Kontakt", kostentraeger: "Amt" };

function vorschlagHtml(v, i) {
  const unter = v.art === "wiedervorlage"
    ? `Wiedervorlage${v.faellig_am ? ` am ${datumDE(v.faellig_am)}` : ""}`
    : `E-Mail an ${v.name || AN_TEXT[v.an] || ""}`;
  return `<button class="schritt" value="v:${i}">
    <span class="schritt__titel">${esc(v.titel)}</span>
    <span class="schritt__unter leise">${esc(unter)}${v.grund ? ` · ${esc(v.grund)}` : ""}</span>
  </button>`;
}

/**
 * Dialog „Was als Nächstes?“ für einen Vorgang.
 * gesendet: kommt direkt nach dem Senden (Überschrift „Gesendet“).
 */
export async function naechsterSchritt(themaId, { gesendet = false } = {}) {
  if (!themaId) return;
  const kiDa = !!zustand.ki?.ki;
  let vorschlaege = [];
  const daten = await dialogFormular(`
    <h2>${gesendet ? "Gesendet. Was als Nächstes?" : "Nächster Schritt"}</h2>
    ${kiDa ? `<div class="schritte" data-schritte aria-live="polite"><p class="leise"><span class="kreisel" aria-hidden="true"></span> Die KI schaut sich den Vorgang an …</p></div>
    <label class="feld"><span>Oder sag einfach, was du möchtest</span>
      <span class="diktat"><input name="wunsch" placeholder="z. B. Hausmeister soll sich das morgen anschauen" autocomplete="off">${mikroKnopf()}</span></label>
    <div class="knopfreihe knopfreihe--eng"><button type="button" class="knopf knopf--ki knopf--klein" data-wunsch>${ICON_KI} Vorschlagen</button></div>`
    : `<p class="leise">Ohne KI: Wiedervorlage anlegen oder jemand anderen im selben Vorgang anschreiben.</p>`}
    <div class="knopfreihe">
      <button class="knopf knopf--links" value="abbrechen" formnovalidate>${gesendet ? "Nichts weiter" : "Abbrechen"}</button>
      <button class="knopf" value="wv" formnovalidate>Wiedervorlage anlegen</button>
      <button class="knopf" value="anders" formnovalidate>Jemand anderen anschreiben</button>
    </div>
    <p class="leise">Nichts wird automatisch gesendet: ein Klick öffnet nur einen Entwurf im selben Vorgang.</p>`, {
    breit: true,
    vorbereiten: (form) => {
      if (!kiDa) return;
      verbindeDiktat(form);
      const box = $("[data-schritte]", form);
      const zeige = () => {
        box.innerHTML = vorschlaege.length
          ? vorschlaege.map(vorschlagHtml).join("")
          : `<p class="leise">Kein Vorschlag. Unten selbst sagen, was du möchtest.</p>`;
      };
      const frage = async (wunsch) => {
        box.innerHTML = `<p class="leise"><span class="kreisel" aria-hidden="true"></span> ${wunsch ? "Die KI bereitet das vor …" : "Die KI schaut sich den Vorgang an …"}</p>`;
        try {
          const r = await db.funktion("ki", { aktion: "naechste_schritte", thema_id: themaId, wunsch: wunsch || null });
          vorschlaege = Array.isArray(r.vorschlaege) ? r.vorschlaege : [];
          zeige();
        } catch (err) {
          box.innerHTML = `<p class="oz-fehler">Vorschläge gerade nicht möglich: ${esc(err.message)}</p>`;
        }
      };
      $("[data-wunsch]", form).addEventListener("click", () => {
        const w = form.wunsch.value.trim();
        if (!w) { form.wunsch.focus(); return; }
        frage(w);
      });
      // Enter im Wunschfeld fragt die KI (statt den Dialog abzuschicken)
      form.wunsch.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); $("[data-wunsch]", form).click(); }
      });
      frage(null);
    },
  });
  if (!daten) return;
  const aktion = daten.get("_aktion");
  const t = await db.ladeThema(themaId).catch(() => null);
  if (aktion === "anders") {
    zustand.themaVorgabe = themaId;
    melde("Empfänger wählen – das Schreiben kommt in denselben Vorgang.", "info");
    return geheZu("#/schreiben");
  }
  if (aktion === "wv") {
    return wiedervorlage({ titel: t ? `Nachfassen: ${t.titel}` : "Nachfassen", mieter_id: t?.mieter_id || null, objekt_id: t?.objekt_id || null }, themaId);
  }
  const v = String(aktion || "").startsWith("v:") ? vorschlaege[Number(aktion.slice(2))] : null;
  if (!v) return;
  if (v.art === "wiedervorlage") {
    return wiedervorlage({ titel: v.titel, notiz: v.grund || null, faellig_am: v.faellig_am, mieter_id: v.mieter_id, objekt_id: v.mieter_id ? null : v.objekt_id }, themaId);
  }
  // Schreiben: vorbelegter Entwurf im selben Vorgang
  zustand.vorbelegung = { nachricht_id: null, anweisung: v.anweisung };
  zustand.themaVorgabe = themaId;
  if (v.objekt_id) zustand.hausVorgabe = v.objekt_id;
  const ziel = v.an === "handwerker" ? `d-${v.id}` : v.an === "kontakt" ? `k-${v.id}`
    : v.an === "kostentraeger" ? `t-${v.id}${v.mieter_id ? "." + v.mieter_id : ""}` : v.id;
  melde("Anweisung eingetragen. Mit „Entwurf mit KI“ den Entwurf erstellen.", "info");
  geheZu(`#/schreiben/${ziel}`);
}

async function wiedervorlage(a, themaId) {
  // start.js erst bei Bedarf laden (Kreis start ↔ postfach)
  const { aufgabeDialog } = await import("./start.js");
  return aufgabeDialog({ ...a, thema_id: themaId }, { nachher: () => { if (location.hash.startsWith("#/thema/")) geheZu(location.hash); } });
}
