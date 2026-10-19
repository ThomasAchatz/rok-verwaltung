// Ersteinschätzung einer Mieterhöhung bis zur ortsüblichen Vergleichsmiete (§ 558 BGB).
// Bewusst als feste Rechenregeln und NICHT von der KI geschätzt. Ersetzt keine Rechtsberatung.
// Nicht abgedeckt: Modernisierungsumlage (§ 559), Mietpreisbremse bei Neuvermietung, mehrere Erhöhungen
// innerhalb von drei Jahren (es wird nur die letzte berücksichtigt).

export type MieterhoehungEingabe = {
  heute: string;                     // JJJJ-MM-TT
  mietart: "normal" | "staffel" | "index";
  kaltmiete: number;
  kaltmiete_vorher?: number | null;  // Kaltmiete vor der letzten Erhöhung
  letzte_erhoehung_am?: string | null;
  mietbeginn?: string | null;
  wohnflaeche?: number | null;       // m²
  vergleichsmiete_qm?: number | null; // €/m² laut Mietspiegel
  kappungsgrenze?: number | null;    // 15 oder 20 (%)
};

export type MieterhoehungErgebnis = {
  moeglich: "ja" | "nein" | "unklar";
  frueheste_zustellung: string | null; // ab wann das Erhöhungsverlangen zugehen darf
  frueheste_wirkung: string | null;    // ab wann die neue Miete gelten würde
  max_kaltmiete: number | null;
  max_erhoehung: number | null;
  gruende: string[];
  fehlend: string[];
  hinweis: string;
};

const HINWEIS = "Ersteinschätzung nach festen Regeln, keine Rechtsberatung. Vor dem Versand prüfen lassen (z. B. Haus & Grund).";

const d = (s: string) => new Date(s + "T12:00:00Z");
const iso = (x: Date) => x.toISOString().slice(0, 10);
const rund = (n: number) => Math.round(n * 100) / 100;
const deDatum = (s: string) => s.split("-").reverse().join(".");
const deEuro = (n: number) => n.toFixed(2).replace(".", ",") + " €";

export function plusMonate(s: string, monate: number): string {
  const x = d(s);
  const tag = x.getUTCDate();
  x.setUTCDate(1);
  x.setUTCMonth(x.getUTCMonth() + monate);
  const letzter = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
  x.setUTCDate(Math.min(tag, letzter));
  return iso(x);
}
// Erster Tag des Monats, der n Monate nach dem Monat von s liegt
const monatsanfang = (s: string, n: number) => {
  const x = d(s);
  return iso(new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + n, 1, 12)));
};
// Nächster Monatsanfang an oder nach s
const naechsterMonatsanfang = (s: string) => (s.endsWith("-01") ? s : monatsanfang(s, 1));
const spaeter = (a: string, b: string) => (a > b ? a : b);

export function pruefeMieterhoehung(e: MieterhoehungEingabe): MieterhoehungErgebnis {
  const gruende: string[] = [];
  const fehlend: string[] = [];
  const ergebnis = (moeglich: MieterhoehungErgebnis["moeglich"], extra: Partial<MieterhoehungErgebnis> = {}): MieterhoehungErgebnis => ({
    moeglich, frueheste_zustellung: null, frueheste_wirkung: null, max_kaltmiete: null, max_erhoehung: null,
    gruende, fehlend, hinweis: HINWEIS, ...extra,
  });

  if (e.mietart === "staffel") {
    gruende.push("Staffelmiete: Während der Staffel ist eine Erhöhung auf die Vergleichsmiete ausgeschlossen (§ 557a BGB).");
    return ergebnis("nein");
  }

  const bezug = e.letzte_erhoehung_am || e.mietbeginn || null;
  if (!bezug) fehlend.push("Datum der letzten Mieterhöhung oder Mietbeginn");

  if (e.mietart === "index") {
    gruende.push("Indexmiete: Anpassung nur nach dem Verbraucherpreisindex (§ 557b BGB), frühestens ein Jahr nach der letzten Änderung. Die Vergleichsmiete spielt keine Rolle.");
    const ab = bezug ? spaeter(e.heute, plusMonate(bezug, 12)) : null;
    if (ab) gruende.push(`Frühestens ab ${deDatum(ab)} möglich.`);
    return ergebnis(ab && ab > e.heute ? "nein" : "unklar", { frueheste_zustellung: ab });
  }

  if (!bezug) return ergebnis("unklar");

  // Sperrfrist: Verlangen frühestens 1 Jahr nach der letzten Erhöhung, Wirkung ab dem 3. Monat nach Zugang
  // und frühestens 15 Monate nach der letzten Erhöhung (§ 558 Abs. 1, § 558b Abs. 1 BGB)
  const zustellung = spaeter(e.heute, plusMonate(bezug, 12));
  const wirkung = spaeter(monatsanfang(zustellung, 3), naechsterMonatsanfang(plusMonate(bezug, 15)));
  gruende.push(
    e.letzte_erhoehung_am
      ? `Letzte Erhöhung am ${deDatum(e.letzte_erhoehung_am)}: Erhöhungsverlangen frühestens ab ${deDatum(zustellung)}, neue Miete frühestens ab ${deDatum(wirkung)}.`
      : `Keine Erhöhung seit Mietbeginn (${deDatum(bezug)}): Erhöhungsverlangen frühestens ab ${deDatum(zustellung)}, neue Miete frühestens ab ${deDatum(wirkung)}.`,
  );

  // Kappungsgrenze: höchstens 20 % (bzw. 15 %) in drei Jahren, gerechnet ab der Miete drei Jahre vor Wirksamkeit
  const k = e.kappungsgrenze === 15 ? 15 : 20;
  let basis: number | null = e.kaltmiete;
  const dreiJahreVorher = plusMonate(wirkung, -36);
  if (e.letzte_erhoehung_am && e.letzte_erhoehung_am > dreiJahreVorher) {
    if (e.kaltmiete_vorher && e.kaltmiete_vorher > 0) basis = e.kaltmiete_vorher;
    else { basis = null; fehlend.push("Kaltmiete vor der letzten Erhöhung (für die Kappungsgrenze)"); }
  }
  const maxKappung = basis != null ? rund(basis * (1 + k / 100)) : null;
  if (maxKappung != null) gruende.push(`Kappungsgrenze ${k} %: höchstens ${deEuro(maxKappung)} Kaltmiete (Basis ${deEuro(basis!)}).`);

  // Ortsübliche Vergleichsmiete
  let maxVergleich: number | null = null;
  if (e.wohnflaeche && e.vergleichsmiete_qm) {
    maxVergleich = rund(e.wohnflaeche * e.vergleichsmiete_qm);
    gruende.push(`Vergleichsmiete: ${String(e.vergleichsmiete_qm).replace(".", ",")} €/m² × ${String(e.wohnflaeche).replace(".", ",")} m² = ${deEuro(maxVergleich)}.`);
  } else {
    if (!e.wohnflaeche) fehlend.push("Wohnfläche");
    if (!e.vergleichsmiete_qm) fehlend.push("Ortsübliche Vergleichsmiete (€/m², Mietspiegel)");
  }

  const grenzen = [maxKappung, maxVergleich].filter((x): x is number => x != null);
  const zeit = { frueheste_zustellung: zustellung, frueheste_wirkung: wirkung };
  if (maxVergleich == null || maxKappung == null) {
    const max = grenzen.length ? Math.min(...grenzen) : null;
    if (max != null && max <= e.kaltmiete) {
      gruende.push(`Die aktuelle Kaltmiete (${deEuro(e.kaltmiete)}) liegt bereits an der Grenze.`);
      return ergebnis("nein", zeit);
    }
    return ergebnis("unklar", zeit);
  }
  const max = Math.min(maxKappung, maxVergleich);
  if (max <= e.kaltmiete) {
    gruende.push(`Die aktuelle Kaltmiete (${deEuro(e.kaltmiete)}) liegt bereits auf oder über der zulässigen Grenze.`);
    return ergebnis("nein", zeit);
  }
  const erhoehung = rund(max - e.kaltmiete);
  gruende.push(zustellung > e.heute
    ? `Jetzt noch nicht möglich (Sperrfrist). Ab ${deDatum(zustellung)} voraussichtlich bis ${deEuro(max)} Kaltmiete, also ${deEuro(erhoehung)} mehr im Monat.`
    : `Möglich: bis ${deEuro(max)} Kaltmiete, also ${deEuro(erhoehung)} mehr im Monat.`);
  return ergebnis(zustellung > e.heute ? "nein" : "ja", { ...zeit, max_kaltmiete: max, max_erhoehung: erhoehung });
}
