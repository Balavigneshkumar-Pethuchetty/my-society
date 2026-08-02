"""
QR code + composited shareable pass image generation.

GET /passes/{id}/qr returns the raw QR PNG (fast, no layout).
GET /passes/{id}/pass-image.png returns the full shareable pass card — the
backend composites QR + resident/visitor details into one PNG with Pillow
(qrcode[pil] already brings Pillow as a dependency, same library ticket-service
uses for its SVG QR, just a different output mode here). Requires
fonts-dejavu-core installed in the Dockerfile's runtime stage for text
rendering — no service in this repo previously drew text into an image.

The card is themed by visitor_category (see 004_visitor_category.sql) —
purely a resident-chosen cosmetic flag, nothing else behaves differently by
category. 'family' reads as a warm "you're welcome home" invitation (greets
the visitor by name, groups the visit under casual "Visiting"/"Dates"
labels); 'other' reads as a more official "Permission Granted" access pass
(formal "Host"/"Valid From"/"Valid To" labels). Both gradients/icons/badges
are drawn in code (no image assets) — this container has no bundled artwork
and no internet access at build time.
"""
import io
import textwrap
from datetime import datetime

import qrcode
from PIL import Image, ImageDraw, ImageFont

from app.config import settings

_FONT_DIR = "/usr/share/fonts/truetype/dejavu"
_CANVAS_W = 800
_MARGIN = 40

_THEMES = {
    "family": {
        "bg_top": (255, 244, 227),
        "bg_bottom": (255, 213, 170),
        "header_left": (196, 74, 34),
        "header_right": (240, 160, 80),
        "accent": (150, 60, 20),
        "header_top": f"Welcome to {settings.society_name}",
        "header_main": "Visiting the Family",
        "header_sub": None,
        "badge_caption": None,
        "greeting": "Welcome, {name}!",
        "footer": "See you soon! Welcome to your home away from home.",
        "icon": "home",
    },
    "other": {
        "bg_top": (232, 241, 250),
        "bg_bottom": (203, 222, 242),
        "header_left": (24, 49, 82),
        "header_right": (45, 91, 137),
        "accent": (24, 49, 82),
        "header_top": settings.society_name,
        "header_main": "Visitor Pass",
        "header_sub": "Guests & Staff",
        "badge_caption": "Permission\nGranted",
        "greeting": None,
        "footer": "Please carry this pass during your visit.",
        "icon": "shield",
    },
}


def _theme_for(visitor_category) -> dict:
    return _THEMES.get(visitor_category or "other", _THEMES["other"])


def _font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    name = "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
    try:
        return ImageFont.truetype(f"{_FONT_DIR}/{name}", size)
    except OSError:
        return ImageFont.load_default()


def _font_serif(size: int) -> ImageFont.FreeTypeFont:
    """Serif face for the family greeting heading — reads warmer/more like an
    invitation card than the body's plain sans-serif."""
    try:
        return ImageFont.truetype(f"{_FONT_DIR}/DejaVuSerif-Bold.ttf", size)
    except OSError:
        return ImageFont.load_default()


def generate_qr_png(token: str) -> bytes:
    img = qrcode.make(token, box_size=8, border=2)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _date_range_label(valid_from: datetime, valid_to: datetime) -> str:
    """Casual, date-only range for the family theme's combined 'Dates' row
    (the guest theme keeps separate, full Valid From/To timestamps for
    precision) — e.g. '03 Aug 2026', '03–04 Aug 2026', or '28 Jul – 03 Aug 2026'."""
    if valid_from.date() == valid_to.date():
        return valid_from.strftime("%d %b %Y")
    if (valid_from.year, valid_from.month) == (valid_to.year, valid_to.month):
        return f"{valid_from.strftime('%d')}–{valid_to.strftime('%d %b %Y')}"
    return f"{valid_from.strftime('%d %b')} – {valid_to.strftime('%d %b %Y')}"


def _vertical_gradient(w: int, h: int, top: tuple, bottom: tuple) -> Image.Image:
    canvas = Image.new("RGB", (w, h))
    draw = ImageDraw.Draw(canvas)
    for y in range(h):
        t = y / max(h - 1, 1)
        row = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        draw.line([(0, y), (w, y)], fill=row)
    return canvas


def _horizontal_gradient_box(draw: ImageDraw.ImageDraw, box: tuple, left: tuple, right: tuple) -> None:
    x0, y0, x1, y1 = box
    w = x1 - x0
    for x in range(w):
        t = x / max(w - 1, 1)
        col = tuple(int(left[i] + (right[i] - left[i]) * t) for i in range(3))
        draw.line([(x0 + x, y0), (x0 + x, y1)], fill=col)


def _draw_home_icon(draw: ImageDraw.ImageDraw, cx: float, cy: float, size: float) -> None:
    half = size / 2
    draw.polygon([(cx - half, cy), (cx, cy - half), (cx + half, cy)], fill="white")
    draw.rectangle([cx - half * 0.7, cy, cx + half * 0.7, cy + half], fill="white")


def _draw_shield_icon(draw: ImageDraw.ImageDraw, cx: float, cy: float, size: float, mark_color: tuple) -> None:
    half = size / 2
    draw.polygon(
        [
            (cx - half, cy - half), (cx + half, cy - half),
            (cx + half, cy + half * 0.2), (cx, cy + half), (cx - half, cy + half * 0.2),
        ],
        fill="white",
    )
    draw.line(
        [(cx - half * 0.4, cy), (cx - half * 0.05, cy + half * 0.35), (cx + half * 0.5, cy - half * 0.3)],
        fill=mark_color, width=max(3, int(size // 10)),
    )


def _tint(rgb: tuple, toward_white: float) -> tuple:
    return tuple(int(c + (255 - c) * toward_white) for c in rgb)


def _draw_badge(draw: ImageDraw.ImageDraw, cx: float, cy: float, radius: float, theme: dict) -> None:
    """Circular icon badge at the header's left edge — a lighter halo of the
    header's own gradient start color, with the theme's pictogram centered
    inside (and, for 'other', a small 'Permission Granted'-style caption
    beneath it, matching the reference mockup's checkmark badge)."""
    halo = tuple(min(255, c + 35) for c in theme["header_left"])
    draw.ellipse([cx - radius, cy - radius, cx + radius, cy + radius], fill=halo)
    icon_size = radius * 1.15
    if theme["icon"] == "home":
        _draw_home_icon(draw, cx, cy, icon_size)
    else:
        _draw_shield_icon(draw, cx, cy, icon_size, theme["header_left"])
    if theme["badge_caption"]:
        cap_font = _font(12, bold=True)
        for i, line in enumerate(theme["badge_caption"].split("\n")):
            w = draw.textlength(line, font=cap_font)
            draw.text((cx - w / 2, cy + radius + 6 + i * 15), line, font=cap_font, fill="white")


def generate_pass_image(pass_row: dict) -> bytes:
    theme = _theme_for(pass_row.get("visitor_category"))
    accent = theme["accent"]
    is_family = pass_row.get("visitor_category") == "family"

    label_font = _font(20, bold=True)
    value_font = _font(20)
    header_top_font = _font(17)
    header_main_font = _font(30, bold=True)
    header_sub_font = _font(16)
    greeting_font = _font_serif(30)
    footer_font = _font(16)

    visitor_count = pass_row.get("visitor_count") or 1
    visiting_value = pass_row["visitor_name"]
    if visitor_count > 1 or pass_row.get("additional_visitor_names"):
        visiting_value += " & Family" if is_family else f" +{visitor_count - 1}"

    lines: list[tuple[str, str]] = []
    if is_family:
        lines.append(("Resident", pass_row["resident_name"] + (f" ({pass_row['resident_flat']})" if pass_row.get("resident_flat") else "")))
        lines.append(("Visiting", visiting_value))
        lines.append(("For", pass_row["purpose"]))
        lines.append(("Dates", _date_range_label(pass_row["valid_from"], pass_row["valid_to"])))
    else:
        lines.append(("Host", pass_row["resident_name"] + (f" ({pass_row['resident_flat']})" if pass_row.get("resident_flat") else "")))
        lines.append(("Visitor Name", visiting_value))
        lines.append(("Purpose", pass_row["purpose"]))
        lines.append(("Valid From", pass_row["valid_from"].strftime("%d %b %Y, %I:%M %p")))
        lines.append(("Valid To", pass_row["valid_to"].strftime("%d %b %Y, %I:%M %p")))
        if visitor_count > 1:
            lines.append(("Group Size", f"{visitor_count} people"))
    if pass_row.get("vehicle_number"):
        lines.append(("Vehicle", str(pass_row["vehicle_number"])))
    for label, key in (("Contact", "contact"), ("Aadhaar", "aadhaar"), ("Email", "email"), ("Address", "address")):
        value = pass_row.get(key)
        if value:
            lines.append((label, str(value)))
    additional_names_lines: list[str] = []
    if pass_row.get("additional_visitor_names"):
        wrapped = textwrap.wrap(pass_row["additional_visitor_names"], width=48) or [""]
        additional_names_lines = wrapped

    qr_img = Image.open(io.BytesIO(generate_qr_png(pass_row["qr_token"]))).convert("RGB")
    qr_size = 320
    qr_img = qr_img.resize((qr_size, qr_size))

    line_height = 38
    header_h = 150
    greeting_h = 46 if theme["greeting"] else 0
    body_h = len(lines) * line_height + 30
    names_h = (len(additional_names_lines) + 1) * 26 if additional_names_lines else 0
    footer_h = 46
    canvas_h = header_h + greeting_h + body_h + names_h + qr_size + footer_h + _MARGIN * 3

    canvas = _vertical_gradient(_CANVAS_W, canvas_h, theme["bg_top"], theme["bg_bottom"])
    draw = ImageDraw.Draw(canvas)

    # Value column starts past the widest label in this pass's field list
    # (e.g. 'Visitor Name:'/'Group Size:' need more room than a fixed 160px).
    value_x = _MARGIN + max(int(draw.textlength(f"{label}:", font=label_font)) for label, _ in lines) + 24

    # Header — icon badge at the left edge, title stack to its right
    _horizontal_gradient_box(draw, (0, 0, _CANVAS_W, header_h), theme["header_left"], theme["header_right"])
    badge_cx, badge_radius = _MARGIN + 38, 38
    _draw_badge(draw, badge_cx, header_h // 2, badge_radius, theme)

    text_x = badge_cx + badge_radius + 26
    text_y = _MARGIN
    if theme["header_top"]:
        draw.text((text_x, text_y), theme["header_top"], font=header_top_font, fill="white")
        text_y += 26
    draw.text((text_x, text_y), theme["header_main"], font=header_main_font, fill="white")
    text_y += 38
    if theme["header_sub"]:
        draw.text((text_x, text_y), theme["header_sub"], font=header_sub_font, fill="white")

    y = header_h + _MARGIN // 2

    # Personal greeting (family theme only) — sits above the details panel,
    # directly on the gradient background, not inside the white card.
    if theme["greeting"]:
        draw.text((_MARGIN, y), theme["greeting"].format(name=pass_row["visitor_name"]), font=greeting_font, fill=accent)
        y += greeting_h

    # Body panel — solid card over the gradient so the details stay legible
    panel_top = y
    panel_bottom = panel_top + body_h + names_h + _MARGIN // 2
    draw.rounded_rectangle(
        [(_MARGIN // 2, panel_top), (_CANVAS_W - _MARGIN // 2, panel_bottom)],
        radius=16, fill="white", outline=accent, width=2,
    )

    underline_color = _tint(accent, 0.75)
    y = panel_top + _MARGIN // 2
    for label, value in lines:
        draw.text((_MARGIN, y), f"{label}:", font=label_font, fill=accent)
        draw.text((value_x, y), value, font=value_font, fill="black")
        underline_y = y + line_height - 10
        draw.line([(value_x, underline_y), (_CANVAS_W - _MARGIN, underline_y)], fill=underline_color, width=1)
        y += line_height

    if additional_names_lines:
        small_font = _font(16)
        draw.text((_MARGIN, y), "Also with:", font=label_font, fill=accent)
        y += 26
        for wrapped_line in additional_names_lines:
            draw.text((_MARGIN + 20, y), wrapped_line, font=small_font, fill="black")
            y += 22

    qr_x = (_CANVAS_W - qr_size) // 2
    qr_y = panel_bottom + _MARGIN
    draw.rounded_rectangle(
        [(qr_x - 16, qr_y - 16), (qr_x + qr_size + 16, qr_y + qr_size + 16)],
        radius=14, fill="white", outline=accent, width=3,
    )
    canvas.paste(qr_img, (qr_x, qr_y))

    footer_y = qr_y + qr_size + 24
    footer_w = draw.textlength(theme["footer"], font=footer_font)
    draw.text(((_CANVAS_W - footer_w) / 2, footer_y), theme["footer"], font=footer_font, fill=accent)

    buf = io.BytesIO()
    canvas.save(buf, format="PNG")
    return buf.getvalue()
