-- Neues Schreiben an Kontakte und Kostenträger (Roberts Suchfeld „An wen?“)
alter table public.antworten
  add column if not exists kontakt_id uuid references public.kontakte (id) on delete set null,
  add column if not exists kostentraeger_id uuid references public.kostentraeger (id) on delete set null;
create index if not exists antworten_kontakt_idx on public.antworten (kontakt_id);
create index if not exists antworten_kostentraeger_idx on public.antworten (kostentraeger_id);
