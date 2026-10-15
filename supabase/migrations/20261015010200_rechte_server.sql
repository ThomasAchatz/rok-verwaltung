-- Rechte für die Server-Funktion "posteingang" (läuft mit dem geheimen Schlüssel = Rolle service_role).
-- Das Projekt vergibt für neue Tabellen keine Rechte automatisch, daher hier gezielt nur das Nötige:
-- Postfach-Token lesen, Mieter zuordnen, Nachricht ablegen und von der KI einordnen lassen.
grant select on public.postfach, public.vermieter_profil, public.mieter, public.wohnungen,
                public.objekte, public.kostentraeger to service_role;
grant select, insert, update on public.nachrichten to service_role;
