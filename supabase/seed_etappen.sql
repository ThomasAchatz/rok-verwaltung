-- Erfundene Beispieldaten für Roberts Wünsche (To-do-Liste, Handwerker, Ablage, Mieterhöhung).
-- Mehrfach ausführbar. Keine echten Namen, Telefonnummern oder Adressen.

-- Wissen in Ordner sortieren
update wissen set ordner = 'Abläufe & Hausordnung'
 where titel in ('Ruhezeiten (Hausordnung)', 'Ratenzahlung bei Mietrückstand', 'Mietbescheinigung und Unterlagen fürs Jobcenter',
                 'Freie Wohnungen und Mietinteressenten', 'Kündigung durch Mieter', 'Müllabfuhr MFH Lindenstraße 14');
update wissen set ordner = 'Dienstleister & Verträge' where titel in ('Reparaturen und Notdienst', 'Hausmeister MFH Am Mühlbach 3');

-- Handwerker und Dienstleister
insert into dienstleister (name, gewerk, telefon, email, objekt_id, notiz)
select v.name, v.gewerk, v.telefon, v.email, o.id, v.notiz
  from (values
    ('Haustechnik Muster GmbH', 'Heizung & Sanitär', '0123 555000', 'auftrag@haustechnik.example.org', null, 'Notdienst rund um die Uhr'),
    ('Elektro Beispiel', 'Elektro', '0123 555100', 'info@elektro-beispiel.example.org', null, null),
    ('Hausmeister Klein', 'Hausmeister', '0170 5550001', null, 'MFH Am Mühlbach 3', 'Montags und donnerstags vor Ort'),
    ('Schlüsseldienst Schnell', 'Schlüssel & Schließanlage', '0123 555200', null, null, 'Schließanlage Lindenstraße: Sicherungskarte im Ordner'),
    ('Malerbetrieb Farbenfroh', 'Maler', '0123 555300', 'angebot@farbenfroh.example.org', null, null)
  ) as v(name, gewerk, telefon, email, objekt, notiz)
  left join objekte o on o.bezeichnung = v.objekt
 where not exists (select 1 from dienstleister d where d.name = v.name);

-- Angaben für die Mieterhöhungsprüfung (Wohnfläche steht schon bei der Wohnung)
update objekte set kappungsgrenze = 15 where bezeichnung = 'MFH Lindenstraße 14';
update mieter m set vergleichsmiete_qm = case o.bezeichnung when 'MFH Lindenstraße 14' then 8.50 else 8.00 end
  from wohnungen w join objekte o on o.id = w.objekt_id
 where w.id = m.wohnung_id;
update mieter set letzte_erhoehung_am = '2026-03-01', kaltmiete_vorher = 450 where nachname = 'Huber';
update mieter set letzte_erhoehung_am = '2022-08-01', kaltmiete_vorher = 470 where nachname = 'Wolf';
update mieter set mietart = 'index', letzte_erhoehung_am = '2026-01-01', kaltmiete_vorher = 545 where nachname = 'Lang';
update mieter set mietart = 'staffel' where nachname = 'Demir';

-- Notizen und Wiedervorlagen
insert into aufgaben (titel, notiz, faellig_am, vorlauf_tage, objekt_id, mieter_id)
select v.titel, v.notiz, v.faellig::date, v.vorlauf, o.id, m.id
  from (values
    ('Check Möglichkeit Mieterhöhung Huber', null, null, 7, null, 'Huber'),
    ('Rauchmelder-Wartung Lindenstraße 14', 'Termin mit allen Mietparteien abstimmen, Aushang im Treppenhaus.', '2026-10-24', 7, 'MFH Lindenstraße 14', null),
    ('Mietbescheinigung Bauer ans Jobcenter', 'Jobcenter wartet auf die Bescheinigung.', '2026-10-21', 3, null, 'Bauer'),
    ('Heizungswartung Am Mühlbach 3 beauftragen', 'Haustechnik Muster anrufen, Termin vor der Heizperiode.', '2026-11-15', 14, 'MFH Am Mühlbach 3', null)
  ) as v(titel, notiz, faellig, vorlauf, objekt, nachname)
  left join objekte o on o.bezeichnung = v.objekt
  left join mieter m on m.nachname = v.nachname
 where not exists (select 1 from aufgaben a where a.titel = v.titel);

-- Offene Nachrichten neu einordnen lassen, damit Fristen erkannt werden
update nachrichten set ki_am = null where status in ('neu', 'offen') and frist_bestaetigt = false;
