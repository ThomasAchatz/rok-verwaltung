-- Mieteingänge: echte Zahlungseingänge (Ist) neben den Forderungen (Soll) und ein Status je Mietpartei und Monat.
-- Soll = Forderungen (Kaltmiete, Nebenkosten, Strom, Internet) eines Monats; Ist = Zahlungen der Art „miete“.
-- Gibt es für einen Monat keine Zahlungen, gilt weiter der Haken „bezahlt“ an den Forderungen (Bestand, von Hand).

create table public.zahlungen (
  id           uuid primary key default gen_random_uuid(),
  mieter_id    uuid not null references public.mieter (id) on delete cascade,
  monat        date not null check (extract(day from monat) = 1),   -- für welchen Monat (Monatserster)
  datum        date,                                                -- Eingang laut Bank (fehlt beim Excel-Import)
  betrag       numeric(10,2) not null check (betrag > 0),
  art          text not null default 'miete' check (art in ('miete', 'kaution', 'nachzahlung', 'sonstiges')),
  quelle       text not null default 'hand' check (quelle in ('hand', 'bank', 'excel')),
  zahler       text,                                                -- Name laut Kontoauszug (ohne IBAN)
  text         text,                                                -- Verwendungszweck (ohne IBAN, gekürzt)
  schluessel   text unique,                                         -- erkennt doppelt importierte Buchungen
  import_id    uuid,                                                -- gemeinsamer Import (zum Rückgängigmachen)
  erstellt_am  timestamptz not null default now(),
  erstellt_von uuid default auth.uid() references auth.users (id) on delete set null
);
create index zahlungen_mieter_monat_idx on public.zahlungen (mieter_id, monat);
create index zahlungen_monat_idx on public.zahlungen (monat);
create index zahlungen_import_idx on public.zahlungen (import_id);
create index zahlungen_erstellt_von_idx on public.zahlungen (erstellt_von);

-- Aktion je Mietpartei und Monat: geprüft (Zahlung da und passt) | in Rückstand gestellt | kontaktiert
create table public.mieteingang_status (
  id              uuid primary key default gen_random_uuid(),
  mieter_id       uuid not null references public.mieter (id) on delete cascade,
  monat           date not null check (extract(day from monat) = 1),
  status          text check (status in ('geprueft', 'rueckstand', 'kontaktiert')),
  notiz           text,
  ki_vorschlag    jsonb,                                            -- { aktion, text, am }
  aktualisiert_am timestamptz not null default now(),
  geaendert_von   uuid default auth.uid() references auth.users (id) on delete set null,
  unique (mieter_id, monat)
);
create index mieteingang_status_monat_idx on public.mieteingang_status (monat);
create index mieteingang_status_geaendert_von_idx on public.mieteingang_status (geaendert_von);
create trigger mieteingang_status_aktualisiert before update on public.mieteingang_status
  for each row execute function public.setze_aktualisiert_am();

alter table public.zahlungen enable row level security;
alter table public.mieteingang_status enable row level security;
create policy "zahlungen_mitglieder" on public.zahlungen for all to authenticated
  using ((select privat.ist_mitglied())) with check ((select privat.ist_mitglied()));
create policy "mieteingang_status_mitglieder" on public.mieteingang_status for all to authenticated
  using ((select privat.ist_mitglied())) with check ((select privat.ist_mitglied()));
revoke all on public.zahlungen, public.mieteingang_status from anon, authenticated;
grant select, insert, update, delete on public.zahlungen, public.mieteingang_status to authenticated;

-- Sollstellung: fehlende Monatsposten (Kaltmiete, Nebenkosten, Pauschalen) bis zum Monat p_bis anlegen.
-- Ab dem Monat nach dem letzten vorhandenen Posten; Mietparteien ganz ohne Posten erst ab dem laufenden Monat.
-- Nie vor Mietbeginn, nie nach Mietende. Vor der letzten Erhöhung gilt die alte Kaltmiete. Mehrfach ausführbar.
create or replace function public.sollstellung_ergaenzen(p_bis date default current_date)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  anzahl integer;
begin
  if not privat.ist_mitglied() then
    raise exception 'keine Berechtigung';
  end if;
  with spannen as (
    select m.*,
      greatest(
        coalesce((select (max(f.monat) + interval '1 month')::date from public.forderungen f where f.mieter_id = m.id),
                 date_trunc('month', p_bis)::date),
        date_trunc('month', coalesce(m.mietbeginn, p_bis))::date
      ) as von,
      least(date_trunc('month', p_bis)::date, date_trunc('month', coalesce(m.mietende, p_bis))::date) as bis
    from public.mieter m
  ),
  monate as (
    select s.*, gs::date as monat from spannen s, generate_series(s.von, s.bis, interval '1 month') gs
    where s.von <= s.bis
  ),
  posten as (
    select mo.id as mieter_id, mo.monat, x.art, x.bezeichnung, x.betrag
    from monate mo
    cross join lateral (values
      ('kaltmiete', 'Kaltmiete',
        case when mo.letzte_erhoehung_am is not null and mo.kaltmiete_vorher is not null and mo.monat < mo.letzte_erhoehung_am
             then mo.kaltmiete_vorher else mo.kaltmiete end),
      ('nebenkosten', 'Nebenkosten-Vorauszahlung', mo.nebenkosten_vz),
      ('strom', 'Strompauschale', mo.strom_pauschale),
      ('internet', 'Internetpauschale', mo.internet_pauschale)
    ) as x(art, bezeichnung, betrag)
    where coalesce(x.betrag, 0) > 0
  ),
  neu as (
    insert into public.forderungen (mieter_id, monat, art, bezeichnung, betrag)
    select p.mieter_id, p.monat, p.art, p.bezeichnung, p.betrag from posten p
    where not exists (select 1 from public.forderungen f where f.mieter_id = p.mieter_id and f.monat = p.monat and f.art = p.art)
    returning 1
  )
  select count(*) into anzahl from neu;
  return anzahl;
end;
$$;
revoke all on function public.sollstellung_ergaenzen(date) from public, anon;
grant execute on function public.sollstellung_ergaenzen(date) to authenticated;
