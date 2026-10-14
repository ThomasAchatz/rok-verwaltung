-- ROK Verwaltung – Grundschema
-- Alle Tabellen liegen im Schema public und sind nur für freigeschaltete
-- Mitglieder (Tabelle mitglieder) erreichbar. Siehe Migration *_sicherheit.sql.

-- ---------------------------------------------------------------------------
-- Mitglieder (Allowlist): nur diese Nutzer dürfen Daten sehen
-- ---------------------------------------------------------------------------
create table public.mitglieder (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  rolle       text not null default 'verwalter' check (rolle in ('verwalter', 'lesend')),
  erstellt_am timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Vermieter-Profil (Briefkopf, genau eine Zeile)
-- ---------------------------------------------------------------------------
create table public.vermieter_profil (
  id            smallint primary key default 1 check (id = 1),
  firma         text not null,
  inhaber       text,
  strasse       text,
  plz           text,
  ort           text,
  telefon       text,
  email         text,
  web           text,
  steuernummer  text,
  aktualisiert_am timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Objekte und Wohnungen
-- ---------------------------------------------------------------------------
create table public.objekte (
  id          uuid primary key default gen_random_uuid(),
  bezeichnung text not null,
  strasse     text not null,
  plz         text not null,
  ort         text not null,
  notiz       text,
  erstellt_am timestamptz not null default now()
);

create table public.wohnungen (
  id          uuid primary key default gen_random_uuid(),
  objekt_id   uuid not null references public.objekte (id) on delete cascade,
  bezeichnung text not null,          -- z. B. "EG links", "Whg. 3"
  flaeche_qm  numeric(6,2),
  zimmer      numeric(3,1),
  erstellt_am timestamptz not null default now()
);
create index wohnungen_objekt_idx on public.wohnungen (objekt_id);

-- ---------------------------------------------------------------------------
-- Kostenträger (Jobcenter, Sozialamt, ...)
-- ---------------------------------------------------------------------------
create table public.kostentraeger (
  id              uuid primary key default gen_random_uuid(),
  art             text not null default 'jobcenter' check (art in ('jobcenter', 'sozialamt', 'sonstige')),
  name            text not null,
  abteilung       text,
  strasse         text,
  plz             text,
  ort             text,
  telefon         text,
  email           text,
  erstellt_am     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Mieter (inkl. eigenem Mietkonto des Vermieters pro Mieter)
-- ---------------------------------------------------------------------------
create table public.mieter (
  id                  uuid primary key default gen_random_uuid(),
  wohnung_id          uuid references public.wohnungen (id) on delete set null,
  anrede              text not null default 'Herr' check (anrede in ('Herr', 'Frau', 'Divers', 'Firma')),
  vorname             text,
  nachname            text not null,
  email               text,
  telefon             text,
  mietbeginn          date,
  mietende            date,
  -- monatliche Bestandteile
  kaltmiete           numeric(10,2) not null default 0,
  nebenkosten_vz      numeric(10,2) not null default 0,
  strom_pauschale     numeric(10,2) not null default 0,
  internet_pauschale  numeric(10,2) not null default 0,
  -- Mietkonto (Konto des Vermieters, auf das dieser Mieter zahlt)
  mietkonto_inhaber   text,
  mietkonto_iban      text,
  mietkonto_bic       text,
  mietkonto_bank      text,
  -- Kostenträger
  kostentraeger_id    uuid references public.kostentraeger (id) on delete set null,
  aktenzeichen        text,           -- z. B. BG-Nummer beim Jobcenter
  direktzahlung       boolean not null default false,
  notiz               text,
  erstellt_am         timestamptz not null default now(),
  aktualisiert_am     timestamptz not null default now()
);
create index mieter_wohnung_idx on public.mieter (wohnung_id);
create index mieter_kostentraeger_idx on public.mieter (kostentraeger_id);

-- ---------------------------------------------------------------------------
-- Forderungen (offene / bezahlte Posten je Monat)
-- ---------------------------------------------------------------------------
create table public.forderungen (
  id          uuid primary key default gen_random_uuid(),
  mieter_id   uuid not null references public.mieter (id) on delete cascade,
  monat       date not null,          -- immer der Monatserste
  art         text not null check (art in ('kaltmiete', 'nebenkosten', 'strom', 'internet', 'sonstiges')),
  bezeichnung text,
  betrag      numeric(10,2) not null check (betrag >= 0),
  bezahlt     boolean not null default false,
  bezahlt_am  date,
  erstellt_am timestamptz not null default now()
);
create index forderungen_mieter_idx on public.forderungen (mieter_id);
create index forderungen_offen_idx on public.forderungen (mieter_id) where not bezahlt;

-- ---------------------------------------------------------------------------
-- Vorgänge (Historie der erzeugten Schreiben)
-- ---------------------------------------------------------------------------
create table public.vorgaenge (
  id           uuid primary key default gen_random_uuid(),
  mieter_id    uuid not null references public.mieter (id) on delete cascade,
  typ          text not null check (typ in ('mahnung_1', 'mahnung_2', 'nachweis_jobcenter', 'antwort', 'sonstiges')),
  titel        text not null,
  summe        numeric(10,2),
  details      jsonb not null default '{}'::jsonb,
  erstellt_von uuid default auth.uid() references auth.users (id) on delete set null,
  erstellt_am  timestamptz not null default now()
);
create index vorgaenge_mieter_idx on public.vorgaenge (mieter_id, erstellt_am desc);

-- ---------------------------------------------------------------------------
-- Vorlagen (Standard liegt im Repo, eigene Uploads im privaten Bucket)
-- ---------------------------------------------------------------------------
create table public.vorlagen (
  schluessel      text primary key,     -- z. B. 'mahnung_1'
  name            text not null,
  beschreibung    text,
  standard_datei  text not null,        -- Pfad im Repo, z. B. 'vorlagen/mahnung_1.docx'
  storage_pfad    text,                 -- eigener Upload im Bucket 'vorlagen' (optional)
  aktualisiert_am timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- aktualisiert_am automatisch pflegen
-- ---------------------------------------------------------------------------
create or replace function public.setze_aktualisiert_am()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.aktualisiert_am := now();
  return new;
end;
$$;

create trigger mieter_aktualisiert before update on public.mieter
  for each row execute function public.setze_aktualisiert_am();
create trigger vermieter_profil_aktualisiert before update on public.vermieter_profil
  for each row execute function public.setze_aktualisiert_am();
create trigger vorlagen_aktualisiert before update on public.vorlagen
  for each row execute function public.setze_aktualisiert_am();

-- ---------------------------------------------------------------------------
-- Übersicht je Mieter mit Rückstand (security_invoker: RLS greift weiterhin)
-- ---------------------------------------------------------------------------
create view public.mieter_uebersicht
with (security_invoker = true) as
select
  m.id,
  m.anrede,
  m.vorname,
  m.nachname,
  m.mietbeginn,
  m.mietende,
  (m.kaltmiete + m.nebenkosten_vz + m.strom_pauschale + m.internet_pauschale) as monatlich_gesamt,
  w.id          as wohnung_id,
  w.bezeichnung as wohnung,
  o.id          as objekt_id,
  o.bezeichnung as objekt,
  k.id          as kostentraeger_id,
  k.name        as kostentraeger,
  k.art         as kostentraeger_art,
  m.aktenzeichen,
  coalesce(sum(f.betrag) filter (where not f.bezahlt), 0)          as offen_summe,
  count(distinct f.monat) filter (where not f.bezahlt)              as offen_monate,
  min(f.monat) filter (where not f.bezahlt)                         as aeltester_offener_monat
from public.mieter m
left join public.wohnungen w     on w.id = m.wohnung_id
left join public.objekte o       on o.id = w.objekt_id
left join public.kostentraeger k on k.id = m.kostentraeger_id
left join public.forderungen f   on f.mieter_id = m.id
group by m.id, w.id, o.id, k.id;
