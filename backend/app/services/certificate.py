import io
from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import landscape, A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


INK = HexColor("#1E2A42")
ACCENT = HexColor("#157A5C")
INK_SOFT = HexColor("#4A5670")

# The base-14 Helvetica font reportlab falls back to only covers
# WinAnsi/Latin-1, so it silently drops Cyrillic names and the Uzbek Latin
# apostrophe (U+02BB) used in official spellings. Noto Sans covers both.
_FONTS_DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"
_REGULAR = "NotoSans"
_BOLD = "NotoSans-Bold"
if _REGULAR not in pdfmetrics.getRegisteredFontNames():
    pdfmetrics.registerFont(TTFont(_REGULAR, str(_FONTS_DIR / "NotoSans-Regular.ttf")))
    pdfmetrics.registerFont(TTFont(_BOLD, str(_FONTS_DIR / "NotoSans-Bold.ttf")))


def generate_certificate_pdf(
    *,
    full_name: str,
    phone_number: str,
    level_name: str,
    exam_type_name: str,
    percentage: float,
) -> bytes:
    buffer = io.BytesIO()
    width, height = landscape(A4)
    c = canvas.Canvas(buffer, pagesize=(width, height))

    c.setFillColor(HexColor("#F3F5F2"))
    c.rect(0, 0, width, height, fill=True, stroke=False)

    margin = 28
    c.setStrokeColor(ACCENT)
    c.setLineWidth(2.5)
    c.rect(margin, margin, width - 2 * margin, height - 2 * margin, fill=False, stroke=True)
    c.setStrokeColor(INK)
    c.setLineWidth(0.75)
    c.rect(margin + 8, margin + 8, width - 2 * (margin + 8), height - 2 * (margin + 8), fill=False, stroke=True)

    c.setFillColor(ACCENT)
    c.setFont(_BOLD, 13)
    c.drawCentredString(width / 2, height - 90, "REGISTON O'QUV MARKAZI")

    c.setFillColor(INK)
    c.setFont(_BOLD, 34)
    c.drawCentredString(width / 2, height - 140, "SERTIFIKAT")

    c.setFillColor(INK_SOFT)
    c.setFont(_REGULAR, 13)
    c.drawCentredString(width / 2, height - 175, "ushbu sertifikat quyidagi shaxsga topshiriladi")

    c.setFillColor(INK)
    c.setFont(_BOLD, 26)
    c.drawCentredString(width / 2, height - 225, full_name)

    c.setFillColor(INK_SOFT)
    c.setFont(_REGULAR, 11)
    c.drawCentredString(width / 2, height - 245, phone_number)

    result_line = (
        f"Registon o'quv markazi tomonidan {level_name} darajada "
        f"{exam_type_name} imtihonida {percentage:.0f}% natija bilan baholandi."
    )
    c.setFillColor(INK)
    c.setFont(_REGULAR, 14)
    c.drawCentredString(width / 2, height - 290, result_line)

    c.setFillColor(ACCENT)
    c.setFont(_BOLD, 40)
    c.drawCentredString(width / 2, height - 350, f"{percentage:.0f}%")

    c.setFillColor(INK_SOFT)
    c.setFont(_REGULAR, 9)
    c.drawCentredString(width / 2, margin + 30, "rgn-exam.uz")

    c.showPage()
    c.save()
    return buffer.getvalue()
