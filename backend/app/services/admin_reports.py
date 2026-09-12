from io import BytesIO

from openpyxl import Workbook
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Attempt


async def export_attempts_workbook(db: AsyncSession) -> BytesIO:
    rows = (await db.execute(select(Attempt).order_by(Attempt.started_at.desc()))).scalars().all()
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Attempts"
    sheet.append(["Attempt ID", "Student ID", "Test Variant ID", "Status", "Score", "Maximum", "Percentage", "Started", "Submitted", "Time (seconds)"])
    for row in rows:
        sheet.append([
            str(row.id), str(row.user_id), str(row.test_variant_id), row.status.value,
            float(row.total_score or 0), float(row.max_score or 0), float(row.percentage or 0),
            row.started_at.isoformat(), row.submitted_at.isoformat() if row.submitted_at else "",
            row.time_spent_seconds or 0,
        ])
    output = BytesIO()
    workbook.save(output)
    output.seek(0)
    return output
