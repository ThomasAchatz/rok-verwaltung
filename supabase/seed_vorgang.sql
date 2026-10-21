-- Erfundene Testdaten: ein Kontakt (Versicherung) mit einem Vorgang aus 6 E-Mails hin und her.
-- Zum Testen von „Erledigt“ (Abschluss-PDF) und der Ablage. Mehrfach ausführbar.
-- Nur fürs Testsystem: Namen, Firma, Schadennummer und Adressen sind ausgedacht.
--
-- Zurücksetzen (Vorgang wieder offen, Abschluss-PDF-Verweis weg):
--   update public.themen set status = 'offen', erledigt_am = null, dokument_id = null, zusammenfassung = null
--   where id = 'c3e0d003-0000-4000-8000-000000000001';
--   update public.nachrichten set status = 'neu' where id = 'd4f0e004-0000-4000-8000-000000000003';

insert into public.kontakte (id, vorname, nachname, firma, rolle, telefon, email, adresse, notiz) values
  ('a1c0b001-0000-4000-8000-000000000007', 'Andrea', 'Lechner', 'Musterland Versicherung AG', 'Versicherung',
   '0851 555210', 'schaden@musterland-versicherung.example', 'Versicherungsplatz 2, 12345 Musterstadt',
   'Sachbearbeiterin Schadenabteilung (Wohngebäude). Am besten per E-Mail, Schadennummer immer im Betreff.')
on conflict (id) do nothing;

-- Der Vorgang
insert into public.themen (id, titel, betreff_norm, kontakt_id, objekt_id, partner_email, status, erstellt_am, aktualisiert_am)
select 'c3e0d003-0000-4000-8000-000000000001', 'Wasserschaden Lindenstraße 14 – Schaden-Nr. WG-2026-04711',
       privat.betreff_norm('Wasserschaden Lindenstraße 14 – Schaden-Nr. WG-2026-04711'),
       'a1c0b001-0000-4000-8000-000000000007', o.id, 'schaden@musterland-versicherung.example', 'offen',
       '2026-09-22 09:10+02', '2026-10-19 11:20+02'
from public.objekte o where o.strasse = 'Lindenstraße 14'
on conflict (id) do nothing;

-- Eingänge von der Versicherung (3)
insert into public.nachrichten (id, eingang_am, quelle, absender_email, absender_name, betreff, text, status,
  ki_kategorie, ki_dringlichkeit, ki_zusammenfassung, ki_vorschlag, ki_am, extern_id, extern_message_id, anhaenge, thema_id) values
  ('d4f0e004-0000-4000-8000-000000000001', '2026-09-24 10:42+02', 'email', 'schaden@musterland-versicherung.example', 'Andrea Lechner (Musterland Versicherung)',
   'AW: Wasserschaden Lindenstraße 14 – Schaden-Nr. WG-2026-04711',
   E'Sehr geehrter Herr Mustermann,\n\nvielen Dank für Ihre Schadenmeldung. Wir haben den Leitungswasserschaden unter der Schaden-Nr. WG-2026-04711 angelegt.\n\nFür die weitere Bearbeitung benötigen wir:\n1. Fotos der betroffenen Stellen (Bad und Flur, Wohnung 1. OG links)\n2. einen Kostenvoranschlag des beauftragten Fachbetriebs\n3. die Rechnung der Leckortung, sobald sie vorliegt\n\nMit freundlichen Grüßen\nAndrea Lechner\nSchadenabteilung Wohngebäude\nMusterland Versicherung AG',
   'beantwortet', 'Sonstiges', 'normal', 'Versicherung hat den Wasserschaden angelegt und bittet um Fotos, Kostenvoranschlag und Rechnung der Leckortung.',
   'Fotos und Kostenvoranschlag an die Versicherung schicken.', '2026-09-24 10:43+02',
   'seed:vorgang-1', 'seed-vorgang-1@musterland-versicherung.example', '[]', 'c3e0d003-0000-4000-8000-000000000001'),
  ('d4f0e004-0000-4000-8000-000000000002', '2026-10-06 14:05+02', 'email', 'schaden@musterland-versicherung.example', 'Andrea Lechner (Musterland Versicherung)',
   'AW: AW: Wasserschaden Lindenstraße 14 – Schaden-Nr. WG-2026-04711',
   E'Sehr geehrter Herr Mustermann,\n\ndanke für die Unterlagen. Wegen der Schadenhöhe schicken wir einen Gutachter. Herr Weiß (Sachverständigenbüro Weiß) würde am Dienstag, 14.10.2026, um 10:00 Uhr vorbeikommen.\n\nBitte bestätigen Sie den Termin und sorgen Sie dafür, dass die Wohnung zugänglich ist.\n\nMit freundlichen Grüßen\nAndrea Lechner',
   'beantwortet', 'Sonstiges', 'normal', 'Gutachtertermin am 14.10.2026 um 10 Uhr, Bestätigung und Zugang zur Wohnung erbeten.',
   'Termin bestätigen und Mieterin informieren.', '2026-10-06 14:06+02',
   'seed:vorgang-2', 'seed-vorgang-2@musterland-versicherung.example', '[]', 'c3e0d003-0000-4000-8000-000000000001'),
  ('d4f0e004-0000-4000-8000-000000000003', '2026-10-19 11:20+02', 'email', 'schaden@musterland-versicherung.example', 'Andrea Lechner (Musterland Versicherung)',
   'AW: AW: AW: Wasserschaden Lindenstraße 14 – Schaden-Nr. WG-2026-04711',
   E'Sehr geehrter Herr Mustermann,\n\nnach Prüfung des Gutachtens übernehmen wir den Schaden in Höhe von 2.430,31 € (Trocknung, Leckortung, Fliesenarbeiten abzüglich 250,00 € Selbstbeteiligung).\n\nDie Zahlung geht in den nächsten Tagen auf das bei uns hinterlegte Konto. Damit ist der Schaden für uns abgeschlossen.\n\nMit freundlichen Grüßen\nAndrea Lechner',
   'neu', 'Sonstiges', 'normal', 'Versicherung übernimmt 2.430,31 € nach Abzug der Selbstbeteiligung; Schaden ist abgeschlossen.',
   'Zahlungseingang prüfen und Vorgang abschließen.', '2026-10-19 11:21+02',
   'seed:vorgang-3', 'seed-vorgang-3@musterland-versicherung.example', '[]', 'c3e0d003-0000-4000-8000-000000000001')
on conflict (id) do nothing;

-- Gesendete Antworten der Verwaltung (3)
insert into public.antworten (id, nachricht_id, kontakt_id, thema_id, empfaenger_email, empfaenger_name, betreff, text, status, art,
  gesendet_am, erstellt_am, aktualisiert_am) values
  ('e5a0f005-0000-4000-8000-000000000001', null, 'a1c0b001-0000-4000-8000-000000000007', 'c3e0d003-0000-4000-8000-000000000001',
   'schaden@musterland-versicherung.example', 'Andrea Lechner',
   'Wasserschaden Lindenstraße 14 – Schaden-Nr. WG-2026-04711',
   E'Sehr geehrte Frau Lechner,\n\nwir melden einen Leitungswasserschaden im MFH Lindenstraße 14, 12345 Musterstadt (Wohnung 1. OG links). Am 20.09.2026 ist eine Zuleitung in der Wand zwischen Bad und Flur undicht geworden. Die Wand und der Estrich im Flur sind durchfeuchtet.\n\nEin Fachbetrieb ist beauftragt, die Leckortung und Trocknung laufen. Bitte teilen Sie uns die Schadennummer und die benötigten Unterlagen mit.',
   'gesendet', 'antwort', '2026-09-22 09:10+02', '2026-09-22 09:02+02', '2026-09-22 09:10+02'),
  ('e5a0f005-0000-4000-8000-000000000002', 'd4f0e004-0000-4000-8000-000000000001', 'a1c0b001-0000-4000-8000-000000000007', 'c3e0d003-0000-4000-8000-000000000001',
   'schaden@musterland-versicherung.example', 'Andrea Lechner',
   'AW: Wasserschaden Lindenstraße 14 – Schaden-Nr. WG-2026-04711',
   E'Sehr geehrte Frau Lechner,\n\nanbei die Fotos von Bad und Flur sowie der Kostenvoranschlag von Haustechnik Muster GmbH über 2.680,31 €. Die Rechnung der Leckortung reichen wir nach, sobald sie da ist.\n\nBei Fragen erreichen Sie uns gern telefonisch.',
   'gesendet', 'antwort', '2026-09-29 16:30+02', '2026-09-29 16:12+02', '2026-09-29 16:30+02'),
  ('e5a0f005-0000-4000-8000-000000000003', 'd4f0e004-0000-4000-8000-000000000002', 'a1c0b001-0000-4000-8000-000000000007', 'c3e0d003-0000-4000-8000-000000000001',
   'schaden@musterland-versicherung.example', 'Andrea Lechner',
   'AW: AW: Wasserschaden Lindenstraße 14 – Schaden-Nr. WG-2026-04711',
   E'Sehr geehrte Frau Lechner,\n\nden Termin mit Herrn Weiß am Dienstag, 14.10.2026, um 10:00 Uhr bestätigen wir. Die Mieterin ist informiert und an dem Vormittag zu Hause, wir sind ebenfalls vor Ort.',
   'gesendet', 'antwort', '2026-10-07 08:45+02', '2026-10-07 08:40+02', '2026-10-07 08:45+02')
on conflict (id) do nothing;

-- Kurzer Eintrag im Gesprächsverlauf des Kontakts
insert into public.verlauf (id, datum, art, text, kontakt_id, mieter_id) values
  ('b2d0c002-0000-4000-8000-000000000021', '2026-10-14', 'treffen',
   'Gutachtertermin Lindenstraße 14 mit Herrn Weiß: Schaden aufgenommen, Gutachten geht direkt an die Versicherung.',
   'a1c0b001-0000-4000-8000-000000000007', null)
on conflict (id) do nothing;
