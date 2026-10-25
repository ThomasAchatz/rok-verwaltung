-- „Ja und Ja“: Die KI bereitet bei Schadensmeldungen Antwort und Handwerker-Auftrag als Entwürfe vor.
-- nachrichten.ki_schritte: { status: laeuft|fertig|keine|verworfen|fehler, am, antwort_id?, auftrag_id?, dienstleister?: { id, name, gewerk, email }, meldung? }
-- Vorbereitet wird mit dem Login des Nutzers (KI-Aktion „schritte“), nicht vom Server-Posteingang (der hat bewusst keine Rechte auf antworten).
alter table public.nachrichten add column if not exists ki_schritte jsonb;
comment on column public.nachrichten.ki_schritte is 'Von der KI vorbereitete nächste Schritte (Antwort- und Auftragsentwurf), nur Vorschlag';
