// Gesprächsmodus (z. B. beim Autofahren): Antworten laut vorlesen, kurzer Ton vor dem Zuhören, Bildschirm bleibt an.
// Nur Bausteine; den Ablauf (zuhören → fragen → vorlesen) steuert js/chat.js. Alles läuft im Browser, nichts geht an weitere Dienste.
import { kannZuhoeren } from "./ui.js";

export const kannGespraech = () =>
  kannZuhoeren() && "speechSynthesis" in window && typeof window.SpeechSynthesisUtterance === "function";

// ---------------------------------------------------------------------------
// Stimme: beste deutsche Stimme des Geräts (iPhone: „Erweitert“/„Premium“, Chrome: Google Deutsch)
// ---------------------------------------------------------------------------
let stimme = null;
let stimmeGewaehlt = false;
function stimmenListe() {
  return new Promise((res) => {
    const jetzt = speechSynthesis.getVoices();
    if (jetzt.length) return res(jetzt);
    const t = setTimeout(() => res(speechSynthesis.getVoices()), 1500);
    speechSynthesis.addEventListener?.("voiceschanged", () => { clearTimeout(t); res(speechSynthesis.getVoices()); }, { once: true });
  });
}
/** Vorab laden (beim Öffnen des Chats), damit die erste Ausgabe direkt im Klick passieren kann */
export async function waehleStimme() {
  if (stimmeGewaehlt || !kannGespraech()) return stimme;
  const de = (await stimmenListe()).filter((v) => /^de([-_]|$)/i.test(v.lang || ""));
  const punkte = (v) => (/premium|enhanced|erweitert|neural|natural/i.test(v.name) ? 4 : 0) + (/google/i.test(v.name) ? 2 : 0) +
    (/^de[-_]DE$/i.test(v.lang) ? 1 : 0) + (v.localService ? 0.5 : 0);
  stimme = de.sort((a, b) => punkte(b) - punkte(a))[0] || null;
  stimmeGewaehlt = true;
  return stimme;
}

// ---------------------------------------------------------------------------
// Text fürs Vorlesen: ohne Links, Markdown, Aufzählungszeichen; gängige Abkürzungen ausgeschrieben
// ---------------------------------------------------------------------------
const ABK = [
  [/\bz\.\s?B\./g, "zum Beispiel"], [/\bca\./g, "circa"], [/\bggf\./g, "gegebenenfalls"], [/\bbzw\./g, "beziehungsweise"],
  [/\busw\./g, "und so weiter"], [/\bu\.\s?a\./g, "unter anderem"], [/\bd\.\s?h\./g, "das heißt"], [/\bNr\./g, "Nummer"],
  [/\bWhg\./g, "Wohnung"], [/\bStr\./g, "Straße"], [/\bmtl\./g, "monatlich"], [/\binkl\./g, "inklusive"], [/\bevtl\./g, "eventuell"],
  [/\bEG\b/g, "Erdgeschoss"], [/\bOG\b/g, "Obergeschoss"], [/\bDG\b/g, "Dachgeschoss"], [/\bNK\b/g, "Nebenkosten"],
];
export function alsSprache(text) {
  let t = String(text || "")
    .replace(/\[([^\]\n]+)\]\([^)\s]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[*_`#>|]+/g, "")
    .split("\n")
    .map((z) => z.replace(/^\s*(?:[-•]|\d+[.)])\s+/, "").trim())
    .filter(Boolean)
    .map((z) => (/[.!?:;,]$/.test(z) ? z : z + "."))
    .join(" ");
  for (const [muster, ersatz] of ABK) t = t.replace(muster, ersatz);
  return t.replace(/m²/g, " Quadratmeter").replace(/\s&\s/g, " und ").replace(/\(\s*\)/g, "").replace(/\s{2,}/g, " ").trim();
}

// In kurze Stücke teilen: Manche Browser brechen lange Ausgaben nach etwa 15 Sekunden ab
export function teile(text, max = 220) {
  const stuecke = [];
  for (const satz of String(text).split(/(?<=[.!?…])\s+/)) {
    if (!satz.trim()) continue;
    const letztes = stuecke[stuecke.length - 1];
    if (letztes && letztes.length + satz.length < 120) stuecke[stuecke.length - 1] = letztes + " " + satz;
    else if (satz.length <= max) stuecke.push(satz);
    else {
      let rest = satz;
      while (rest.length > max) {
        const schnitt = Math.max(rest.lastIndexOf(", ", max), rest.lastIndexOf(" ", max));
        const i = schnitt > 40 ? schnitt + 1 : max;
        stuecke.push(rest.slice(0, i).trim());
        rest = rest.slice(i).trim();
      }
      if (rest) stuecke.push(rest);
    }
  }
  return stuecke;
}

let laufend = null; // { aus, fertig }
/**
 * Liest den Text vor. Die erste Ausgabe startet synchron (wichtig im Klick: schaltet auf dem iPhone die Sprachausgabe frei).
 * Löst auf, wenn alles gesprochen ist oder stoppeSprechen() aufgerufen wurde.
 */
export function sprich(text, { tempo = 1.05 } = {}) {
  stoppeSprechen();
  const stuecke = teile(alsSprache(text));
  if (!stuecke.length || !kannGespraech()) return Promise.resolve();
  return new Promise((fertig) => {
    const lauf = { aus: false, fertig };
    laufend = lauf;
    let i = 0;
    const naechstes = () => {
      if (lauf.aus || i >= stuecke.length) {
        if (laufend === lauf) laufend = null;
        return fertig();
      }
      const u = new SpeechSynthesisUtterance(stuecke[i++]);
      u.lang = stimme?.lang || "de-DE";
      if (stimme) u.voice = stimme;
      u.rate = tempo;
      let weiter = false;
      // Sicherheitsnetz: Manche Browser melden das Ende nie
      const netz = setTimeout(() => fertigStueck(), Math.max(5000, u.text.length * 140));
      function fertigStueck() {
        if (weiter) return;
        weiter = true;
        clearTimeout(netz);
        naechstes();
      }
      u.onend = fertigStueck;
      u.onerror = fertigStueck;
      speechSynthesis.speak(u);
    };
    naechstes();
  });
}
export function stoppeSprechen() {
  const lauf = laufend;
  laufend = null;
  if (lauf) lauf.aus = true;
  try { if (kannGespraech()) speechSynthesis.cancel(); } catch { /* egal */ }
  lauf?.fertig();
}

// ---------------------------------------------------------------------------
// Kurzer Ton „ich höre jetzt zu“ (Web Audio, im Klick vorbereitet). Fällt still weg, wenn das Gerät es nicht kann.
// ---------------------------------------------------------------------------
let audio = null;
export function tonVorbereiten() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!audio && Ctx) audio = new Ctx();
    audio?.resume?.();
  } catch { audio = null; }
}
export function ton(hoch = true) {
  if (!audio) return;
  try {
    audio.resume?.();
    const t0 = audio.currentTime;
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = hoch ? 880 : 520;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.2, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
    o.connect(g).connect(audio.destination);
    o.start(t0);
    o.stop(t0 + 0.2);
  } catch { /* ohne Ton */ }
}
export function tonAus() {
  try { audio?.close?.(); } catch { /* egal */ }
  audio = null;
}

// ---------------------------------------------------------------------------
// Bildschirm anlassen, solange das Gespräch läuft (sonst sperrt das Handy und das Zuhören endet)
// ---------------------------------------------------------------------------
let sperre = null;
export async function bildschirmAn() {
  try { sperre = (await navigator.wakeLock?.request("screen")) || null; } catch { sperre = null; }
}
export function bildschirmFrei() {
  try { sperre?.release?.(); } catch { /* egal */ }
  sperre = null;
}

// ---------------------------------------------------------------------------
// Gesprochene Antworten erkennen
// ---------------------------------------------------------------------------
export const normWort = (t) => String(t || "").toLowerCase().replace(/[’'`´]/g, "").replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim();
const STOPP = /^(?:ok(?:ay)? )?(?:stopp?|ende|beenden|gespräch beenden|schluss|tschüss|tschau|ciao|servus|pfiat di|pfiat eich|danke(?: dir| schön| sehr)?(?: das wars?| das war alles| das wärs)?|das wars?|das war alles|das wärs)$/;
const JA = /^(?:ja|jo|jawohl|jep|genau|passt|gern|gerne|ok|okay|bitte|speicher|speichere|speichern|mach|mach das|mach mal|freilich|logisch)\b/;
const NEIN = /^(?:nein|nee|ne|na|nö|noi|lass|lass es|nicht|brauch ich nicht|nicht speichern|vergiss es)\b/;
export const istStopp = (t) => STOPP.test(normWort(t));
export const istNein = (t) => NEIN.test(normWort(t)) || /\b(?:nein|nicht speichern)\b/.test(normWort(t));
export const istJa = (t) => JA.test(normWort(t)) && !istNein(t);
