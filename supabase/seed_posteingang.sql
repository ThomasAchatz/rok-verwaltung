-- Vier erfundene Beispiel-Nachrichten für den Posteingang (mehrfach ausführbar, über extern_id).
-- KI-Felder bleiben leer: Das Postfach ordnet sie beim Öffnen selbst ein.
-- 1. Mieterin: Mietminderung wegen Schimmel (rechtliche Frage)
-- 2. Mieter: vorzeitig raus mit Nachmieter (rechtliche Frage, Kündigungsfrist)
-- 3. Interessentin: sucht Wohnung (nicht zugeordnet)
-- 4. Handwerker: Heizungswartung, Termin und Kostenvoranschlag mit Frist (ganzes Haus)
do $$
declare
  m_wolf uuid := (select id from public.mieter where email = 's.wolf@example.org' limit 1);
  m_schmid uuid := (select id from public.mieter where email = 'j.schmid@example.org' limit 1);
  haus_otto uuid := (select o.id from public.mieter m join public.wohnungen w on w.id = m.wohnung_id
                     join public.objekte o on o.id = w.objekt_id where m.email = 'j.schmid@example.org' limit 1);
  t uuid;
begin
  if not exists (select 1 from public.nachrichten where extern_id = 'beispiel:schimmel') then
    insert into public.themen (titel, betreff_norm, mieter_id, partner_email, status)
      values ('Schimmel im Schlafzimmer – Mietminderung?', 'schimmel im schlafzimmer – mietminderung?', m_wolf, 's.wolf@example.org', 'offen') returning id into t;
    insert into public.nachrichten (eingang_am, absender_email, absender_name, betreff, text, mieter_id, zuordnung, extern_id, thema_id, erstellt_von)
    values (now() - interval '3 hours', 's.wolf@example.org', 'Sabine Wolf', 'Schimmel im Schlafzimmer – Mietminderung?',
'Sehr geehrte Damen und Herren,

seit etwa drei Wochen bildet sich an der Außenwand im Schlafzimmer Schimmel, hinter dem Schrank inzwischen eine Fläche von ca. 40 x 60 cm. Ich lüfte morgens und abends und heize normal.

Eine Freundin hat mir gesagt, dass ich die Miete um 20 % mindern darf, solange der Schimmel nicht beseitigt ist. Stimmt das? Ich würde die Miete ab November entsprechend kürzen, wenn bis dahin nichts passiert.

Bitte schicken Sie jemanden, der sich das ansieht. Ich bin unter der Woche ab 16 Uhr zu Hause.

Mit freundlichen Grüßen
Sabine Wolf', m_wolf, case when m_wolf is null then null else 'email' end, 'beispiel:schimmel', t, null);
  end if;

  if not exists (select 1 from public.nachrichten where extern_id = 'beispiel:nachmieter') then
    insert into public.themen (titel, betreff_norm, mieter_id, partner_email, status)
      values ('Vorzeitiger Auszug – Nachmieter', 'vorzeitiger auszug – nachmieter', m_schmid, 'j.schmid@example.org', 'offen') returning id into t;
    insert into public.nachrichten (eingang_am, absender_email, absender_name, betreff, text, mieter_id, zuordnung, extern_id, thema_id, erstellt_von)
    values (now() - interval '1 day 2 hours', 'j.schmid@example.org', 'Jürgen Schmid', 'Vorzeitiger Auszug – Nachmieter',
'Hallo,

ich habe ein Jobangebot in Hamburg bekommen und müsste zum 31.12. ausziehen. Laut Mietvertrag habe ich drei Monate Kündigungsfrist, das würde knapp nicht mehr reichen.

Kann ich einen Nachmieter stellen und dann früher aus dem Vertrag raus? Ein Arbeitskollege hätte Interesse an der Wohnung und könnte ab 1.1. einziehen.

Außerdem: Wann bekomme ich meine Kaution zurück, und muss ich die Wohnung beim Auszug streichen?

Viele Grüße
Jürgen Schmid', m_schmid, case when m_schmid is null then null else 'email' end, 'beispiel:nachmieter', t, null);
  end if;

  if not exists (select 1 from public.nachrichten where extern_id = 'beispiel:interessent') then
    insert into public.themen (titel, betreff_norm, partner_email, status)
      values ('Anfrage 2-Zimmer-Wohnung', 'anfrage 2-zimmer-wohnung', 'lena.beispiel@example.org', 'offen') returning id into t;
    insert into public.nachrichten (eingang_am, absender_email, absender_name, betreff, text, extern_id, thema_id, erstellt_von)
    values (now() - interval '5 hours', 'lena.beispiel@example.org', 'Lena Beispiel', 'Anfrage 2-Zimmer-Wohnung',
'Guten Tag,

ich bin auf der Suche nach einer 2-Zimmer-Wohnung ab Januar und habe gehört, dass bei Ihnen eventuell etwas frei wird.

Kurz zu mir: 29 Jahre, Pflegefachfrau im Klinikum, unbefristet angestellt, Nichtraucherin. Ich habe eine kleine Katze – wäre das ein Problem?

Gerne schicke ich Ihnen Gehaltsnachweise und eine Mietschuldenfreiheitsbescheinigung. Wäre eine Besichtigung möglich?

Viele Grüße
Lena Beispiel
Tel. 0151 0000000', 'beispiel:interessent', t, null);
  end if;

  if not exists (select 1 from public.nachrichten where extern_id = 'beispiel:heizung') then
    insert into public.themen (titel, betreff_norm, objekt_id, partner_email, status)
      values ('Heizungswartung – Termin und Kostenvoranschlag', 'heizungswartung – termin und kostenvoranschlag', haus_otto, 'auftrag@haustechnik.example.org', 'offen') returning id into t;
    insert into public.nachrichten (eingang_am, absender_email, absender_name, betreff, text, objekt_id, extern_id, thema_id, erstellt_von)
    values (now() - interval '40 minutes', 'auftrag@haustechnik.example.org', 'Haustechnik Muster GmbH', 'Heizungswartung – Termin und Kostenvoranschlag',
'Sehr geehrte Damen und Herren,

die jährliche Wartung der Gasheizung in Ihrem Objekt steht an. Wir könnten am Dienstag, 04.11.2026, ab 8 Uhr vorbeikommen. Dafür brauchen wir Zugang zum Heizungsraum im Keller.

Bei der letzten Wartung ist uns aufgefallen, dass das Ausdehnungsgefäß Druck verliert. Ein Austausch würde ca. 480 € brutto kosten (Material und ca. 2 Stunden Arbeit). Soll das gleich mit erledigt werden?

Bitte bestätigen Sie den Termin und die Reparatur bis spätestens 29.10.2026, damit wir das Material bestellen können.

Mit freundlichen Grüßen
Haustechnik Muster GmbH
Auftragsannahme', haus_otto, 'beispiel:heizung', t, null);
  end if;
end $$;
