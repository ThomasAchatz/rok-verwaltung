-- Verlauf: Aufträge an Handwerker als eigene Art (sonst schlägt der Eintrag nach dem Versand fehl)
alter table public.vorgaenge drop constraint if exists vorgaenge_typ_check;
alter table public.vorgaenge add constraint vorgaenge_typ_check
  check (typ in ('mahnung_1', 'mahnung_2', 'nachweis_jobcenter', 'antwort', 'auftrag', 'sonstiges'));
