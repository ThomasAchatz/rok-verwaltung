# ROK Verwaltung

Verwaltungs-Dashboard für ROK Immobilien: offene Mieten im Blick behalten und Standardschreiben
(1. Mahnung, 2. Mahnung, Nachweis an Jobcenter/Sozialamt) per Klick erzeugen – mit den richtigen
Mieterdaten und dem richtigen Mietkonto (IBAN) je Mieter. Jedes Schreiben erscheint zuerst in einer
Vorschau; erst beim Herunterladen, Drucken/PDF oder Versenden wird es im Verlauf archiviert.

Dazu ein **Postfach mit KI**: Mieteranfragen kommen per E-Mail an (oder als fotografierter Brief /
Notiz zu einem Anruf), die KI ordnet sie ein und entwirft Antworten aus Akte und **Wissen**.
Robert kann auch einfach diktieren, was in ein Schreiben soll. **Die KI schreibt nur Entwürfe** –
verschickt wird ausschließlich per Klick (E-Mail oder als Brief über die Vorschau). Die Finanzen
bleiben in immocloud.

Seit Stufe 3 (Roberts Wünsche): **Übersicht als priorisierte To-do-Liste** (Fristen, Wiedervorlagen,
neue Nachrichten, fällige Mahnungen, Entwürfe), **Notizen mit Wiedervorlage** und KI-Prüfung
(z. B. Mieterhöhung nach festen Regeln), **Seite je Haus** mit Mietparteien, Dokumenten, Wissen und
Handwerkern, **Foto/PDF erfassen** mit Ablagevorschlag und Standardnamen, **Handwerker-Auftrag** mit Fotos,
**Wissen einsprechen** und ein **Chat „Fragen“**, der nur liest und Aktionen als Knopf vorschlägt.

> **Testversion:** In der Datenbank liegen ausschließlich erfundene Daten. Echte Mieterdaten
> erst nach dem Umzug auf Roberts eigenes Supabase-Konto (Pro-Plan, AVV, Region Frankfurt) eintragen.

## Aufbau

| Teil | Technik |
|---|---|
| Oberfläche | `index.html`, `css/app.css`, `js/*.js` – reines HTML/JS ohne Build-Schritt, läuft auf GitHub Pages |
| Datenbank, Login, Dateiablage | Supabase (Region eu-central-1 / Frankfurt) |
| Briefe | Word-Vorlagen in `vorlagen/` mit Platzhaltern, befüllt im Browser mit docxtemplater (`vendor/docx-vendor.min.js`) |
| KI | Supabase Edge Function `ki` → Claude API (Schlüssel nur als Supabase-Secret) |
| E-Mail rein / raus | Resend: Empfang per Webhook an `posteingang`, Versand über `versand` |

```
index.html            Einstieg
css/app.css           Gestaltung
js/config.js          Supabase-URL + Publishable Key (öffentlich, das ist so gedacht)
js/daten.js           alle Datenbankzugriffe
js/dokumente.js       Briefdaten zusammenstellen, Vorlagen befüllen
js/vorschau.js        Vorschau-Fenster (Drucken/PDF, E-Mail, Herunterladen, in E-Mail ziehen)
js/app.js             Router, Mieterliste, Akte, Vorlagen
js/start.js           Übersicht (To-do-Liste), Seite je Haus, Notizen/Wiedervorlagen
js/postfach.js        Postfach, Nachricht (Frist, Anhänge, Handwerker-Auftrag), Entwurf mit KI + Diktat, Einstellungen
js/ablage.js          Foto/PDF erfassen, Dokumente, Wissen (auch eingesprochen), Handwerker
js/chat.js            Chat „Fragen an die App“
js/vorgaenge.js       Vorgänge: E-Mail-Verlauf zu einer Sache, „Erledigt“ mit Abschluss-PDF
js/zipimport.js       ZIP mit fertiger Ordnerstruktur importieren, Dateien für die KI erschließen
js/kontakte.js        Kontakte (Mieter | Handwerker | Sonstige), Verlauf, Notiz einsprechen mit Assistent
js/bausteine.js       Mietbuch-Leiste, Zeilen, Schreiben-Kacheln
js/ui.js              Diktat, Wartehinweise, Auswahllisten, Bilder verkleinern, Drucken
js/helfer.js          gemeinsame Hilfen und Zustand
PLATZHALTER.md        alle Platzhalter für eigene Vorlagen
manifest.webmanifest, sw.js, icons/   installierbare App (PWA)
vorlagen/*.docx       Standard-Briefvorlagen
tools/vorlagen-erzeugen.js   erzeugt die Standardvorlagen neu (node, Paket "docx")
supabase/migrations/  Datenbankstruktur + Zugriffsschutz
supabase/seed.sql     erfundene Testdaten
supabase/seed_postfach.sql   erfundene Nachrichten, Wissen, Tonfall/Signatur
supabase/seed_etappen.sql    erfundene Handwerker, Notizen, Angaben zur Mieterhöhung
supabase/functions/   Edge Functions: ki, posteingang, versand
  _shared/gemeinsam.ts   REST, Speicher, Claude-Aufruf, Hilfen
  _shared/fach.ts        Einordnen (mit Frist), Entwürfe, Auftrag, Dokument lesen, Wissen ordnen, Notiz prüfen
  _shared/mieterhoehung.ts  feste Regeln § 558 BGB (Sperrfrist, Kappungsgrenze, Vergleichsmiete)
  _shared/chat.ts        Chat mit Lese-Werkzeugen und geprüften Vorschlägen
vendor/               gebündelte Bibliotheken (siehe vendor/LIZENZEN.md)
```

## Als App installieren

- **iPhone/iPad:** Seite in Safari öffnen → Teilen → „Zum Home-Bildschirm“.
- **Android:** Chrome-Menü → „App installieren“.
- **Windows/Mac:** In Chrome oder Edge das Installieren-Symbol rechts in der Adressleiste.

In der App gibt es dafür auch den Knopf „Installieren“ (auf dem iPhone mit Anleitung).

## Postfach und KI

```
E-Mail an …@….resend.app ──► Resend ──Webhook──► Edge Function posteingang ──► Tabelle nachrichten
                                                        └─► KI ordnet ein (Kategorie, Dringlichkeit, Mietpartei)
App: Nachricht öffnen ─► Anweisung tippen/diktieren ─► Edge Function ki ─► Claude ─► Entwurf (Tabelle antworten)
Entwurf prüfen ─► Klick „Per E-Mail senden“ ─► Edge Function versand ─► Resend   (oder „Als Brief“ ─► Vorschau)
```

- **Edge Functions** (`supabase/functions/`, deployt mit `verify_jwt = false`, die Prüfung passiert im Code):
  - `ki`: nur für freigeschaltete Mitglieder. Aktionen `status`, `einordnen` (inkl. Frist mit wörtlicher Textstelle),
    `entwurf`, `auftrag`, `brief_lesen` (Foto/PDF → Postfach oder Ablage), `wissen_ordnen`, `notiz_pruefen`, `chat`,
    `notiz_lesen`, `ablage_vorschlag`, `thema_zusammenfassen`, `datei_erschliessen`.
  - `posteingang`: Webhook für eingehende E-Mails, geschützt durch den Schlüssel `?token=…` aus der
    Tabelle `postfach` (in der App unter Einstellungen → Einrichtung) und optional die Resend-Signatur.
  - `versand`: nur für Mitglieder, nur per Klick. Ohne Resend-Schlüssel öffnet die App stattdessen das E-Mail-Programm.
    Aufträge an Handwerker gehen mit den gewählten Fotos aus dem Speicher raus.
    Jede E-Mail trägt unter der Signatur den Briefkopf (Firma, Anschrift, Kontakt aus den Einstellungen).
  - „Neues Schreiben“: ein Suchfeld **„An wen?“** über Mietparteien, Kontakte, Handwerker und Kostenträger
    (tippen, Pfeiltasten + Enter oder Klick). Route `#/schreiben/<ziel>`: Mieter-ID, `d-<id>` Handwerker,
    `k-<id>` Kontakt, `t-<id>[.<mieter-id>]` Kostenträger (optional zu einer Mietpartei, dann mit Aktenzeichen).
    Bei Handwerkern und Kontakten bekommt die KI keine Mieterdaten; bei Kontakten die letzten Gespräche aus dem Verlauf.
    Gespeichert in `antworten.dienstleister_id / kontakt_id / kostentraeger_id`. Was an einen Kontakt rausgeht,
    steht danach in seinem Verlauf.
- **Secrets** (Supabase → Edge Functions → Secrets, nie ins Repo):
  `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `VERSAND_ABSENDER` (z. B. `ROK Immobilien <verwaltung@rok-immobilien.com>`),
  optional `RESEND_WEBHOOK_SECRET` (`whsec_…`) und `KI_MODELL` (Standard `claude-sonnet-5-5`).
- **Was die KI bekommt:** Name, Wohnung, Mietbeginn, Miethöhe, Kostenträger, Summe offener Posten,
  letzte Schreiben/Nachrichten der Mietpartei, die Einträge unter **Wissen** und die Nachricht.
  **Nie** die IBAN/Bankdaten. Text aus eingehenden Nachrichten wird als Information behandelt, nicht als Anweisung.
- **Diktat** nutzt die Spracherkennung des Browsers (Chrome: Google-Server, iPhone/Safari: Apple).
  Alternative ohne Browser-Diktat: das Mikrofon der iPhone-Tastatur.
- Fotografierte Briefe und E-Mail-Anhänge liegen im privaten Bucket `eingang` (nur JPEG/PNG/WebP/PDF bis 10 MB,
  Inhalt wird geprüft, alles andere wird verworfen und nur namentlich angezeigt). Abgelegte Dokumente im privaten
  Bucket `dokumente` (`<haus|allgemein>/<uuid>.pdf|jpg`), Name nach Schema `JJJJ-MM-TT_Haus_Absender_Art`.
  Beim Herunterladen kommt die Datei unter diesem Namen statt der internen Kennung.
- **Ordner der Ablage** stehen in der Tabelle `dokument_ordner` und sind in den Einstellungen bzw. auf der
  Hausseite („Ordner bearbeiten“) änderbar: umbenennen, sortieren, löschen (Dokumente wandern nach „Sonstiges“),
  neu anlegen. Unterordner mit „/“, z. B. `Versorger/Strom`. Die KI wählt nur aus dieser Liste.
- **ZIP-Export** je Haus oder für alles (Einstellungen): echte Ordnerstruktur, saubere Dateinamen und
  `Inhaltsverzeichnis.csv`. Taugt auch als Sicherungskopie.
- **Ablegen aus der App:** „In Ablage speichern“ bei Nachrichten (auf Wunsch mit Anhängen), bei erledigten
  Antworten und bei Notizen. Mails und Notizen werden als PDF abgelegt (eigener kleiner PDF-Schreiber `js/pdf.js`),
  Briefe aus den Vorlagen als Word-Datei. Die KI schlägt nur den Ordner vor (`ki` → `ablage_vorschlag`,
  IBANs werden vorher entfernt); bei Briefen mit Bankverbindung sieht sie nur Titel und Empfänger.
- **Gesendetes automatisch ablegen** (E-Mail, Brief, Auftrag, Mahnung/Nachweis): Name nach Schema, Ordner von der KI,
  danach Meldung „Abgelegt in … – Ändern“. Schalter in den Einstellungen (`vermieter_profil.auto_ablage`).
- **Upload vom Gerät:** Fotos, PDF, Word (.docx) und Excel (.xlsx), auch mehrere auf einmal (je Datei ein Dialog,
  „Überspringen“ / „Alle abbrechen“). Die KI liest jede Datei und schlägt Haus, Mietpartei, Ordner, Art und den
  Dateinamen nach Roberts Schema vor. Word/Excel: Der Text wird im Browser ausgelesen (`js/officetext.js`, JSZip),
  der Server entfernt IBANs, erst dann geht er an die KI. Der Dateiname vom Gerät geht nur als Hinweis mit.
- **Ordnerstruktur nach Robert** (je Haus gleich): 01_Kalkulation & Ankauf … 09_Archiv mit festen Unterordnern.
  Automatische Unterordner (`dokument_ordner.automatik`): 04_Betriebskosten und 05_Instandhaltung **je Jahr**,
  03_Vermietung **je Wohnung** („Wohnung - Nachname“ aus den Mietparteien, nie von Hand angelegt).
- **Dateiname:** `JJMMTT_Kürzel_Straße Nr._Dokumentart_Thema_Wohnung_Betrag`, z. B.
  `261019_SR_Königsberger Str. 19_Rechnung_Wasserschaden_WHG 1_2430,31` oder `…_Mietvertrag_WHG 08_Meier`.
  Thema, Betrag und Wohnung schlägt die KI vor; die Mietpartei (Name) kommt bei Schriftverkehr dazu, nicht bei Rechnungen.
  Orts-Kürzel je Haus (`objekte.kuerzel`, Hausseite → Einstellungen zum Haus). Details schlägt die KI vor
  (Firma_Betrag, Vertragspartner …); bei einer Mietpartei setzt die App „Wohnung_Nachname“.
- **Kontakte (Mini-CRM):** Menüpunkt „Kontakte“ mit den Reitern Mieter | Handwerker | Sonstige
  (Makler, Bank, Behörden …). Je Kontakt und je Mietpartei ein **Verlauf** mit datierten Gesprächsnotizen.
  **„Notiz einsprechen“** (Übersicht, Kontaktliste, Kontaktseite, Mietakte): diktieren, die KI (`notiz_lesen`) erkennt
  Kontakt oder Mietpartei (oder schlägt einen neuen Kontakt vor), Notiz, Datum, Geburtstag, feste Infos und To-dos;
  Robert prüft im Dialog und speichert. Bei Mietparteien optional zusätzlich als PDF in die Ablage (Name sichtbar).
  **Geburtstage** stehen jedes Jahr ab 7 Tagen vorher in „Zu erledigen“ (abhaken = für dieses Jahr erledigt).
  Der Chat kennt Kontakte und Verlauf („Was weiß ich über …?“). Testdaten: `supabase/seed_kontakte.sql` (erfunden),
  ein Vorgang mit 6 E-Mails (Versicherung, Wasserschaden) zum Testen von „Erledigt“: `supabase/seed_vorgang.sql`.
- **Ordner bearbeiten** (gilt für alle Häuser): oben „Neuen Ordner anlegen“ mit Name und „Einsortieren in“
  (Oberste Ebene oder unter einem Ordner, wie im Mail-Programm), bei jedem Ordner „+ Unterordner“. Die Liste ist ein
  eingerückter Baum; Verschieben und Umbenennen nehmen Unterordner und Dokumente mit, Löschen ebenfalls (Dokumente
  kommen nach „Sonstiges“). Hinweise bei „je Wohnung“/„je Jahr“; von Hand angelegte Wohnungsordner werden erkannt
  und es wird davon abgeraten (die entstehen automatisch aus den Mietparteien).
- **Objekte (Menüpunkt):** alle Häuser als Karten, je Haus die Ordner der Ablage als aufklappbarer Baum
  (`#/ablage/<id>`, auch leere Ordner, automatische Unterordner je Jahr/Wohnung). Oben eine Ablagefläche:
  Dateien hineinziehen (am Handy: auswählen), die KI benennt sie nach dem Schema; danach klappt der Zielordner
  auf und die neue Datei ist markiert. Auf der Hausseite und den Objekt-Seiten nimmt die ganze Seite Dateien an.
- **Dateiname immer sichtbar:** Wo eine Datei entsteht (Senden-, Druck- und Mail-Bestätigung, Brief-Vorschau,
  Hochladen, „In Ablage speichern“), steht ein Feld „Dateiname“ mit dem KI-Vorschlag nach diesem Schema und
  dem Zielordner darunter. Der Name ist änderbar; beim Senden kann das Ablegen per Häkchen abgewählt werden.
  In der Brief-Vorschau gilt derselbe Name für Download, Archiv und Ablage.
- **Handwerker** bekommen nur Adresse, Wohnung, Name/Telefon der Mietpartei, Schadensbeschreibung und Fotos –
  keine Miete, keine Rückstände, keinen Kostenträger, keine Bankdaten.
- **Selbsthilfe-Tipps** in Entwürfen sind als „Unser Tipp (unverbindlich)“ markiert, nie bei Strom, Gas,
  Wasser von oben, Heizungsanlage, Dach oder Statik.
- **Mieterhöhung:** Die Zahlen (Sperrfrist, Kappungsgrenze 15/20 %, Vergleichsmiete × Fläche, Staffel/Index)
  rechnet der Code nach festen Regeln, die KI erklärt nur. Immer mit Hinweis „keine Rechtsberatung“.
- **Fristen** zeigt die App mit der Originalstelle aus der Nachricht; Robert bestätigt oder ändert sie.
- **Chat:** liest mit Roberts Login, sieht keine Bankdaten, Summen kommen aus der Datenbank. Er kann nichts
  ändern, senden oder löschen. Vorschläge erscheinen als kleine Karten: **Annehmen** (To-do/Wissen direkt speichern),
  **Ändern** (vorbelegter Dialog), **Ablehnen** („Doch anzeigen“ holt sie zurück). Schreiben öffnen „Neues Schreiben“
  mit der Anweisung (auch an Kontakte). **PDF aus dem Chat** (Liste/Übersicht): Dateiname sichtbar und änderbar,
  Ansehen, Herunterladen, **Per E-Mail** (Empfänger suchen, die hinterlegte Adresse wird übernommen, PDF als Anhang,
  optional zusätzlich in die Ablage) oder In Ablage (Ablage-Dialog mit Namen nach Schema). Andere Dateiformate folgen später.
- **Brotkrumen** auf allen Unterseiten (z. B. Kontakte › Mieter › Melanie Huber › Heizung im Bad), nach der Struktur der App,
  nicht nach dem Klickweg. Am Handy steht nur „‹ Eltern“ als Zurück-Link.
- **Übersicht filtern:** über „Zu erledigen“ Alle, Eilig, Wiedervorlagen (auch die späteren) und Erledigt. Unter Erledigt
  stehen abgehakte Notizen/Wiedervorlagen (mit „Wieder öffnen“), beantwortete Nachrichten und Gratulationen.
- **Kontakte per Chat anlegen:** „Leg Max Beispiel von der Beispielbank an, Tel. …“ – die KI prüft erst, ob es ihn schon gibt,
  und schlägt dann einen neuen Kontakt bzw. Handwerker als Karte vor (Annehmen, Ändern, Ablehnen). Bei Namensgleichheit fragt die App nach.
  Mietparteien legt man weiter selbst an (Wohnung, Miete, Mietbeginn).
- **Vorgänge (E-Mail-Verlauf):** Alles Hin und Her zu einer Sache landet in einem Vorgang (Tabelle `themen`).
  Eingehende Mails werden über die Antwort-Kennung (In-Reply-To/References) zugeordnet, sonst über gleichen Betreff
  derselben Person (offen, letzte 120 Tage). Die Vorgangsseite (`#/thema/<id>`) zeigt den Verlauf als Gesprächsfaden,
  mit „Antworten“ und **„Erledigt“**: Dann entsteht ein PDF des ganzen Verlaufs (optional mit KI-Zusammenfassung,
  Dateiname sichtbar und änderbar), das in die Ablage geht. Kommt danach noch eine Antwort, öffnet sich der Vorgang wieder.
  Akte und Kontaktseite zeigen den Abschnitt „Schriftverkehr“.
- **ZIP-Import:** Eine ZIP mit fertiger Ordnerstruktur in die Ablagefläche ziehen. Erkannt wird entweder je Haus ein
  Ordner in der obersten Ebene oder eine Struktur für ein gewähltes Haus. Ordner werden den vorhandenen zugeordnet,
  fehlende angelegt, Dateinamen 1:1 übernommen, Doppelte übersprungen (Vorschau vor dem Import, Abbrechen möglich).
  Danach optional **„Für die KI erschließen“**: Die KI liest jede Datei einmal und speichert nur eine kurze
  Zusammenfassung; Name und Ordner bleiben unverändert. Der Knopf steht auch später auf der Ablage-Seite.
- **Suchfelder statt langer Listen:** Empfänger, „Betrifft“ bei Notizen (Mietpartei, Handwerker, Kontakt),
  Handwerker-Auftrag („Wer soll kommen?“, passende zuerst) und Mietpartei einer Nachricht: tippen, Treffer erscheinen oben.
- **Assistent beim Einsprechen:** „Mieter kommt, will etwas“ – einsprechen, die KI erkennt neben Notiz und To-dos auch,
  welche Schreiben nötig sind (E-Mail oder Brief, an wen, was hinein soll). Robert prüft die Zeilen, ändert sie bei Bedarf,
  dann bereitet die KI die Entwürfe vor und öffnet den ersten. Senden bleibt ein eigener Klick.
- **Ganzes Haus statt Mietpartei:** Bei „Erfassen“ und auf der Nachrichtenseite kann unter „Betrifft“ auch ein ganzes Haus
  stehen (z. B. Gerümpel im Keller, Verursacher unbekannt). Die Nachricht erscheint dann auf der Hausseite (`nachrichten.objekt_id`),
  die KI ordnet sie keiner einzelnen Mietpartei mehr zu.
- **Rundschreiben:** „An alle Mietparteien schreiben“ (Hausseite, Nachricht mit Haus, Empfängersuche „Häuser“) öffnet ein
  Schreiben an das Haus mit Häkchenliste der Mietparteien („Mehrere“ = einzelne abwählen). Anrede „Sehr geehrte Mieterinnen und
  Mieter“, keine Namen. „Per E-Mail an alle senden“ schickt jeder Mietpartei eine eigene Mail (niemand sieht die anderen
  Adressen, jede Akte bekommt einen Eintrag). Wer keine E-Mail hat, bekommt das Schreiben als **Aushang/Brief** (Vorschau, dann drucken).
- **Absender wählbar:** Unter Einstellungen › „Weitere Absender“ lassen sich z. B. „Privat“ mit Name, Anschrift, Kontakt und
  Signatur anlegen. Beim Schreiben oben „Absender“ wählen: Signatur, Fußzeile der Mail, Briefkopf (ohne „Immobilienverwaltung“),
  Absendername und der Ton der KI (Ich-Form, ohne Firma) folgen der Wahl. Technisch geht die Mail weiter über die bestätigte
  Versand-Adresse; Antworten landen bei der hinterlegten E-Mail des Absenders (Reply-To).
- **Unterschrift in Briefen:** Unter Einstellungen › Unterschrift ein Foto oder einen Scan hochladen (Hintergrund wird entfernt,
  das Bild liegt privat im Speicher). In der Brief-Vorschau gibt es das Häkchen „Unterschrift einsetzen“: vorbelegt bei Mahnungen,
  Nachweisen ans Jobcenter/Amt und bei Vertraglichem (Mieterhöhung, Kündigung, Vereinbarung, Kaution …), nicht bei Aushängen,
  Rundschreiben und z. B. Hausordnung. Umschalten zeigt den Brief sofort neu; nach dem Speichern bleibt die Fassung fest.
  E-Mails bekommen nie eine Unterschrift.
- **Vom Einzel-Schreiben zum Rundschreiben:** Am Feld „An (E-Mail)“ steht „An alle im Haus“. Fängt der Text mit „Sehr geehrte
  Mieterinnen und Mieter“ o. Ä. an, erscheint zusätzlich ein Hinweis mit demselben Knopf (oder „Nein, nur an diesen Empfänger“).
  Betreff, Text und ein gespeicherter Entwurf ziehen ins Rundschreiben um (kein zweiter Entwurf); ohne bekanntes Haus wird kurz gefragt.
- **To-dos ohne Zuordnung:** Im Notiz-Dialog „Nur To-do (keiner Person und keinem Haus zuordnen)“ – erscheint in der Übersicht als
  „To-do · Allgemein“ zum Fälligkeitsdatum (leer = heute). Beim Einsprechen heißt die Wahl „Nur To-do / Schreiben“.
- **Ort an jedem To-do:** Haus und Wohnung (bzw. „ganzes Haus“, „Allgemein“, „nicht zugeordnet“; von der KI zugeordnet: „KI-Vorschlag“).
- **Rückstände** stehen nicht mehr unter „Zu erledigen“, sondern im Filter „Rückstände“ (Mahnung fällig zuerst).
- **Rundschreiben:** Eine Kopie geht zusätzlich an die eigene Adresse (Absender-E-Mail, sonst „Antworten gehen an“, sonst Briefkopf).

## Sicherheit

- **Login + Freischaltung:** Eingeloggt sein reicht nicht. Daten sieht nur, wer in der Tabelle
  `mitglieder` steht (Row Level Security auf allen Tabellen, Funktion `privat.ist_mitglied()`).
- Der anonyme Zugang (`anon`) hat auf keine Tabelle Rechte.
- Eigene Vorlagen liegen im **privaten** Bucket `vorlagen`, erstellte Schreiben im **privaten**
  Bucket `schreiben` (`<mieter_id>/<vorgang_id>.docx`, nicht überschreibbar).
- Im Repo stehen **keine** Geheimnisse und **keine** echten Daten. Niemals den Secret Key
  (`sb_secret_…` / service_role), das Datenbank-Passwort oder KI-API-Schlüssel committen.

### Neues Mitglied freischalten

1. Supabase → Authentication → Users → „Add user“ (mit „Auto Confirm User“).
2. Supabase → SQL Editor:

```sql
insert into public.mitglieder (user_id, email)
select id, email from auth.users where email = 'name@beispiel.de';
```

Empfohlen zusätzlich: Authentication → Sign In / Providers → „Allow new users to sign up“ ausschalten.

## Testdaten neu einspielen

Im Supabase SQL Editor erst leeren, dann `supabase/seed.sql`, `supabase/seed_postfach.sql`,
`supabase/seed_postfach_2.sql` und `supabase/seed_etappen.sql` ausführen:

```sql
truncate public.aufgaben, public.dokumente, public.dienstleister,
         public.antworten, public.nachrichten, public.wissen, public.vorgaenge, public.forderungen,
         public.mieter, public.wohnungen, public.objekte, public.kostentraeger, public.vorlagen cascade;
```

Danach die Zeile für die Antwortvorlage aus `supabase/migrations/20261015020000_vorlage_antwort.sql` erneut ausführen.

## Umzug auf das echte Konto (später)

1. Robert legt ein eigenes Supabase-Projekt an: Pro-Plan, **Region Frankfurt**, AVV im Dashboard unterschreiben.
2. Migrationen aus `supabase/migrations/` der Reihe nach im SQL Editor ausführen (ohne die `seed`-Dateien
   und ohne `…_pg_net.sql`, das war nur für Tests).
   Edge Functions deployen (`supabase functions deploy ki posteingang versand --no-verify-jwt`) und Secrets setzen.
3. Vorlagen-Einträge anlegen (letzter Block in `seed.sql`, Tabelle `vorlagen`) und Briefkopf eintragen.
4. `js/config.js` auf die neue URL + Publishable Key umstellen.
5. Repo auf privat stellen (GitHub Pro) bzw. auf Roberts Konto übertragen.
6. AVV mit Anthropic (Claude API) und Resend abschließen, Datenschutzhinweis für Mieter ergänzen,
   bei Resend die eigene Domain (EU-Region) bestätigen.
7. Erst dann echte Daten eintragen. Das Testprojekt löschen.

## Ausbaustufen

- [x] Stufe 1: Mieter, offene Posten, Mahnungen und Nachweis per Klick, eigene Vorlagen
- [x] Stufe 1b: Vorschau vor dem Download, Archiv der Schreiben, Ansicht ohne seitliches Scrollen
- [x] Stufe 2: Postfach, KI-Einordnung, Antwortentwürfe mit Diktat, Wissen, Versand per Klick, Brief fotografieren
- [x] Stufe 3 (Roberts Feedback): To-do-Übersicht mit Fristen und Wiedervorlagen, Seiten je Haus,
      Dokumentenablage mit KI-Vorschlag, Anhänge aus E-Mails, Handwerker-Auftrag, Wissen einsprechen,
      Mieterhöhung prüfen, Chat mit Vorschlägen
- [x] Ablage: Ordner bearbeitbar (mit Unterordnern), ZIP-Export, Download unter sauberem Namen
- [x] Ablage aus der App: Mails, Notizen und Gesendetes mit KI-Ordnervorschlag, Word/Excel hochladen
- [x] Roberts Ordnerstruktur (automatische Jahres- und Wohnungsordner) und Dateinamen-Schema
- [x] Dateiname vor dem Speichern sichtbar und änderbar (KI-Vorschlag nach Schema)
- [x] Upload: KI liest auch Word/Excel, mehrere Dateien auf einmal
- [x] Menüpunkt „Objekte“ mit Ordnerbaum je Haus und Ablagefläche zum Hineinziehen
- [x] Kontakte mit Verlauf, „Notiz einsprechen“ (KI), jährliche Geburtstags-Erinnerungen
- [x] „An wen?“ als ein Suchfeld (Mietparteien, Kontakte, Handwerker, Kostenträger)
- [x] Chat-Vorschläge mit Annehmen / Ändern / Ablehnen, PDF aus dem Chat
- [x] Upload: Haus folgt der gewählten Mietpartei (Warnung bei Widerspruch)
- [x] Eingabemaske Stammdaten (`#/stammdaten`): Häuser, Wohnungen (auch „WHG 01–12“ auf einmal), Kostenträger,
      neue Mietparteien; Details der Mietpartei weiter in der Akte
- [ ] Später: Antwort als PDF-Anhang mailen, Import offener Posten aus immocloud (CSV)

Die Mustertexte der Vorlagen sind ein Ausgangspunkt und vor dem echten Einsatz rechtlich prüfen zu lassen.
