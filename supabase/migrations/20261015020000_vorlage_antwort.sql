-- Briefvorlage für Antworten aus dem Postfach (Text kommt aus dem Entwurf)
insert into public.vorlagen (schluessel, name, beschreibung, standard_datei)
values (
  'antwort',
  'Antwortschreiben',
  'Brief mit freiem Text, z. B. eine Antwort aus dem Postfach oder ein mit der KI entworfenes Schreiben.',
  'vorlagen/antwort.docx'
)
on conflict (schluessel) do nothing;
