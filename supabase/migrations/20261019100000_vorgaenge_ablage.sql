-- Roberts Feedback: To-do-Liste mit Fristen und Wiedervorlagen, Handwerker, Dokumentenablage,
-- Wissen in Ordnern, Daten für die Prüfung einer Mieterhöhung.

-- ---------------------------------------------------------------------------
-- Fristen an Nachrichten (KI schlägt vor, Robert bestätigt)
-- ---------------------------------------------------------------------------
alter table public.nachrichten
  add column if not exists ki_frist date,
  add column if not exists ki_frist_zitat text,
  add column if not exists frist date,
  add column if not exists frist_bestaetigt boolean not null default false;

-- ---------------------------------------------------------------------------
-- Aufgaben: Kurz-Notizen, Wiedervorlagen (erscheinen „vorlauf_tage“ vor dem Stichtag)
-- ---------------------------------------------------------------------------
create table public.aufgaben (
  id              uuid primary key default gen_random_uuid(),
  titel           text not null,
  notiz           text,
  antwort         text,                         -- Ergebnis, z. B. Prüfung durch die KI
  faellig_am      date,                         -- Stichtag / Wiedervorlage
  vorlauf_tage    integer not null default 7 check (vorlauf_tage between 0 and 60),
  status          text not null default 'offen' check (status in ('offen', 'erledigt')),
  objekt_id       uuid references public.objekte (id) on delete set null,
  mieter_id       uuid references public.mieter (id) on delete set null,
  nachricht_id    uuid references public.nachrichten (id) on delete set null,
  erstellt_am     timestamptz not null default now(),
  aktualisiert_am timestamptz not null default now(),
  erledigt_am     timestamptz,
  erstellt_von    uuid default auth.uid() references auth.users (id) on delete set null
);
create index aufgaben_status_idx on public.aufgaben (status, faellig_am);
create index aufgaben_objekt_idx on public.aufgaben (objekt_id);
create index aufgaben_mieter_idx on public.aufgaben (mieter_id);
create index aufgaben_nachricht_idx on public.aufgaben (nachricht_id);
create index aufgaben_erstellt_von_idx on public.aufgaben (erstellt_von);
create trigger aufgaben_aktualisiert before update on public.aufgaben
  for each row execute function public.setze_aktualisiert_am();

-- ---------------------------------------------------------------------------
-- Handwerker und Dienstleister (objekt_id leer = für alle Häuser)
-- ---------------------------------------------------------------------------
create table public.dienstleister (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  gewerk          text,
  telefon         text,
  email           text,
  objekt_id       uuid references public.objekte (id) on delete cascade,
  notiz           text,
  aktiv           boolean not null default true,
  erstellt_am     timestamptz not null default now(),
  aktualisiert_am timestamptz not null default now()
);
create index dienstleister_objekt_idx on public.dienstleister (objekt_id);
create trigger dienstleister_aktualisiert before update on public.dienstleister
  for each row execute function public.setze_aktualisiert_am();

-- ---------------------------------------------------------------------------
-- Wissen in Ordnern
-- ---------------------------------------------------------------------------
alter table public.wissen add column if not exists ordner text not null default 'Sonstiges';

-- ---------------------------------------------------------------------------
-- Dokumentenablage (objekt_id leer = „Allgemein“)
-- ---------------------------------------------------------------------------
create table public.dokumente (
  id              uuid primary key default gen_random_uuid(),
  objekt_id       uuid references public.objekte (id) on delete set null,
  mieter_id       uuid references public.mieter (id) on delete set null,
  nachricht_id    uuid references public.nachrichten (id) on delete set null,
  ordner          text not null default 'Sonstiges',
  art             text,                          -- Rechnung, Vertrag, Bescheid …
  absender        text,
  datum           date,
  titel           text not null,                 -- einheitlicher Name: Datum_Objekt_Absender_Art
  zusammenfassung text,
  pfad            text not null unique,          -- im Bucket „dokumente“
  typ             text,
  groesse         integer,
  erstellt_am     timestamptz not null default now(),
  erstellt_von    uuid default auth.uid() references auth.users (id) on delete set null
);
create index dokumente_objekt_idx on public.dokumente (objekt_id, ordner);
create index dokumente_mieter_idx on public.dokumente (mieter_id);
create index dokumente_nachricht_idx on public.dokumente (nachricht_id);
create index dokumente_erstellt_von_idx on public.dokumente (erstellt_von);

-- ---------------------------------------------------------------------------
-- Antworten: auch Aufträge an Handwerker, mit Anhängen aus dem Speicher
-- ---------------------------------------------------------------------------
alter table public.antworten
  add column if not exists art text not null default 'antwort' check (art in ('antwort', 'auftrag')),
  add column if not exists dienstleister_id uuid references public.dienstleister (id) on delete set null,
  add column if not exists anhaenge jsonb not null default '[]'::jsonb;
create index if not exists antworten_dienstleister_idx on public.antworten (dienstleister_id);

-- ---------------------------------------------------------------------------
-- Mieterhöhung: Angaben je Mietpartei und Haus (Wohnfläche steht schon bei der Wohnung)
-- ---------------------------------------------------------------------------
alter table public.mieter
  add column if not exists mietart text not null default 'normal' check (mietart in ('normal', 'staffel', 'index')),
  add column if not exists vergleichsmiete_qm numeric(6, 2),
  add column if not exists letzte_erhoehung_am date,
  add column if not exists kaltmiete_vorher numeric(10, 2);
alter table public.objekte
  add column if not exists kappungsgrenze numeric(4, 1) not null default 20 check (kappungsgrenze in (15, 20));

-- ---------------------------------------------------------------------------
-- Rechte und RLS (nur freigeschaltete Mitglieder)
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.aufgaben, public.dienstleister, public.dokumente to authenticated;
revoke all on public.aufgaben, public.dienstleister, public.dokumente from anon;
alter table public.aufgaben      enable row level security;
alter table public.dienstleister enable row level security;
alter table public.dokumente     enable row level security;
create policy "aufgaben_mitglieder" on public.aufgaben for all to authenticated
  using ((select privat.ist_mitglied())) with check ((select privat.ist_mitglied()));
create policy "dienstleister_mitglieder" on public.dienstleister for all to authenticated
  using ((select privat.ist_mitglied())) with check ((select privat.ist_mitglied()));
create policy "dokumente_mitglieder" on public.dokumente for all to authenticated
  using ((select privat.ist_mitglied())) with check ((select privat.ist_mitglied()));

-- Der Posteingang (Server) legt Anhänge ab und vermerkt sie an der Nachricht
grant select on public.objekte, public.dienstleister to service_role;

-- ---------------------------------------------------------------------------
-- Speicher für Dokumente (privat, nur Bilder und PDF)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dokumente', 'dokumente', false, 15728640, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;
update storage.buckets set file_size_limit = 15728640 where id = 'eingang';

create policy "dokumente_bucket_lesen" on storage.objects
  for select to authenticated using (bucket_id = 'dokumente' and (select privat.ist_mitglied()));
create policy "dokumente_bucket_ablegen" on storage.objects
  for insert to authenticated with check (bucket_id = 'dokumente' and (select privat.ist_mitglied()));
create policy "dokumente_bucket_loeschen" on storage.objects
  for delete to authenticated using (bucket_id = 'dokumente' and (select privat.ist_mitglied()));
