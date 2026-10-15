-- Rechte nachschärfen: Die Standardrechte des Projekts geben neuen Tabellen für anon und authenticated
-- TRUNCATE/REFERENCES/TRIGGER mit. TRUNCATE umgeht RLS. Über die API ist das nicht erreichbar,
-- wird hier aber trotzdem entzogen (Verteidigung in der Tiefe).
revoke all on public.nachrichten, public.antworten, public.wissen, public.postfach from anon;
revoke truncate, references, trigger on public.nachrichten, public.antworten, public.wissen, public.postfach from authenticated;
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;

-- Künftige Tabellen bekommen diese Rechte gar nicht erst
alter default privileges for role postgres in schema public revoke truncate, references, trigger, maintain on tables from anon, authenticated;
