import mimetypes
import uuid

from fastapi import HTTPException

from app.object_storage import upload_bytes

_ALLOWED_EXTS = {"jpg", "jpeg", "png", "webp", "pdf"}


async def save_screenshot(content: bytes, filename: str) -> str:
    """Save an already-read payment/refund proof screenshot to disk and return its
    path relative to `payment-screenshots/` (as stored in `screenshot_path`/
    `refund_screenshot_path`). Takes raw bytes (not UploadFile) so callers that also
    need to forward the same bytes elsewhere (e.g. the AI screenshot parser) can read
    the upload exactly once."""
    ext = (filename or "screenshot.jpg").rsplit(".", 1)[-1].lower()
    if ext not in _ALLOWED_EXTS:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: .{ext}")

    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    saved_filename = f"{uuid.uuid4()}.{ext}"
    object_key = f"payment-screenshots/{saved_filename}"
    content_type = mimetypes.guess_type(saved_filename)[0] or "application/octet-stream"
    await upload_bytes(object_key, content, content_type)

    return object_key
