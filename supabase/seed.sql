-- ROK Verwaltung – ERFUNDENE Testdaten. Keine echten Personen, Konten oder Aktenzeichen.
-- Die IBANs sind formal gültig (Prüfziffer), gehören aber zu keiner echten Bank (BLZ 12345678).
-- Erneut einspielen: vorher Daten leeren (siehe README).
begin;

insert into public.vermieter_profil (id, firma, inhaber, strasse, plz, ort, telefon, email, web)
values (1, 'ROK Immobilien', 'Robert Mustermann', 'Musterstraße 1', '12345', 'Musterstadt', '0123 456789', 'info@rok-immobilien.com', 'rok-immobilien.com')
on conflict (id) do update set firma = excluded.firma, inhaber = excluded.inhaber, strasse = excluded.strasse,
  plz = excluded.plz, ort = excluded.ort, telefon = excluded.telefon, email = excluded.email, web = excluded.web;

insert into public.objekte (id, bezeichnung, strasse, plz, ort) values ('c49bbb18-618b-5255-a99e-7a84d7e4b014', 'MFH Lindenstraße 14', 'Lindenstraße 14', '12345', 'Musterstadt');
insert into public.objekte (id, bezeichnung, strasse, plz, ort) values ('83010da9-80e0-51a2-9adb-0ca86d4d8527', 'MFH Am Mühlbach 3', 'Am Mühlbach 3', '12345', 'Musterstadt');
insert into public.wohnungen (id, objekt_id, bezeichnung, flaeche_qm, zimmer) values ('32df7b96-e2dd-530f-958a-119ef2549e64', 'c49bbb18-618b-5255-a99e-7a84d7e4b014', 'EG links', 58, 2);
insert into public.wohnungen (id, objekt_id, bezeichnung, flaeche_qm, zimmer) values ('6de51602-10ae-589a-a99c-6bbdb4c399fe', 'c49bbb18-618b-5255-a99e-7a84d7e4b014', 'EG rechts', 72, 3);
insert into public.wohnungen (id, objekt_id, bezeichnung, flaeche_qm, zimmer) values ('12758406-59fd-53cd-ba95-5b287f221063', 'c49bbb18-618b-5255-a99e-7a84d7e4b014', '1. OG links', 58, 2);
insert into public.wohnungen (id, objekt_id, bezeichnung, flaeche_qm, zimmer) values ('f69eb783-df8a-5658-b80a-dc44055b6eb3', 'c49bbb18-618b-5255-a99e-7a84d7e4b014', '1. OG rechts', 72, 3);
insert into public.wohnungen (id, objekt_id, bezeichnung, flaeche_qm, zimmer) values ('e1bd1c8b-fe69-506c-b9b8-084cfe6bc220', '83010da9-80e0-51a2-9adb-0ca86d4d8527', 'Whg. 1', 45, 1.5);
insert into public.wohnungen (id, objekt_id, bezeichnung, flaeche_qm, zimmer) values ('cb390aeb-ea8d-5a55-b66b-4f346b69fd4f', '83010da9-80e0-51a2-9adb-0ca86d4d8527', 'Whg. 2', 64, 2.5);
insert into public.wohnungen (id, objekt_id, bezeichnung, flaeche_qm, zimmer) values ('2155adc1-10c5-5014-9fbc-aea3c05b51a0', '83010da9-80e0-51a2-9adb-0ca86d4d8527', 'Whg. 3', 51, 2);
insert into public.wohnungen (id, objekt_id, bezeichnung, flaeche_qm, zimmer) values ('831e2f98-680f-5a49-ac39-ae57b077b7f8', '83010da9-80e0-51a2-9adb-0ca86d4d8527', 'Dachgeschoss', 80, 3);
insert into public.kostentraeger (id, art, name, abteilung, strasse, plz, ort, telefon, email) values
('14a50af0-56a3-5618-a9c6-4115c97efdb7', 'jobcenter', 'Jobcenter Musterstadt', 'Leistungsabteilung – Kosten der Unterkunft', 'Agenturplatz 1', '12345', 'Musterstadt', '0123 900100', 'jobcenter-musterstadt@example.org'),
('1e26eff6-2413-51f7-9746-e7e3b6b991b1', 'sozialamt', 'Sozialamt Landkreis Musterland', 'Grundsicherung', 'Landratsamtstraße 2', '12346', 'Musterhausen', '0123 900200', 'sozialamt@example.org');
insert into public.mieter (id, wohnung_id, anrede, vorname, nachname, email, telefon, mietbeginn, kaltmiete, nebenkosten_vz, strom_pauschale, internet_pauschale,
  mietkonto_inhaber, mietkonto_iban, mietkonto_bic, mietkonto_bank, kostentraeger_id, aktenzeichen, direktzahlung) values
('4af207c4-9544-5250-902a-be08d7c488da', '32df7b96-e2dd-530f-958a-119ef2549e64', 'Herr', 'Kevin', 'Bauer', 'k.bauer@example.org', '0170 0000001', '2023-04-01', 420, 160, 45, 25,
 'ROK Immobilien – Mietkonto Bauer', 'DE87123456780004711001', 'MUSTDEXXXXX', 'Musterbank', '14a50af0-56a3-5618-a9c6-4115c97efdb7', 'BG 12345//0012345', false);
insert into public.mieter (id, wohnung_id, anrede, vorname, nachname, email, telefon, mietbeginn, kaltmiete, nebenkosten_vz, strom_pauschale, internet_pauschale,
  mietkonto_inhaber, mietkonto_iban, mietkonto_bic, mietkonto_bank, kostentraeger_id, aktenzeichen, direktzahlung) values
('20676779-02ef-5d89-913c-5d873c92b442', '6de51602-10ae-589a-a99c-6bbdb4c399fe', 'Frau', 'Sabine', 'Wolf', 's.wolf@example.org', '0170 0000002', '2019-08-01', 520, 180, 0, 0,
 'ROK Immobilien – Mietkonto Wolf', 'DE60123456780004711002', 'MUSTDEXXXXX', 'Musterbank', null, null, false);
insert into public.mieter (id, wohnung_id, anrede, vorname, nachname, email, telefon, mietbeginn, kaltmiete, nebenkosten_vz, strom_pauschale, internet_pauschale,
  mietkonto_inhaber, mietkonto_iban, mietkonto_bic, mietkonto_bank, kostentraeger_id, aktenzeichen, direktzahlung) values
('054da6fe-69b1-5a1d-a033-495a994de5a8', '12758406-59fd-53cd-ba95-5b287f221063', 'Herr', 'Dragan', 'Petrović', 'd.petrovic@example.org', '0170 0000003', '2024-02-01', 400, 150, 45, 25,
 'ROK Immobilien – Mietkonto Petrović', 'DE33123456780004711003', 'MUSTDEXXXXX', 'Musterbank', '14a50af0-56a3-5618-a9c6-4115c97efdb7', 'BG 12345//0067890', true);
insert into public.mieter (id, wohnung_id, anrede, vorname, nachname, email, telefon, mietbeginn, kaltmiete, nebenkosten_vz, strom_pauschale, internet_pauschale,
  mietkonto_inhaber, mietkonto_iban, mietkonto_bic, mietkonto_bank, kostentraeger_id, aktenzeichen, direktzahlung) values
('875f2dca-b19c-5180-aec3-16545b423056', 'f69eb783-df8a-5658-b80a-dc44055b6eb3', 'Frau', 'Melanie', 'Huber', 'm.huber@example.org', '0170 0000004', '2021-11-01', 480, 170, 0, 0,
 'ROK Immobilien – Mietkonto Huber', 'DE06123456780004711004', 'MUSTDEXXXXX', 'Musterbank', null, null, false);
insert into public.mieter (id, wohnung_id, anrede, vorname, nachname, email, telefon, mietbeginn, kaltmiete, nebenkosten_vz, strom_pauschale, internet_pauschale,
  mietkonto_inhaber, mietkonto_iban, mietkonto_bic, mietkonto_bank, kostentraeger_id, aktenzeichen, direktzahlung) values
('8cfe85f4-bbb4-528b-bb1c-92a5927a6493', 'e1bd1c8b-fe69-506c-b9b8-084cfe6bc220', 'Herr', 'Jürgen', 'Schmid', 'j.schmid@example.org', '0170 0000005', '2020-06-01', 330, 120, 0, 0,
 'ROK Immobilien – Mietkonto Schmid', 'DE76123456780004711005', 'MUSTDEXXXXX', 'Musterbank', '1e26eff6-2413-51f7-9746-e7e3b6b991b1', 'Az. 50-2241/SGB XII', true);
insert into public.mieter (id, wohnung_id, anrede, vorname, nachname, email, telefon, mietbeginn, kaltmiete, nebenkosten_vz, strom_pauschale, internet_pauschale,
  mietkonto_inhaber, mietkonto_iban, mietkonto_bic, mietkonto_bank, kostentraeger_id, aktenzeichen, direktzahlung) values
('5bb12e4d-2f17-5c3f-afc2-13af5d36e0ff', 'cb390aeb-ea8d-5a55-b66b-4f346b69fd4f', 'Frau', 'Aylin', 'Demir', 'a.demir@example.org', '0170 0000006', '2022-09-01', 450, 165, 0, 0,
 'ROK Immobilien – Mietkonto Demir', 'DE49123456780004711006', 'MUSTDEXXXXX', 'Musterbank', null, null, false);
insert into public.mieter (id, wohnung_id, anrede, vorname, nachname, email, telefon, mietbeginn, kaltmiete, nebenkosten_vz, strom_pauschale, internet_pauschale,
  mietkonto_inhaber, mietkonto_iban, mietkonto_bic, mietkonto_bank, kostentraeger_id, aktenzeichen, direktzahlung) values
('59fb016c-46ec-57e3-be6c-336db5177338', '2155adc1-10c5-5014-9fbc-aea3c05b51a0', 'Herr', 'Lukas', 'Meier', 'l.meier@example.org', '0170 0000007', '2025-01-01', 390, 150, 40, 25,
 'ROK Immobilien – Mietkonto Meier', 'DE22123456780004711007', 'MUSTDEXXXXX', 'Musterbank', '14a50af0-56a3-5618-a9c6-4115c97efdb7', 'BG 12345//0024680', false);
insert into public.mieter (id, wohnung_id, anrede, vorname, nachname, email, telefon, mietbeginn, kaltmiete, nebenkosten_vz, strom_pauschale, internet_pauschale,
  mietkonto_inhaber, mietkonto_iban, mietkonto_bic, mietkonto_bank, kostentraeger_id, aktenzeichen, direktzahlung) values
('991b6d70-b8e6-51f4-8fd4-08a6acb9a99a', '831e2f98-680f-5a49-ac39-ae57b077b7f8', 'Frau', 'Erika', 'Lang', 'e.lang@example.org', '0170 0000008', '2017-03-01', 560, 200, 0, 0,
 'ROK Immobilien – Mietkonto Lang', 'DE92123456780004711008', 'MUSTDEXXXXX', 'Musterbank', null, null, false);
insert into public.forderungen (mieter_id, monat, art, bezeichnung, betrag, bezahlt, bezahlt_am)
select m.id, mo::date, a.art, a.bez, a.betrag, not u.offen,
       case when u.offen then null else mo::date + 2 end
from public.mieter m
left join (values
  -- Mieter, Monate komplett offen, Monate nur Strom/Internet offen
  ('4af207c4-9544-5250-902a-be08d7c488da'::uuid, array['2026-08','2026-09','2026-10'], array[]::text[]),  -- Bauer
  ('054da6fe-69b1-5a1d-a033-495a994de5a8'::uuid, array[]::text[], array['2026-09','2026-10']),            -- Petrović
  ('875f2dca-b19c-5180-aec3-16545b423056'::uuid, array['2026-10'], array[]::text[]),                      -- Huber
  ('59fb016c-46ec-57e3-be6c-336db5177338'::uuid, array['2026-09','2026-10'], array[]::text[])             -- Meier
) as r(id, alles_offen, strom_internet_offen) on r.id = m.id
cross join generate_series('2026-07-01'::date, '2026-10-01'::date, interval '1 month') mo
cross join lateral (values
  ('kaltmiete', 'Kaltmiete', m.kaltmiete),
  ('nebenkosten', 'Nebenkostenvorauszahlung', m.nebenkosten_vz),
  ('strom', 'Strompauschale', m.strom_pauschale),
  ('internet', 'Internetpauschale', m.internet_pauschale)
) a(art, bez, betrag)
cross join lateral (select coalesce(
    to_char(mo, 'YYYY-MM') = any(r.alles_offen)
    or (a.art in ('strom', 'internet') and to_char(mo, 'YYYY-MM') = any(r.strom_internet_offen)),
  false) as offen) u
where a.betrag > 0;

insert into public.vorgaenge (mieter_id, typ, titel, summe, details, erstellt_von, erstellt_am) values
('4af207c4-9544-5250-902a-be08d7c488da', 'mahnung_1', '1. Mahnung (Aug–Sep 2026)', 1300.00, '{"hinweis":"Testeintrag"}', null, '2026-09-18 10:15:00+02'),
('4af207c4-9544-5250-902a-be08d7c488da', 'nachweis_jobcenter', 'Nachweis an Jobcenter Musterstadt', 1300.00, '{"hinweis":"Testeintrag"}', null, '2026-09-18 10:20:00+02'),
('054da6fe-69b1-5a1d-a033-495a994de5a8', 'mahnung_1', '1. Mahnung Strom/Internet (Sep 2026)', 70.00, '{"hinweis":"Testeintrag"}', null, '2026-09-25 09:00:00+02');
insert into public.vorlagen (schluessel, name, beschreibung, standard_datei) values
('mahnung_1', '1. Mahnung', 'Freundliche Zahlungserinnerung mit Aufstellung der offenen Posten und Frist von 14 Tagen.', 'vorlagen/mahnung_1.docx'),
('mahnung_2', '2. Mahnung', 'Deutlichere Mahnung mit Frist von 7 Tagen und Hinweis auf weitere Schritte.', 'vorlagen/mahnung_2.docx'),
('nachweis_jobcenter', 'Nachweis an Kostenträger', 'Mitteilung an Jobcenter/Sozialamt über offene Beträge (inkl. Strom/Internet) mit Bitte um Prüfung einer Direktzahlung.', 'vorlagen/nachweis_jobcenter.docx')
on conflict (schluessel) do update set name = excluded.name, beschreibung = excluded.beschreibung, standard_datei = excluded.standard_datei;
commit;
