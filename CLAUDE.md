# Hinweise für Claude

Projekt: Verwaltungs-Dashboard für ROK Immobilien (Vermieter mit mehreren Mehrfamilienhäusern,
teils Mieter mit Jobcenter/Sozialamt als Kostenträger). Ansprechpartner: Tommy (baut), Robert (nutzt).
Sprache im Code, in der Oberfläche und in Commits: Deutsch.

## Regeln

- **Nur erfundene Daten** im Repo und in der Test-Datenbank. Keine echten Namen, IBANs, Aktenzeichen.
- **Keine Geheimnisse committen** (Secret Key, DB-Passwort, KI-Schlüssel). Der Publishable Key in
  `js/config.js` ist öffentlich und darf drin stehen.
- Schemaänderungen immer als neue Datei in `supabase/migrations/` (Zeitstempel-Präfix) UND in der
  Datenbank anwenden. Jede neue Tabelle: RLS an, Policy mit `privat.ist_mitglied()`, Rechte nur für
  `authenticated` (das Projekt veröffentlicht neue Tabellen nicht automatisch).
- Kein Build-Schritt: reines HTML/CSS/ES-Module, läuft direkt auf GitHub Pages.
- `vendor/docx-vendor.min.js` ist ein gebündelter Build (pizzip 3.3.0, docxtemplater 3.70.1,
  @xmldom/xmldom 0.9.12, pako 2.1.0) und stellt `window.PizZip` / `window.Docxtemplater` bereit.
  Vorschau: `vendor/jszip.min.js` + `vendor/docx-preview.min.js` (window.docx), genutzt in `js/vorschau.js`.
- Briefe werden NIE automatisch heruntergeladen: erst Vorschau, Archivierung (Bucket `schreiben`,
  Vorgang mit details.datei_pfad) passiert bei der ersten Aktion (Herunterladen/Drucken/E-Mail/Ziehen).
- Keine Tabellen mit fester Breite: Listen müssen ab 360 px ohne seitliches Scrollen funktionieren.
- Platzhalter-Doku für Tommy: `PLATZHALTER.md` (nicht in der App anzeigen).
- Installierbare App (PWA): `manifest.webmanifest`, `sw.js`, Symbole in `icons/` (neu erzeugen mit
  `python3 tools/icons-erzeugen.py`). **Bei jeder Änderung an Dateien der App `VERSION` in `sw.js`
  hochzählen** und neue Dateien in die Liste `HUELLE` aufnehmen. Der Service Worker speichert nur
  eigene Dateien zwischen, nie Supabase-Antworten.
- **Content-Security-Policy** steht als Meta-Tag in `index.html`: neue externe Quellen (Skripte, Schriften,
  APIs) dort eintragen, sonst blockiert der Browser sie. Keine Inline-Handler (`onclick=`) verwenden.
- Neue Tabellen: nach dem Anlegen `revoke all … from anon` prüfen (Advisor + `information_schema.role_table_grants`).
- iOS: Statusleiste ist `black-translucent`; der Bereich `env(safe-area-inset-top)` wird über
  `body::before` dunkel gefärbt, Kopfzeile/Inhalt berücksichtigen alle Safe-Area-Ränder.
- Standardvorlagen werden mit `node tools/vorlagen-erzeugen.js` erzeugt; Platzhalter `{feld}`,
  Schleife `{#posten}…{/posten}`, Bedingung `{#feld}…{/feld}`. Datenobjekt: `briefDaten()` in `js/dokumente.js`.

## Supabase (Testprojekt)

- Projekt `rok-verwaltung`, Ref `hjrmwdcvsngovhtrkobc`, Region eu-central-1.
- Tabellen: mitglieder, vermieter_profil, objekte, wohnungen, kostentraeger, mieter, forderungen,
  vorgaenge, vorlagen, nachrichten, antworten, wissen, postfach, aufgaben, dienstleister, dokumente,
  dokument_ordner (bearbeitbare Ordnerliste, Unterordner mit „/“, „Sonstiges“ fest; KI liest sie über `dokumentOrdner()`);
  View mieter_uebersicht (security_invoker); Buckets `vorlagen`, `schreiben`, `eingang`, `dokumente` (privat).
- Edge Functions `ki`, `posteingang`, `versand` (Quellen in `supabase/functions/`, gemeinsamer Code in
  `_shared/` (gemeinsam, fach, mieterhoehung, chat), deployt mit verify_jwt=false; Prüfung im Code: Mitglied bzw.
  Postfach-Token). Beim Deploy über MCP alle importierten `_shared`-Dateien mitschicken (ki: alle vier,
  posteingang: gemeinsam + fach + mieterhoehung, versand: gemeinsam).
  service_role hat nur die Rechte aus `20261015010200_rechte_server.sql` (Projekt vergibt keine automatischen Grants).
- Secrets: ANTHROPIC_API_KEY, RESEND_API_KEY, VERSAND_ABSENDER, optional RESEND_WEBHOOK_SECRET, KI_MODELL.

## Stand / nächste Schritte

- Stufe 1 fertig (Übersicht, Mieterliste mit Mietbuch, Akte, 3 Briefvorlagen, Vorlagen-Upload, Briefkopf),
  dazu Vorschau-Ablauf und Archiv der Schreiben.
- Stufe 2 gebaut: Postfach (Resend-Webhook), KI-Einordnung, Entwürfe mit Diktat, Wissen, Versand per Klick,
  Brief fotografieren. Regeln: nur nötige Daten an die KI, nie IBAN; immer Entwurf, nie Autoversand.
- Stufe 3 gebaut (Roberts Feedback): To-do-Übersicht + Häuser (`js/start.js`), Ablage/Wissen/Handwerker
  (`js/ablage.js`), Chat (`js/chat.js`), Frist/Anhänge/Auftrag auf der Nachrichtenseite (`js/postfach.js`).
  Grundsätze: KI schlägt nur vor (Fristen mit Zitat bestätigen, Wiedervorlage-Datum erst nach „Speichern“,
  Chat-Aktionen öffnen vorbelegte Dialoge); Mieterhöhung rechnet `_shared/mieterhoehung.ts`, nicht die KI.
- Gemeinsame UI-Hilfen in `js/ui.js` und `js/bausteine.js`, Zustand in `js/helfer.js`.
  Dialoge (`dialogFormular`) lösen erst beim close-Ereignis auf, sonst schließt sich der nächste Dialog sofort.
  Der Chat ist ein eigenes `<dialog id="chat">`, damit Bestätigungsdialoge darüber gehen.
- Ablage: `ordnerBearbeiten()` und `zipExport()` in `js/ablage.js` (JSZip aus `vendor/jszip.min.js`);
  Downloads über `dateiAdresse(…, { download: "Name.ext" })`, damit nicht die UUID als Dateiname kommt.
- Ablage aus der App: `inAblageDialog()` / `automatischAblegen()` in `js/ablage.js` mit einem „Eintrag“
  (Builder `eintragNachricht`/`eintragAntwort` in `js/postfach.js`, `eintragNotiz` in `js/start.js`).
  Verknüpfung über `dokumente.nachricht_id/antwort_id/aufgabe_id/vorgang_id`. PDF aus Text: `js/pdf.js`
  (Helvetica/WinAnsi, keine Bibliothek). Bucket `dokumente` erlaubt Fotos, PDF, docx, xlsx.
- Roberts Struktur: `dokument_ordner.automatik` ('jahr' | 'wohnung') → `zielOrdner()` hängt den Unterordner an;
  Name über `dokumentTitel({ datum, objekt, art, details })` (JJMMTT_Kürzel_Straße_Art_Details), `objekte.kuerzel`,
  `dokumente.details`. Echte Namen/Wohnungen aus Roberts Vorlage NICHT ins Testsystem (erst nach dem Umzug).
