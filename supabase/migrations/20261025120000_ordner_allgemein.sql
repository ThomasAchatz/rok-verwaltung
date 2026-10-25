-- Ordner unter „Allgemein“ (Unterlagen ohne Haus): eigene, freie Liste, getrennt von der Hausstruktur.
-- bereich 'haus' = Ordner, die es in jedem Haus gleich gibt; 'allgemein' = frei angelegte Ordner ohne Vorgabe.
alter table public.dokument_ordner
  add column bereich text not null default 'haus' check (bereich in ('haus', 'allgemein'));
alter table public.dokument_ordner drop constraint if exists dokument_ordner_name_key;
alter table public.dokument_ordner add constraint dokument_ordner_bereich_name_key unique (bereich, name);
-- Unter „Allgemein“ gibt es keine automatischen Unterordner (je Jahr / je Wohnung)
alter table public.dokument_ordner
  add constraint dokument_ordner_allgemein_ohne_automatik check (bereich = 'haus' or automatik is null);

-- Nichts geht verloren: Ordner, in denen unter „Allgemein“ schon Dateien liegen, bleiben dort als eigene Ordner.
-- Alle anderen Hausordner tauchen unter „Allgemein“ nicht mehr auf (dort startet die Liste leer).
insert into public.dokument_ordner (bereich, name, reihenfolge)
select 'allgemein', o.name, o.reihenfolge
from public.dokument_ordner o
where o.bereich = 'haus' and o.name <> 'Sonstiges'
  and exists (
    select 1 from public.dokumente d
    where d.objekt_id is null and (d.ordner = o.name or d.ordner like replace(replace(o.name, '%', '\%'), '_', '\_') || '/%')
  )
on conflict do nothing;
