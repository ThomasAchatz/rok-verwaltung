// Heller/dunkler Modus: wird vor dem Zeichnen der Seite gesetzt (kein Aufblitzen).
// Gemerkt im Browser; ohne eigene Wahl gilt die Einstellung des Geräts.
(function () {
  var SCHLUESSEL = "rok-thema";
  var root = document.documentElement;
  function gemerkt() { try { return localStorage.getItem(SCHLUESSEL); } catch (e) { return null; } }
  function geraet() { return window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dunkel" : "hell"; }
  function setze(thema) {
    root.dataset.thema = thema;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", thema === "dunkel" ? "#0d1726" : "#1f3a5f");
    var knopf = document.querySelector("[data-aktion=thema]");
    if (knopf) {
      knopf.setAttribute("aria-pressed", String(thema === "dunkel"));
      knopf.title = thema === "dunkel" ? "Heller Modus" : "Dunkler Modus";
    }
  }
  setze(gemerkt() || geraet());
  // Gerät wechselt (z. B. abends automatisch): folgen, solange nichts von Hand gewählt ist
  if (window.matchMedia) {
    var mq = matchMedia("(prefers-color-scheme: dark)");
    var folge = function () { if (!gemerkt()) setze(geraet()); };
    if (mq.addEventListener) mq.addEventListener("change", folge);
  }
  // Drucken immer hell
  var vorher = null;
  window.addEventListener("beforeprint", function () { vorher = root.dataset.thema; setze("hell"); });
  window.addEventListener("afterprint", function () { if (vorher) setze(vorher); vorher = null; });
  document.addEventListener("click", function (e) {
    var k = e.target.closest && e.target.closest("[data-aktion=thema]");
    if (!k) return;
    var neu = root.dataset.thema === "dunkel" ? "hell" : "dunkel";
    try { localStorage.setItem(SCHLUESSEL, neu); } catch (err) { /* privat: nur für diese Sitzung */ }
    setze(neu);
  });
  document.addEventListener("DOMContentLoaded", function () { setze(root.dataset.thema); });
})();
