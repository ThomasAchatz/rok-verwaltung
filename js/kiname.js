// Eigener Name für die KI (Einstellungen › Antworten und E-Mails › „Name der KI“, Spalte vermieter_profil.ki_name).
// Statt jede Textstelle umzubauen, ersetzt ein Beobachter in sichtbaren Texten „die KI“ / „der KI“ durch den Namen –
// mit passender Grammatik („Vorschlag der KI“ → „Vorschlag von Jarvis“, „mit der KI“ → „mit Jarvis“).
// Eingaben (Felder, Textbereiche, bearbeitbare Bereiche) und Roberts eigene Chat-Fragen bleiben unverändert.
import { zustand } from "./helfer.js";

const AUSNAHMEN = "textarea, input, select, option, script, style, [contenteditable], .chat__frage, [data-kein-kiname]";
const PRAEP = "mit|von|bei|zu|aus|nach|seit|vor|für|an|über|durch|gegen|ohne";

export const kiName = () => String(zustand.profil?.ki_name || "").replace(/\s+/g, " ").trim().slice(0, 30);

/** Text mit dem KI-Namen (ohne Namen unverändert). Auch für Code, der den Namen direkt braucht. */
export function mitKiName(text, name = kiName()) {
  if (!name || !text || !/KI|Fragen an die App/.test(text)) return text;
  return String(text)
    .replace(/\bKI-Vorschläge\b/g, `Vorschläge von ${name}`)
    .replace(/\bKI-Vorschlag\b/g, `Vorschlag von ${name}`)
    .replace(new RegExp(`\\b(${PRAEP}) (der|die) KI\\b`, "gi"), (_, p) => `${p} ${name}`)
    .replace(new RegExp(`\\b(${PRAEP}) KI\\b`, "gi"), (_, p) => `${p} ${name}`)
    .replace(/\bDie KI\b/g, name)
    .replace(/\bdie KI\b/g, name)
    .replace(/\bDer KI\b/g, `Von ${name}`)
    .replace(/\bder KI\b/g, `von ${name}`)
    .replace(/\bFragen an die App\b/g, `Fragen an ${name}`);
}

const original = new WeakMap(); // Textknoten → ursprünglicher Text (damit ein neuer Name sauber ersetzt)
function knoten(n, name) {
  if (n.nodeType !== 3) return;
  const el = n.parentElement;
  if (!el || el.closest(AUSNAHMEN)) return;
  const alt = original.has(n) && n.nodeValue === original.get(n).neu ? original.get(n).text : n.nodeValue;
  if (!/KI|Fragen an die App/.test(alt)) return;
  const neu = mitKiName(alt, name);
  if (neu !== n.nodeValue) {
    original.set(n, { text: alt, neu });
    n.nodeValue = neu;
  }
}
function attribute(el, name) {
  for (const a of ["placeholder", "title", "aria-label"]) {
    const v = el.getAttribute?.(a);
    if (!v) continue;
    const key = `data-ki-orig-${a}`;
    const alt = el.getAttribute(key) ?? v;
    if (!/KI|Fragen an die App/.test(alt)) continue;
    const neu = mitKiName(alt, name);
    if (neu !== v) { el.setAttribute(key, alt); el.setAttribute(a, neu); }
  }
}
function durchlaufe(wurzel, name) {
  if (!wurzel) return;
  if (wurzel.nodeType === 3) return knoten(wurzel, name);
  if (wurzel.nodeType !== 1) return;
  attribute(wurzel, name);
  const gang = document.createTreeWalker(wurzel, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = gang.nextNode(); n; n = gang.nextNode()) {
    if (n.nodeType === 3) knoten(n, name);
    else attribute(n, name);
  }
}

let beobachter = null;
let aktiv = "";
/** Startet bzw. aktualisiert die Ersetzung (nach dem Laden des Profils und nach dem Speichern des Namens). */
export function aktualisiereKiName() {
  const name = kiName();
  if (name === aktiv) return;
  // Vorher ersetzte Stellen zurück auf den Originaltext, damit „Jarvis“ → „Friday“ sauber wechselt
  for (const el of document.querySelectorAll("[data-ki-orig-placeholder],[data-ki-orig-title],[data-ki-orig-aria-label]")) {
    for (const a of ["placeholder", "title", "aria-label"]) {
      const k = `data-ki-orig-${a}`;
      if (el.hasAttribute(k)) { el.setAttribute(a, el.getAttribute(k)); el.removeAttribute(k); }
    }
  }
  const gang = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = gang.nextNode(); n; n = gang.nextNode()) {
    const o = original.get(n);
    if (o && n.nodeValue === o.neu) { n.nodeValue = o.text; original.delete(n); }
  }
  aktiv = name;
  beobachter?.disconnect();
  beobachter = null;
  if (!name) return;
  durchlaufe(document.body, name);
  beobachter = new MutationObserver((liste) => {
    for (const m of liste) {
      if (m.type === "characterData") knoten(m.target, aktiv);
      else if (m.type === "attributes") attribute(m.target, aktiv);
      else for (const n of m.addedNodes) durchlaufe(n, aktiv);
    }
  });
  beobachter.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["placeholder", "title", "aria-label"] });
}
