// Vorschau eines Word-Dokuments im Browser (docx-preview) mit den Aktionen
// Drucken/PDF, Per E-Mail, Herunterladen und „ins E-Mail-Programm ziehen“.
// Benötigt die globalen Bibliotheken JSZip und docx (vendor/jszip.min.js, vendor/docx-preview.min.js).

const DOCX_TYP = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const RAHMEN_CSS = `
  html, body { margin: 0; background: #e6eaf0; }
  body { padding: 20px 0; }
  .docx-wrapper { background: transparent !important; padding: 0 !important; display: flex; flex-direction: column; align-items: center; gap: 20px; }
  .docx-wrapper > section.docx { box-shadow: 0 1px 3px rgba(29,36,48,.12), 0 6px 18px rgba(29,36,48,.10); margin: 0 !important; }
  @media print {
    html, body { background: #fff; }
    body { padding: 0; zoom: 1 !important; }
    .docx-wrapper { gap: 0; display: block; }
    .docx-wrapper > section.docx { box-shadow: none; margin: 0 !important; page-break-after: always; }
    @page { size: A4; margin: 0; }
  }`;

/**
 * Öffnet die Vorschau.
 * @param {object} o
 * @param {string} o.titel
 * @param {string} [o.untertitel]
 * @param {Uint8Array|ArrayBuffer} o.bytes
 * @param {string} o.dateiname
 * @param {string} [o.hinweis]           Text unter der Vorschau
 * @param {function} [o.vorAbschluss]   async; wird vor der ersten Aktion einmal aufgerufen (z. B. im Verlauf speichern)
 * @param {{an?: string, betreff?: string, text?: string}} [o.email]
 * @param {function} [o.melde]           Meldungsfunktion (text, art)
 * @returns {Promise<boolean>}           true, wenn eine Aktion ausgeführt wurde
 */
export function zeigeDokument(o) {
  const dlg = document.getElementById("dialog");
  const blob = new Blob([o.bytes], { type: DOCX_TYP });
  const url = URL.createObjectURL(blob);
  const melde = o.melde || (() => {});
  let abgeschlossen = !o.vorAbschluss;
  const aufraeumen = new AbortController();
  let aktion = false;

  dlg.classList.add("dialog--vorschau");
  dlg.innerHTML = `
    <div class="vorschau">
      <header class="vorschau__kopf">
        <div>
          <h2>${esc(o.titel)}</h2>
          ${o.untertitel ? `<p class="leise">${esc(o.untertitel)}</p>` : ""}
        </div>
        <button type="button" class="knopf knopf--leise" data-v="schliessen" aria-label="Vorschau schließen">Schließen</button>
      </header>
      <div class="vorschau__flaeche">
        <iframe class="vorschau__blatt" title="Vorschau ${esc(o.titel)}"></iframe>
        <div class="vorschau__laden">Vorschau wird erstellt …</div>
      </div>
      <footer class="vorschau__fuss">
        <p class="vorschau__hinweis leise" data-v="hinweis">${esc(o.hinweis || "")}</p>
        <div class="vorschau__aktionen">
          <a class="datei-chip" data-v="ziehen" href="${url}" download="${esc(o.dateiname)}" draggable="true"
             title="Mit der Maus in eine E-Mail ziehen (Chrome/Edge)">
            <span class="datei-chip__icon" aria-hidden="true">W</span>
            <span><strong>${esc(o.dateiname)}</strong><span class="leise">In die E-Mail ziehen</span></span>
          </a>
          <div class="knopfreihe">
            <button type="button" class="knopf" data-v="drucken">Drucken / PDF</button>
            <button type="button" class="knopf" data-v="email">Per E-Mail</button>
            <button type="button" class="knopf knopf--primaer" data-v="laden">Herunterladen</button>
          </div>
        </div>
      </footer>
    </div>`;

  const iframe = dlg.querySelector("iframe");
  const ladeHinweis = dlg.querySelector(".vorschau__laden");

  async function abschliessen() {
    if (abgeschlossen) return;
    abgeschlossen = true;
    try {
      await o.vorAbschluss();
      aktion = true;
    } catch (err) {
      abgeschlossen = false;
      melde(err.message, "fehler");
      throw err;
    }
  }

  function herunterladen() {
    const a = Object.assign(document.createElement("a"), { href: url, download: o.dateiname });
    document.body.append(a);
    a.click();
    a.remove();
  }

  dlg.addEventListener("click", async (e) => {
    if (e.target === dlg) return dlg.close(); // Klick neben das Fenster
    const k = e.target.closest("[data-v]");
    if (!k) return;
    const was = k.dataset.v;
    if (was === "schliessen") return dlg.close();
    if (was === "ziehen") {
      // Klick auf die Datei = herunterladen
      e.preventDefault();
      herunterladen();
      try { await abschliessen(); } catch { /* gemeldet */ }
      return;
    }
    if (was === "laden") {
      herunterladen();
      try { await abschliessen(); melde("Heruntergeladen: " + o.dateiname, "ok"); } catch { /* gemeldet */ }
    }
    if (was === "drucken") {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      try { await abschliessen(); } catch { /* gemeldet */ }
    }
    if (was === "email") {
      const datei = new File([blob], o.dateiname, { type: DOCX_TYP });
      const e2 = o.email || {};
      if (navigator.canShare && navigator.canShare({ files: [datei] })) {
        try {
          await navigator.share({ files: [datei], title: e2.betreff || o.titel, text: e2.text || "" });
        } catch (err) {
          if (err.name === "AbortError") return;
          melde("Teilen nicht möglich: " + err.message, "fehler");
          return;
        }
      } else {
        herunterladen();
        const ziel = `mailto:${encodeURIComponent(e2.an || "")}?subject=${encodeURIComponent(e2.betreff || o.titel)}&body=${encodeURIComponent(e2.text || "")}`;
        window.location.href = ziel;
        melde("Die Datei wurde heruntergeladen. Bitte im E-Mail-Programm als Anhang hinzufügen.", "info");
      }
      try { await abschliessen(); } catch { /* gemeldet */ }
    }
  }, { signal: aufraeumen.signal });

  dlg.querySelector('[data-v="ziehen"]').addEventListener("dragstart", (e) => {
    const absolut = new URL(url, location.href).href;
    e.dataTransfer.setData("DownloadURL", `${DOCX_TYP}:${o.dateiname}:${absolut}`);
    e.dataTransfer.effectAllowed = "copy";
    abschliessen().catch(() => {});
  });

  // Vorschau rendern
  iframe.srcdoc = `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>${RAHMEN_CSS}</style></head><body></body></html>`;
  iframe.addEventListener("load", async () => {
    const idoc = iframe.contentDocument;
    try {
      await window.docx.renderAsync(blob, idoc.body, idoc.head, {
        className: "docx",
        inWrapper: true,
        breakPages: true,
        ignoreLastRenderedPageBreak: true,
        renderHeaders: true,
        renderFooters: true,
        useBase64URL: true,
      });
      // docx-preview leert den Style-Container: eigene Rahmen-Styles danach wieder anhängen
      const stil = idoc.createElement("style");
      stil.textContent = RAHMEN_CSS;
      idoc.head.append(stil);
      const passeAn = () => {
        const seite = idoc.querySelector("section.docx");
        if (!seite) return;
        // offsetWidth ist unabhängig vom Zoom und liefert die echte Seitenbreite
        const verfuegbar = iframe.clientWidth - 24;
        idoc.body.style.zoom = String(Math.min(1, verfuegbar / seite.offsetWidth));
      };
      passeAn();
      new ResizeObserver(passeAn).observe(iframe);
      ladeHinweis.remove();
    } catch (err) {
      ladeHinweis.textContent = "Die Vorschau konnte nicht erstellt werden: " + err.message + ". Das Herunterladen funktioniert trotzdem.";
    }
  }, { once: true });

  dlg.showModal();
  return new Promise((fertig) => {
    dlg.addEventListener("close", () => {
      aufraeumen.abort();
      dlg.classList.remove("dialog--vorschau");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      dlg.innerHTML = "";
      fertig(aktion);
    }, { once: true });
  });
}
