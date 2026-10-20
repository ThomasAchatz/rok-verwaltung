-- Vorgänge („Themen“): E-Mail-Pingpong zu einer Sache als ein Verlauf in der Akte,
-- mit „Erledigt“ und Abschluss-PDF. Dazu: Notizen können einen Handwerker betreffen.

-- Betreff ohne AW:/Re:/WG:/Fwd: und ohne Groß-/Kleinschreibung (gleich wie betreffNorm() in der App)
create or replace function privat.betreff_norm(t text) returns text
language sql immutable set search_path = '' as $$
  select nullif(btrim(regexp_replace(
    regexp_replace(lower(coalesce(t, '')), '^(\s*(aw|re|wg|fw|fwd|antw|antwort|tr)\s*(\[\d+\])?\s*:\s*)+', '', 'g'),
    '\s+', ' ', 'g')), '')
$$;

create table public.themen (
  id               uuid primary key default gen_random_uuid(),
  titel            text not null default '',
  betreff_norm     text,
  mieter_id        uuid references public.mieter (id) on delete set null,
  kontakt_id       uuid references public.kontakte (id) on delete set null,
  dienstleister_id uuid references public.dienstleister (id) on delete set null,
  kostentraeger_id uuid references public.kostentraeger (id) on delete set null,
  objekt_id        uuid references public.objekte (id) on delete set null,
  partner_email    text,
  status           text not null default 'offen' check (status in ('offen', 'erledigt')),
  erledigt_am      timestamptz,
  dokument_id      uuid references public.dokumente (id) on delete set null,
  zusammenfassung  text,
  erstellt_am      timestamptz not null default now(),
  aktualisiert_am  timestamptz not null default now(),
  erstellt_von     uuid default auth.uid() references auth.users (id) on delete set null
);
create index themen_mieter_idx on public.themen (mieter_id, aktualisiert_am desc);
create index themen_kontakt_idx on public.themen (kontakt_id, aktualisiert_am desc);
create index themen_suche_idx on public.themen (betreff_norm, status);
create trigger themen_aktualisiert before update on public.themen
  for each row execute function public.setze_aktualisiert_am();

alter table public.nachrichten add column if not exists thema_id uuid references public.themen (id) on delete set null;
alter table public.antworten   add column if not exists thema_id uuid references public.themen (id) on delete set null;
alter table public.aufgaben    add column if not exists dienstleister_id uuid references public.dienstleister (id) on delete set null;
create index if not exists nachrichten_thema_idx on public.nachrichten (thema_id);
create index if not exists antworten_thema_idx on public.antworten (thema_id);
create index if not exists aufgaben_dienstleister_idx on public.aufgaben (dienstleister_id);

alter table public.themen enable row level security;
create policy "themen_mitglieder" on public.themen for all to authenticated
  using ((select privat.ist_mitglied())) with check ((select privat.ist_mitglied()));
revoke all on public.themen from anon, authenticated;
grant select, insert, update, delete on public.themen to authenticated;
-- Posteingang (service_role) ordnet neue Mails einem Vorgang zu
grant select, insert, update on public.themen to service_role;

-- Bestand: je Gegenüber und Betreff ein Vorgang
do $$
declare r record; neu uuid;
begin
  for r in
    select coalesce(n.mieter_id::text, lower(n.absender_email), n.id::text) as wer, privat.betreff_norm(n.betreff) as bn,
           min(n.eingang_am) as start, max(n.eingang_am) as ende,
           (array_agg(n.betreff order by n.eingang_am))[1] as betreff,
           (array_agg(n.mieter_id order by n.eingang_am))[1] as mieter_id,
           (array_agg(lower(n.absender_email) order by n.eingang_am))[1] as email,
           bool_and(n.status = 'erledigt') as alle_erledigt,
           array_agg(n.id) as ids
    from public.nachrichten n where n.thema_id is null
    group by 1, 2
  loop
    insert into public.themen (titel, betreff_norm, mieter_id, partner_email, status, erstellt_am, aktualisiert_am, erstellt_von)
    values (coalesce(nullif(btrim(regexp_replace(coalesce(r.betreff, ''), '^(\s*(aw|re|wg|fw|fwd|antw|antwort|tr)\s*:\s*)+', '', 'i')), ''), '(ohne Betreff)'),
            r.bn, r.mieter_id, r.email, case when r.alle_erledigt then 'erledigt' else 'offen' end, r.start, r.ende, null)
    returning id into neu;
    update public.nachrichten set thema_id = neu where id = any (r.ids);
  end loop;
  -- Antworten auf eine Nachricht gehören zu deren Vorgang
  update public.antworten a set thema_id = n.thema_id from public.nachrichten n where a.nachricht_id = n.id and a.thema_id is null;
  -- Eigene Schreiben ohne Nachricht: je Schreiben ein Vorgang
  for r in select * from public.antworten where thema_id is null loop
    insert into public.themen (titel, betreff_norm, mieter_id, kontakt_id, dienstleister_id, kostentraeger_id, partner_email, erstellt_am, aktualisiert_am, erstellt_von)
    values (coalesce(nullif(btrim(r.betreff), ''), 'Schreiben'), privat.betreff_norm(r.betreff), r.mieter_id, r.kontakt_id, r.dienstleister_id,
            r.kostentraeger_id, lower(r.empfaenger_email), r.erstellt_am, coalesce(r.gesendet_am, r.aktualisiert_am), null)
    returning id into neu;
    update public.antworten set thema_id = neu where id = r.id;
  end loop;
end $$;
