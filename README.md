# ROK Verwaltung

Verwaltungs-Dashboard für ROK Immobilien: offene Mieten im Blick behalten und Standardschreiben
(1. Mahnung, 2. Mahnung, Nachweis an Jobcenter/Sozialamt) per Klick erzeugen – mit den richtigen
Mieterdaten und dem richtigen Mietkonto (IBAN) je Mieter. Jedes Schreiben erscheint zuerst in einer
Vorschau; erst beim Herunterladen, Drucken/PDF oder Versenden wird es im Verlauf archiviert.

> **Testversion:** In der Datenbank liegen ausschließlich erfundene Daten. Echte Mieterdaten
> erst nach dem Umzug auf Roberts eigenes Supabase-Konto (Pro-Plan, AVV, Region Frankfurt) eintragen.

## Aufbau

| Teil | Technik |
|---|---|
| Oberfläche | `index.html`, `css/app.css`, `js/*.js` – reines HTML/JS ohne Build-Schritt, läuft auf GitHub Pages |
| Datenbank, Login, Dateiablage | Supabase (Region eu-central-1 / Frankfurt) |
| Briefe | Word-Vorlagen in `vorlagen/` mit Platzhaltern, befüllt im Browser mit docxtemplater (`vendor/docx-vendor.min.js`) |

```
index.html            Einstieg
css/app.css           Gestaltung
js/config.js          Supabase-URL + Publishable Key (öffentlich, das ist so gedacht)
js/daten.js           alle Datenbankzugriffe
js/dokumente.js       Briefdaten zusammenstellen, Vorlagen befüllen
js/vorschau.js        Vorschau-Fenster (Drucken/PDF, E-Mail, Herunterladen, in E-Mail ziehen)
js/app.js             Oberfläche
PLATZHALTER.md        alle Platzhalter für eigene Vorlagen
manifest.webmanifest, sw.js, icons/   installierbare App (PWA)
vorlagen/*.docx       Standard-Briefvorlagen
tools/vorlagen-erzeugen.js   erzeugt die Standardvorlagen neu (node, Paket "docx")
supabase/migrations/  Datenbankstruktur + Zugriffsschutz
supabase/seed.sql     erfundene Testdaten
vendor/               gebündelte Bibliotheken (siehe vendor/LIZENZEN.md)
```

## Als App installieren

- **iPhone/iPad:** Seite in Safari öffnen → Teilen → „Zum Home-Bildschirm“.
- **Android:** Chrome-Menü → „App installieren“.
- **Windows/Mac:** In Chrome oder Edge das Installieren-Symbol rechts in der Adressleiste.

In der App gibt es dafür auch den Knopf „Installieren“ (auf dem iPhone mit Anleitung).

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

Im Supabase SQL Editor erst leeren, dann `supabase/seed.sql` ausführen:

```sql
truncate public.vorgaenge, public.forderungen, public.mieter, public.wohnungen,
         public.objekte, public.kostentraeger, public.vorlagen cascade;
```

## Umzug auf das echte Konto (später)

1. Robert legt ein eigenes Supabase-Projekt an: Pro-Plan, **Region Frankfurt**, AVV im Dashboard unterschreiben.
2. Migrationen aus `supabase/migrations/` der Reihe nach im SQL Editor ausführen (ohne `seed.sql`).
3. Vorlagen-Einträge anlegen (letzter Block in `seed.sql`, Tabelle `vorlagen`) und Briefkopf eintragen.
4. `js/config.js` auf die neue URL + Publishable Key umstellen.
5. Repo auf privat stellen (GitHub Pro) bzw. auf Roberts Konto übertragen.
6. Erst dann echte Daten eintragen. Das Testprojekt löschen.

## Ausbaustufen

- [x] Stufe 1: Mieter, offene Posten, Mahnungen und Nachweis per Klick, eigene Vorlagen
- [x] Stufe 1b: Vorschau vor dem Download, Archiv der Schreiben, Ansicht ohne seitliches Scrollen
- [ ] Stufe 2: Antwortentwürfe auf individuelle Schreiben mit KI (Supabase Edge Function + Claude API,
      Schlüssel nur als Supabase-Secret)
- [ ] Später: Import offener Posten aus immocloud (CSV), direkter E-Mail-Versand aus der App

Die Mustertexte der Vorlagen sind ein Ausgangspunkt und vor dem echten Einsatz rechtlich prüfen zu lassen.
