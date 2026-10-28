"""Build the TUTUTIKTOK site assets from one small brand specification."""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont


OUT = Path(__file__).resolve().parent
PURPLE = (141, 100, 246, 255)  # sampled from the supplied tutu mark
DEEP_PURPLE = (61, 35, 111, 255)
WHITE = (255, 255, 255, 255)
FONT_PATH = "/System/Library/Fonts/SFNSRounded.ttf"


def rounded_icon(size: int) -> Image.Image:
    scale = max(1, 2048 // size)
    width = size * scale
    icon = Image.new("RGBA", (width, width))
    draw = ImageDraw.Draw(icon)

    def p(point):
        return tuple(round(value * width / 512) for value in point)

    draw.rounded_rectangle((0, 0, width - 1, width - 1), radius=round(width * 0.22), fill=PURPLE)

    # Soft play shape, sampled from a cubic curve so the PNG and SVG share the same silhouette.
    vertices = []
    start = (169, 93)

    def line(end):
        vertices.append(p(end))

    def curve(a, b, c, end):
        for step in range(1, 41):
            t = step / 40
            u = 1 - t
            point = (
                u**3 * a[0] + 3 * u**2 * t * b[0] + 3 * u * t**2 * c[0] + t**3 * end[0],
                u**3 * a[1] + 3 * u**2 * t * b[1] + 3 * u * t**2 * c[1] + t**3 * end[1],
            )
            line(point)

    line(start)
    curve(start, (139, 75), (105, 96), (105, 132))
    line((105, 380))
    curve((105, 380), (105, 416), (139, 437), (169, 419))
    line((402, 281))
    curve((402, 281), (426, 267), (426, 245), (402, 231))
    line(start)
    draw.polygon(vertices, fill=WHITE)

    # A broad lowercase t cutout survives the small favicon sizes.
    draw.rounded_rectangle((*p((220, 157)), *p((281, 357))), radius=round(width * 0.06), fill=PURPLE)
    draw.rounded_rectangle((*p((174, 210)), *p((327, 267))), radius=round(width * 0.04), fill=PURPLE)
    return icon.resize((size, size), Image.Resampling.LANCZOS)


def wordmark(text_color, filename):
    font = ImageFont.truetype(FONT_PATH, 184)
    font.set_variation_by_name("Black")
    title = "тутутикток"
    spacing = -6
    icon_size = 248
    gap = 38
    advances = [font.getlength(letter) + spacing for letter in title]
    text_width = round(sum(advances) - spacing)
    height = 288
    width = icon_size + gap + text_width + 24
    canvas = Image.new("RGBA", (width, height))
    canvas.alpha_composite(rounded_icon(icon_size), (0, (height - icon_size) // 2))
    draw = ImageDraw.Draw(canvas)
    bbox = font.getbbox(title)
    top = round((height - (bbox[3] - bbox[1])) / 2 - bbox[1])
    x = icon_size + gap
    for letter, advance in zip(title, advances):
        draw.text((round(x), top), letter, font=font, fill=text_color)
        x += advance
    canvas.save(OUT / filename, optimize=True)


if __name__ == "__main__":
    for dimension in (16, 32, 180, 512):
        rounded_icon(dimension).save(OUT / f"icon-{dimension}.png", optimize=True)
    rounded_icon(64).save(OUT / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
    wordmark(WHITE, "logo-on-dark.png")
    wordmark(DEEP_PURPLE, "logo-on-light.png")
