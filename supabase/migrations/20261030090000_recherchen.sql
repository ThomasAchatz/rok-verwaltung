-- Recherchen aus dem Internet (Standort-Check): Eingabe und Ergebnis je Abschnitt bleiben gespeichert,
-- damit ein Bericht später ohne neue Suche (und ohne neue Kosten) wieder geöffnet werden kann.
-- Ins Internet geht nur die Eingabe (Ort, Adresse, Eckdaten), nie Daten aus der App.

create table public.recherchen (
  id              uuid primary key default gen_random_uuid(),
  art             text not null default 'standort' check (art in ('standort')),
  titel           text not null,
  eingabe         jsonb not null default '{}'::jsonb,   -- { ort, adresse, objektart, einheiten, wohnflaeche, baujahr, kaufpreis, ist_miete, gewerke }
  ergebnis        jsonb not null default '{}'::jsonb,   -- { markt: {…}, recht: {…}, handwerker: {…}, partner: {…} } je mit quellen
  suchen          integer not null default 0,            -- Zahl der Websuchen (Kosten)
  dokument_id     uuid references public.dokumente (id) on delete set null,   -- abgelegter Bericht (PDF)
  erstellt_am     timestamptz not null default now(),
  aktualisiert_am timestamptz not null default now(),
  erstellt_von    uuid default auth.uid() references auth.users (id) on delete set null
);
create index recherchen_erstellt_idx on public.recherchen (erstellt_am desc);
create index recherchen_dokument_idx on public.recherchen (dokument_id);
create index recherchen_erstellt_von_idx on public.recherchen (erstellt_von);
create trigger recherchen_aktualisiert before update on public.recherchen
  for each row execute function public.setze_aktualisiert_am();

alter table public.recherchen enable row level security;
create policy "recherchen_mitglieder" on public.recherchen for all to authenticated
  using ((select privat.ist_mitglied())) with check ((select privat.ist_mitglied()));
revoke all on public.recherchen from anon, authenticated;
grant select, insert, update, delete on public.recherchen to authenticated;
