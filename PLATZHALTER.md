# Platzhalter für eigene Briefvorlagen

Platzhalter stehen in geschweiften Klammern direkt im Word-Text, z. B. `{konto_iban}`.
Am einfachsten: In der App unter **Vorlagen** eine Standardvorlage „Zum Bearbeiten herunterladen“,
in Word Texte und Gestaltung ändern, Platzhalter stehen lassen und wieder hochladen.
Beim Hochladen prüft die App die Vorlage; unbekannte Platzhalter bleiben im Brief leer.

Tipp: Platzhalter in Word am Stück tippen (nicht teilweise formatieren), sonst erkennt Word ihn
eventuell nicht als zusammenhängenden Text.

## Briefkopf (Einstellungen → Briefkopf in der App)

| Platzhalter | Inhalt |
|---|---|
| `{v_firma}` | Firma, z. B. ROK Immobilien |
| `{v_inhaber}` | Inhaber / Unterzeichner |
| `{v_strasse}`, `{v_plz}`, `{v_ort}` | Absenderadresse |
| `{v_telefon}`, `{v_email}`, `{v_web}` | Kontakt |
| `{v_untertitel}` | „Immobilienverwaltung“, bei privatem Absender leer |
| `{v_fusszeile}` | Fußzeile (Firma/Name · Anschrift · Kontakt), passt sich dem gewählten Absender an |
| `{v_gruss_firma}` | Firmenname unter dem Gruß, bei privatem Absender leer |
| `{v_unterschrift}` | Stelle für die Unterschrift (eigener Absatz zwischen Gruß und Name). Wird durch das Bild ersetzt oder bleibt leer. Fehlt sie in einer eigenen Vorlage, kommt das Bild unter den Absatz mit „Grüßen“. |

Wählt Robert beim Schreiben einen anderen Absender (z. B. „Privat“), stehen in allen `v_…`-Feldern dessen Angaben.

## Datum und Fristen

| Platzhalter | Inhalt |
|---|---|
| `{datum}` | Heutiges Datum (TT.MM.JJJJ) |
| `{frist}` | Zahlungsfrist: 1. Mahnung heute + 14 Tage, 2. Mahnung heute + 7 Tage |
| `{letzte_mahnung_datum}` | Datum der letzten **1. Mahnung** aus dem Verlauf (leer, wenn keine) |
| `{mahnung_datum}` | Datum der letzten Mahnung (1. oder 2.) aus dem Verlauf |

## Empfänger

Bei Mahnungen ist der Empfänger der Mieter, beim Nachweis der Kostenträger.

| Platzhalter | Inhalt |
|---|---|
| `{empf_name}` | „Herrn Kevin Bauer“ bzw. „Jobcenter Musterstadt“ |
| `{empf_zusatz}` | „Wohnung EG links“ bzw. Abteilung des Kostenträgers |
| `{empf_strasse}`, `{empf_plz_ort}` | Anschrift |
| `{briefanrede}` | „Sehr geehrter Herr Bauer“ / „Sehr geehrte Frau …“ (ohne Komma) |

## Mieter und Mietobjekt

| Platzhalter | Inhalt |
|---|---|
| `{mieter_name}`, `{mieter_vorname}`, `{mieter_nachname}` | Mietpartei |
| `{objekt}` | Bezeichnung des Objekts, z. B. „MFH Lindenstraße 14“ |
| `{objekt_strasse}` | Straße des Objekts |
| `{objekt_adresse}` | Straße, PLZ und Ort des Objekts |
| `{wohnung}` | z. B. „EG links“ |
| `{mietbeginn}` | Mietbeginn (TT.MM.JJJJ) |
| `{kostentraeger_name}` | Jobcenter / Sozialamt (leer bei Selbstzahlern) |
| `{aktenzeichen}` | Aktenzeichen / BG-Nummer |

## Mietkonto dieses Mieters

| Platzhalter | Inhalt |
|---|---|
| `{konto_inhaber}` | Kontoinhaber |
| `{konto_iban}` | IBAN, in Vierergruppen |
| `{konto_bic}`, `{konto_bank}` | BIC und Bank |
| `{verwendungszweck}` | z. B. „Miete Bauer, MFH Lindenstraße 14 EG links“ |

## Offene Posten (Tabelle)

Die im Brief ausgewählten Posten werden als Schleife ausgegeben. In einer Word-Tabelle steht
`{#posten}` in der ersten und `{/posten}` in der letzten Zelle **derselben Zeile** – diese Zeile
wird dann für jeden Posten wiederholt:

| Monat | Position | Betrag |
|---|---|---|
| `{#posten}{monat}` | `{bezeichnung}` | `{betrag}{/posten}` |

| Platzhalter | Inhalt |
|---|---|
| `{monat}` | „August 2026“ |
| `{bezeichnung}` | „Kaltmiete“, „Strompauschale“ … |
| `{betrag}` | „420,00 €“ |
| `{summe}` | Summe aller ausgewählten Posten, „1.950,00 €“ |

## Bedingungen

Text, der nur erscheinen soll, wenn ein Feld gefüllt ist, steht zwischen `{#feld}` und `{/feld}`.
Steht beides jeweils allein in einem eigenen Absatz, verschwinden die Absätze ohne Leerzeile.
Mit `{^feld}…{/feld}` erscheint Text nur, wenn das Feld **leer** ist.

| Bedingung | Wofür |
|---|---|
| `{#kostentraeger_name}…{/kostentraeger_name}` | Hinweis nur bei Mietern mit Jobcenter/Sozialamt |
| `{#hat_nebenleistungen}…{/hat_nebenleistungen}` | Absatz nur, wenn Strom- oder Internetpauschale offen ist |
| `{#mahnung_datum}…{/mahnung_datum}` | Satz nur, wenn schon gemahnt wurde |
| `{#letzte_mahnung_datum}…{/letzte_mahnung_datum}` / `{^letzte_mahnung_datum}…{/letzte_mahnung_datum}` | Text abhängig davon, ob es eine 1. Mahnung gab |
| `{#empf_zusatz}…{/empf_zusatz}` | Zusatzzeile in der Anschrift nur, wenn vorhanden |

## Antwortschreiben (Vorlage „Antwortschreiben“)

Wird im Postfach bzw. bei „Neues Schreiben“ mit „Als Brief“ erzeugt. Der Text kommt aus dem Entwurf.
Briefkopf-, Datums- und Mieter-Platzhalter wie oben (Mieterfelder bleiben leer, wenn keine Mietpartei
zugeordnet ist). Die Anschrift (`{empf_…}`) wählt man vor der Vorschau aus.

| Platzhalter | Inhalt |
|---|---|
| `{betreff}` | Betreff des Entwurfs |
| `{#absaetze}` / `{absatz}` / `{/absaetze}` | Jeder Absatz des Entwurfs (der erste ist die Anrede). Die drei Teile jeweils in einem eigenen Absatz, dann wird der mittlere Absatz für jeden Textabsatz wiederholt. |
