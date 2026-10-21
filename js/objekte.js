// Objekte: alle Häuser im Überblick und je Haus die Ordner der Ablage (wie ein Datei-Explorer).
// Dateien lassen sich direkt hineinziehen; die KI benennt sie nach dem Ablage-Schema.
import * as db from "./daten.js";
import * as ablage from "./ablage.js";
import { $, $$, esc, zustand, objektVon, brotkrumen, KRUMEN } from "./helfer.js";
import { ICON_KI, geheZu } from "./ui.js";
import { erschliessen } from "./zipimport.js";

const inhalt = () => $("#inhalt");
const ICON_ORDNER = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z"/></svg>`;
const ICON_HAUS = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M12 3 2 11h3v10h6v-6h2v6h6V11h3L12 3z"/></svg>`;
const anzahl = (n, eins, mehr) => `${n} ${n === 1 ? eins : mehr}`;

// ---------------------------------------------------------------------------
// Alle Objekte
// ---------------------------------------------------------------------------
export async function zeigeObjekte() {
  const [zahlen, uebersicht] = await Promise.all([
    db.ladeDokumentZahlen().catch(() => []),
    db.ladeUebersicht().catch(() => []),
  ]);
  const doks = (id) => zahlen.filter((d) => (d.objekt_id || null) === id).length;
  const leute = (id) => uebersicht.filter((m) => m.objekt_id === id).length;
  const karte = (o) => `
    <a class="objektkarte" href="#/ablage/${esc(o ? o.id : "allgemein")}">
      <span class="objektkarte__symbol">${o ? ICON_HAUS : ICON_ORDNER}</span>
      <span class="objektkarte__text">
        <span class="objektkarte__name">${esc(o ? o.bezeichnung : "Allgemein")}${o?.kuerzel ? ` <span class="marker marker--leise">${esc(o.kuerzel)}</span>` : ""}</span>
        <span class="leise">${o ? esc([o.strasse, [o.plz, o.ort].filter(Boolean).join(" ")].filter(Boolean).join(", ")) : "Unterlagen, die zu keinem Haus gehören"}</span>
        <span class="objektkarte__zahlen">${anzahl(doks(o ? o.id : null), "Dokument", "Dokumente")}${o ? ` · ${anzahl(leute(o.id), "Mietpartei", "Mietparteien")}` : ""}</span>
      </span>
      <span class="objektkarte__pfeil" aria-hidden="true">›</span>
    </a>`;

  inhalt().innerHTML = `
    <div class="kopf">
      <div><h1>Objekte</h1><p>Die Ordner der Ablage je Haus. Zum Öffnen ein Objekt antippen.</p></div>
      <div class="knopfreihe"><a class="knopf" href="#/stammdaten">Häuser &amp; Wohnungen</a></div>
    </div>
    ${ablage.ablegeflaecheHtml({ text: "Dateien hierher ziehen" })}
    <p class="leise ablegeflaeche__unter">Die KI erkennt auch das Haus. Wer schon weiß, wohin es gehört, öffnet vorher das Objekt.</p>
    <div class="objektkarten">
      ${zustand.stamm.objekte.map(karte).join("")}
      ${karte(null)}
    </div>
    ${zustand.stamm.objekte.length ? "" : `<div class="flaeche leer">Noch keine Häuser angelegt. <a href="#/stammdaten">Jetzt anlegen</a></div>`}`;

  ablage.verbindeAblegeflaeche($("[data-ablegeflaeche]", inhalt()), {
    nurAblage: true, ablageZiel: (id) => `#/ablage/${id || "allgemein"}`,
    // Nach dem ZIP-Import: ging alles in ein Haus, dorthin; sonst Übersicht neu
    nachZip: (neu) => {
      const haeuser = [...new Set((neu || []).map((d) => d.objekt_id || "allgemein"))];
      if (haeuser.length === 1) geheZu(`#/ablage/${haeuser[0]}`);
      else zeigeObjekte();
    },
  });
}

// ---------------------------------------------------------------------------
// Ordner eines Objekts als Baum
// ---------------------------------------------------------------------------
// Offene Ordner merken (über Neuladen hinweg, z. B. nach dem Ablegen)
const offen = (zustand.ordnerOffen ||= new Set());

/** Baut den Ordnerbaum aus der Ordnerliste und den Ordnern der Dokumente */
export function ordnerBaum(ordnerNamen, dokumente) {
  const wurzel = { pfad: "", kinder: new Map(), doks: [], platz: -1 };
  const knoten = (pfad) => {
    let k = wurzel;
    const teile = pfad.split("/").map((t) => t.trim()).filter(Boolean);
    teile.forEach((teil, i) => {
      const p = teile.slice(0, i + 1).join("/");
      if (!k.kinder.has(teil)) k.kinder.set(teil, { pfad: p, teil, kinder: new Map(), doks: [], platz: ordnerNamen.indexOf(p) });
      k = k.kinder.get(teil);
    });
    return k;
  };
  for (const n of ordnerNamen) knoten(n);
  for (const d of dokumente) knoten(d.ordner || "Sonstiges").doks.push(d);
  return wurzel;
}
const summe = (k) => k.doks.length + [...k.kinder.values()].reduce((s, x) => s + summe(x), 0);
// Reihenfolge: wie in der Ordnerliste; automatische Unterordner: Jahre neueste zuerst, sonst nach Namen
const sortiert = (k) => [...k.kinder.values()].sort((a, b) => {
  if (a.platz >= 0 || b.platz >= 0) return (a.platz < 0 ? 1e6 : a.platz) - (b.platz < 0 ? 1e6 : b.platz);
  if (/^\d{4}$/.test(a.teil) && /^\d{4}$/.test(b.teil)) return b.teil.localeCompare(a.teil);
  return a.teil.localeCompare(b.teil, "de", { numeric: true });
});

function baumHtml(k, objektKey, tiefe = 0) {
  return sortiert(k).map((x) => {
    const n = summe(x);
    const auto = ablage.ordnerAutomatik(x.pfad);
    const schluessel = `${objektKey}|${x.pfad}`;
    const leerText = auto === "jahr" ? "Leer. Unterordner je Jahr entstehen beim Ablegen automatisch."
      : auto === "wohnung" ? "Leer. Unterordner je Wohnung entstehen beim Ablegen automatisch."
      : "Leer.";
    return `
      <details class="baum__ordner ${n ? "" : "baum__ordner--leer"}" data-pfad="${esc(schluessel)}" ${offen.has(schluessel) ? "open" : ""}>
        <summary>
          <span class="baum__symbol">${ICON_ORDNER}</span>
          <span class="baum__name">${esc(x.teil)}</span>
          ${auto ? `<span class="marker marker--leise">${auto === "jahr" ? "je Jahr" : "je Wohnung"}</span>` : ""}
          <span class="baum__zahl">${n}</span>
        </summary>
        <div class="baum__inhalt">
          ${baumHtml(x, objektKey, tiefe + 1)}
          ${x.doks.map(ablage.dokKnopf).join("")}
          ${n ? "" : `<div class="baum__leer leise">${leerText}</div>`}
        </div>
      </details>`;
  }).join("");
}

export async function zeigeOrdner(id) {
  const allgemein = id === "allgemein";
  const o = allgemein ? null : objektVon(id);
  if (!allgemein && !o) throw new Error("Dieses Haus gibt es nicht (mehr).");
  const objektId = allgemein ? null : o.id;
  const [ordnerNamen, dokumente] = await Promise.all([
    ablage.ordnerListe(),
    db.ladeDokumente({ objektId }).catch(() => []),
  ]);
  const titel = allgemein ? "Allgemein" : o.bezeichnung;
  // Zuletzt abgelegte Datei: Ordner aufklappen und Datei hervorheben
  const neuId = zustand.zuletztAbgelegt;
  zustand.zuletztAbgelegt = null;
  const neuDok = dokumente.find((d) => d.id === neuId);
  if (neuDok) {
    const teile = String(neuDok.ordner || "Sonstiges").split("/");
    teile.forEach((_, i) => offen.add(`${id}|${teile.slice(0, i + 1).join("/")}`));
  }
  const baum = ordnerBaum(ordnerNamen, dokumente);
  const neuLaden = () => zeigeOrdner(id);
  // Dateien ohne Inhaltsangabe (z. B. aus einem ZIP-Import): kann die KI nachträglich lesen
  const unerschlossen = dokumente.filter((d) => !d.zusammenfassung && /^(image\/|application\/pdf|application\/vnd\.openxmlformats)/.test(d.typ || ""));

  inhalt().innerHTML = `
    ${brotkrumen([...KRUMEN.objekte, { text: titel, href: `#/objekt/${id}` }, { text: "Ablage" }])}
    <div class="kopf">
      <div><h1>${esc(titel)}</h1>
        <p>${allgemein ? "Unterlagen, die zu keinem bestimmten Haus gehören" : esc([o.strasse, [o.plz, o.ort].filter(Boolean).join(" ")].filter(Boolean).join(", "))} · ${anzahl(dokumente.length, "Dokument", "Dokumente")}</p></div>
      <div class="knopfreihe"><a class="knopf" href="#/objekt/${esc(id)}">Zur Hausseite</a></div>
    </div>
    ${ablage.ablegeflaecheHtml({ text: `Dateien für ${titel} hierher ziehen` })}
    <section class="flaeche">
      <div class="flaeche__kopf"><h2>Ordner</h2>
        <span class="knopfreihe">
          <button type="button" class="knopf knopf--klein knopf--leise" id="alle-auf">Alle aufklappen</button>
          <button type="button" class="knopf knopf--klein knopf--leise" id="alle-zu">Alle zuklappen</button>
        </span></div>
      <div class="baum">${baumHtml(baum, id)}</div>
      <div class="flaeche__fuss knopfreihe">
        <button type="button" class="knopf knopf--klein" id="ordner-bearbeiten">Ordner bearbeiten</button>
        ${dokumente.length ? `<button type="button" class="knopf knopf--klein" id="zip">Als ZIP herunterladen</button>` : ""}
        ${unerschlossen.length && zustand.ki?.ki ? `<button type="button" class="knopf knopf--klein knopf--ki" id="erschliessen" title="Die KI liest die Dateien einmal und merkt sich, was drinsteht">${ICON_KI} Für die KI erschließen (${unerschlossen.length})</button>` : ""}
      </div>
    </section>`;

  ablage.verbindeAblegeflaeche($("[data-ablegeflaeche]", inhalt()), {
    objektId, nurAblage: true, ablageZiel: (neuId) => `#/ablage/${neuId || "allgemein"}`, nachZip: () => neuLaden(),
  });
  $("#erschliessen")?.addEventListener("click", () => erschliessen(unerschlossen, { nachher: neuLaden }));
  ablage.verbindeListen(inhalt(), { dokumente, objektId, nachher: neuLaden });
  if (neuDok) {
    const el = $(`[data-dok="${CSS.escape(neuDok.id)}"]`, inhalt());
    el?.classList.add("dok--neu");
    setTimeout(() => el?.scrollIntoView({ block: "center" }), 0); // nach dem Hochscrollen beim Seitenwechsel
  }
  for (const d of $$(".baum__ordner", inhalt())) {
    d.addEventListener("toggle", () => (d.open ? offen.add(d.dataset.pfad) : offen.delete(d.dataset.pfad)));
  }
  const alle = (auf) => { for (const d of $$(".baum__ordner", inhalt())) if (!d.classList.contains("baum__ordner--leer") || !auf) d.open = auf; };
  $("#alle-auf").addEventListener("click", () => alle(true));
  $("#alle-zu").addEventListener("click", () => alle(false));
  $("#ordner-bearbeiten").addEventListener("click", () => ablage.ordnerBearbeiten({ nachher: neuLaden }));
  $("#zip")?.addEventListener("click", () => ablage.zipExport({ objektId }));
}
