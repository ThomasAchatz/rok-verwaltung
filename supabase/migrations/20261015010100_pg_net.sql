-- pg_net: HTTP-Aufrufe aus der Datenbank. Wird für Funktionstests der Edge Functions genutzt
-- (z. B. Posteingang mit einer Test-E-Mail aufrufen) und später für zeitgesteuerte Abläufe.
create extension if not exists pg_net;
