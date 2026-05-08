"""
Generate PillReminder branded assets.
Run: py -3 scripts/generate-assets.py
"""
from PIL import Image, ImageDraw

NAVY  = (26,  47,  90,  255)
BLUE  = (74,  144, 217, 255)
WHITE = (255, 255, 255, 255)
TRANS = (0,   0,   0,   0)


def capsule(draw, cx, cy, w, h, color):
    """Horizontal capsule (pill shape)."""
    r = h // 2
    x0, y0 = cx - w // 2, cy - r
    draw.ellipse([x0, y0, x0 + h, y0 + h], fill=color)
    draw.rectangle([x0 + r, y0, x0 + w - r, y0 + h], fill=color)
    draw.ellipse([x0 + w - h, y0, x0 + w, y0 + h], fill=color)


def score_line(draw, cx, cy, h, color):
    """Thin vertical line dividing pill in half."""
    half = h // 2 - 4
    draw.rectangle([cx - 3, cy - half, cx + 3, cy + half], fill=color)


def dot_row(draw, cx, cy, color_mid, color_side, r=14, gap=68):
    """Three dots — side/mid/side — representing scheduled doses."""
    for i, x in enumerate([cx - gap, cx, cx + gap]):
        c = color_mid if i == 1 else color_side
        draw.ellipse([x - r, cy - r, x + r, cy + r], fill=c)


# ─── icon.png  1024×1024 ─────────────────────────────────────────────────────

def make_icon():
    S = 1024
    img = Image.new("RGBA", (S, S), TRANS)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=210, fill=NAVY)

    cx, cy = S // 2, S // 2 - 40
    pw, ph = 620, 210
    capsule(d, cx, cy, pw, ph, WHITE)
    score_line(d, cx, cy, ph, (*NAVY[:3], 160))
    dot_row(d, cx, cy + ph // 2 + 55, BLUE, WHITE, r=16, gap=76)

    img.convert("RGB").save("assets/icon.png")
    print("OK assets/icon.png")


# ─── adaptive-icon.png  1024×1024  (transparent bg, Android foreground) ──────

def make_adaptive_icon():
    S = 1024
    img = Image.new("RGBA", (S, S), TRANS)
    d = ImageDraw.Draw(img)

    cx, cy = S // 2, S // 2 - 40
    pw, ph = 600, 200
    capsule(d, cx, cy, pw, ph, WHITE)
    score_line(d, cx, cy, ph, (*NAVY[:3], 180))
    dot_row(d, cx, cy + ph // 2 + 52, BLUE, WHITE, r=15, gap=72)

    img.save("assets/adaptive-icon.png")
    print("OK assets/adaptive-icon.png")


# ─── splash-icon.png  512×512 ────────────────────────────────────────────────

def make_splash():
    S = 512
    img = Image.new("RGBA", (S, S), TRANS)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([64, 64, S - 65, S - 65], radius=100, fill=NAVY)

    cx, cy = S // 2, S // 2 - 20
    pw, ph = 280, 96
    capsule(d, cx, cy, pw, ph, WHITE)
    score_line(d, cx, cy, ph, (*NAVY[:3], 160))
    dot_row(d, cx, cy + ph // 2 + 28, BLUE, WHITE, r=8, gap=36)

    img.convert("RGB").save("assets/splash-icon.png")
    print("OK assets/splash-icon.png")


# ─── favicon.png  48×48 ──────────────────────────────────────────────────────

def make_favicon():
    S = 48
    img = Image.new("RGBA", (S, S), TRANS)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=10, fill=NAVY)
    capsule(d, S // 2, S // 2, 32, 12, WHITE)
    img.save("assets/favicon.png")
    print("OK assets/favicon.png")


if __name__ == "__main__":
    make_icon()
    make_adaptive_icon()
    make_splash()
    make_favicon()
    print("\nAll assets generated.")
