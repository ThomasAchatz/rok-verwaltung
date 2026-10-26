-- Testdaten: je Haus ein (erfundener) Hausmeister als Handwerker mit Gewerk „Hausmeister“. Mehrfach ausführbar.
insert into public.dienstleister (name, gewerk, telefon, email, objekt_id, notiz, aktiv)
select v.name, 'Hausmeister', v.telefon, v.email, o.id, 'Testdaten', true
from (values
  ('Königsweg 1', 'Hausservice Lindner', '0151 1000101', 'hausmeister.lindner@example.org'),
  ('Ottostraße 15', 'Hausmeister Brandstätter', '0151 1000202', 'hausmeister.brandstaetter@example.org')
) as v(strasse, name, telefon, email)
join public.objekte o on o.strasse = v.strasse
where not exists (select 1 from public.dienstleister d where d.name = v.name and d.objekt_id = o.id);
