-- Bearbeitbare Ordnerliste für die Dokumentenablage (für alle Häuser gleich).
-- Unterordner werden mit „/“ geschrieben, z. B. „Versorger/Strom“. „Sonstiges“ gibt es immer.
create table public.dokument_ordner (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique check (length(btrim(name)) between 1 and 80),
  reihenfolge integer not null default 0,
  erstellt_am timestamptz not null default now()
);

alter table public.dokument_ordner enable row level security;
create policy "dokument_ordner_mitglieder" on public.dokument_ordner for all to authenticated
  using ((select privat.ist_mitglied())) with check ((select privat.ist_mitglied()));
revoke all on public.dokument_ordner from anon, authenticated;
grant select, insert, update, delete on public.dokument_ordner to authenticated;
grant select on public.dokument_ordner to service_role;

insert into public.dokument_ordner (name, reihenfolge) values
  ('Rechnungen', 10), ('Verträge', 20), ('Versorger', 30), ('Versicherungen', 40),
  ('Behörden & Steuern', 50), ('Handwerker & Angebote', 60), ('Mietverhältnisse', 70), ('Sonstiges', 999);
