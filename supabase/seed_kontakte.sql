-- Erfundene Testdaten für Kontakte, Verlauf und Geburtstage (Mini-CRM). Mehrfach ausführbar.
-- Nur fürs Testsystem: alle Namen, Firmen und Nummern sind ausgedacht.

insert into public.kontakte (id, vorname, nachname, firma, rolle, telefon, email, adresse, geburtstag_tag, geburtstag_monat, geburtsjahr, notiz) values
  ('a1c0b001-0000-4000-8000-000000000001', 'Gerd',  'Obermaier', 'Sparkasse Musterstadt', 'Makler', '0851 555123', 'g.obermaier@example.org', null, 22, 10, null,
   'Hat einen Hund (Bello). Tochter hat am selben Tag Geburtstag wie er (22.10.).'),
  ('a1c0b001-0000-4000-8000-000000000002', 'Hans',  'Wimmer', 'Volksbank Musterland', 'Bank', '0851 555777', 'h.wimmer@example.org', null, 20, 10, 1970,
   'Fährt Motorrad, im Sommer meist am Gardasee.'),
  ('a1c0b001-0000-4000-8000-000000000003', 'Lena',  'Brandl', 'Notariat Dr. Brandl', 'Notar', '0851 555440', 'kanzlei@notariat-brandl.example', 'Marktplatz 5, 12345 Musterstadt', 9, 11, null, null),
  ('a1c0b001-0000-4000-8000-000000000004', 'Petra', 'Kollmer', 'Kanzlei Kollmer & Partner', 'Steuerberater', '0851 555600', 'p.kollmer@example.org', null, 25, 10, 1981,
   'Bevorzugt E-Mail statt Anruf.'),
  ('a1c0b001-0000-4000-8000-000000000005', 'Klaus', 'Fischer', 'Stadtwerke Musterstadt', 'Versorger', '0851 555300', null, null, 3, 3, 1968,
   'Spielt Tennis im TC Musterstadt.'),
  ('a1c0b001-0000-4000-8000-000000000006', null, null, 'Finanzamt Musterstadt', 'Behörde', '0851 555900', null, 'Amtsplatz 1, 12345 Musterstadt', null, null, null,
   'Grundsteuer: Sachbearbeitung Buchstaben M–R.')
on conflict (id) do nothing;

insert into public.verlauf (id, datum, art, text, kontakt_id, mieter_id) values
  ('b2d0c002-0000-4000-8000-000000000001', '2026-10-20', 'telefonat',
   'Haus in Landau ist reserviert. Er schickt das Exposé, sobald die Unterlagen vom Eigentümer da sind.', 'a1c0b001-0000-4000-8000-000000000001', null),
  ('b2d0c002-0000-4000-8000-000000000002', '2026-10-01', 'treffen',
   'Erstes Treffen in der Filiale. Sucht für einen Kunden einen Käufer für ein MFH in Landau (6 Einheiten).', 'a1c0b001-0000-4000-8000-000000000001', null),
  ('b2d0c002-0000-4000-8000-000000000003', '2026-10-17', 'treffen',
   'Finanzierung Landau besprochen: Zinsbindung 10 Jahre angefragt, Angebot kommt bis Ende Oktober.', 'a1c0b001-0000-4000-8000-000000000002', null),
  ('b2d0c002-0000-4000-8000-000000000004', '2026-10-14', 'email',
   'Unterlagen für die Steuererklärung 2025 geschickt. Es fehlen noch die Nebenkostenabrechnungen Am Mühlbach.', 'a1c0b001-0000-4000-8000-000000000004', null),
  ('b2d0c002-0000-4000-8000-000000000005', '2026-09-30', 'telefonat',
   'Zählerwechsel im Keller Lindenstraße für November angekündigt. Termin folgt schriftlich.', 'a1c0b001-0000-4000-8000-000000000005', null)
on conflict (id) do nothing;

-- Verlauf bei Mietparteien (über den Namen gesucht, damit die Datei unabhängig von IDs bleibt)
insert into public.verlauf (id, datum, art, text, kontakt_id, mieter_id)
select v.id::uuid, v.datum::date, v.art, v.text, null, m.id
from (values
  ('b2d0c002-0000-4000-8000-000000000011', '2026-10-20', 'telefonat', 'Huber',
   'Mit Frau Huber vereinbart: Die Kaution wird in 3 Raten gezahlt (November, Dezember, Januar).'),
  ('b2d0c002-0000-4000-8000-000000000012', '2026-10-08', 'telefonat', 'Bauer',
   'Herr Bauer sagt, das Jobcenter zahlt die Miete ab November wieder direkt. Bescheid reicht er nach.'),
  ('b2d0c002-0000-4000-8000-000000000013', '2026-10-12', 'treffen', 'Demir',
   'Wohnungsbesichtigung wegen Feuchtigkeit im Bad: Lüftungsgitter verstopft, Hausmeister reinigt es nächste Woche.')
) as v(id, datum, art, nachname, text)
join public.mieter m on m.nachname = v.nachname
on conflict (id) do nothing;

-- To-dos zu Kontakten und Mietparteien
insert into public.aufgaben (id, titel, notiz, faellig_am, vorlauf_tage, kontakt_id)
values
  ('c3e0d003-0000-4000-8000-000000000001', 'Bei Gerd Obermaier nachfragen: Exposé Haus Landau', null, '2026-10-27', 3, 'a1c0b001-0000-4000-8000-000000000001'),
  ('c3e0d003-0000-4000-8000-000000000002', 'Finanzierungsangebot Volksbank prüfen', 'Zinsbindung 10 Jahre', '2026-10-31', 5, 'a1c0b001-0000-4000-8000-000000000002')
on conflict (id) do nothing;
insert into public.aufgaben (id, titel, faellig_am, vorlauf_tage, mieter_id, objekt_id)
select 'c3e0d003-0000-4000-8000-000000000003'::uuid, 'Zweite Kautionsrate von Frau Huber prüfen', '2026-12-05'::date, 7, m.id, w.objekt_id
from public.mieter m join public.wohnungen w on w.id = m.wohnung_id
where m.nachname = 'Huber'
on conflict (id) do nothing;
