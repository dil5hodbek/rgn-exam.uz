import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import MediaAsset


async def batch_media_by_ids(db: AsyncSession, ids: set[uuid.UUID]) -> dict[uuid.UUID, MediaAsset]:
    """Fetch multiple MediaAsset rows in a single query, keyed by id.

    Avoids N+1 queries when resolving media for a list of tasks.
    """
    if not ids:
        return {}
    rows = (await db.execute(select(MediaAsset).where(MediaAsset.id.in_(ids)))).scalars().all()
    return {media.id: media for media in rows}
