-- Weitere Personen im Haushalt einer Mietpartei (nicht Vertragspartner), eine Person je Zeile,
-- z. B. „Christian Meier · 0151 … · c.meier@…“. Pflege über die Stammdaten oder per Chat-Karte (mit Bestätigung).
alter table public.mieter
  add column weitere_bewohner text check (weitere_bewohner is null or length(weitere_bewohner) <= 2000);
