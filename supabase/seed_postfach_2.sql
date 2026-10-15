-- Weitere erfundene Test-Mails: gebrochenes Deutsch, Notfall, lange Anfragen mit mehreren Anliegen.
-- Mehrfach ausführbar (extern_id verhindert Doppelte). Die KI ordnet sie beim Öffnen des Postfachs ein.
insert into public.nachrichten (eingang_am, quelle, absender_email, absender_name, betreff, text, mieter_id, zuordnung, status, extern_id)
select x.eingang_am, 'email', x.absender_email, x.absender_name, x.betreff, x.text,
       m.id, case when m.id is not null then 'email' end, 'neu', x.extern_id
from (values
  (now() - interval '3 hours 40 minutes', 'd.petrovic@example.org', 'Dragan Petrović', 'wasser in bad',
$$Hallo Herr Robert,

ich bin Dragan aus Lindenstrasse 14, 1 Stock links. In bad unter waschbecken ist immer nass, ich glaube rohr ist kaputt. Schon 3 tage so. Ich habe handtuch gelegt aber wird immer mehr wasser.

Auch schwarz flecken an wand neben dusche, ist das schimmel? Meine kinder hat husten seit 2 woche.

Bitte schicken jemand. Ich bin zuhause ab 15 uhr jeden tag, morgens arbeit.

Danke
Dragan$$, 'test:beispiel-1'),

  (now() - interval '3 hours 5 minutes', 's.haddad@example.net', 'Samir Haddad', 'Wohnung suchen',
$$hallo,

ich heise Samir Haddad, mein freund wohnt bei ihnen in Musterstadt. ich suche wohnung für mich und meine frau und 2 kinder (4 und 7 jahre). jobcenter bezahlt miete, ich habe bescheinigung von jobcenter mit mietobergrenze.

haben sie 3 zimmer frei? wieviel kostet? ich kann kommen jede zeit für besichtigung.

danke schön
Samir$$, 'test:beispiel-2'),

  (now() - interval '2 hours 30 minutes', 's.wolf@example.org', 'Sabine Wolf', 'Mehrere Anliegen – Nebenkosten, Balkontür, Untervermietung',
$$Sehr geehrter Herr Mustermann,

ich wollte Ihnen eigentlich schon länger schreiben und fasse jetzt alles in einer Mail zusammen, ich hoffe, das ist in Ordnung.

1. Nebenkostenabrechnung: Die Abrechnung für 2025 habe ich noch nicht bekommen. Letztes Jahr kam sie im August. Ich frage, weil ich gerne wüsste, ob ich mit einer Nachzahlung rechnen muss – die Heizkosten sind ja überall gestiegen. Kann man die Vorauszahlung vielleicht vorsorglich erhöhen?

2. Balkontür: Die Balkontür im Wohnzimmer schließt seit ein paar Wochen nicht mehr richtig. Man muss sie mit viel Kraft zudrücken und es zieht trotzdem unten durch. Jetzt, wo es kälter wird, merkt man das deutlich.

3. Untervermietung: Meine Nichte macht ab Januar ein dreimonatiges Praktikum in Musterstadt und würde in dieser Zeit gerne bei mir im Gästezimmer wohnen. Muss ich das bei Ihnen anmelden oder genehmigen lassen? Sie würde mir etwas für Strom und Wasser dazugeben.

4. Und dann noch eine Frage: Wäre ein kleiner Hund (Malteser, ca. 4 kg) in der Wohnung erlaubt? Im Mietvertrag habe ich dazu nichts Eindeutiges gefunden.

5. Im Fahrradkeller stehen mindestens sechs alte Fahrräder mit platten Reifen, die seit Jahren keiner bewegt. Man kommt kaum noch an die eigenen Räder.

Am besten erreichen Sie mich nachmittags ab 16 Uhr unter 0123 555777, gerne auch per Mail.

Vielen Dank und freundliche Grüße
Sabine Wolf
Lindenstraße 14, EG rechts$$, 'test:beispiel-3'),

  (now() - interval '1 hour 50 minutes', 'j.schmid@example.org', 'Jürgen Schmid', 'DRINGEND!!!! wasser',
$$wasser kommt von der decke in küche!!! tropft auf herd. strom ist noch an. was soll ich machen

bitte anrufen 0170 5550099
schmid whg 1$$, 'test:beispiel-4'),

  (now() - interval '1 hour 15 minutes', 'l.meier@example.org', 'Lukas Meier', 'Kündigung und paar Fragen',
$$Hallo Herr Mustermann,

ich wollte Bescheid geben dass ich die Wohnung kündigen muss, ich ziehe zu meiner Freundin nach Musterhausen. Wäre gut wenn das zum 31.01. geht, geht das?

Paar Fragen dazu:
- Muss ich die Wohnung streichen? Ich hab die Wände im Schlafzimmer dunkelblau gemacht.
- Wann krieg ich die Kaution zurück?
- Das Jobcenter will für den Umzug eine Bescheinigung von Ihnen, dass ich gekündigt habe, können Sie mir die schicken?
- Ein Kumpel von mir würde die Wohnung nehmen, kann ich den als Nachmieter vorschlagen?

Und wegen dem offenen Betrag vom Oktober, das Jobcenter hat sich verrechnet, das kommt nächste Woche.

Gruß
Lukas$$, 'test:beispiel-5'),

  (now() - interval '45 minutes', 'priya.sharma@example.com', 'Priya Sharma', 'Apartment request / Wohnungsanfrage',
$$Hello,

I am moving to Musterstadt for a job at Musterwerk GmbH starting 1 December. Do you have a small apartment (1–2 rooms), ideally furnished? Ich spreche ein bisschen Deutsch, aber Englisch ist besser für mich.

My budget is max. 800 Euro warm. I can send salary statements and a Schufa report.

Thank you very much!
Priya Sharma$$, 'test:beispiel-6'),

  (now() - interval '20 minutes', 'a.demir@example.org', 'Aylin Demir', 'Nachtrag Lärm – es ist schlimmer geworden',
$$Guten Tag Herr Mustermann,

ich hatte Ihnen ja schon wegen dem Lärm aus der Wohnung über uns geschrieben. Leider ist es seitdem nicht besser, sondern schlimmer geworden. Wie Sie es empfohlen hatten, habe ich mir die Zeiten aufgeschrieben:

- Freitag 9.10.: 23:15 bis ca. 1:30 Uhr laute Musik, Bass
- Samstag 10.10.: 0:40 Uhr Türenknallen, Streit, Gepolter
- Dienstag 13.10.: 22:30 bis 0:15 Uhr Musik
- Mittwoch 14.10.: 2:10 Uhr Möbel werden verschoben

Unsere Kinder (5 und 8) müssen um 6:30 aufstehen und sind morgens völlig fertig. Mein Mann arbeitet Schicht und kann tagsüber nicht schlafen, weil es auch mittags oft laut ist. Ich habe nochmal geklopft, da wurde ich nur angeschrien.

Ich möchte niemandem Ärger machen, aber so geht es nicht weiter. Was können Sie tun? Muss ich mich ans Ordnungsamt wenden? Und können wir die Miete mindern, solange das so ist?

Mit freundlichen Grüßen
Aylin Demir$$, 'test:beispiel-7')
) as x(eingang_am, absender_email, absender_name, betreff, text, extern_id)
left join public.mieter m on lower(m.email) = lower(x.absender_email)
on conflict (extern_id) do nothing;
