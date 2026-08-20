from __future__ import annotations

import logging
from datetime import timedelta
from pathlib import Path

from celery import shared_task
from django.conf import settings
from django.utils import timezone

from .models import TryOnSession

logger = logging.getLogger(__name__)


def _media_path(relative_url: str) -> Path | None:
    """Map a stored /media/... URL back to its on-disk path, refusing escapes."""
    if not relative_url:
        return None
    media_url = settings.MEDIA_URL
    if not relative_url.startswith(media_url):
        return None
    media_root = Path(settings.MEDIA_ROOT).resolve()
    candidate = (media_root / relative_url[len(media_url):]).resolve()
    # A crafted path must never let us unlink outside MEDIA_ROOT.
    if not candidate.is_relative_to(media_root):
        logger.warning("Refusing to delete out-of-root path %s", candidate)
        return None
    return candidate


def purge_expired_tryon_photos(now=None) -> dict:
    """Delete customer try-on photos older than AI_TRYON_PHOTO_RETENTION_DAYS.

    TryOnView is AllowAny and writes body photos of real people into MEDIA_ROOT, which is
    served unauthenticated under /media. Without this they were retained forever and the
    RWO PVC grew without bound. The session row is kept for analytics; only the image
    files and their paths are cleared.
    """
    now = now or timezone.now()
    cutoff = now - timedelta(days=settings.AI_TRYON_PHOTO_RETENTION_DAYS)
    sessions = TryOnSession.objects.filter(created_at__lt=cutoff).exclude(
        customer_photo="", result_image=""
    )
    deleted_files = 0
    cleared_rows = 0
    for session in sessions.iterator():
        for field in ("customer_photo", "result_image"):
            path = _media_path(getattr(session, field))
            if path and path.is_file():
                try:
                    path.unlink()
                    deleted_files += 1
                except OSError as exc:
                    logger.warning("Could not delete %s: %s", path, exc)
        session.customer_photo = ""
        session.result_image = ""
        session.save(update_fields=["customer_photo", "result_image"])
        cleared_rows += 1
    return {"deleted_files": deleted_files, "cleared_rows": cleared_rows}


@shared_task(name="ai.purge_expired_tryon_photos")
def purge_expired_tryon_photos_task() -> dict:
    return purge_expired_tryon_photos()
