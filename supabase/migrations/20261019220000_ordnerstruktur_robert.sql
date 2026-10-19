-- Ordnerstruktur und Dateinamen nach Roberts Vorgabe (je Haus gleich aufgebaut).
-- Automatische Unterordner: „jahr“ = Jahr des Dokuments, „wohnung“ = Wohnung + Nachname der Mietpartei.
alter table public.dokument_ordner
  add column automatik text check (automatik in ('jahr', 'wohnung'));

-- Orts-Kürzel je Haus für den Dateinamen (z. B. „SR“)
alter table public.objekte
  add column kuerzel text check (kuerzel is null or length(btrim(kuerzel)) between 1 and 10);

-- Details für den Dateinamen (z. B. „WHG 08_Meier“ oder „Sanitär Gruber_102,89“)
alter table public.dokumente
  add column details text check (details is null or length(details) <= 120);

-- Neue Standard-Ordner (keine Personendaten: die Wohnungsordner entstehen automatisch)
delete from public.dokument_ordner where name <> 'Sonstiges';
insert into public.dokument_ordner (name, reihenfolge, automatik) values
  ('01_Kalkulation & Ankauf', 100, null),
  ('02_Objektunterlagen', 200, null),
  ('02_Objektunterlagen/Fotos', 201, null),
  ('02_Objektunterlagen/Grundbuch', 202, null),
  ('02_Objektunterlagen/Gutachten', 203, null),
  ('02_Objektunterlagen/Heizung', 204, null),
  ('02_Objektunterlagen/Kaufnebenkosten', 205, null),
  ('02_Objektunterlagen/Kaufvertrag', 206, null),
  ('02_Objektunterlagen/Lagepläne', 207, null),
  ('02_Objektunterlagen/Paketbox', 208, null),
  ('02_Objektunterlagen/PV-Anlage', 209, null),
  ('02_Objektunterlagen/Wohnflächenberechnung', 210, null),
  ('02_Objektunterlagen/Zähler', 211, null),
  ('03_Vermietung', 300, 'wohnung'),
  ('03_Vermietung/00_Archiv', 301, null),
  ('03_Vermietung/Auszüge', 302, null),
  ('03_Vermietung/Garage_Lager', 303, null),
  ('03_Vermietung/NK-Anpassung', 304, null),
  ('03_Vermietung/Zigarettenautomat', 305, null),
  ('04_Betriebskosten', 400, 'jahr'),
  ('05_Instandhaltung', 500, 'jahr'),
  ('05_Instandhaltung/Angebote', 501, null),
  ('06_Versicherungen', 600, null),
  ('07_Verträge', 700, null),
  ('07_Verträge/Internet', 701, null),
  ('07_Verträge/Ista', 702, null),
  ('07_Verträge/Mieterstrom', 703, null),
  ('07_Verträge/Strom', 704, null),
  ('07_Verträge/ZAW', 705, null),
  ('08_Finanzen & Steuern', 800, null),
  ('08_Finanzen & Steuern/Darlehensverträge', 801, null),
  ('08_Finanzen & Steuern/Ersatzsicherheit', 802, null),
  ('08_Finanzen & Steuern/Finanzierungsunterlagen', 803, null),
  ('08_Finanzen & Steuern/Grundsteuer', 804, null),
  ('08_Finanzen & Steuern/Mietkonto', 805, null),
  ('08_Finanzen & Steuern/Tilgungsersatz', 806, null),
  ('09_Archiv', 900, null)
on conflict (name) do nothing;
update public.dokument_ordner set reihenfolge = 9999 where name = 'Sonstiges';

-- Bisherige Dokumente in die neue Struktur verschieben
update public.dokumente set ordner = case ordner
    when 'Rechnungen' then '04_Betriebskosten'
    when 'Verträge' then '07_Verträge'
    when 'Versorger' then '07_Verträge'
    when 'Versicherungen' then '06_Versicherungen'
    when 'Behörden & Steuern' then '08_Finanzen & Steuern'
    when 'Handwerker & Angebote' then '05_Instandhaltung/Angebote'
    when 'Mietverhältnisse' then '03_Vermietung'
    else ordner end
  where ordner in ('Rechnungen', 'Verträge', 'Versorger', 'Versicherungen', 'Behörden & Steuern', 'Handwerker & Angebote', 'Mietverhältnisse');
update public.dokumente set ordner = 'Sonstiges'
  where ordner not in (select name from public.dokument_ordner)
    and split_part(ordner, '/', 1) not in (select name from public.dokument_ordner);
