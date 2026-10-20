// Gemeinsame Bausteine der Oberfläche: Symbole, Diktat, Wartehinweise, Auswahllisten, Bilder verkleinern
import * as db from "./daten.js";
import { datumDE, mieterName } from "./dokumente.js";
import { $, $$, esc, melde, zustand, wohnungVon, objektVon } from "./helfer.js";

export const ICON_MIKRO = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/></svg>`;
export const ICON_KI = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M11 2l1.9 5.6L18.5 9.5l-5.6 1.9L11 17l-1.9-5.6L3.5 9.5l5.6-1.9zM18.5 13.5l.95 2.55 2.55.95-2.55.95-.95 2.55-.95-2.55L15 17l2.55-.95z"/></svg>`;
export const ICON_KAMERA = `<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M9 3 7.2 5H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3.2L15 3H9zm3 5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9zm0 2a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"/></svg>`;

export const istEmail = (s) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(String(s || ""));
export const kurz = (t, n) => {
  const s = String(t || "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
};
export const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
export const anschriftAnrede = (m) => (m.anrede === "Herr" ? "Herrn " : m.anrede === "Frau" ? "Frau " : "");

export function zeitDE(iso) {
  if (!iso) return "";
  const d = new Date(iso), jetzt = new Date();
  if (d.toDateString() === jetzt.toDateString()) return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) + " Uhr";
  if (d.getFullYear() === jetzt.getFullYear()) return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" }).replace(/\.?$/, ".");
  return datumDE(iso);
}
export const datumZeit = (iso) =>
  new Date(iso).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) + " Uhr";

// ---------------------------------------------------------------------------
// Mietparteien (für Auswahllisten)
// ---------------------------------------------------------------------------
// Navigation auch dann auslösen, wenn die Adresse schon stimmt (Seite neu aufbauen)
export function geheZu(hash) {
  if (location.hash === hash) window.dispatchEvent(new HashChangeEvent("hashchange"));
  else location.hash = hash;
}

export async function mieterListe() {
  zustand.mieterKurz = await db.ladeMieterKurz();
  return zustand.mieterKurz;
}
export function ortVon(m) {
  const w = wohnungVon(m.wohnung_id);
  const o = w && objektVon(w.objekt_id);
  return o ? `${o.strasse || o.bezeichnung}, ${w.bezeichnung}` : "";
}
export function mieterOptionen(liste, gewaehlt, leer = "Keine Mietpartei") {
  return `<option value="">${esc(leer)}</option>` + liste.map((m) => {
    const ort = ortVon(m);
    return `<option value="${esc(m.id)}" ${m.id === gewaehlt ? "selected" : ""}>${esc(mieterName(m))}${ort ? " – " + esc(ort) : ""}</option>`;
  }).join("");
}

// ---------------------------------------------------------------------------
// Diktat (Spracherkennung des Browsers). Auf dem iPhone geht auch das Mikrofon der Tastatur.
// ---------------------------------------------------------------------------
const Erkennung = window.SpeechRecognition || window.webkitSpeechRecognition;
let diktat = null;

export const mikroKnopf = () =>
  `<button type="button" class="mikro" data-diktat aria-pressed="false" title="Diktieren" aria-label="Diktieren">${ICON_MIKRO}</button>`;

export function stoppeDiktat() {
  try { diktat?.erkennung.stop(); } catch { /* schon beendet */ }
}
window.addEventListener("hashchange", stoppeDiktat);
document.getElementById("dialog")?.addEventListener("close", stoppeDiktat);

export function verbindeDiktat(root) {
  for (const knopf of $$("[data-diktat]", root)) {
    const feld = knopf.parentElement.querySelector("textarea, input");
    if (!Erkennung || !feld) { knopf.hidden = true; continue; }
    knopf.addEventListener("click", () => {
      if (diktat?.knopf === knopf) return stoppeDiktat();
      stoppeDiktat();
      starteDiktat(knopf, feld);
    });
  }
}

// Fügt erkannten Text an. Chrome auf Android liefert jedes Ergebnis inklusive allem davor
// („Heizung“, „Heizung ist“, „Heizung ist kalt“) und manchmal doppelt; andere Browser nur das neue Stück.
// Darum: Enthält das neue Stück den bisherigen Text, ersetzt es ihn; überlappende Wörter zählen nur einmal.
const woerter = (t) => String(t).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter(Boolean);
export function fuegeZusammen(bisher, neu) {
  bisher = String(bisher || "").trim();
  neu = String(neu || "").trim();
  if (!neu) return bisher;
  if (!bisher) return neu;
  const a = woerter(bisher), b = woerter(neu);
  const beginntMit = (x, y) => y.length <= x.length && y.every((w, i) => x[i] === w);
  if (beginntMit(b, a)) return neu;                      // neu = bisher + mehr (Android)
  if (beginntMit(a, b) || (b.length <= a.length && a.slice(-b.length).join(" ") === b.join(" "))) return bisher; // schon enthalten (doppelt)
  for (let k = Math.min(a.length, b.length); k >= 2; k--) { // Ende von bisher = Anfang von neu
    if (a.slice(-k).join(" ") === b.slice(0, k).join(" ")) {
      return bisher + " " + neu.split(/\s+/).slice(k).join(" ");
    }
  }
  return bisher + " " + neu;
}

function starteDiktat(knopf, feld) {
  const erkennung = new Erkennung();
  erkennung.lang = "de-DE";
  erkennung.continuous = true;
  erkennung.interimResults = true;
  const anfang = feld.value.trim() ? feld.value.replace(/\s*$/, " ") : "";
  let fest = ""; // fertig erkannter Text dieses Diktats
  erkennung.onresult = (e) => {
    let vorlaeufig = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const teil = e.results[i][0].transcript.trim();
      if (e.results[i].isFinal) fest = fuegeZusammen(fest, teil);
      else vorlaeufig = fuegeZusammen(vorlaeufig, teil);
    }
    feld.value = anfang + fuegeZusammen(fest, vorlaeufig);
    feld.dispatchEvent(new Event("input", { bubbles: true }));
  };
  erkennung.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      melde("Bitte den Zugriff aufs Mikrofon erlauben. Alternativ das Mikrofon der Tastatur nutzen.", "fehler");
    } else if (e.error !== "aborted" && e.error !== "no-speech") {
      melde("Diktat nicht möglich (" + e.error + "). Alternativ das Mikrofon der Tastatur nutzen.", "fehler");
    }
  };
  erkennung.onend = () => {
    knopf.classList.remove("mikro--an");
    knopf.setAttribute("aria-pressed", "false");
    if (diktat?.erkennung === erkennung) diktat = null;
  };
  try {
    erkennung.start();
  } catch (err) {
    return melde("Diktat nicht möglich: " + err.message, "fehler");
  }
  diktat = { knopf, erkennung };
  knopf.classList.add("mikro--an");
  knopf.setAttribute("aria-pressed", "true");
  feld.focus();
}

// Textfelder wachsen mit dem Inhalt
export function wachsen(feld) {
  const anpassen = () => {
    feld.style.height = "auto";
    feld.style.height = Math.min(feld.scrollHeight + 2, 900) + "px";
  };
  feld.addEventListener("input", anpassen);
  requestAnimationFrame(anpassen);
  return anpassen;
}

// Kurzer Wartehinweis als Dialog (z. B. während die KI einen Brief liest)
export function wartehinweis(text) {
  const dlg = $("#dialog");
  dlg.innerHTML = `<div class="warten"><span class="kreisel" aria-hidden="true"></span><p>${esc(text)}</p></div>`;
  dlg.showModal();
  // Wartet auf das close-Ereignis, damit es nicht beim nächsten Dialog ankommt
  return {
    text: (neu) => { const p = dlg.querySelector(".warten p"); if (p) p.textContent = neu; },
    ende: () => new Promise((fertig) => {
      if (!dlg.open) return fertig();
      dlg.addEventListener("close", () => fertig(), { once: true });
      dlg.close();
    }),
  };
}

// Knopf zeigt „arbeitet“, alle Knöpfe im Bereich sind solange gesperrt
export async function beschaeftigt(bereich, knopf, text, arbeit) {
  const knoepfe = $$("button", bereich).filter((b) => !b.disabled);
  const vorher = knopf.innerHTML;
  knoepfe.forEach((b) => (b.disabled = true));
  knopf.innerHTML = `<span class="kreisel" aria-hidden="true"></span> ${esc(text)}`;
  try {
    return await arbeit();
  } finally {
    knoepfe.forEach((b) => (b.disabled = false));
    knopf.innerHTML = vorher;
  }
}

export const alsBase64 = (blob) => new Promise((ok, fehler) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(",")[1]);
  r.onerror = () => fehler(r.error);
  r.readAsDataURL(blob);
});

export function verkleinere(datei, max = 1568) {
  return new Promise((ok, fehler) => {
    const url = URL.createObjectURL(datei);
    const bild = new Image();
    bild.onload = () => {
      const f = Math.min(1, max / Math.max(bild.naturalWidth, bild.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(bild.naturalWidth * f);
      c.height = Math.round(bild.naturalHeight * f);
      c.getContext("2d").drawImage(bild, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob(async (blob) => {
        if (!blob) return fehler(new Error("Umwandlung fehlgeschlagen"));
        ok({ blob, base64: await alsBase64(blob), url: URL.createObjectURL(blob) });
      }, "image/jpeg", 0.85);
    };
    bild.onerror = () => { URL.revokeObjectURL(url); fehler(new Error("Bildformat wird nicht unterstützt")); };
    bild.src = url;
  });
}


// Druckt eine eigene Ansicht (z. B. Auftrag mit Fotos). Die App selbst wird dabei ausgeblendet.
export async function drucke(html) {
  document.getElementById("druck")?.remove();
  const el = document.createElement("div");
  el.id = "druck";
  el.innerHTML = html;
  document.body.append(el);
  document.body.classList.add("druckmodus");
  await Promise.all([...el.querySelectorAll("img")].map((b) => (b.complete ? null : new Promise((ok) => { b.onload = b.onerror = ok; }))));
  const aufraeumen = () => { el.remove(); document.body.classList.remove("druckmodus"); };
  window.addEventListener("afterprint", aufraeumen, { once: true });
  setTimeout(aufraeumen, 120000);
  window.print();
}

// ---------------------------------------------------------------------------
// Suchfeld mit Auswahlliste (Combobox): tippen filtert, Pfeiltasten + Enter oder Klick wählt.
// eintraege: [{ wert, name, zusatz?, gruppe }]; Gruppen erscheinen in der Reihenfolge des ersten Auftretens.
// ---------------------------------------------------------------------------
let suchNr = 0;
export function suchauswahlHtml({ label, placeholder = "Name eingeben …", wert = "", name = null, versteckt = "", inline = false }) {
  const id = `such-${++suchNr}`;
  return `<div class="suchauswahl${inline ? " suchauswahl--inline" : ""}" data-such="${id}">
    <label class="feld"><span>${esc(label)}</span>
      <input type="search" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${id}-liste"
        autocomplete="off" spellcheck="false" placeholder="${esc(placeholder)}" value="${esc(wert)}"></label>
    ${name ? `<input type="hidden" name="${esc(name)}" value="${esc(versteckt)}">` : ""}
    <div class="suchauswahl__liste" id="${id}-liste" role="listbox" hidden></div>
  </div>`;
}

/**
 * Macht aus .suchauswahl eine Suche mit Auswahlliste. waehle(eintrag) bei jeder Wahl.
 * Gibt es ein verstecktes Feld (name), bekommt es eintrag.wert und ein change-Ereignis (für Formulare in Dialogen).
 * Rückgabe: { setze(wert) } zum Vorbelegen von außen.
 */
export function verbindeSuchauswahl(box, eintraege, waehle = () => {}, { max = 80 } = {}) {
  const feld = box.querySelector("input[type=search]");
  const verdeckt = box.querySelector("input[type=hidden]");
  const liste = box.querySelector("[role=listbox]");
  let aktuell = feld.value;
  let treffer = [];
  let aktiv = -1;
  const idVon = (i) => `${liste.id}-${i}`;

  function filtere() {
    const woerter = norm(feld.value === aktuell ? "" : feld.value).split(/\s+/).filter(Boolean);
    treffer = eintraege.filter((e) => {
      const t = norm(`${e.name} ${e.zusatz || ""} ${e.gruppe || ""}`);
      return woerter.every((w) => t.includes(w));
    }).slice(0, max);
  }
  function zeichne() {
    let gruppe = null;
    liste.innerHTML = treffer.length
      ? treffer.map((e, i) => {
        const kopf = e.gruppe && e.gruppe !== gruppe ? `<div class="suchauswahl__gruppe" role="presentation">${esc(e.gruppe)}</div>` : "";
        gruppe = e.gruppe;
        return `${kopf}<div class="suchauswahl__eintrag${e.wert === verdeckt?.value ? " suchauswahl__eintrag--gewaehlt" : ""}" role="option" id="${idVon(i)}" data-i="${i}" aria-selected="${i === aktiv}">
          <span>${esc(e.name)}</span>${e.zusatz ? `<span class="leise">${esc(e.zusatz)}</span>` : ""}</div>`;
      }).join("")
      : `<div class="suchauswahl__leer">Nichts gefunden.</div>`;
    if (aktiv >= 0) feld.setAttribute("aria-activedescendant", idVon(aktiv));
    else feld.removeAttribute("aria-activedescendant");
    const sel = liste.querySelector('[aria-selected="true"]');
    if (sel) liste.scrollTop = Math.max(0, sel.offsetTop - liste.clientHeight + sel.offsetHeight);
  }
  function oeffne() {
    filtere();
    aktiv = treffer.length && feld.value !== aktuell && feld.value.trim() ? 0 : -1;
    liste.hidden = false;
    liste.scrollTop = 0;
    feld.setAttribute("aria-expanded", "true");
    zeichne();
  }
  function schliesse() {
    liste.hidden = true;
    feld.setAttribute("aria-expanded", "false");
    feld.removeAttribute("aria-activedescendant");
    aktiv = -1;
  }
  function uebernimm(e) {
    aktuell = e ? e.name : "";
    feld.value = aktuell;
    if (verdeckt && verdeckt.value !== (e?.wert ?? "")) {
      verdeckt.value = e?.wert ?? "";
      verdeckt.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
  function nimm(i) {
    const e = treffer[i];
    if (!e) return;
    uebernimm(e);
    schliesse();
    waehle(e);
  }
  feld.addEventListener("focus", () => { feld.select(); oeffne(); });
  feld.addEventListener("click", () => { if (liste.hidden) oeffne(); });
  feld.addEventListener("input", oeffne);
  feld.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      if (liste.hidden) return oeffne();
      if (!treffer.length) return;
      aktiv = ev.key === "ArrowDown" ? (aktiv + 1) % treffer.length : (aktiv <= 0 ? treffer.length - 1 : aktiv - 1);
      zeichne();
    } else if (ev.key === "Enter") {
      if (!liste.hidden) { ev.preventDefault(); if (aktiv >= 0) nimm(aktiv); else if (treffer.length === 1) nimm(0); }
    } else if (ev.key === "Escape") {
      if (!liste.hidden) { ev.preventDefault(); ev.stopPropagation(); feld.value = aktuell; schliesse(); }
    }
  });
  // mousedown statt click: sonst verliert das Feld vorher den Fokus und die Liste ist schon zu
  liste.addEventListener("mousedown", (ev) => ev.preventDefault());
  liste.addEventListener("click", (ev) => {
    const z = ev.target.closest("[data-i]");
    if (z) nimm(Number(z.dataset.i));
  });
  feld.addEventListener("blur", () => setTimeout(() => {
    if (document.activeElement === feld) return;
    feld.value = aktuell;
    schliesse();
  }, 150));
  return {
    setze(wert) {
      const e = eintraege.find((x) => x.wert === wert) || null;
      uebernimm(e);
    },
  };
}
