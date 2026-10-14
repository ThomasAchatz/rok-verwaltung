-- Archiv der erzeugten Schreiben: Jedes fertiggestellte Schreiben wird als .docx im
-- privaten Bucket "schreiben" abgelegt (Pfad: <mieter_id>/<vorgang_id>.docx) und im
-- Vorgang unter details->>'datei_pfad' vermerkt. Archivierte Schreiben werden nicht
-- überschrieben (kein Update), damit nachvollziehbar bleibt, was verschickt wurde.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'schreiben', 'schreiben', false, 10485760,
  array['application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
on conflict (id) do nothing;

create policy "schreiben_bucket_lesen" on storage.objects
  for select to authenticated
  using (bucket_id = 'schreiben' and (select privat.ist_mitglied()));
create policy "schreiben_bucket_ablegen" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'schreiben' and (select privat.ist_mitglied()));
create policy "schreiben_bucket_loeschen" on storage.objects
  for delete to authenticated
  using (bucket_id = 'schreiben' and (select privat.ist_mitglied()));
