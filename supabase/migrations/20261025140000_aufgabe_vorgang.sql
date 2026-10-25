-- Aus einer Notiz / einem To-do einen Vorgang starten: die Notiz merkt sich ihren Vorgang.
alter table public.aufgaben
  add column thema_id uuid references public.themen(id) on delete set null;
create index aufgaben_thema_idx on public.aufgaben (thema_id) where thema_id is not null;
