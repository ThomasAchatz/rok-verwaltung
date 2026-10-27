-- Handwerker-Aufträge: Angebote einholen oder direkt beauftragen, mit Status bis „abgeschlossen“.
-- Ein Auftrag = ein Vorhaben (z. B. „Treppenhaus streichen“); bei Angeboten mehrere Handwerker in `handwerker`.
-- Die Schreiben an die Handwerker bleiben normale Antworten (antworten.auftrag_id), gesendet wird nie automatisch.

create table public.auftraege (
  id                   uuid primary key default gen_random_uuid(),
  art                  text not null default 'auftrag' check (art in ('angebot', 'auftrag')),   -- Angebote einholen | direkt beauftragen
  status               text not null default 'entwurf'
                       check (status in ('entwurf', 'angefragt', 'angebot', 'beauftragt', 'erledigt', 'abgeschlossen', 'abgebrochen')),
  titel                text not null,
  beschreibung         text,
  objekt_id            uuid references public.objekte (id) on delete set null,
  mieter_id            uuid references public.mieter (id) on delete set null,
  dienstleister_id     uuid references public.dienstleister (id) on delete set null,  -- beauftragter Handwerker
  -- Beteiligte Handwerker: [{ dienstleister_id, status: angefragt|angebot|abgelehnt|beauftragt, betrag, datum, dokument_id, notiz }]
  handwerker           jsonb not null default '[]'::jsonb,
  thema_id             uuid references public.themen (id) on delete set null,
  nachricht_id         uuid references public.nachrichten (id) on delete set null,
  frist                date,            -- Angebot bis | erledigt bis
  termin               date,            -- vereinbarter Termin
  kostenrahmen         numeric(10,2),   -- bei Direktaufträgen optional
  betrag               numeric(10,2),   -- angenommenes Angebot bzw. Rechnung
  rechnung_dokument_id uuid references public.dokumente (id) on delete set null,
  sichtbar             jsonb not null default '{}'::jsonb,   -- { fotos, kontakt, zugang } – was der Handwerker bekommt
  gesendet_am          timestamptz,
  erledigt_am          date,
  abgeschlossen_am     date,
  notiz                text,
  erstellt_am          timestamptz not null default now(),
  aktualisiert_am      timestamptz not null default now(),
  erstellt_von         uuid default auth.uid() references auth.users (id) on delete set null
);
create index auftraege_status_idx on public.auftraege (status);
create index auftraege_objekt_idx on public.auftraege (objekt_id);
create index auftraege_mieter_idx on public.auftraege (mieter_id);
create index auftraege_dienstleister_idx on public.auftraege (dienstleister_id);
create index auftraege_thema_idx on public.auftraege (thema_id);
create index auftraege_nachricht_idx on public.auftraege (nachricht_id);
create index auftraege_rechnung_idx on public.auftraege (rechnung_dokument_id);
create index auftraege_erstellt_von_idx on public.auftraege (erstellt_von);
create trigger auftraege_aktualisiert before update on public.auftraege
  for each row execute function public.setze_aktualisiert_am();

alter table public.auftraege enable row level security;
create policy "auftraege_mitglieder" on public.auftraege for all to authenticated
  using ((select privat.ist_mitglied())) with check ((select privat.ist_mitglied()));
revoke all on public.auftraege from anon, authenticated;
grant select, insert, update, delete on public.auftraege to authenticated;

-- Schreiben an Handwerker gehören zu einem Auftrag
alter table public.antworten add column if not exists auftrag_id uuid references public.auftraege (id) on delete set null;
create index if not exists antworten_auftrag_idx on public.antworten (auftrag_id);

-- Bestand: jeder bisherige Auftrag (antworten.art = 'auftrag') wird ein Auftrag
do $$
declare
  a record;
  neu uuid;
begin
  for a in
    select an.*, coalesce(w.objekt_id, n.objekt_id, d.objekt_id) as haus
    from public.antworten an
    left join public.mieter m on m.id = an.mieter_id
    left join public.wohnungen w on w.id = m.wohnung_id
    left join public.nachrichten n on n.id = an.nachricht_id
    left join public.dienstleister d on d.id = an.dienstleister_id
    where an.art = 'auftrag' and an.auftrag_id is null
  loop
    insert into public.auftraege (art, status, titel, objekt_id, mieter_id, dienstleister_id, handwerker, thema_id, nachricht_id, gesendet_am, erstellt_am)
    values (
      'auftrag',
      case when a.status in ('gesendet', 'als_brief') then 'beauftragt' else 'entwurf' end,
      coalesce(nullif(regexp_replace(coalesce(a.betreff, ''), '^\s*((auftrag|aw|re|wg)\s*:\s*)+', '', 'i'), ''), 'Auftrag'),
      a.haus, a.mieter_id, a.dienstleister_id,
      case when a.dienstleister_id is null then '[]'::jsonb
           else jsonb_build_array(jsonb_build_object('dienstleister_id', a.dienstleister_id, 'status', 'beauftragt')) end,
      a.thema_id, a.nachricht_id, a.gesendet_am, a.erstellt_am
    )
    returning id into neu;
    update public.antworten set auftrag_id = neu where id = a.id;
  end loop;
end $$;
