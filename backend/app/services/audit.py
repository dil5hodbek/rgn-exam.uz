import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AdminAuditLog


async def write_audit(
    db: AsyncSession,
    actor_id: uuid.UUID,
    action: str,
    entity_type: str,
    entity_id: str | None = None,
    metadata: dict[str, Any] | None = None,
    ip_address: str | None = None,
) -> None:
    db.add(AdminAuditLog(
        actor_id=actor_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        metadata_json=metadata or {},
        ip_address=ip_address,
    ))
