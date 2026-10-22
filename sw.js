// Service Worker der ROK Verwaltung
// - Speichert nur die App-Hülle (HTML, CSS, JS, Symbole, Standardvorlagen) zwischen.
// - Mieterdaten, Logins und archivierte Schreiben (Supabase) werden NIE zwischengespeichert:
//   fremde Adressen laufen direkt ins Netz.
// - „Netz zuerst“: Online gibt es immer die neueste Version, offline startet wenigstens die Hülle.
// Bei jeder Änderung an der App VERSION hochzählen.
const VERSION = "rok-v30";
const HUELLE = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/app.css",
  "js/ablage.js",
  "js/app.js",
  "js/bausteine.js",
  "js/chat.js",
  "js/config.js",
  "js/daten.js",
  "js/dokumente.js",
  "js/helfer.js",
  "js/kontakte.js",
  "js/vorgaenge.js",
  "js/zipimport.js",
  "js/objekte.js",
  "js/officetext.js",
  "js/pdf.js",
  "js/postfach.js",
  "js/stammdaten.js",
  "js/start.js",
  "js/ui.js",
  "js/vorschau.js",
  "js/unterschrift.js",
  "vendor/docx-vendor.min.js",
  "vendor/jszip.min.js",
  "vendor/docx-preview.min.js",
  "vorlagen/mahnung_1.docx",
  "vorlagen/mahnung_2.docx",
  "vorlagen/nachweis_jobcenter.docx",
  "vorlagen/antwort.docx",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
  "icons/favicon-32.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(HUELLE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((namen) => Promise.all(namen.filter((n) => n !== VERSION).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const anfrage = e.request;
  if (anfrage.method !== "GET") return;
  const url = new URL(anfrage.url);
  if (url.origin !== self.location.origin) return; // Supabase, CDN, Schriften: direkt ins Netz

  // Immer beim Server nachfragen (nicht den 10-Minuten-Cache von GitHub Pages nehmen), offline aus dem Speicher
  e.respondWith(
    fetch(anfrage, { cache: "no-cache" })
      .then((antwort) => {
        if (antwort.ok) {
          const kopie = antwort.clone();
          caches.open(VERSION).then((c) => c.put(anfrage, kopie));
        }
        return antwort;
      })
      .catch(async () => {
        const treffer = await caches.match(anfrage, { ignoreSearch: true });
        if (treffer) return treffer;
        if (anfrage.mode === "navigate") return caches.match("index.html");
        return Response.error();
      })
  );
});
