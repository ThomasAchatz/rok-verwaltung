-- Unterschrift für Briefe (nur Briefe/PDF, nie E-Mails)
-- Das Bild liegt im privaten Bucket „vorlagen“ unter unterschrift/<id>.png (nur Mitglieder, siehe vorlagen_bucket_*).
-- vermieter_profil.unterschrift: { pfad, breite, hoehe, stand } oder null

alter table public.vermieter_profil add column if not exists unterschrift jsonb;
comment on column public.vermieter_profil.unterschrift is
  'Unterschrift für Briefe: { pfad (Bucket vorlagen), breite, hoehe (Pixel), stand }; null = keine';

update storage.buckets
   set allowed_mime_types = array[
     'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
     'image/png'
   ]
 where id = 'vorlagen';
