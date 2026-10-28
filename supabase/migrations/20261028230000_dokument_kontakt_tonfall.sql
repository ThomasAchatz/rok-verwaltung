-- Dokumente können einen Kontakt oder Handwerker betreffen (statt/zusätzlich zur Mietpartei) → erscheinen in der Kontaktakte.
alter table public.dokumente add column if not exists kontakt_id uuid references public.kontakte (id) on delete set null;
alter table public.dokumente add column if not exists dienstleister_id uuid references public.dienstleister (id) on delete set null;
create index if not exists dokumente_kontakt_idx on public.dokumente (kontakt_id);
create index if not exists dokumente_dienstleister_idx on public.dokumente (dienstleister_id);

-- Schreibstil der KI je Empfängergruppe: { mieter, handwerker, sonstige } (ki_tonfall bleibt die Grundlage für alle)
alter table public.vermieter_profil add column if not exists ki_tonfall_gruppen jsonb not null default '{}'::jsonb;
update public.vermieter_profil set ki_tonfall_gruppen = jsonb_build_object(
  'mieter', 'Förmlich: Sie-Form, höflich, klar.',
  'handwerker', 'Klar und direkt, kurze Sätze, das Wichtigste in Stichpunkten (Was, Wo, Kontakt, bis wann).',
  'sonstige', 'Förmlich und professionell, sachlich, höflich.'
) where id = 1 and ki_tonfall_gruppen = '{}'::jsonb;
