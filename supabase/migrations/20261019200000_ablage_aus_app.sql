-- Ablage direkt aus der App: Mails, Notizen und Gesendetes landen als Dokument in der Ablage.
-- Die Verknüpfung zeigt, was schon abgelegt ist (kein doppeltes Ablegen, Hinweis „In der Ablage“).
alter table public.dokumente
  add column antwort_id uuid references public.antworten(id) on delete set null,
  add column aufgabe_id uuid references public.aufgaben(id) on delete set null,
  add column vorgang_id uuid references public.vorgaenge(id) on delete set null;

create index if not exists dokumente_nachricht_idx on public.dokumente (nachricht_id) where nachricht_id is not null;
create index if not exists dokumente_antwort_idx on public.dokumente (antwort_id) where antwort_id is not null;
create index if not exists dokumente_aufgabe_idx on public.dokumente (aufgabe_id) where aufgabe_id is not null;
create index if not exists dokumente_vorgang_idx on public.dokumente (vorgang_id) where vorgang_id is not null;

-- Gesendetes automatisch ablegen (abschaltbar in den Einstellungen)
alter table public.vermieter_profil add column auto_ablage boolean not null default true;

-- Upload vom Gerät: auch Word- und Excel-Dateien (Briefe aus den Vorlagen sind Word-Dateien)
update storage.buckets
   set allowed_mime_types = array[
     'image/jpeg', 'image/png', 'image/webp', 'application/pdf',
     'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
   ]
 where id = 'dokumente';
