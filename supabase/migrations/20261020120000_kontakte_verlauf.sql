-- Kontakte (Makler, Bank, Behörden, Steuerberater …; Handwerker bleiben in „dienstleister“)
-- und ein Verlauf mit datierten Gesprächsnotizen je Kontakt oder Mietpartei („Mini-CRM“).
-- Geburtstage: Tag/Monat (Jahr optional) am Kontakt; die App erinnert jedes Jahr daran.

create table public.kontakte (
  id                  uuid primary key default gen_random_uuid(),
  vorname             text,
  nachname            text,
  firma               text,
  rolle               text,                     -- z. B. Makler, Bank, Behörde, Steuerberater, Notar
  telefon             text,
  email               text,
  adresse             text,
  geburtstag_tag      smallint check (geburtstag_tag between 1 and 31),
  geburtstag_monat    smallint check (geburtstag_monat between 1 and 12),
  geburtsjahr         smallint check (geburtsjahr between 1900 and 2100),
  geburtstag_erledigt smallint,                 -- Jahr, in dem die Erinnerung abgehakt wurde
  notiz               text,                     -- feste Infos, z. B. „Hund Bello, Tochter Lisa“
  erstellt_am         timestamptz not null default now(),
  aktualisiert_am     timestamptz not null default now(),
  erstellt_von        uuid default auth.uid() references auth.users (id) on delete set null,
  constraint kontakte_name_noetig check (coalesce(btrim(nachname), '') <> '' or coalesce(btrim(firma), '') <> ''),
  constraint kontakte_geburtstag_ganz check ((geburtstag_tag is null) = (geburtstag_monat is null))
);
create index kontakte_nachname_idx on public.kontakte (nachname);
create index kontakte_erstellt_von_idx on public.kontakte (erstellt_von);
create trigger kontakte_aktualisiert before update on public.kontakte
  for each row execute function public.setze_aktualisiert_am();

create table public.verlauf (
  id           uuid primary key default gen_random_uuid(),
  datum        date not null default current_date,
  art          text not null default 'notiz' check (art in ('telefonat', 'treffen', 'email', 'notiz')),
  text         text not null check (length(btrim(text)) between 1 and 8000),
  kontakt_id   uuid references public.kontakte (id) on delete cascade,
  mieter_id    uuid references public.mieter (id) on delete cascade,
  erstellt_am  timestamptz not null default now(),
  erstellt_von uuid default auth.uid() references auth.users (id) on delete set null,
  constraint verlauf_ziel check (kontakt_id is not null or mieter_id is not null)
);
create index verlauf_kontakt_idx on public.verlauf (kontakt_id, datum desc);
create index verlauf_mieter_idx on public.verlauf (mieter_id, datum desc);
create index verlauf_erstellt_von_idx on public.verlauf (erstellt_von);

-- To-dos können zu einem Kontakt gehören; abgelegte PDFs zu einem Verlaufseintrag
alter table public.aufgaben  add column if not exists kontakt_id uuid references public.kontakte (id) on delete set null;
create index if not exists aufgaben_kontakt_idx on public.aufgaben (kontakt_id);
alter table public.dokumente add column if not exists verlauf_id uuid references public.verlauf (id) on delete set null;
create index if not exists dokumente_verlauf_idx on public.dokumente (verlauf_id);

-- Rechte: nur freigeschaltete Mitglieder
alter table public.kontakte enable row level security;
alter table public.verlauf  enable row level security;
create policy "kontakte_mitglieder" on public.kontakte for all to authenticated
  using ((select privat.ist_mitglied())) with check ((select privat.ist_mitglied()));
create policy "verlauf_mitglieder" on public.verlauf for all to authenticated
  using ((select privat.ist_mitglied())) with check ((select privat.ist_mitglied()));
revoke all on public.kontakte, public.verlauf from anon, authenticated;
grant select, insert, update, delete on public.kontakte, public.verlauf to authenticated;
