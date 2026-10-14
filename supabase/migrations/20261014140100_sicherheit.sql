-- ROK Verwaltung – Zugriffsschutz
-- Prinzip: Eingeloggt sein reicht NICHT. Zugriff hat nur, wer in der Tabelle
-- public.mitglieder steht. Neue Mitglieder werden per SQL im Supabase-Dashboard
-- eingetragen (siehe README).

-- Hilfsfunktion in einem Schema, das NICHT über die API erreichbar ist
create schema if not exists privat;
revoke all on schema privat from public;
grant usage on schema privat to authenticated;

create or replace function privat.ist_mitglied()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.mitglieder where user_id = (select auth.uid())
  );
$$;
revoke all on function privat.ist_mitglied() from public, anon;
grant execute on function privat.ist_mitglied() to authenticated;

-- ---------------------------------------------------------------------------
-- Rechte: anon bekommt nichts, authenticated nur das Nötige
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;

grant select, insert, update, delete on
  public.objekte,
  public.wohnungen,
  public.kostentraeger,
  public.mieter,
  public.forderungen,
  public.vorgaenge,
  public.vorlagen
to authenticated;
grant select, update on public.vermieter_profil to authenticated;
grant select on public.mitglieder to authenticated;
grant select on public.mieter_uebersicht to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.mitglieder       enable row level security;
alter table public.vermieter_profil enable row level security;
alter table public.objekte          enable row level security;
alter table public.wohnungen        enable row level security;
alter table public.kostentraeger    enable row level security;
alter table public.mieter           enable row level security;
alter table public.forderungen      enable row level security;
alter table public.vorgaenge        enable row level security;
alter table public.vorlagen         enable row level security;

-- Mitglieder sehen nur ihren eigenen Eintrag (zum Prüfen der Freischaltung)
create policy "mitglieder_eigener_eintrag" on public.mitglieder
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "profil_lesen" on public.vermieter_profil
  for select to authenticated using ((select privat.ist_mitglied()));
create policy "profil_aendern" on public.vermieter_profil
  for update to authenticated
  using ((select privat.ist_mitglied())) with check ((select privat.ist_mitglied()));

create policy "objekte_mitglieder" on public.objekte
  for all to authenticated
  using ((select privat.ist_mitglied())) with check ((select privat.ist_mitglied()));
create policy "wohnungen_mitglieder" on public.wohnungen
  for all to authenticated
  using ((select privat.ist_mitglied())) with check ((select privat.ist_mitglied()));
create policy "kostentraeger_mitglieder" on public.kostentraeger
  for all to authenticated
  using ((select privat.ist_mitglied())) with check ((select privat.ist_mitglied()));
create policy "mieter_mitglieder" on public.mieter
  for all to authenticated
  using ((select privat.ist_mitglied())) with check ((select privat.ist_mitglied()));
create policy "forderungen_mitglieder" on public.forderungen
  for all to authenticated
  using ((select privat.ist_mitglied())) with check ((select privat.ist_mitglied()));
create policy "vorgaenge_mitglieder" on public.vorgaenge
  for all to authenticated
  using ((select privat.ist_mitglied())) with check ((select privat.ist_mitglied()));
create policy "vorlagen_mitglieder" on public.vorlagen
  for all to authenticated
  using ((select privat.ist_mitglied())) with check ((select privat.ist_mitglied()));

-- ---------------------------------------------------------------------------
-- Privater Speicher für eigene Briefvorlagen (.docx)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'vorlagen', 'vorlagen', false, 5242880,
  array['application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
on conflict (id) do nothing;

create policy "vorlagen_bucket_lesen" on storage.objects
  for select to authenticated
  using (bucket_id = 'vorlagen' and (select privat.ist_mitglied()));
create policy "vorlagen_bucket_hochladen" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'vorlagen' and (select privat.ist_mitglied()));
create policy "vorlagen_bucket_ersetzen" on storage.objects
  for update to authenticated
  using (bucket_id = 'vorlagen' and (select privat.ist_mitglied()))
  with check (bucket_id = 'vorlagen' and (select privat.ist_mitglied()));
create policy "vorlagen_bucket_loeschen" on storage.objects
  for delete to authenticated
  using (bucket_id = 'vorlagen' and (select privat.ist_mitglied()));
