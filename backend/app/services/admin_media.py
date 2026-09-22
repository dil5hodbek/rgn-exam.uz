import mimetypes
import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models import MediaAsset

MEDIA_EXTENSIONS = {
    ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".ogg": "audio/ogg",
    ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp",
}
IMAGE_EXTENSIONS = {
    ext: mime for ext, mime in MEDIA_EXTENSIONS.items() if mime.startswith("image/")
}


async def _write_upload(upload: UploadFile, allowed: dict[str, str], subdir: str, max_bytes: int) -> Path:
    suffix = Path(upload.filename or "").suffix.lower()
    if suffix not in allowed:
        raise HTTPException(415, f"Upload one of: {', '.join(sorted(allowed))}.")
    settings.storage_path.mkdir(parents=True, exist_ok=True)
    target = settings.storage_path / subdir / f"{uuid.uuid4()}{suffix}"
    target.parent.mkdir(parents=True, exist_ok=True)
    size = 0
    with target.open("wb") as output:
        while chunk := await upload.read(1024 * 1024):
            size += len(chunk)
            if size > max_bytes:
                output.close()
                target.unlink(missing_ok=True)
                raise HTTPException(413, "The file is too large.")
            output.write(chunk)
    return target


async def save_media_upload(upload: UploadFile, uploaded_by: uuid.UUID, db: AsyncSession) -> MediaAsset:
    target = await _write_upload(upload, MEDIA_EXTENSIONS, "media", settings.max_upload_mb * 1024 * 1024)
    media = MediaAsset(
        file_name=upload.filename or target.name,
        file_url=f"/media/media/{target.name}",
        mime_type=mimetypes.guess_type(upload.filename or "")[0] or MEDIA_EXTENSIONS[target.suffix.lower()],
        uploaded_by=uploaded_by,
    )
    db.add(media)
    await db.flush()
    return media


AVATAR_MAX_MB = 5


async def save_avatar_upload(upload: UploadFile) -> str:
    """Stores a student's profile picture and returns its public URL. Kept
    separate from save_media_upload (no MediaAsset row, image-only, smaller
    size cap) since an avatar isn't exam content and is looked up straight
    off the User row rather than through the shared media table."""
    target = await _write_upload(upload, IMAGE_EXTENSIONS, "avatars", AVATAR_MAX_MB * 1024 * 1024)
    return f"/media/avatars/{target.name}"


def media_payload(media: MediaAsset) -> dict:
    return {"id": str(media.id), "file_name": media.file_name, "url": media.file_url, "mime_type": media.mime_type}
