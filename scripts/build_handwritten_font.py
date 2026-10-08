from __future__ import annotations

from collections.abc import Iterable
from pathlib import Path

import numpy as np
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from PIL import Image
from skimage.measure import approximate_polygon, find_contours
from skimage.morphology import remove_small_objects


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "scripts" / "assets" / "letter-chart-reupload.JPG"
FONT_DIR = ROOT / "public" / "fonts"
PREVIEW_WIDTH = 768
CELL_PITCH = 25.7
CELL_WIDTH = 23
X_SCALE = 28
Y_SCALE = 38
UNITS_PER_EM = 1000


def glyph_name(character: str) -> str:
    names = {
        " ": "space",
        "×": "multiply",
        "÷": "divide",
        "+": "plus",
        "−": "minus",
        "=": "equal",
        "★": "blackstar",
        "●": "blackcircle",
        "—": "emdash",
        ":": "colon",
        "*": "asterisk",
    }
    return names.get(character, character if character.isascii() else f"uni{ord(character):04X}")


def point_inside(point: tuple[float, float], polygon: list[tuple[int, int]]) -> bool:
    x, y = point
    inside = False
    previous_x, previous_y = polygon[-1]
    for current_x, current_y in polygon:
        if (current_y > y) != (previous_y > y):
            crossing_x = (previous_x - current_x) * (y - current_y) / (previous_y - current_y) + current_x
            if x < crossing_x:
                inside = not inside
        previous_x, previous_y = current_x, current_y
    return inside


def signed_area(polygon: list[tuple[int, int]]) -> float:
    return sum(
        polygon[index][0] * polygon[(index + 1) % len(polygon)][1]
        - polygon[(index + 1) % len(polygon)][0] * polygon[index][1]
        for index in range(len(polygon))
    ) / 2


def orient_contours(contours: list[list[tuple[int, int]]]) -> list[list[tuple[int, int]]]:
    oriented = []
    for index, polygon in enumerate(contours):
        nesting_depth = sum(
            point_inside(polygon[0], other)
            for other_index, other in enumerate(contours)
            if other_index != index
        )
        should_be_clockwise = nesting_depth % 2 == 0
        if (signed_area(polygon) < 0) != should_be_clockwise:
            polygon = list(reversed(polygon))
        oriented.append(polygon)
    return oriented


def trace_glyph(
    image: Image.Image,
    character: str,
    column: int,
    top: int,
    bottom: int,
    baseline: int,
    mode: str = "pencil",
) -> tuple[list[list[tuple[int, int]]], int]:
    center_x = 29.5 + column * CELL_PITCH
    left = round(center_x - CELL_WIDTH / 2)
    crop = image.crop((left, top, left + CELL_WIDTH, bottom))
    pixels = np.asarray(crop, dtype=np.int32)

    if mode == "pencil":
        gray = (pixels[:, :, 0] * 299 + pixels[:, :, 1] * 587 + pixels[:, :, 2] * 114) // 1000
        mask = gray < 130
    else:
        red, green, blue = pixels[:, :, 0], pixels[:, :, 1], pixels[:, :, 2]
        if mode == "orange":
            mask = (red > green + 20) & (red > blue + 10) & (red > 115)
        elif mode == "purple":
            mask = (red > green + 15) & (blue > green + 15) & (red > 100) & (blue > 100)
        elif mode == "green":
            mask = (green > red + 18) & (green >= blue - 4) & (green > 110)
        else:
            mask = (blue > red + 35) & (blue > green + 15) & (blue < 235)

    mask = remove_small_objects(mask.astype(bool), max_size=1)
    if not mask.any():
        raise ValueError(f"No strokes found for {character!r} at chart column {column}")

    padded = np.pad(mask, 1)
    pixel_contours = find_contours(padded.astype(np.uint8), 0.5)
    contours = []
    cell_left = center_x - CELL_PITCH / 2
    for pixel_contour in pixel_contours:
        simplified = approximate_polygon(pixel_contour, tolerance=0.5)
        if len(simplified) < 4:
            continue
        polygon = [
            (
                round((left + column_point - 1 - cell_left) * X_SCALE),
                round((baseline - (top + row_point - 1)) * Y_SCALE),
            )
            for row_point, column_point in simplified[:-1]
        ]
        if len(polygon) >= 3:
            contours.append(polygon)

    return orient_contours(contours), round(CELL_PITCH * X_SCALE)


def make_glyph(contours: Iterable[list[tuple[int, int]]]):
    pen = TTGlyphPen(None)
    for polygon in contours:
        pen.moveTo(polygon[0])
        for point in polygon[1:]:
            pen.lineTo(point)
        pen.closePath()
    return pen.glyph()


def main() -> None:
    if not SOURCE.is_file() or SOURCE.stat().st_size == 0:
        raise FileNotFoundError(f"Put the original chart image here: {SOURCE}")

    source = Image.open(SOURCE).convert("RGB")
    preview_height = round(source.height * PREVIEW_WIDTH / source.width)
    image = source.resize((PREVIEW_WIDTH, preview_height), Image.Resampling.LANCZOS)

    specs: list[tuple[str, int, int, int, int, str]] = []
    specs.extend((chr(65 + index), index, 44, 68, 65, "pencil") for index in range(26))
    specs.extend((chr(97 + index), index, 72, 97, 91, "pencil") for index in range(26))
    specs.extend((str(index), index, 98, 122, 117, "pencil") for index in range(10))
    specs.extend([
        ("×", 11, 98, 122, 117, "pencil"),
        ("÷", 12, 98, 122, 117, "pencil"),
        ("+", 13, 98, 122, 117, "pencil"),
        ("−", 14, 98, 122, 117, "pencil"),
        ("★", 16, 98, 122, 117, "orange"),
        ("●", 17, 98, 122, 117, "purple"),
        ("—", 18, 98, 122, 117, "green"),
        (":", 19, 98, 122, 117, "blue"),
    ])

    glyph_contours: dict[str, list[list[tuple[int, int]]]] = {".notdef": [], "space": []}
    advances = {".notdef": 720, "space": 360}
    character_map = {32: "space"}

    for character, column, top, bottom, baseline, mode in specs:
        contours, advance = trace_glyph(image, character, column, top, bottom, baseline, mode)
        glyph_contours[glyph_name(character)] = contours
        advances[glyph_name(character)] = advance
        character_map[ord(character)] = glyph_name(character)

    glyph_contours[glyph_name("*")] = glyph_contours[glyph_name("★")]
    advances[glyph_name("*")] = advances[glyph_name("★")]
    character_map[ord("*")] = glyph_name("★")
    character_map[ord("-")] = glyph_name("−")

    line_contours = glyph_contours[glyph_name("—")]
    glyph_contours[glyph_name("=")] = line_contours + [
        [(x, y + 135) for x, y in polygon] for polygon in line_contours
    ]
    advances[glyph_name("=")] = advances[glyph_name("—")]
    character_map[ord("=")] = glyph_name("=")

    order = [".notdef", "space"] + sorted(set(glyph_contours) - {".notdef", "space"})
    glyphs = {name: make_glyph(glyph_contours[name]) for name in order}
    builder = FontBuilder(UNITS_PER_EM, isTTF=True)
    builder.setupGlyphOrder(order)
    builder.setupCharacterMap(character_map)
    builder.setupGlyf(glyphs)
    builder.setupHorizontalMetrics({name: (advances[name], 0) for name in order})
    builder.setupHorizontalHeader(ascent=820, descent=-240)
    builder.setupNameTable({
        "familyName": "Letter Chart Hand",
        "styleName": "Regular",
        "uniqueFontIdentifier": "Letter Chart Hand Regular 1.0",
        "fullName": "Letter Chart Hand Regular",
        "psName": "LetterChartHand-Regular",
        "version": "Version 1.000",
    })
    builder.setupOS2(
        sTypoAscender=820,
        sTypoDescender=-240,
        usWinAscent=820,
        usWinDescent=240,
        sxHeight=480,
        sCapHeight=680,
    )
    builder.setupPost()
    builder.setupMaxp()

    FONT_DIR.mkdir(parents=True, exist_ok=True)
    ttf_path = FONT_DIR / "letter-chart-hand.ttf"
    woff2_path = FONT_DIR / "letter-chart-hand.woff2"
    builder.save(ttf_path)

    font = TTFont(ttf_path)
    font.flavor = "woff2"
    font.save(woff2_path)
    print(f"Generated {len(character_map)} mapped characters:")
    print(f"  {ttf_path.relative_to(ROOT)} ({ttf_path.stat().st_size:,} bytes)")
    print(f"  {woff2_path.relative_to(ROOT)} ({woff2_path.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()