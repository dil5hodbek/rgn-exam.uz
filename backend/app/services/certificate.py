"""Certificate PDF: the designer's template with the result written into its blanks.

The template (assets/certificate_template.pdf, A4 landscape, all text outlined)
reads "...“Darajani aniqlash” imtihonida ____ darajadagi / ____ kursini ____
natija asosida baholandi!". We draw the level, the course stage (Mid/End) and
the percentage on a transparent overlay and merge it onto the template page, so
the logos, stamp, QR code and gradient stay vector-exact.
"""

import io
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from reportlab.lib.colors import HexColor
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

_ASSETS = Path(__file__).resolve().parent.parent / "assets"
_TEMPLATE = _ASSETS / "certificate_template.pdf"

# Helvetica only covers Latin-1; Noto Sans also covers the Uzbek ʻ and Cyrillic.
_BOLD = "NotoSans-Bold"
if _BOLD not in pdfmetrics.getRegisteredFontNames():
    pdfmetrics.registerFont(TTFont(_BOLD, str(_ASSETS / "fonts" / "NotoSans-Bold.ttf")))

INK = HexColor("#111111")
FONT_SIZE = 21.0
MIN_FONT_SIZE = 12.0

# Blank slots measured on the template, in points from the bottom-left corner
# (page is 841.89 x 595.28). x_from/x_to bound the free space on that line.
_LINE3_BASELINE = 595.28 - 382.0   # "____ darajadagi"
_LINE4_BASELINE = 595.28 - 410.0   # "____ kursini ____ natija asosida"
_LEVEL_SLOT = (58.0, 266.0, _LINE3_BASELINE)
_STAGE_SLOT = (58.0, 111.0, _LINE4_BASELINE)
_PERCENT_SLOT = (186.0, 250.0, _LINE4_BASELINE)


def course_stage_label(exam_type_slug: str, exam_type_name: str) -> str:
    """'mid-course' -> 'Mid', 'end-course' -> 'End'; other types keep their name."""
    slug = (exam_type_slug or "").lower()
    if slug.startswith("mid"):
        return "Mid"
    if slug.startswith("end"):
        return "End"
    return exam_type_name


def _fit_size(text: str, max_width: float) -> float:
    size = FONT_SIZE
    while size > MIN_FONT_SIZE and pdfmetrics.stringWidth(text, _BOLD, size) > max_width:
        size -= 0.5
    return size


def _draw_left(c: canvas.Canvas, text: str, slot: tuple[float, float, float]) -> None:
    x_from, x_to, baseline = slot
    c.setFont(_BOLD, _fit_size(text, x_to - x_from))
    c.drawString(x_from, baseline, text)


def _draw_centred(c: canvas.Canvas, text: str, slot: tuple[float, float, float]) -> None:
    x_from, x_to, baseline = slot
    c.setFont(_BOLD, _fit_size(text, x_to - x_from - 4))
    c.drawCentredString((x_from + x_to) / 2, baseline, text)


def generate_certificate_pdf(
    *,
    level_name: str,
    exam_type_slug: str,
    exam_type_name: str,
    percentage: float,
) -> bytes:
    template_page = PdfReader(str(_TEMPLATE)).pages[0]
    width = float(template_page.mediabox.width)
    height = float(template_page.mediabox.height)

    overlay_buf = io.BytesIO()
    c = canvas.Canvas(overlay_buf, pagesize=(width, height))
    c.setFillColor(INK)
    _draw_centred(c, level_name, _LEVEL_SLOT)
    _draw_left(c, course_stage_label(exam_type_slug, exam_type_name), _STAGE_SLOT)
    _draw_centred(c, f"{percentage:.0f}%", _PERCENT_SLOT)
    c.showPage()
    c.save()

    template_page.merge_page(PdfReader(io.BytesIO(overlay_buf.getvalue())).pages[0])
    writer = PdfWriter()
    writer.add_page(template_page)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()
