// Unterschrift für Briefe: hochladen (Hintergrund wird entfernt), sicher ablegen und in Word-Briefe einsetzen.
// Nur Briefe/PDF bekommen die Unterschrift, E-Mails nie. Das Bild liegt im privaten Bucket „vorlagen“.
import * as db from "./daten.js";
import { $, esc, melde, frage, zustand } from "./helfer.js";

const MAX_BREITE = 900;

// ---------------------------------------------------------------------------
// Wann gehört eine Unterschrift drauf? (nur Vorschlag, in der Vorschau umschaltbar)
// ---------------------------------------------------------------------------
const VERTRAGLICH = /miet(er)?h(ö|oe)hung|mietanpassung|anpassung der miete|vergleichsmiete|staffel|indexmiete|k(ü|ue)ndigung|vertrag|vereinbarung|kaution|abmahnung|mahnung|ratenzahlung|zahlungsaufforderung|nebenkostenabrechnung|betriebskostenabrechnung|abrechnung|bescheinigung|best(ä|ae)tigung|vollmacht|(ü|ue)bergabeprotokoll|jobcenter|sozialamt|kosten der unterkunft|\bkdu\b|aktenzeichen/i;

/**
 * Vorschlag „mit Unterschrift?“ für ein Schreiben.
 * Vertragliches (Jobcenter/Ämter, Mieterhöhung, Kündigung, Mahnung, Vereinbarungen …): ja.
 * Rundschreiben/Aushänge, Hausordnung, Anweisungen: nein.
 */
export function sollUnterschreiben({ typ = null, kostentraeger = false, haus = false, betreff = "", text = "" } = {}) {
  if (typ === "mahnung_1" || typ === "mahnung_2" || typ === "nachweis_jobcenter") return true;
  if (haus) return false;
  if (kostentraeger) return true;
  return VERTRAGLICH.test(`${betreff}\n${text}`);
}

// ---------------------------------------------------------------------------
// Bild laden (zwischengespeichert, nur im Arbeitsspeicher)
// ---------------------------------------------------------------------------
let zwischen = { pfad: null, png: null };

export const hatUnterschrift = () => !!zustand.profil?.unterschrift?.pfad;

/** PNG der hinterlegten Unterschrift als { png } für fuelleVorlage, sonst null */
export async function ladeUnterschrift() {
  const u = zustand.profil?.unterschrift;
  if (!u?.pfad) return null;
  if (zwischen.pfad !== u.pfad) {
    zwischen = { pfad: u.pfad, png: await db.ladeUnterschriftBild(u.pfad) };
  }
  return { png: zwischen.png };
}

// ---------------------------------------------------------------------------
// Foto/Scan aufbereiten: heller Hintergrund wird durchsichtig, Rand abgeschnitten
// ---------------------------------------------------------------------------
async function bildAus(datei) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(datei); } catch { /* unten mit <img> */ }
  }
  const url = URL.createObjectURL(datei);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export async function bereiteBildAuf(datei) {
  if (!/^image\/(png|jpe?g|webp|gif|bmp)$/i.test(datei.type || "")) {
    throw new Error("Bitte ein Foto oder einen Scan als Bild wählen (JPG oder PNG).");
  }
  const bild = await bildAus(datei);
  const w0 = bild.width, h0 = bild.height;
  const faktor = Math.min(1, 2000 / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * faktor)), h = Math.max(1, Math.round(h0 * faktor));
  const c = Object.assign(document.createElement("canvas"), { width: w, height: h });
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bild, 0, 0, w, h);
  const daten = ctx.getImageData(0, 0, w, h);
  const px = daten.data;

  // Helligkeit des Papiers schätzen (90 % der Pixel sind dunkler)
  const hist = new Uint32Array(256);
  for (let i = 0; i < px.length; i += 4) hist[(px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000 | 0]++;
  let papier = 255;
  for (let summe = 0, ziel = (w * h) * 0.9, l = 0; l < 256; l++) {
    summe += hist[l];
    if (summe >= ziel) { papier = l; break; }
  }
  const voll = Math.max(20, papier - 110); // ab hier volle Deckkraft
  const leer = Math.max(voll + 10, papier - 35); // ab hier durchsichtig

  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const l = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
      let a = l >= leer ? 0 : l <= voll ? 255 : Math.round(255 * (leer - l) / (leer - voll));
      if (a < 25) a = 0;
      // Tinte etwas kräftiger, Farbton bleibt (blau bleibt blau)
      px[i] = Math.round(px[i] * 0.6); px[i + 1] = Math.round(px[i + 1] * 0.6); px[i + 2] = Math.round(px[i + 2] * 0.6);
      px[i + 3] = a;
      if (a) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0 || (x1 - x0) < 20 || (y1 - y0) < 8) {
    throw new Error("Auf dem Bild ist keine Unterschrift zu erkennen. Bitte mit dunklem Stift auf weißem Papier, gut ausgeleuchtet.");
  }
  ctx.putImageData(daten, 0, 0);
  const rand = Math.round(Math.max(x1 - x0, y1 - y0) * 0.03) + 2;
  x0 = Math.max(0, x0 - rand); y0 = Math.max(0, y0 - rand);
  x1 = Math.min(w - 1, x1 + rand); y1 = Math.min(h - 1, y1 + rand);
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const s = Math.min(1, MAX_BREITE / bw);
  const ziel = Object.assign(document.createElement("canvas"), { width: Math.round(bw * s), height: Math.round(bh * s) });
  const zctx = ziel.getContext("2d");
  zctx.imageSmoothingQuality = "high";
  zctx.drawImage(c, x0, y0, bw, bh, 0, 0, ziel.width, ziel.height);
  const blob = await new Promise((ok, fehl) => ziel.toBlob((b) => (b ? ok(b) : fehl(new Error("Bild konnte nicht erstellt werden."))), "image/png"));
  return { blob, breite: ziel.width, hoehe: ziel.height };
}

// ---------------------------------------------------------------------------
// Einstellungen: Bereich „Unterschrift“
// ---------------------------------------------------------------------------
export function unterschriftBereichHtml() {
  return `
    <section class="flaeche" id="unterschrift-bereich">
      <div class="flaeche__kopf"><h2>Unterschrift</h2><span class="leise">nur in Briefen, nie in E-Mails</span></div>
      <div class="flaeche__inhalt">
        <div class="unterschrift-feld" data-unterschrift-bild>${hatUnterschrift() ? `<span class="leise">Wird geladen …</span>` : `<span class="leise">Noch keine Unterschrift hinterlegt.</span>`}</div>
        <p class="leise">Foto oder Scan der Unterschrift (dunkler Stift auf weißem Papier). Der Hintergrund wird entfernt.
          Beim Brief entscheidet ihr in der Vorschau mit „Unterschrift einsetzen“; bei Jobcenter, Mieterhöhung, Mahnung,
          Kündigung und Vereinbarungen ist das Häkchen schon gesetzt, bei Aushängen und Rundschreiben nicht.</p>
        <div class="knopfreihe">
          <label class="knopf">${hatUnterschrift() ? "Neue Unterschrift hochladen" : "Unterschrift hochladen"}
            <input type="file" accept="image/*" id="unterschrift-datei" hidden></label>
          ${hatUnterschrift() ? `<button type="button" class="knopf knopf--gefahr" id="unterschrift-weg">Entfernen</button>` : ""}
        </div>
      </div>
    </section>`;
}

export function verbindeUnterschrift(neuZeichnen) {
  const feld = $("[data-unterschrift-bild]");
  if (hatUnterschrift() && feld) {
    ladeUnterschrift()
      .then((u) => {
        const url = URL.createObjectURL(new Blob([u.png], { type: "image/png" }));
        feld.innerHTML = `<img src="${url}" alt="Hinterlegte Unterschrift">`;
      })
      .catch((err) => { feld.innerHTML = `<span class="formfehler">Unterschrift nicht ladbar: ${esc(err.message)}</span>`; });
  }
  $("#unterschrift-datei")?.addEventListener("change", async (e) => {
    const datei = e.target.files[0];
    e.target.value = "";
    if (!datei) return;
    let fertig;
    try { fertig = await bereiteBildAuf(datei); } catch (err) { return melde(err.message, "fehler"); }
    const url = URL.createObjectURL(fertig.blob);
    const ok = await frage("Unterschrift übernehmen?", `
      <p>So erscheint sie in Briefen (Hintergrund entfernt):</p>
      <div class="unterschrift-feld unterschrift-feld--gross"><img src="${url}" alt="Vorschau der Unterschrift"></div>
      <p class="leise">Sie liegt geschützt im Speicher der App und wird nur in Briefe eingesetzt, wenn ihr das Häkchen setzt.</p>`, "Übernehmen");
    URL.revokeObjectURL(url);
    if (!ok) return;
    try {
      const alt = zustand.profil?.unterschrift?.pfad || null;
      const pfad = await db.speichereUnterschriftBild(fertig.blob);
      zustand.profil = await db.speichereProfil({
        unterschrift: { pfad, breite: fertig.breite, hoehe: fertig.hoehe, stand: new Date().toISOString() },
      });
      if (alt && alt !== pfad) await db.loescheUnterschriftBild(alt).catch(() => {});
      zwischen = { pfad: null, png: null };
      melde("Unterschrift gespeichert.", "ok");
      neuZeichnen?.();
    } catch (err) { melde(err.message, "fehler"); }
  });
  $("#unterschrift-weg")?.addEventListener("click", async () => {
    const ok = await frage("Unterschrift entfernen?", "<p>Briefe enthalten danach keine eingesetzte Unterschrift mehr. Bereits erstellte Briefe bleiben, wie sie sind.</p>", "Entfernen", { gefahr: true });
    if (!ok) return;
    try {
      const alt = zustand.profil?.unterschrift?.pfad || null;
      zustand.profil = await db.speichereProfil({ unterschrift: null });
      if (alt) await db.loescheUnterschriftBild(alt).catch(() => {});
      zwischen = { pfad: null, png: null };
      melde("Unterschrift entfernt.", "ok");
      neuZeichnen?.();
    } catch (err) { melde(err.message, "fehler"); }
  });
}

/** Für die Vorschau: Option `unterschrift` von zeigeDokument */
export async function vorschauOption(an, erzeuge) {
  const u = hatUnterschrift() ? await ladeUnterschrift().catch(() => null) : null;
  return {
    vorhanden: !!u,
    an: !!u && an,
    erzeuge: (mit) => erzeuge(mit && u ? u : null),
  };
}
