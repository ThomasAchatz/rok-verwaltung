-- ROK Verwaltung – ERFUNDENE Testdaten für Postfach und Wissen.
-- Alle Personen, Firmen, Telefonnummern und Inhalte sind ausgedacht.
-- Erneut einspielen: vorher "truncate public.antworten, public.nachrichten, public.wissen cascade;"
begin;

update public.vermieter_profil set
  ki_tonfall = 'Sie-Form. Freundlich, klar und kurz (höchstens 150 Wörter). Keine Zusagen zu Geld, Fristen oder Terminen, die nicht im Wissen stehen oder vorgegeben wurden – dann lieber einen Rückruf anbieten.',
  email_signatur = E'Robert Mustermann\nROK Immobilien\nMusterstraße 1, 12345 Musterstadt\nTel. 0123 456789',
  antwort_email = 'info@rok-immobilien.com'
where id = 1;

insert into public.wissen (titel, inhalt, objekt_id) values
('Ruhezeiten (Hausordnung)',
 E'Nachtruhe 22 bis 6 Uhr, an Sonn- und Feiertagen ganztägig Ruhe.\nBei Beschwerden: zuerst allgemeiner Aushang im Treppenhaus (ohne Namen), bei Wiederholung schriftliche Ermahnung an die betroffene Partei. Beschwerdeführer bitten, Datum und Uhrzeit der Störungen zu notieren.',
 null),
('Reparaturen und Notdienst',
 E'Heizung und Sanitär: Haustechnik Muster GmbH, Tel. 0123 555000 (24-Stunden-Notdienst).\nElektro: Elektro Beispiel, Tel. 0123 555100.\nAblauf: Mieter meldet den Schaden, ROK beauftragt die Firma, die Firma meldet sich innerhalb von 2 Werktagen direkt beim Mieter für einen Termin. Heizungsausfall von Oktober bis April: Firma kommt am selben oder nächsten Tag.',
 null),
('Ratenzahlung bei Mietrückstand',
 E'Ratenzahlung ist möglich, höchstens über 6 Monate und nur schriftlich vereinbart. Die laufende Miete muss daneben pünktlich weitergezahlt werden. Bei Mietern mit Jobcenter: Hinweis geben, die Direktzahlung der Unterkunftskosten an den Vermieter zu beantragen. Eine Zusage zur Ratenhöhe macht Robert selbst – im Entwurf nur Bereitschaft signalisieren und einen Vorschlag zur schriftlichen Vereinbarung ankündigen.',
 null),
('Mietbescheinigung und Unterlagen fürs Jobcenter',
 E'Mietbescheinigungen stellt ROK innerhalb einer Woche aus. Benötigt wird das Formular des Jobcenters. Die Bescheinigung geht auf Wunsch direkt an das Jobcenter.',
 null),
('Freie Wohnungen und Mietinteressenten',
 E'Derzeit sind keine Wohnungen frei. Interessenten können sich auf die Warteliste setzen lassen: per E-Mail mit Namen, Anzahl der Personen und gewünschtem Einzugstermin.',
 null),
('Kündigung durch Mieter',
 E'Kündigungsfrist 3 Monate, schriftlich mit Unterschrift (eine E-Mail genügt nicht). Nach Eingang wird ein Termin für die Wohnungsübergabe vereinbart.',
 null),
('Müllabfuhr MFH Lindenstraße 14',
 E'Restmüll dienstags alle 14 Tage, Papier donnerstags, Gelber Sack montags. Tonnen am Vorabend an die Straße stellen.',
 'c49bbb18-618b-5255-a99e-7a84d7e4b014'),
('Hausmeister MFH Am Mühlbach 3',
 E'Hausmeister Herr Klein, Tel. 0170 5550001, Montag bis Freitag 8 bis 16 Uhr. Kleinreparaturen und Winterdienst.',
 '83010da9-80e0-51a2-9adb-0ca86d4d8527');

insert into public.nachrichten (eingang_am, quelle, absender_email, absender_name, betreff, text, mieter_id, zuordnung, status) values
(now() - interval '3 hours', 'email', 'm.huber@example.org', 'Melanie Huber', 'Heizung im Bad bleibt kalt',
 E'Hallo Herr Mustermann,\n\nseit Montag bleibt der Heizkörper im Bad kalt, obwohl das Thermostat auf 5 steht. Im Wohnzimmer und in der Küche funktioniert alles. Können Sie bitte jemanden vorbeischicken? Ich bin vormittags meistens zu Hause.\n\nViele Grüße\nMelanie Huber\n1. OG rechts',
 '875f2dca-b19c-5180-aec3-16545b423056', 'email', 'neu'),
(now() - interval '20 hours', 'email', 'l.meier@example.org', 'Lukas Meier', 'Miete September und Oktober',
 E'Hallo Herr Mustermann,\n\nich weiß, dass ich mit der Miete für September und Oktober im Rückstand bin. Das Jobcenter hat meinen Weiterbewilligungsantrag noch nicht bearbeitet, abgegeben habe ich aber alles. Kann ich den Rückstand in Raten zahlen, zum Beispiel 300 Euro im Monat, bis das Geld vom Amt kommt?\n\nGruß\nLukas Meier',
 '59fb016c-46ec-57e3-be6c-336db5177338', 'email', 'neu'),
(now() - interval '1 day 4 hours', 'email', 'jobcenter-musterstadt@example.org', 'Jobcenter Musterstadt', 'BG 12345//0012345 – Bitte um Mietbescheinigung',
 E'Sehr geehrte Damen und Herren,\n\nfür die Prüfung des Weiterbewilligungsantrags von Herrn Kevin Bauer (BG 12345//0012345) benötigen wir eine aktuelle Mietbescheinigung. Bitte verwenden Sie das beigefügte Formular und senden Sie es bis zum 31.10.2026 an uns zurück.\n\nMit freundlichen Grüßen\nIm Auftrag\nS. Beispiel\nJobcenter Musterstadt, Leistungsabteilung',
 null, null, 'neu'),
(now() - interval '2 days', 'email', 'a.demir@example.org', 'Aylin Demir', 'Lärm aus der Wohnung über uns',
 E'Guten Tag,\n\nseit etwa zwei Wochen ist es aus der Wohnung über uns fast jede Nacht nach 23 Uhr sehr laut (Musik, Türen knallen). Wir haben schon einmal freundlich geklopft, aber es hat sich nichts geändert. Unsere Kinder können nicht schlafen. Können Sie da bitte etwas unternehmen?\n\nFreundliche Grüße\nAylin Demir',
 '5bb12e4d-2f17-5c3f-afc2-13af5d36e0ff', 'email', 'neu'),
(now() - interval '3 days', 'email', 'j.weber@example.net', 'Jonas Weber', 'Anfrage Wohnung',
 E'Hallo,\n\nich habe gehört, dass Sie in Musterstadt Wohnungen vermieten. Ich suche ab Januar eine 2-Zimmer-Wohnung für mich und meine Partnerin. Haben Sie etwas frei?\n\nBeste Grüße\nJonas Weber',
 null, null, 'neu');

commit;
