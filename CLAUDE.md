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
  vorgaenge, vorlagen, nachrichten, antworten, wissen, postfach, aufgaben, dienstleister, dokumente, kontakte, verlauf,
  themen (E-Mail-Vorgänge: nachrichten/antworten.thema_id, Status offen|erledigt, Abschluss-PDF in dokument_id),
  dokument_ordner (bearbeitbare Ordnerliste, Unterordner mit „/“, „Sonstiges“ fest; KI liest sie über `dokumentOrdner()`;
  Spalte `bereich` 'haus' | 'allgemein', siehe „Ordner unter Allgemein“ unten),
  zahlungen + mieteingang_status (siehe „Mieteingänge“ unten);
  View mieter_uebersicht (security_invoker); Buckets `vorlagen`, `schreiben`, `eingang`, `dokumente` (privat).
- Edge Functions `ki`, `posteingang`, `versand`, `miete` (Quellen in `supabase/functions/`, gemeinsamer Code in
  `_shared/` (gemeinsam, fach, mieterhoehung, chat, notiz, miete), deployt mit verify_jwt=false; Prüfung im Code: Mitglied bzw.
  Postfach-Token). Beim Deploy über MCP alle importierten `_shared`-Dateien mitschicken (ki: alle fünf = 6 Dateien mit index,
  posteingang: gemeinsam + fach + mieterhoehung, versand: gemeinsam, miete: gemeinsam + miete = 3 Dateien).
  Neue KI-Bereiche lieber als eigene kleine Function (wie `miete`) statt `ki` zu vergrößern – der Deploy bleibt klein und prüfbar.
  service_role hat nur die Rechte aus `20261015010200_rechte_server.sql` (Projekt vergibt keine automatischen Grants).
  Nach jedem Deploy prüfen: `get_edge_function` holen und jede Datei mit dem Repo vergleichen (nie Platzhalter mitschicken).
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
  `dokumente.details` = `detailsVorschlag()` aus KI-Teilen { thema, betrag, wohnung_id } + Mietpartei (Thema_Wohnung_Name_Betrag).
  Echte Namen/Wohnungen aus Roberts Vorlage NICHT ins Testsystem (erst nach dem Umzug).
- Dateiname sichtbar: `nameVorschlag(eintrag)` liefert { titel, ordner, … }; `ablageBlockHtml()` + `verbindeAblageBlock()`
  (Feld `ablage_titel`, Häkchen `ablage_an`) bzw. `frageMitAblage()` für Bestätigungsdialoge → `{ vorgabe }` an
  `automatischAblegen(e, { vorgabe })`. Brief-Vorschau: Option `name: { vorschlag }` in `js/vorschau.js`,
  `vorAbschluss({ titel })` übernimmt den Namen (Feld danach gesperrt). Jede neue Stelle, die eine Datei erzeugt,
  muss den Namen so vorher zeigen.
- Upload: `erfasseAlle(dateien, opt)` → je Datei `erfasse()` (Rückgabe { ziel, abgelegt } bzw. { abbruch }).
  KI-Aktion `brief_lesen` nimmt `bild` (Foto/PDF) oder `datei_text: { text, art: "word"|"excel" }` plus `dateiname`;
  Text aus Office-Dateien liest `js/officetext.js` im Browser, `liesDokument()` entfernt IBANs vor der KI.
- Objekte: `js/objekte.js` (Routen `#/objekte`, `#/ablage/<id|allgemein>`), `ordnerBaum()` aus Ordnerliste + Dokumenten,
  offene Ordner in `zustand.ordnerOffen`, neue Datei über `zustand.zuletztAbgelegt` markiert.
  Ablagefläche: `ablegeflaecheHtml()` + `verbindeAblegeflaeche(el, { objektId, nurAblage, ablageZiel })` in `js/ablage.js`;
  ein Dokument-weiter Drop-Handler leitet auf die Fläche der Seite um (ohne Fläche: Hinweis).
  Menü: 6 Punkte; unter 520 px wird „Einstellungen“ zum Zahnrad (`.nav-lang`/`.nav-kurz`).
- Ordner-Editor `ordnerBearbeiten()`: Modell mit `eltern`-Verweis (voller Name = Eltern + "/" + teil), neu zeichnen nur bei
  Struktur-Änderungen (beim Umbenennen nicht, sonst geht der nächste Klick verloren). Löschen kaskadiert auf Unterordner.
  `wieWohnung()` erkennt von Hand angelegte Wohnungsordner. Fehler stehen im Dialog (`[data-fehler]`), nicht als Meldung.
- Kontakte: `js/kontakte.js` (Routen `#/kontakte`, `#/kontakt/<id>`, `#/handwerker`; Reiter via `reiterHtml()`, Menüpunkt
  „Kontakte“ = data-nav "mieter"). Tabellen `kontakte` (Geburtstag als Tag/Monat/Jahr?, `geburtstag_erledigt` = Jahr),
  `verlauf` (kontakt_id ODER mieter_id), `aufgaben.kontakt_id`, `dokumente.verlauf_id`. KI-Aktion `notiz_lesen`
  (`_shared/notiz.ts`) liefert nur Vorschläge, IDs werden gegen die Listen geprüft. Geburtstage: `geburtstagTodos()`
  in sammle() (start.js). Testdaten: `supabase/seed_kontakte.sql` (erfunden, mehrfach ausführbar).
- Empfänger-Suche: `suchauswahlHtml()` + `verbindeSuchauswahl(box, eintraege, waehle)` in `js/ui.js` (Combobox, Gruppen).
  `zeigeNeuesSchreiben(ziel)`: Mieter-ID | `d-` Handwerker | `k-` Kontakt | `t-<kt>[.<mieter>]` Kostenträger; `baueEntwurf` kennt
  `k.kontakt` / `k.kostentraeger` (Spalten `antworten.kontakt_id/kostentraeger_id`, KI `entwurf` mit `kontakt_id/kostentraeger_id`).
  Empfänger wechseln (`wechsle()`): `el.mitnehmen()` von baueEntwurf → `zustand.vorbelegung.uebernahme`; Anweisung, Betreff/Text
  und ein gespeicherter Entwurf (`k.uebernahme.antwort`) ziehen um, der Entwurf wird auf den neuen Empfänger umgeschrieben (kein zweiter).
  Chat-Aktion `entwurf` kennt auch `dienstleister_id`, `kostentraeger_id`, `objekt_id` (→ `zustand.hausVorgabe`).
- Chat-Vorschläge (`js/chat.js`): Karte je Aktion mit Status (`a.status` gespeichert/abgelehnt), Knöpfe `data-vorschlag="i:j:op"`
  (annehmen/aendern/ablehnen/oeffnen/ansehen/laden/ablage). PDF-Aktion `pdf` { titel, einleitung, abschnitte, objekt_id, mieter_id }
  → `ablage.pdfEintrag` (Name im Feld `data-pdfname`, Ablage über `inAblageDialog` mit `e.thema` = Titel).
  Neue Kontakte/Handwerker: Aktionen `kontakt` / `handwerker` (geprüft in `pruefeAktion`, IBAN entfernt), Karte mit Annehmen
  (vorher `keinDoppelter()`), Ändern (`kontaktDialog` / `bearbeiteDienstleister` vorbelegt), danach Link „Öffnen“ (`a.href`).
  „Per E-Mail“ (`pdfPerMail`): Suchfeld übernimmt die E-Mail, speichert eine Antwort + Vorgang, `versand` mit `anhang` (base64).
- Upload/Ablage: Haus folgt der gewählten Mietpartei, Warnung in `[data-mieter-hinweis]` bei Widerspruch;
  `detailsVorschlag`/`zielOrdner` nehmen eine KI-Wohnung nur, wenn sie zum Haus passt.
- Übersicht-Filter (`zeigeStart`): Alle | Eilig | Wiedervorlagen (auch spätere) | Erledigt, gemerkt in `zustand.startFilter`, Liste in
  `#todo-inhalt`. Erledigt = `sammleErledigt()` (erledigte Aufgaben mit „Wieder öffnen“ `data-wieder`, beantwortete/erledigte Nachrichten,
  Gratulationen dieses Jahr). Links in der Kachel oben (`.lage__link[data-filter]`).
- Brotkrumen: `brotkrumen([...KRUMEN.mieter, { text }])` aus `js/helfer.js` statt Zurück-Links, nur auf Unterseiten, nach Struktur
  (Vorgang/Schreiben hängen am Empfänger), am Handy nur „‹ Eltern“. Das Menü folgt dem ersten Glied (`route()` in app.js).
- Stammdaten-Maske: `js/stammdaten.js` (Route `#/stammdaten`, Links in Einstellungen und Mieterliste). Löschen nur,
  wenn leer (Haus ohne Wohnungen, Wohnung ohne Mietpartei); Haus löschen kaskadiert auf Wissen/Handwerker des Hauses.
- Vorgänge (`js/vorgaenge.js`, Route `#/thema/<id>`, Migration `20261020210000_themen_verlauf.sql`): Posteingang ordnet über
  In-Reply-To/References, sonst gleichen Betreff (`betreff_norm`, gleiche Regel in SQL, fach.ts und App) + Mietpartei/Adresse
  (offen, 120 Tage) zu, sonst neu (`themaFuerEingang`). Eigene Schreiben: `themaFuerNachricht`/`neuesThema` in baueEntwurf.
  „Erledigt“ → `abschliessen()`: PDF des Verlaufs (Art „Schriftverkehr“, optional KI-Zusammenfassung `thema_zusammenfassen`),
  Name sichtbar über `ablageBlockHtml({ immer: true })`. Akte und Kontaktseite zeigen „Schriftverkehr“ (`ladeListe`).
- ZIP-Import (`js/zipimport.js`): `planeZip()` erkennt Häuser in der obersten Ebene oder ein Haus für alles, bildet Ordner per
  `norm()` auf `dokument_ordner` ab, legt fehlende an, Namen bleiben 1:1. Danach optional „Für die KI erschließen“
  (`erschliessen()`, KI-Aktion `datei_erschliessen`, schreibt nur `dokumente.zusammenfassung`). Kein Import von zipimport.js
  in Modulen auf oberster Ebene benutzen (Kreis ablage↔zipimport), Konstanten lokal halten.
- Suchfelder: `suchauswahlHtml({ inline })` + `verbindeSuchauswahl()` gibt `{ setze }` zurück und füllt ein verstecktes Feld
  (`name`) mit change-Ereignis. Genutzt für Empfänger, Notiz „Betrifft“ (m:/d:/k:, `aufgaben.dienstleister_id`),
  Auftrag „Wer soll kommen?“, Mietpartei einer Nachricht, „Gehört zu“ beim Einsprechen.
- Assistent beim Einsprechen: `notiz_lesen` liefert zusätzlich `schreiben` [{ an, id, mieter_id, kanal, anweisung }]
  (höchstens 3, IDs geprüft); `notizPruefen` zeigt sie als änderbare Zeilen, `bereiteSchreibenVor()` erzeugt die Entwürfe
  und öffnet den ersten (`zustand.briefWunsch`, `zustand.entwurfHinweise`). Nie automatisch senden.
- Ganzes Haus / Rundschreiben / Absender (Migration `20261022090000_rundschreiben_absender.sql`): `nachrichten.objekt_id` (Betrifft
  ganzes Haus, `betrifftOptionen()`/`betrifftAus()` in `js/ui.js`, Werte `h:<id>`; `ordneEin` überschreibt das nicht).
  Rundschreiben = `antworten.objekt_id` ohne mieter_id, Route `#/schreiben/h-<objekt>`, Häkchen `[data-rund]`; `rundSenden()` legt je
  Mietpartei mit E-Mail eine Kopie (mieter_id+objekt_id, ohne thema) an und sendet sie einzeln, Rest als Aushang/Brief.
  KI `entwurf` mit `rundschreiben: true` (keine Mieterdaten). Weitere Absender in `vermieter_profil.absender` [{ id, bezeichnung,
  name, strasse, plz, ort, telefon, email, signatur }], Kopie am Schreiben in `antworten.absender`; Briefe über `profilFuer()`
  (js/dokumente.js, Vorlagenfelder `v_untertitel`/`v_fusszeile`/`v_gruss_firma`), Versand über `absenderProfil()`/`absenderZeile()`
  (Name im From, Adresse bleibt VERSAND_ABSENDER, reply_to = E-Mail des Absenders), KI `absender` → Ich-Form ohne Firma.
- Unterschrift (Migration `20261022110000_unterschrift.sql`): `vermieter_profil.unterschrift` { pfad, breite, hoehe, stand }, Bild als PNG im
  Bucket `vorlagen` unter `unterschrift/<uuid>.png`. `js/unterschrift.js`: `bereiteBildAuf()` (Hintergrund weg, Zuschnitt, max. 900 px),
  Einstellungs-Bereich, `sollUnterschreiben()` (Vorschlag), `vorschauOption(an, erzeuge)` → Option `unterschrift` von `zeigeDokument`
  (Häkchen, rendert neu, nach dem Speichern gesperrt). `fuelleVorlage(buf, daten, { unterschrift: { png } })` ersetzt `{v_unterschrift}`
  (Marke `[[UNTERSCHRIFT]]` aus briefDaten) durch ein Inline-Bild (5 cm, max. 1,8 cm hoch), sonst Rückfall unter „Grüßen“; ohne Bild
  wird die Marke entfernt. Nie in E-Mails. Echte Unterschrift NICHT ins Testsystem legen (lädt Robert selbst hoch).
- „An alle im Haus“ in `baueEntwurf`: Knopf `[data-anhaus]` am Feld An (`anHausMoeglich`: nicht bei Haus/Auftrag) und Hinweis
  `[data-teil=rundtipp]` bei Rundschreiben-Anrede (`RUND_ANREDE`, `pruefeRundtipp()` bei Eingabe und in `zeigeEditor`, „Nein“ merkt sich
  `rundtippWeg`). `zumHaus()` → `hausFuerRund()` (Mietpartei/Nachricht/gewähltes Haus, sonst Dialog) → `zustand.vorbelegung.uebernahme`
  mit `rund: true` → `#/schreiben/h-<id>`; Antworten auf Nachrichten nehmen den Text mit, der Vorgang bleibt (`themaVorgabe`).
- Übersicht: `sammle()` liefert zusätzlich `rueck` (Rückstände nur im Filter `rueckstand`) und je Eintrag `ort` (`ortVon()` mit Map `orte`
  aus mieter_uebersicht); Aufgaben ohne jede Zuordnung mit Datum heißen „To-do“ (zählen bei Wiedervorlagen mit). Notiz-Dialog: Häkchen
  `nur_todo` blendet `[data-zuordnung]` (auch „Mit KI prüfen“) aus. `rundSenden()` schickt eine Kopie an die eigene Adresse
  (eigene antworten-Zeile mit objekt_id, ohne mieter_id, empfaenger_name „Kopie an die eigene Adresse“).
- „Ja und Ja“ (Migration `20261025090000_ki_schritte.sql`): `nachrichten.ki_schritte` { status laeuft|fertig|keine|verworfen|fehler, am,
  antwort_id, auftrag_id, dienstleister, hinweise }. KI-Aktion `schritte` → `bereiteSchritteVor()` in fach.ts (nur Reparatur/Mangel, nur ohne
  vorhandene Antworten; `passenderHandwerker()` nach Gewerk-Regeln; entwirf + auftrag parallel; legt beide antworten-Zeilen im Vorgang an).
  Läuft mit dem Login des Nutzers: `postfach.bereiteImHintergrundVor()` aus Übersicht/Postfach (max. 3) und `verbindeSchritte()` beim Öffnen.
  Kasten `#schritte` (`schritteHtml`): „Ja“ klickt den Senden-Knopf des jeweiligen Entwurfs (normaler Bestätigungsdialog). Nie Autoversand.
- Chat-Links: `formatiere()` erlaubt auch `#/thema/` und `#/entwurf/`; im Browser `target=_blank` (Chat bleibt offen), als installierte App
  im selben Fenster. chat.ts liefert `vorgaenge` (`themaKurz`) bei suche/mieter_info/objekt_info/offene_vorgaenge, notiz.ts bei kontakt_info.
- Ablegen: der Dokument-weite Drop-Handler (ablage.js) nimmt ohne Ablagefläche alles an (`verteile(dateien, {})`, KI entscheidet),
  Overlay über `body.datei-ueber`.
- Design B (Tintenblau-Seitenleiste, Suchleiste oben, Manrope): `<html class="design-b">` in index.html, Regeln nur in
  `css/design-b.css` (alle mit `.design-b` davor). Elemente nur für B haben `nur-design-b` (sonst versteckt), dazu `.nav-icon`,
  `#oberleiste` (fragt den Chat über `oeffneChat(frage)`), Route `#/rueckstaende` (Filter), `vorbereitetHtml()` in start.js
  („Die KI hat vorbereitet“, prüft die Klasse). Zurück zum alten Design: Klasse in index.html entfernen (oder Commit zurücknehmen).
- Ordner unter Allgemein (Migration `20261025120000_ordner_allgemein.sql`): `dokument_ordner.bereich` 'haus' (in jedem Haus gleich) |
  'allgemein' (frei angelegt, ohne Vorgabe, ohne Automatik; unique(bereich, name)). App: `ordnerListe(neu, bereich)`, `ordnerFuer(objektId)`,
  `passenderOrdner(name, objektId)`, Auswahl im Dialog folgt dem Haus (`verbindeOrdnerWahl`, merkt den KI-Wunsch in `data-wunsch`);
  `ordnerBearbeiten({ bereich })`, `verschiebeDokumente(…, { allgemein })` trifft nur den eigenen Bereich; `zielOrdner(…, { objektId: null })`
  ohne Automatik. Server: `dokumentOrdnerInfo(zugriff, "haus"|"allgemein"|"beide")` (ablage_vorschlag ohne objekt_id → allgemein,
  brief_lesen → beide). ZIP-Import legt fehlende Ordner im passenden Bereich an (`plan.neueOrdnerFuer()`).
- Notiz → Vorgang (Migration `20261025140000_aufgabe_vorgang.sql`, `aufgaben.thema_id`): Knopf „Anschreiben“ im Notiz-Dialog
  (`aufgabeDialog`, value `schreiben`) speichert und ruft `anschreiben(a)` in start.js: Empfänger = Mietpartei | `d-` Handwerker | `k-` Kontakt,
  ohne Zuordnung Nachname im Titel, sonst `#/schreiben` (Empfänger wählen). `zustand.vorbelegung = { anweisung, aufgabeId }`; baueEntwurf
  (`k.aufgabeId`) setzt beim Anlegen des Vorgangs `aufgaben.thema_id`; vorhandener Vorgang → `zustand.themaVorgabe` („Weiter anschreiben“).
  Vorgangsseite zeigt „Gestartet aus der Notiz …“ (`.notiz-vorgang`, start.js per dynamischem Import). Nie automatisch senden.
- Diktat (`js/ui.js`): auf iPhone/iPad (`IOS`) kein Dauer-Modus, sondern kurze Runden mit Neustart bis zum Stopp-Klick (je Runde neues
  Objekt, Wächter 8 s gegen stilles Hängen, Ende nach 45 s ohne Wörter), Text jeder Runde wird in `onend` übernommen (iOS liefert „final“
  nicht zuverlässig), kein `focus()`. Fehler „service-not-allowed“ → Hinweis auf Einstellungen › Allgemein › Tastatur › Diktierfunktion.
  Test mit nachgebauter Erkennung: `ui_diktat.py`.
- Stammdaten per Chat (Migration `20261025160000_weitere_bewohner.sql`, `mieter.weitere_bewohner` Text, eine Person je Zeile): KI-Aktion
  `stammdaten` { ziel mieter|kontakt|handwerker, id, felder, bewohner_neu } – erlaubte Felder in `STAMM_FELDER` (chat.ts; nie Miete, Wohnung,
  Vertrag, Kostenträger, Aktenzeichen, Bank), `pruefeAktion` prüft Format, `ergaenzeStammdaten()` lädt die Person (muss es geben) und hängt
  `vorher`, `name`, `link` an. App (`js/chat.js`): Karte Alt → Neu, „Übernehmen“ speichert sofort + Verlaufseintrag, danach „Rückgängig“
  (alte Werte, Verlaufseintrag weg); „Ändern“ = `stammdatenDialog()`. Akte zeigt „Mit im Haushalt“, Stammdaten-Formular hat das Feld.
- Doppelte Kontakte: Chat-Aktion `kontakt`/`handwerker` prüft im Server `vorhandenePerson()` (chat.ts, E-Mail/Name/Firma) und verlangt dann
  `stammdaten` statt Neuanlage. In der App fragt `doppeltFragen(a)` (js/chat.js, über `vorhandener(a)`) vor dem Anlegen: „Vorhandenen ergänzen“
  (nur neue/abweichende Felder aus `ERGAENZ_FELDER`, Karte wird zur Stammdaten-Karte mit Rückgängig) | „Trotzdem neu anlegen“ | Abbrechen.
- Anhänge an Schreiben: `antworten.anhaenge` [{ bucket, pfad, name, groesse?, dokument_id? }] gilt für alle Schreiben (nicht nur Aufträge), `versand` schickt sie
  (max. 8, zusammen 20 MB). Editor (`baueEntwurf`): Block `[data-teil=anhaenge]` mit „Aus der Ablage anhängen“ (`ablage.dokumentWaehlen()`) und
  „Vom Gerät anhängen“ (erst `ablage.erfasse(…, { nurAblage, weiter: false })` → Rückgabe `dokument`, dann `ablage.anhangVonDokument()`); Anhänge
  ziehen beim Empfängerwechsel mit (`mitnehmen().anhaenge` → `uebernahme.anhaenge`), Rundschreiben-Kopien bekommen sie auch. Nicht beim Brief.
  Chat-Aktion `entwurf` kennt `anhaenge` (Dokument-IDs, Server prüft und hängt { id, titel } an, `ergaenzeEntwurf()`) → App lädt sie über
  `db.ladeDokumenteIds()` in `zustand.anhangVorgabe` (verbraucht der nächste Nicht-Auftrag-Editor). `empfaenger_neu` 'kontakt'|'handwerker':
  Schreiben an die Person, die in derselben Antwort angelegt wird; Karte wartet, bis die Kontakt-Karte `zielId` hat (`neuerEmpfaenger()`, auch nach
  „Vorhandenen ergänzen“ über `urArt`). `bearbeiteDienstleister` ruft `nachher(gespeichert)`.
- Nächster Schritt im Vorgang (`js/schritte.js`, `naechsterSchritt(themaId, { gesendet })`): Dialog mit KI-Vorschlägen (KI-Aktion `naechste_schritte`
  { thema_id, wunsch? } → `naechsteSchritte()` in `_shared/notiz.ts`: Verlauf + Mietpartei (Ort, Telefon, nie Miete/Bank) + Handwerker des Hauses +
  Kontakte + Kostenträger, IDs geprüft, max. 3; art schreiben → `zustand.vorbelegung` + `themaVorgabe` + `#/schreiben/<ziel>`, art wiedervorlage →
  `aufgabeDialog({ …, thema_id })`). Freies Wunschfeld (Enter fragt die KI, Dialog bleibt offen). Aufgerufen nach dem Senden (`nachSenden()` in
  baueEntwurf, nicht bei Rundschreiben, nicht wenn schon ein Dialog offen ist), Knopf `[data-k=schritt]` im Editor und `#thema-schritt` auf der
  Vorgangsseite. Hausmeister = Handwerker mit Gewerk „Hausmeister“ je Haus (Testdaten: `supabase/seed_hausmeister.sql`).
- Notiz mit Dateien: Feld `dateien` im Notiz-Dialog; nach dem Speichern je Datei `ablage.erfasse(…, { nurAblage, weiter: false })` (Name sichtbar),
  dann `dokumente.aufgabe_id` setzen (`dateienAnNotiz`). „Anschreiben“ fragt vorher `anhaengeAusNotiz()` (Häkchen je Datei → `zustand.anhangVorgabe`).
  Neue Notizen aus einem Vorgang speichern `thema_id`; die Vorgangsseite zeigt „Notiz(en) zu diesem Vorgang“ mit ihren Dateien.
- Mieteingänge (Menüpunkt statt „Rückstände“, Route `#/mieteingaenge`, alter Link `#/rueckstaende` führt dorthin; Migration
  `20261027120000_mieteingaenge.sql`): Soll = Forderungen (kaltmiete/nebenkosten/strom/internet), Ist = `zahlungen` Art „miete“
  (verteilt in dieser Reihenfolge); ohne Zahlungen gilt `forderungen.bezahlt`. `abgleichen()`/`abgleichenViele()` setzen den Haken
  „bezahlt“ aus den Zahlungen (für Mietbuch/Akte). `mieteingang_status` je Mietpartei+Monat: geprueft (Zahlung da und passt) |
  rueckstand | kontaktiert, dazu `ki_vorschlag`. `sollstellung_ergaenzen()` (SQL) legt fehlende Monatsposten an (einmal am Tag).
  Seite `js/mieteingaenge.js` (Kacheln, Jahresverlauf, Reiter je Haus, Zeile mit Kalt/NK/Historie/Aktion, Monatsdialog).
  Import `js/zahlungsimport.js` (Oberfläche) + `js/zahlungslogik.js` (ohne DOM, in Node testbar): Kontoauszug-CSV (UTF-8 oder
  Windows-1252, IBAN-Spalten nie gelesen, IBANs aus Texten entfernt, Ausgänge übersprungen, ab dem 25. → Folgemonat außer der
  Text nennt den Monat, Mehrbetrag wird abgespalten, Schlüssel `bank:…` erkennt doppelte Importe) und immocloud-Mietübersicht
  (Excel über `excelZellen()` in officetext.js; Haus über die Straße, Wohnung über die Nummer, Jahr aus dem Dateinamen; Schlüssel
  `excel:<mieter>:<monat>`, erneuter Import überschreibt; Kontoauszug/Hand gehen vor, ersetzen Excel-Beträge). Immer Vorschau,
  gespeichert wird erst nach „Übernehmen“; Kontoauszug-Import mit „Rückgängig“. KI (Function `miete`) nur auf Klick:
  `mieteingang_vorschlaege` (nur Zahlen, keine Namen) und `buchungen_zuordnen` (nur unklare Eingänge, ohne IBAN).
  Test-Dateien sind erfunden (Scratchpad), Roberts echte Exporte NICHT ins Repo/Testsystem.
