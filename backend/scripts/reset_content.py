"""One-shot content wipe for re-seeding from scratch.

Deletes every test variant (sections/tasks/questions cascade) and every
attempt (answers cascade). Run inside the backend container where
DATABASE_URL points at Postgres:

    python -m scripts.reset_content
"""

import asyncio

from sqlalchemy import delete, func, select

from app.core.database import SessionLocal
from app.models import Attempt, TestVariant


async def main() -> None:
    async with SessionLocal() as db:
        tests = await db.scalar(select(func.count()).select_from(TestVariant))
        attempts = await db.scalar(select(func.count()).select_from(Attempt))
        # Attempts first — their FK to test_variants has no ON DELETE CASCADE.
        await db.execute(delete(Attempt))
        await db.execute(delete(TestVariant))
        await db.commit()
        print(f"Removed {int(tests or 0)} tests and {int(attempts or 0)} attempts.")


if __name__ == "__main__":
    asyncio.run(main())
