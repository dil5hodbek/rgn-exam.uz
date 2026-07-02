import asyncio

from sqlalchemy import select

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.security import hash_password
from app.models import (
    ExamType, Level, Role, User,
)

LEVELS = [
    ("Beginner", "beginner", "Build a confident foundation.", 1),
    ("Elementary", "elementary", "Use English in everyday situations.", 2),
    ("Pre-Intermediate", "pre-intermediate", "Connect ideas with growing fluency.", 3),
    ("Intermediate", "intermediate", "Communicate with precision and range.", 4),
]


async def seed():
    async with SessionLocal() as db:
        admin = await db.scalar(select(User).where(User.phone_number == settings.admin_phone))
        if not admin:
            admin = User(
                first_name="ExamFlow", last_name="Administrator",
                phone_number=settings.admin_phone, password_hash=hash_password(settings.admin_password),
                role=Role.SUPER_ADMIN,
            )
            db.add(admin)
        await db.flush()
        level_rows = {}
        for name, slug, description, order in LEVELS:
            row = await db.scalar(select(Level).where(Level.slug == slug))
            if not row:
                row = Level(name=name, slug=slug, description=description, order_index=order)
                db.add(row)
                await db.flush()
            level_rows[slug] = row
        exam_types = {}
        for name, slug in [("Mid-course Exam", "mid-course"), ("End-course Exam", "end-course")]:
            row = await db.scalar(select(ExamType).where(ExamType.slug == slug))
            if not row:
                row = ExamType(name=name, slug=slug)
                db.add(row)
                await db.flush()
            exam_types[slug] = row
        await db.commit()


if __name__ == "__main__":
    asyncio.run(seed())
