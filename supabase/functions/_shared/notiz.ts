// Eingesprochene Notiz einordnen („Mini-CRM“): Wer ist gemeint (Mietpartei, Kontakt oder neuer Kontakt),
// was ist die Notiz für den Verlauf, gibt es Geburtstag, feste Infos zum Kontakt oder Aufgaben mit Datum?
// Die KI schlägt nur vor; gespeichert wird erst nach Bestätigung in der App. Keine Bankdaten an die KI.
import { Fehler, KI_REGEL_FREMD, type Werkzeug, type Zugriff, claude, datumDE, datumOk, enc, heuteDE, heuteISO, kuerze, rest } from "./gemeinsam.ts";

export const VERLAUF_ARTEN = ["telefonat", "treffen", "email", "notiz"] as const;
const ZIELE = ["mieter", "kontakt", "neuer_kontakt", "keiner"] as const;
const EMPFAENGER = ["mieter", "handwerker", "kontakt", "kostentraeger", "neuer_kontakt"] as const;
const IBAN = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/g;
const ohneIban = (s: unknown) => String(s ?? "").replace(IBAN, "[IBAN entfernt]");
const kurz = (s: unknown, n: number) => {
  const t = ohneIban(s).replace(/\s+/g, " ").trim();
  return t ? t.slice(0, n) : null;
};

const WERKZEUG_NOTIZ: Werkzeug = {
  name: "notiz",
  description: "Ordnet eine eingesprochene Notiz der Verwaltung einem Kontakt oder einer Mietpartei zu und zerlegt sie.",
  input_schema: {
    type: "object",
    properties: {
      ziel: {
        type: "string", enum: [...ZIELE],
        description: "mieter: betrifft eine Mietpartei aus <mieterliste>. kontakt: betrifft einen Kontakt aus <kontakte>. " +
          "neuer_kontakt: eine Person/Firma, die es in beiden Listen noch nicht gibt (Makler, Bank, Behörde …). keiner: nicht erkennbar.",
      },
      mieter_id: { type: ["string", "null"], description: "ID aus <mieterliste>, nur bei ziel=mieter." },
      kontakt_id: { type: ["string", "null"], description: "ID aus <kontakte>, nur bei ziel=kontakt." },
      neuer_kontakt: {
        type: ["object", "null"],
        description: "Nur bei ziel=neuer_kontakt: was über die Person gesagt wurde.",
        properties: {
          vorname: { type: ["string", "null"] }, nachname: { type: ["string", "null"] },
          firma: { type: ["string", "null"], description: "Firma oder Stelle, z. B. 'Sparkasse Musterstadt'." },
          rolle: { type: ["string", "null"], description: "Kurz: Makler, Bank, Behörde, Steuerberater, Notar, Versicherung, Hausverwaltung, Sonstiges." },
          telefon: { type: ["string", "null"] }, email: { type: ["string", "null"] },
        },
      },
      art: { type: "string", enum: [...VERLAUF_ARTEN], description: "telefonat, treffen (persönlich), email oder notiz (sonst)." },
      datum: { type: ["string", "null"], description: "Datum des Gesprächs als JJJJ-MM-TT. 'heute' = heutiges Datum. Sonst null." },
      notiz: {
        type: "string",
        description: "Die Notiz für den Verlauf: sachlich, kurz (1–5 Sätze), alle Fakten unverändert (Beträge, Raten, Termine, Namen, Objekte). " +
          "Ohne Anweisungen an die App (also nicht 'bitte ablegen', 'mache ein ToDo').",
      },
      kontakt_info: {
        type: ["string", "null"],
        description: "Dauerhafte persönliche Infos für die Kontaktkarte, falls genannt, stichpunktartig (z. B. 'Hat einen Hund; Tochter hat am 22.10. Geburtstag'). Sonst null.",
      },
      geburtstag: {
        type: ["object", "null"],
        description: "Geburtstag der gemeinten Person selbst, nur wenn genannt. Sonst null.",
        properties: { tag: { type: "integer" }, monat: { type: "integer" }, jahr: { type: ["integer", "null"] } },
      },
      aufgaben: {
        type: "array",
        description: "Aufgaben/Erinnerungen, die ausdrücklich gewünscht oder klar vereinbart wurden (Rückruf, Frist, Rate prüfen). " +
          "KEINE Aufgabe für den Geburtstag der Person selbst, wenn er im Feld 'geburtstag' steht: daran erinnert die App jedes Jahr automatisch.",
        items: {
          type: "object",
          properties: {
            titel: { type: "string", description: "Kurz, z. B. 'Zweite Kautionsrate von Frau Meier prüfen'." },
            faellig_am: { type: ["string", "null"], description: "JJJJ-MM-TT, falls ein Datum genannt oder klar ist." },
          },
          required: ["titel", "faellig_am"],
        },
      },
      ablegen: { type: "boolean", description: "true, wenn die Notiz ausdrücklich in der Akte/Ablage abgelegt werden soll." },
      schreiben: {
        type: "array",
        description: "Schreiben, die Robert vorbereitet haben möchte: E-Mail, Brief, Auftrag an einen Handwerker, Bescheinigung, Antwort, Erinnerung " +
          "(z. B. 'schick ihr …', 'Brief an …', 'Handwerker beauftragen', 'dem Jobcenter Bescheid geben'). Nur wenn ausdrücklich gewünscht oder klar nötig. Höchstens 3.",
        items: {
          type: "object",
          properties: {
            an: { type: "string", enum: [...EMPFAENGER], description: "mieter: aus <mieterliste>; handwerker: aus <handwerker>; kontakt: aus <kontakte>; kostentraeger: aus <kostentraeger> (Amt, Jobcenter); neuer_kontakt: der neue Kontakt aus dieser Notiz." },
            id: { type: ["string", "null"], description: "ID aus der passenden Liste (bei neuer_kontakt null)." },
            mieter_id: { type: ["string", "null"], description: "Nur bei handwerker/kostentraeger: betroffene Mietpartei aus <mieterliste>, sonst null." },
            kanal: { type: "string", enum: ["email", "brief"], description: "brief nur, wenn ausdrücklich Brief/Post/ausdrucken gewünscht." },
            anweisung: { type: "string", description: "Was im Schreiben stehen soll, mit allen genannten Fakten (Termine, Beträge, Wohnung, Schaden). Als Auftrag an die schreibende KI formuliert." },
          },
          required: ["an", "id", "mieter_id", "kanal", "anweisung"],
        },
      },
    },
    required: ["ziel", "mieter_id", "kontakt_id", "neuer_kontakt", "art", "datum", "notiz", "kontakt_info", "geburtstag", "aufgaben", "ablegen", "schreiben"],
  },
};

const name = (x: { vorname?: string | null; nachname?: string | null }) => [x.vorname, x.nachname].filter(Boolean).join(" ");

function geburtstagOk(g: unknown): { tag: number; monat: number; jahr: number | null } | null {
  if (!g || typeof g !== "object") return null;
  // deno-lint-ignore no-explicit-any
  const { tag, monat, jahr } = g as any;
  const t = Number(tag), m = Number(monat);
  if (!Number.isInteger(t) || !Number.isInteger(m) || m < 1 || m > 12 || t < 1) return null;
  if (t > new Date(Date.UTC(2000, m, 0)).getUTCDate()) return null; // 2000 = Schaltjahr, 29.02. erlaubt
  const j = Number(jahr);
  const jahrOk = Number.isInteger(j) && j >= 1900 && j <= Number(heuteISO().slice(0, 4)) ? j : null;
  return { tag: t, monat: m, jahr: jahrOk };
}

// deno-lint-ignore no-explicit-any
export async function liesNotiz(text: string, zugriff: Zugriff, o: { kontaktId?: string | null; mieterId?: string | null } = {}): Promise<any> {
  const roh = String(text ?? "").trim();
  if (!roh) throw new Fehler(400, "Bitte erst etwas einsprechen oder eintippen.", "eingabe");
  const [mieter, kontakte, handwerker, aemter] = await Promise.all([
    rest("mieter?select=id,vorname,nachname,wohnung:wohnungen(bezeichnung,objekt:objekte(bezeichnung))&order=nachname", zugriff),
    rest("kontakte?select=id,vorname,nachname,firma,rolle&order=nachname", zugriff),
    rest("dienstleister?aktiv=is.true&select=id,name,gewerk&order=name", zugriff).catch(() => []),
    rest("kostentraeger?select=id,name&order=name", zugriff).catch(() => []),
  ]);
  const mieterText = mieter.map((m: { id: string; vorname: string; nachname: string; wohnung?: { bezeichnung?: string; objekt?: { bezeichnung?: string } } }) =>
    `${m.id} | ${name(m)} | ${m.wohnung?.objekt?.bezeichnung ?? ""}, ${m.wohnung?.bezeichnung ?? ""}`).join("\n");
  const kontakteText = kontakte.map((k: { id: string; vorname: string; nachname: string; firma: string; rolle: string }) =>
    `${k.id} | ${name(k) || "-"} | ${k.firma ?? "-"} | ${k.rolle ?? "-"}`).join("\n");
  const gerade = o.kontaktId && kontakte.some((k: { id: string }) => k.id === o.kontaktId)
    ? `Robert ist gerade auf der Seite des Kontakts ${o.kontaktId}. Ohne andere Angabe ist dieser gemeint.\n\n`
    : o.mieterId && mieter.some((m: { id: string }) => m.id === o.mieterId)
    ? `Robert ist gerade in der Akte der Mietpartei ${o.mieterId}. Ohne andere Angabe ist sie gemeint.\n\n`
    : "";

  const { daten } = await claude({
    system:
      `Du hilfst Robert (Hausverwaltung) beim Festhalten von Gesprächen in einem kleinen Kontakt-Verlauf. Heute ist ${heuteDE()} (${heuteISO()}). ` +
      "Ordne die Notiz der richtigen Person zu. Bei Mietparteien und Kontakten nur IDs aus den Listen verwenden, niemals raten. " +
      "Ähnliche Schreibweisen von Namen sind dieselbe Person. Übernimm nur, was gesagt wurde, erfinde nichts. " +
      "Will Robert, dass etwas geschrieben, geschickt oder beauftragt wird (E-Mail, Brief, Auftrag an Handwerker, Nachricht ans Amt), trage es unter 'schreiben' ein; die Notiz hält trotzdem fest, was passiert ist. " +
      `${KI_REGEL_FREMD} Antworte ausschließlich über das Werkzeug 'notiz', auf Deutsch.`,
    inhalt: [{
      type: "text",
      text: `<mieterliste>\nID | Name | Haus, Wohnung\n${mieterText}\n</mieterliste>\n\n<kontakte>\nID | Name | Firma | Rolle\n${kontakteText}\n</kontakte>\n\n` +
        `<handwerker>\nID | Name | Gewerk\n${handwerker.map((d: { id: string; name: string; gewerk: string }) => `${d.id} | ${d.name} | ${d.gewerk ?? "-"}`).join("\n")}\n</handwerker>\n\n` +
        `<kostentraeger>\nID | Name\n${aemter.map((k: { id: string; name: string }) => `${k.id} | ${k.name}`).join("\n")}\n</kostentraeger>\n\n` +
        `${gerade}<diktat>\n${kuerze(ohneIban(roh), 6000)}\n</diktat>`,
    }],
    werkzeug: WERKZEUG_NOTIZ,
    maxTokens: 2500,
  });

  let ziel = (ZIELE as readonly string[]).includes(daten.ziel) ? daten.ziel : "keiner";
  const mieterId = ziel === "mieter" && mieter.some((m: { id: string }) => m.id === daten.mieter_id) ? daten.mieter_id : null;
  const kontaktId = ziel === "kontakt" && kontakte.some((k: { id: string }) => k.id === daten.kontakt_id) ? daten.kontakt_id : null;
  let neu = null;
  if (ziel === "neuer_kontakt" && daten.neuer_kontakt && typeof daten.neuer_kontakt === "object") {
    const n = daten.neuer_kontakt;
    neu = {
      vorname: kurz(n.vorname, 60), nachname: kurz(n.nachname, 80), firma: kurz(n.firma, 120), rolle: kurz(n.rolle, 40),
      telefon: kurz(n.telefon, 40), email: kurz(n.email, 120),
    };
    if (!neu.nachname && !neu.firma) neu = null;
  }
  if ((ziel === "mieter" && !mieterId) || (ziel === "kontakt" && !kontaktId) || (ziel === "neuer_kontakt" && !neu)) ziel = "keiner";

  const aufgaben = (Array.isArray(daten.aufgaben) ? daten.aufgaben : []).slice(0, 5)
    // deno-lint-ignore no-explicit-any
    .map((a: any) => ({ titel: kurz(a?.titel, 200), faellig_am: datumOk(a?.faellig_am) ? a.faellig_am : null }))
    .filter((a: { titel: string | null }) => a.titel);

  // Vorbereitete Schreiben: nur gültige IDs, höchstens 3
  const gibt = (liste: { id: string }[], id: unknown) => liste.some((x) => x.id === id) ? (id as string) : null;
  const schreiben = (Array.isArray(daten.schreiben) ? daten.schreiben : []).slice(0, 8)
    // deno-lint-ignore no-explicit-any
    .map((x: any) => {
      const an = (EMPFAENGER as readonly string[]).includes(x?.an) ? x.an : null;
      const id = an === "mieter" ? gibt(mieter, x.id) : an === "handwerker" ? gibt(handwerker, x.id) : an === "kontakt" ? gibt(kontakte, x.id)
        : an === "kostentraeger" ? gibt(aemter, x.id) : null;
      const anweisung = kurz(x?.anweisung, 2000);
      if (!an || !anweisung || (an !== "neuer_kontakt" && !id) || (an === "neuer_kontakt" && !neu)) return null;
      return {
        an, id, kanal: x?.kanal === "brief" ? "brief" : "email", anweisung,
        mieter_id: an === "handwerker" || an === "kostentraeger" ? gibt(mieter, x.mieter_id) ?? mieterId : null,
      };
    })
    .filter(Boolean).slice(0, 3);

  return {
    ziel,
    mieter_id: mieterId,
    kontakt_id: kontaktId,
    neuer_kontakt: neu,
    art: (VERLAUF_ARTEN as readonly string[]).includes(daten.art) ? daten.art : "notiz",
    datum: datumOk(daten.datum) ? daten.datum : heuteISO(),
    notiz: kurz(daten.notiz, 4000) ?? kuerze(ohneIban(roh), 4000),
    kontakt_info: kurz(daten.kontakt_info, 300),
    geburtstag: geburtstagOk(daten.geburtstag),
    aufgaben,
    ablegen: daten.ablegen === true,
    schreiben,
  };
}

/** Für den Chat: alles zu einem Kontakt (Stammdaten, Verlauf, offene Aufgaben) */
export async function kontaktInfo(id: string, zugriff: Zugriff) {
  const [k] = await rest(`kontakte?id=eq.${enc(id)}&select=id,vorname,nachname,firma,rolle,telefon,email,adresse,geburtstag_tag,geburtstag_monat,geburtsjahr,notiz`, zugriff);
  if (!k) return { fehler: "nicht gefunden" };
  const [verlauf, aufgaben, themen] = await Promise.all([
    rest(`verlauf?kontakt_id=eq.${enc(id)}&select=datum,art,text&order=datum.desc&limit=20`, zugriff),
    rest(`aufgaben?kontakt_id=eq.${enc(id)}&status=eq.offen&select=id,titel,faellig_am`, zugriff),
    rest(`themen?kontakt_id=eq.${enc(id)}&select=id,titel,status&order=aktualisiert_am.desc&limit=10`, zugriff).catch(() => []),
  ]);
  return {
    ...k, name: name(k) || k.firma, link: `#/kontakt/${id}`,
    geburtstag: k.geburtstag_tag ? `${k.geburtstag_tag}.${k.geburtstag_monat}.${k.geburtsjahr ?? ""}` : null,
    verlauf: verlauf.map((v: { datum: string; art: string; text: string }) => ({ ...v, text: `<fremder_text>${kuerze(v.text, 1500)}</fremder_text>` })),
    offene_aufgaben: aufgaben,
    vorgaenge: themen.map((t: { id: string; titel: string; status: string }) => ({ titel: t.titel, status: t.status, link: `#/thema/${t.id}` })),
  };
}

// ---------------------------------------------------------------------------
// Nächster Schritt in einem Vorgang (z. B. nach einer Antwort: Hausmeister informieren, Wiedervorlage)
// Nur Vorschläge: die App öffnet daraus einen vorbelegten Entwurf bzw. den Notiz-Dialog, gesendet wird nie automatisch.
// ---------------------------------------------------------------------------
const SCHRITT_AN = ["mieter", "handwerker", "kontakt", "kostentraeger"] as const;
const WERKZEUG_SCHRITTE: Werkzeug = {
  name: "schritte",
  description: "Schlägt die nächsten Schritte in einem Vorgang der Hausverwaltung vor.",
  input_schema: {
    type: "object",
    properties: {
      vorschlaege: {
        type: "array",
        description: "1 bis 3 sinnvolle nächste Schritte, der wichtigste zuerst.",
        items: {
          type: "object",
          properties: {
            art: { type: "string", enum: ["schreiben", "wiedervorlage"], description: "schreiben: E-Mail an jemanden vorbereiten. wiedervorlage: Erinnerung mit Datum." },
            titel: { type: "string", description: "Kurzer Knopftext, z. B. 'Hausmeister bitten, sich den Geruch in Whg. 2 anzusehen' oder 'Wiedervorlage: Rückmeldung von Frau Demir'." },
            grund: { type: "string", description: "Ein kurzer Satz, warum dieser Schritt sinnvoll ist." },
            an: { type: ["string", "null"], enum: [...SCHRITT_AN, null], description: "Nur bei schreiben: Art des Empfängers." },
            id: { type: ["string", "null"], description: "Nur bei schreiben: ID aus der passenden Liste (<mietpartei>, <handwerker>, <kontakte>, <kostentraeger>)." },
            anweisung: { type: ["string", "null"], description: "Nur bei schreiben: was im Schreiben stehen soll, als Auftrag an die schreibende KI, mit allen nötigen Fakten (Adresse, Wohnung, worum es geht; bei Handwerkern/Hausmeister Name und Telefon der Mietpartei für die Terminabsprache)." },
            faellig_am: { type: ["string", "null"], description: "Nur bei wiedervorlage: Datum JJJJ-MM-TT (meist in 3–7 Tagen)." },
          },
          required: ["art", "titel", "grund", "an", "id", "anweisung", "faellig_am"],
        },
      },
    },
    required: ["vorschlaege"],
  },
};

// deno-lint-ignore no-explicit-any
export async function naechsteSchritte(themaId: string, wunsch: string | null, zugriff: Zugriff): Promise<any> {
  const [t] = await rest(`themen?id=eq.${enc(themaId)}&select=id,titel,status,mieter_id,kontakt_id,dienstleister_id,kostentraeger_id,objekt_id`, zugriff);
  if (!t) throw new Fehler(404, "Vorgang nicht gefunden.", "nicht_gefunden");
  const [ein, aus] = await Promise.all([
    rest(`nachrichten?thema_id=eq.${enc(themaId)}&select=eingang_am,absender_name,betreff,text&order=eingang_am&limit=20`, zugriff),
    rest(`antworten?thema_id=eq.${enc(themaId)}&select=status,gesendet_am,aktualisiert_am,empfaenger_name,art,betreff,text&limit=20`, zugriff),
  ]);
  // Mietpartei des Vorgangs (ohne Bankdaten, ohne Miete): für Ort und Terminabsprache
  let mieter = null;
  if (t.mieter_id) {
    [mieter] = await rest(`mieter?id=eq.${enc(t.mieter_id)}&select=id,anrede,vorname,nachname,telefon,email,kostentraeger_id,` +
      "wohnung:wohnungen(bezeichnung,objekt:objekte(id,bezeichnung,strasse,plz,ort)),kostentraeger:kostentraeger(id,name)", zugriff).catch(() => []);
  }
  const objektId = t.objekt_id ?? mieter?.wohnung?.objekt?.id ?? null;
  const [haus, handwerker, kontakte, aemter] = await Promise.all([
    objektId && !mieter ? rest(`objekte?id=eq.${enc(objektId)}&select=id,bezeichnung,strasse,plz,ort`, zugriff).then((r) => r[0]).catch(() => null) : null,
    rest(`dienstleister?aktiv=is.true&select=id,name,gewerk,objekt_id${objektId ? `&or=(objekt_id.is.null,objekt_id.eq.${enc(objektId)})` : "&objekt_id=is.null"}&order=gewerk`, zugriff).catch(() => []),
    rest("kontakte?select=id,vorname,nachname,firma,rolle&order=nachname&limit=150", zugriff).catch(() => []),
    rest("kostentraeger?select=id,name&order=name", zugriff).catch(() => []),
  ]);
  const posten = [
    // deno-lint-ignore no-explicit-any
    ...ein.map((n: any) => ({ zeit: n.eingang_am, kopf: `Eingang von ${n.absender_name ?? "unbekannt"}`, betreff: n.betreff, text: n.text })),
    // deno-lint-ignore no-explicit-any
    ...aus.map((a: any) => ({ zeit: a.gesendet_am ?? a.aktualisiert_am, kopf: `${a.status === "entwurf" ? "Entwurf (noch nicht gesendet)" : a.art === "auftrag" ? "Auftrag" : "Schreiben"} der Verwaltung an ${a.empfaenger_name ?? "-"}`, betreff: a.betreff, text: a.text })),
  ].sort((a, b) => String(a.zeit).localeCompare(String(b.zeit)));
  let gesamt = 0;
  const bloecke: string[] = [];
  for (const p of posten.reverse()) { // neueste zuerst, damit sie bei langen Verläufen nicht fehlen
    const b = `--- ${p.zeit ? datumDE(p.zeit) : ""} · ${p.kopf}\nBetreff: ${p.betreff ?? ""}\n${kuerze(ohneIban(p.text), 2500)}`;
    if (gesamt + b.length > 16000) break;
    gesamt += b.length;
    bloecke.unshift(b);
  }
  const o = mieter?.wohnung?.objekt ?? haus;
  const mieterText = mieter
    ? `<mietpartei>\nID: ${mieter.id}\nName: ${[mieter.anrede === "Herr" || mieter.anrede === "Frau" ? mieter.anrede : "", mieter.vorname, mieter.nachname].filter(Boolean).join(" ")}\n` +
      `Wohnung: ${mieter.wohnung?.bezeichnung ?? "-"}, ${o ? `${o.strasse}, ${o.plz} ${o.ort} (${o.bezeichnung})` : "-"}\n` +
      `Telefon: ${mieter.telefon || "nicht hinterlegt"}\nE-Mail: ${mieter.email || "nicht hinterlegt"}\n` +
      `Kostenträger: ${mieter.kostentraeger ? `${mieter.kostentraeger.name} (ID ${mieter.kostentraeger.id})` : "keiner"}\n</mietpartei>`
    : o ? `<haus>${o.bezeichnung}: ${o.strasse}, ${o.plz} ${o.ort}</haus>` : "";
  const name = (k: { vorname?: string | null; nachname?: string | null; firma?: string | null }) => [k.vorname, k.nachname].filter(Boolean).join(" ") || k.firma || "";
  const text = [
    `Heute ist ${heuteDE()} (${heuteISO()}).`,
    `<vorgang titel="${String(t.titel ?? "").replace(/"/g, "'")}">\n${bloecke.join("\n\n") || "(noch keine Einträge)"}\n</vorgang>`,
    mieterText,
    `<handwerker>\nID | Name | Gewerk\n${handwerker.map((d: { id: string; name: string; gewerk: string }) => `${d.id} | ${d.name} | ${d.gewerk ?? "-"}`).join("\n")}\n</handwerker>`,
    `<kontakte>\nID | Name | Rolle\n${kontakte.map((k: { id: string; rolle: string }) => `${k.id} | ${name(k)} | ${k.rolle ?? "-"}`).join("\n")}\n</kontakte>`,
    `<kostentraeger>\nID | Name\n${aemter.map((k: { id: string; name: string }) => `${k.id} | ${k.name}`).join("\n")}\n</kostentraeger>`,
    wunsch?.trim() ? `<wunsch_von_robert>\n${kuerze(ohneIban(wunsch), 1500)}\n</wunsch_von_robert>` : "",
    wunsch?.trim() ? "Aufgabe: Setze Roberts Wunsch als Vorschlag um (meist genau ein Schritt)." : "Aufgabe: Was sind die sinnvollen nächsten Schritte?",
  ].filter(Boolean).join("\n\n");
  const { daten } = await claude({
    system:
      "Du hilfst Robert (Hausverwaltung), den nächsten Schritt in einem Vorgang festzulegen. " +
      "Typisch: Hausmeister oder Handwerker informieren bzw. bitten, sich etwas anzusehen (Hausmeister = Gewerk 'Hausmeister' des Hauses), " +
      "eine Wiedervorlage, wenn auf eine Antwort gewartet wird, den Kostenträger informieren, der Mietpartei Bescheid geben. " +
      "Schlage nichts vor, was im Verlauf schon erledigt ist. Nur IDs aus den Listen, niemals raten; gibt es keinen passenden Empfänger, lieber eine Wiedervorlage. " +
      "Schreiben an Handwerker/Hausmeister enthalten nur Ort, Wohnung, worum es geht und Name/Telefon der Mietpartei für die Terminabsprache, nie Miete, Rückstände oder Kostenträger. " +
      `Keine Bankdaten, keine Rechtsberatung. ${KI_REGEL_FREMD} Antworte ausschließlich über das Werkzeug 'schritte', auf Deutsch.`,
    inhalt: [{ type: "text", text }],
    werkzeug: WERKZEUG_SCHRITTE,
    maxTokens: 2000,
  });

  const gibt = (liste: { id: string }[], id: unknown) => (liste.some((x) => x.id === id) ? (id as string) : null);
  const vorschlaege = (Array.isArray(daten.vorschlaege) ? daten.vorschlaege : []).slice(0, 5)
    // deno-lint-ignore no-explicit-any
    .map((v: any) => {
      const titel = kurz(v?.titel, 140);
      const grund = kurz(v?.grund, 300);
      if (!titel) return null;
      if (v?.art === "wiedervorlage") {
        const datum = datumOk(v.faellig_am) && v.faellig_am >= heuteISO() ? v.faellig_am : null;
        return { art: "wiedervorlage", titel, grund, faellig_am: datum, mieter_id: mieter?.id ?? null, objekt_id: objektId };
      }
      if (v?.art !== "schreiben") return null;
      const an = (SCHRITT_AN as readonly string[]).includes(v.an) ? v.an : null;
      const id = an === "mieter" ? (mieter && v.id === mieter.id ? mieter.id : null)
        : an === "handwerker" ? gibt(handwerker, v.id) : an === "kontakt" ? gibt(kontakte, v.id) : an === "kostentraeger" ? gibt(aemter, v.id) : null;
      const anweisung = kurz(v.anweisung, 2000);
      if (!an || !id || !anweisung) return null;
      // deno-lint-ignore no-explicit-any
      const wer: any = an === "mieter" ? mieter : (an === "handwerker" ? handwerker : an === "kontakt" ? kontakte : aemter).find((x: { id: string }) => x.id === id);
      return {
        art: "schreiben", titel, grund, an, id, anweisung, objekt_id: objektId,
        mieter_id: an === "kostentraeger" || an === "mieter" ? mieter?.id ?? null : null,
        name: an === "handwerker" ? `${wer.name}${wer.gewerk ? ` (${wer.gewerk})` : ""}` : an === "kostentraeger" ? wer.name : name(wer),
      };
    })
    .filter(Boolean).slice(0, 3);
  return { vorschlaege };
}
