-- Postfach, KI-Antworten und Wissensbasis
-- nachrichten: eingehende Schreiben (E-Mail über den Posteingang, fotografierte Briefe, Notizen)
-- antworten:   Entwürfe und gesendete Antworten (immer erst Entwurf, Versand nur per Klick)
-- wissen:      Hausordnung, Abläufe, Ansprechpartner – die KI nutzt das für ihre Antworten
-- postfach:    Einstellungen des Posteingangs (Adresse, Zugangsschlüssel für den Webhook)

-- ---------------------------------------------------------------------------
-- Profil: Angaben für KI und E-Mail
-- ---------------------------------------------------------------------------
alter table public.vermieter_profil
  add column if not exists ki_tonfall text,
  add column if not exists email_signatur text,
  add column if not exists antwort_email text;

-- ---------------------------------------------------------------------------
-- Eingehende Nachrichten
-- ---------------------------------------------------------------------------
create table public.nachrichten (
  id                 uuid primary key default gen_random_uuid(),
  eingang_am         timestamptz not null default now(),
  quelle             text not null default 'email' check (quelle in ('email', 'brief', 'notiz')),
  absender_email     text,
  absender_name      text,
  betreff            text,
  text               text not null default '',
  mieter_id          uuid references public.mieter (id) on delete set null,
  zuordnung          text check (zuordnung in ('email', 'ki', 'manuell')),
  status             text not null default 'neu' check (status in ('neu', 'offen', 'beantwortet', 'erledigt')),
  ki_kategorie       text,
  ki_dringlichkeit   text check (ki_dringlichkeit in ('niedrig', 'normal', 'hoch')),
  ki_zusammenfassung text,
  ki_vorschlag       text,
  ki_am              timestamptz,
  extern_id          text unique,          -- ID beim E-Mail-Dienst (verhindert doppelte Einträge)
  extern_message_id  text,                 -- Message-ID der E-Mail (für Antworten im selben Verlauf)
  anhaenge           jsonb not null default '[]'::jsonb,
  erstellt_von       uuid default auth.uid() references auth.users (id) on delete set null
);
create index nachrichten_status_idx on public.nachrichten (status, eingang_am desc);
create index nachrichten_mieter_idx on public.nachrichten (mieter_id, eingang_am desc);

-- ---------------------------------------------------------------------------
-- Antworten (Entwürfe und gesendete)
-- ---------------------------------------------------------------------------
create table public.antworten (
  id               uuid primary key default gen_random_uuid(),
  nachricht_id     uuid references public.nachrichten (id) on delete set null,
  mieter_id        uuid references public.mieter (id) on delete set null,
  empfaenger_email text,
  empfaenger_name  text,
  betreff          text not null default '',
  text             text not null default '',   -- Anrede + Inhalt, ohne Grußformel und Signatur
  anweisung        text,                        -- was Robert der KI gesagt/diktiert hat
  status           text not null default 'entwurf' check (status in ('entwurf', 'gesendet', 'als_brief')),
  gesendet_am      timestamptz,
  versand_id       text,
  ki_modell        text,
  erstellt_am      timestamptz not null default now(),
  aktualisiert_am  timestamptz not null default now(),
  erstellt_von     uuid default auth.uid() references auth.users (id) on delete set null
);
create index antworten_nachricht_idx on public.antworten (nachricht_id, erstellt_am desc);
create index antworten_mieter_idx on public.antworten (mieter_id, erstellt_am desc);
create index antworten_erstellt_von_idx on public.antworten (erstellt_von);
create index nachrichten_erstellt_von_idx on public.nachrichten (erstellt_von);
create index vorgaenge_erstellt_von_idx on public.vorgaenge (erstellt_von);

create trigger antworten_aktualisiert before update on public.antworten
  for each row execute function public.setze_aktualisiert_am();

-- ---------------------------------------------------------------------------
-- Wissensbasis
-- ---------------------------------------------------------------------------
create table public.wissen (
  id              uuid primary key default gen_random_uuid(),
  titel           text not null,
  inhalt          text not null default '',
  objekt_id       uuid references public.objekte (id) on delete cascade,  -- leer = gilt für alle Objekte
  aktiv           boolean not null default true,
  erstellt_am     timestamptz not null default now(),
  aktualisiert_am timestamptz not null default now()
);
create index wissen_objekt_idx on public.wissen (objekt_id);
create trigger wissen_aktualisiert before update on public.wissen
  for each row execute function public.setze_aktualisiert_am();

-- ---------------------------------------------------------------------------
-- Postfach-Einstellungen (eine Zeile)
-- ---------------------------------------------------------------------------
create table public.postfach (
  id              smallint primary key default 1 check (id = 1),
  adresse         text,                                                   -- z. B. xyz@abc.resend.app
  token           text not null default encode(extensions.gen_random_bytes(24), 'hex'),
  aktualisiert_am timestamptz not null default now()
);
insert into public.postfach (id) values (1) on conflict (id) do nothing;
create trigger postfach_aktualisiert before update on public.postfach
  for each row execute function public.setze_aktualisiert_am();

-- ---------------------------------------------------------------------------
-- Rechte und Row Level Security (nur freigeschaltete Mitglieder)
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.nachrichten, public.antworten, public.wissen to authenticated;
grant select, update on public.postfach to authenticated;

alter table public.nachrichten enable row level security;
alter table public.antworten   enable row level security;
alter table public.wissen      enable row level security;
alter table public.postfach    enable row level security;

create policy "nachrichten_mitglieder" on public.nachrichten
  for all to authenticated
  using ((select privat.ist_mitglied())) with check ((select privat.ist_mitglied()));
create policy "antworten_mitglieder" on public.antworten
  for all to authenticated
  using ((select privat.ist_mitglied())) with check ((select privat.ist_mitglied()));
create policy "wissen_mitglieder" on public.wissen
  for all to authenticated
  using ((select privat.ist_mitglied())) with check ((select privat.ist_mitglied()));
create policy "postfach_lesen" on public.postfach
  for select to authenticated using ((select privat.ist_mitglied()));
create policy "postfach_aendern" on public.postfach
  for update to authenticated
  using ((select privat.ist_mitglied())) with check ((select privat.ist_mitglied()));

-- Token neu erzeugen (z. B. wenn die Webhook-Adresse in falsche Hände geraten ist)
create or replace function public.postfach_token_erneuern()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  neu text;
begin
  if not privat.ist_mitglied() then
    raise exception 'keine Berechtigung';
  end if;
  neu := encode(extensions.gen_random_bytes(24), 'hex');
  update public.postfach set token = neu where id = 1;
  return neu;
end;
$$;
revoke all on function public.postfach_token_erneuern() from public, anon;
grant execute on function public.postfach_token_erneuern() to authenticated;

-- ---------------------------------------------------------------------------
-- Ablage für fotografierte Briefe
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('eingang', 'eingang', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

create policy "eingang_bucket_lesen" on storage.objects
  for select to authenticated using (bucket_id = 'eingang' and (select privat.ist_mitglied()));
create policy "eingang_bucket_ablegen" on storage.objects
  for insert to authenticated with check (bucket_id = 'eingang' and (select privat.ist_mitglied()));
create policy "eingang_bucket_loeschen" on storage.objects
  for delete to authenticated using (bucket_id = 'eingang' and (select privat.ist_mitglied()));
