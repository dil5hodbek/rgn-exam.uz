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


async def save_media_upload(upload: UploadFile, uploaded_by: uuid.UUID, db: AsyncSession) -> MediaAsset:
    suffix = Path(upload.filename or "").suffix.lower()
    if suffix not in MEDIA_EXTENSIONS:
        raise HTTPException(415, "Upload an audio, video, or image file (mp3, wav, m4a, ogg, mp4, webm, mov, png, jpg, gif, webp).")
    settings.storage_path.mkdir(parents=True, exist_ok=True)
    target = settings.storage_path / "media" / f"{uuid.uuid4()}{suffix}"
    target.parent.mkdir(parents=True, exist_ok=True)
    size = 0
    with target.open("wb") as output:
        while chunk := await upload.read(1024 * 1024):
            size += len(chunk)
            if size > settings.max_upload_mb * 1024 * 1024:
                output.close()
                target.unlink(missing_ok=True)
                raise HTTPException(413, "The file is too large.")
            output.write(chunk)
    media = MediaAsset(
        file_name=upload.filename or target.name,
        file_url=f"/media/media/{target.name}",
        mime_type=mimetypes.guess_type(upload.filename or "")[0] or MEDIA_EXTENSIONS[suffix],
        uploaded_by=uploaded_by,
    )
    db.add(media)
    await db.flush()
    return media


def media_payload(media: MediaAsset) -> dict:
    return {"id": str(media.id), "file_name": media.file_name, "url": media.file_url, "mime_type": media.mime_type}
