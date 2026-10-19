// Gemeinsame Hilfsfunktionen und der Zustand der Oberfläche (von app.js und postfach.js genutzt)

export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
export const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const heuteISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// aktion: { text, beiKlick } zeigt einen Knopf in der Meldung (z. B. „Ändern“)
export function melde(text, art = "info", { aktion = null, dauer = null } = {}) {
  const el = document.createElement("div");
  el.className = `meldung meldung--${art}`;
  el.setAttribute("role", art === "fehler" ? "alert" : "status");
  const span = document.createElement("span");
  span.textContent = text;
  el.append(span);
  if (aktion) {
    const knopf = Object.assign(document.createElement("button"), { type: "button", className: "meldung__knopf", textContent: aktion.text });
    knopf.addEventListener("click", () => { el.remove(); aktion.beiKlick(); });
    el.append(knopf);
  }
  $("#meldungen").append(el);
  setTimeout(() => el.remove(), dauer ?? (art === "fehler" ? 9000 : 4500));
}

export function herunterladen(bytes, dateiname, typ = "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
  const url = URL.createObjectURL(new Blob([bytes], { type: typ }));
  const a = Object.assign(document.createElement("a"), { href: url, download: dateiname });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const dateiTeil = (s) =>
  String(s || "").replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/Ä/g, "Ae").replace(/Ö/g, "Oe").replace(/Ü/g, "Ue").replace(/ß/g, "ss")
    .normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Dialog mit Formular; liefert die Formulardaten oder null bei Abbruch.
// vorbereiten(form) wird nach dem Öffnen aufgerufen (z. B. für Diktat-Knöpfe).
export function dialogFormular(html, { breit = false, vorbereiten = null } = {}) {
  const dlg = $("#dialog");
  dlg.classList.toggle("dialog--breit", breit);
  dlg.innerHTML = `<form method="dialog">${html}</form>`;
  const form = $("form", dlg);
  dlg.showModal();
  $("input:not([type=hidden]):not([readonly]), select, textarea", form)?.focus();
  vorbereiten?.(form);
  // Erst nach dem close-Ereignis auflösen: Sonst landet es beim nächsten Dialog und schließt ihn sofort.
  return new Promise((fertig) => {
    let ergebnis = null;
    form.addEventListener("submit", (e) => {
      if (e.submitter?.value === "abbrechen") { ergebnis = null; return; }
      ergebnis = new FormData(form);
      ergebnis.set("_aktion", e.submitter?.value || "ok");
    });
    dlg.addEventListener("close", () => { dlg.classList.remove("dialog--breit"); fertig(ergebnis); }, { once: true });
  });
}

// Einfache Rückfrage mit eigenem Text (statt confirm(), das auf iOS in der App unschön aussieht)
export async function frage(titel, html, jaText = "OK", { gefahr = false } = {}) {
  const daten = await dialogFormular(`
    <h2>${esc(titel)}</h2>
    ${html}
    <div class="knopfreihe">
      <button class="knopf" value="abbrechen" formnovalidate>Abbrechen</button>
      <button class="knopf ${gefahr ? "knopf--gefahr" : "knopf--primaer"}" value="ok">${esc(jaText)}</button>
    </div>`, { breit: true });
  return !!daten;
}

// ---------------------------------------------------------------------------
// Zustand
// ---------------------------------------------------------------------------
export const zustand = {
  nutzer: null,
  profil: null,
  stamm: null,      // { objekte, wohnungen, kostentraeger }
  vorlagen: null,
  akte: null,       // geöffneter Mieter
  ki: null,         // { ki, modell, versand, absender } – was auf dem Server eingerichtet ist
};

export const wohnungVon = (id) => zustand.stamm.wohnungen.find((w) => w.id === id) || null;
export const objektVon = (id) => zustand.stamm.objekte.find((o) => o.id === id) || null;
export const kostentraegerVon = (id) => zustand.stamm.kostentraeger.find((k) => k.id === id) || null;
