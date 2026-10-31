-- Eigener Name für die KI (z. B. „Jarvis“): steht in der App statt „die KI“ („Vorschlag von Jarvis“).
alter table public.vermieter_profil add column if not exists ki_name text
  check (ki_name is null or char_length(btrim(ki_name)) between 1 and 30);
