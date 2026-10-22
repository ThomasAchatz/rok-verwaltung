-- Rundschreiben und wählbarer Absender
-- 1. Eine Nachricht kann ein ganzes Haus betreffen (statt einer Mietpartei)
-- 2. Ein Schreiben kann an alle/mehrere Mietparteien eines Hauses gehen (antworten.objekt_id = Rundschreiben)
-- 3. Weitere Absender (z. B. „Privat“) mit eigener Signatur und Anschrift; das gewählte steht am Schreiben

alter table public.nachrichten add column if not exists objekt_id uuid references public.objekte(id) on delete set null;
alter table public.antworten add column if not exists objekt_id uuid references public.objekte(id) on delete set null;
alter table public.antworten add column if not exists absender jsonb;
alter table public.vermieter_profil add column if not exists absender jsonb not null default '[]'::jsonb;

create index if not exists nachrichten_objekt_idx on public.nachrichten (objekt_id) where objekt_id is not null;
create index if not exists antworten_objekt_idx on public.antworten (objekt_id) where objekt_id is not null;

comment on column public.nachrichten.objekt_id is 'Betrifft das ganze Haus (wenn keine einzelne Mietpartei)';
comment on column public.antworten.objekt_id is 'Rundschreiben an Mietparteien dieses Hauses';
comment on column public.antworten.absender is 'Gewählter Absender (Kopie aus vermieter_profil.absender), null = Standard (Firma)';
comment on column public.vermieter_profil.absender is 'Weitere Absender: [{ id, bezeichnung, name, strasse, plz, ort, telefon, email, signatur }]';
