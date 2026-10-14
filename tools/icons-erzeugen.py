"""Erzeugt die App-Symbole (PWA, iOS, Favicon) in icons/.
Aufruf:  python3 tools/icons-erzeugen.py   (benötigt Pillow)
Motiv: Tintenblaue Fläche, „ROK“ in Weiß, Messinglinie darunter – wie im Briefkopf."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

TINTE = (31, 58, 95)
MESSING = (176, 141, 87)
WEISS = (255, 255, 255)
SCHRIFT = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"
ZIEL = Path(__file__).resolve().parent.parent / "icons"
ZIEL.mkdir(exist_ok=True)


def zeichne(groesse: int, inhalt_anteil: float, rund: bool) -> Image.Image:
    """inhalt_anteil: Anteil der Kantenlänge, den Schrift + Linie maximal einnehmen."""
    s = groesse * 4  # Überabtastung für glatte Kanten
    bild = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(bild)
    if rund:
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.22), fill=TINTE)
    else:
        d.rectangle([0, 0, s, s], fill=TINTE)
    breite_max = s * inhalt_anteil
    schrift = ImageFont.truetype(SCHRIFT, int(s * 0.3))
    # Schriftgröße so wählen, dass „ROK“ die gewünschte Breite füllt
    for _ in range(30):
        box = d.textbbox((0, 0), "ROK", font=schrift)
        w = box[2] - box[0]
        if abs(w - breite_max) < s * 0.005:
            break
        schrift = ImageFont.truetype(SCHRIFT, max(10, int(schrift.size * breite_max / w)))
    box = d.textbbox((0, 0), "ROK", font=schrift)
    w, h = box[2] - box[0], box[3] - box[1]
    linie_h = max(4, int(s * 0.028))
    abstand = int(s * 0.05)
    gesamt_h = h + abstand + linie_h
    x = (s - w) / 2 - box[0]
    y = (s - gesamt_h) / 2 - box[1]
    d.text((x, y), "ROK", font=schrift, fill=WEISS)
    ly = (s - gesamt_h) / 2 + h + abstand
    d.rectangle([(s - w) / 2, ly, (s + w) / 2, ly + linie_h], fill=MESSING)
    return bild.resize((groesse, groesse), Image.LANCZOS)


def speichere(bild: Image.Image, name: str, hintergrund: bool = False):
    if hintergrund:  # iOS mag keine Transparenz
        flach = Image.new("RGB", bild.size, TINTE)
        flach.paste(bild, mask=bild.split()[3])
        bild = flach
    bild.save(ZIEL / name, optimize=True)
    print("geschrieben:", name)


speichere(zeichne(192, 0.62, rund=True), "icon-192.png")
speichere(zeichne(512, 0.62, rund=True), "icon-512.png")
# „maskable“: volle Fläche, Inhalt innerhalb der sicheren Zone (80 % Kreis)
speichere(zeichne(512, 0.5, rund=False), "icon-maskable-512.png", hintergrund=True)
speichere(zeichne(192, 0.5, rund=False), "icon-maskable-192.png", hintergrund=True)
# iOS: quadratisch ohne Transparenz, iOS rundet selbst ab
speichere(zeichne(180, 0.58, rund=False), "apple-touch-icon.png", hintergrund=True)
speichere(zeichne(32, 0.7, rund=True), "favicon-32.png")
