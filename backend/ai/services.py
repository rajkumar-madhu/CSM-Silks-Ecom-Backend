from __future__ import annotations

import base64
import logging
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeout
from pathlib import Path

from django.conf import settings
from urllib.request import urlopen

logger = logging.getLogger(__name__)

# The try-on endpoint is AllowAny and writes into MEDIA_ROOT, which is served publicly under
# /media on the same origin as the admin and API. Never derive the on-disk extension from a
# client-supplied media type: mapping through this table is what stops a caller from planting
# a .html/.svg file in a directory the browser will happily execute in our origin.
_IMAGE_EXTENSIONS = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}
# Unbounded writes would let an anonymous caller fill the RWO PVC.
MAX_IMAGE_BYTES = getattr(settings, "AI_MAX_IMAGE_BYTES", 8 * 1024 * 1024)


def _resolve_extension(media_type: str) -> str | None:
    return _IMAGE_EXTENSIONS.get((media_type or "").split(";")[0].strip().lower())


def _write_image(binary: bytes, extension: str, subdir: str) -> str | None:
    if len(binary) > MAX_IMAGE_BYTES:
        logger.warning("Rejected image of %d bytes (limit %d)", len(binary), MAX_IMAGE_BYTES)
        return None
    filename = f"{subdir}/{uuid.uuid4().hex}.{extension}"
    path = Path(settings.MEDIA_ROOT) / filename
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(binary)
    return f"{settings.MEDIA_URL}{filename}"


def save_base64_image(base64_data: str, media_type: str, subdir: str = "tryon") -> str | None:
    """Save a base64 image to MEDIA_ROOT and return the relative URL path."""
    try:
        extension = _resolve_extension(media_type)
        if extension is None:
            logger.warning("Rejected upload with unsupported media type %r", media_type)
            return None
        # Cap before decoding so an oversized payload is never materialised in memory.
        if len(base64_data or "") > (MAX_IMAGE_BYTES // 3 + 1) * 4 + 8:
            logger.warning("Rejected oversized base64 image payload")
            return None
        binary = base64.b64decode(base64_data, validate=True)
        return _write_image(binary, extension, subdir)
    except Exception as exc:
        logger.error("save_base64_image failed: %s", exc)
        return None


def download_and_save_image(image_url: str, subdir: str = "tryon") -> str | None:
    """Download an image from a URL and save to MEDIA_ROOT. Returns relative URL."""
    try:
        with urlopen(image_url, timeout=30) as resp:
            extension = _resolve_extension(resp.headers.get_content_type() or "")
            if extension is None:
                logger.warning("Rejected download from %s: unsupported content type", image_url)
                return None
            # Read one byte past the cap so an over-limit body is detected without buffering it all.
            data = resp.read(MAX_IMAGE_BYTES + 1)
        return _write_image(data, extension, subdir)
    except Exception as exc:
        logger.error("download_and_save_image failed for %s: %s", image_url, exc)
        return None


def generate_virtual_tryon(
    person_image_url: str,
    garment_image_url: str,
    category: str = "dresses",
) -> tuple[str | None, str | None, int]:
    """Call Replicate IDM-VTON and return (local_result_url, error, latency_ms)."""
    if not settings.VIRTUAL_TRYON_ENABLED:
        return None, "Virtual try-on not configured (REPLICATE_API_TOKEN missing).", 0

    started = time.perf_counter()
    try:
        import replicate as replicate_client

        def _run():
            return replicate_client.run(
                settings.VIRTUAL_TRYON_MODEL,
                input={
                    "human_image": person_image_url,
                    "garment_image": garment_image_url,
                    "category": category,
                },
            )

        # replicate.run() polls to completion with no timeout of its own, and IDM-VTON
        # routinely takes 30-60s+. Left unbounded it outlives ingress-nginx's 60s
        # proxy_read_timeout, so the customer gets a 504 while the paid job runs on.
        # Bound the wait so we answer first. NOTE: this only bounds *our* wait — the
        # Replicate job still completes and is still billed. Moving this to a Celery task
        # with a polled result is the real fix.
        with ThreadPoolExecutor(max_workers=1) as pool:
            try:
                output = pool.submit(_run).result(timeout=settings.AI_VTON_TIMEOUT_SECONDS)
            except FuturesTimeout:
                latency_ms = int((time.perf_counter() - started) * 1000)
                logger.warning(
                    "VTON timed out after %ss (job continues on Replicate)",
                    settings.AI_VTON_TIMEOUT_SECONDS,
                )
                return None, "Try-on is taking longer than usual. Please try again shortly.", latency_ms
        latency_ms = int((time.perf_counter() - started) * 1000)

        result_url: str | None = None
        if isinstance(output, list):
            result_url = str(output[0]) if output else None
        elif isinstance(output, str):
            result_url = output
        elif output is not None:
            result_url = str(output)

        if not result_url:
            return None, "Replicate returned no output.", latency_ms

        saved = download_and_save_image(result_url, subdir="tryon/results")
        return saved, None, latency_ms

    except Exception as exc:
        latency_ms = int((time.perf_counter() - started) * 1000)
        logger.error("Replicate VTON failed: %s", exc)
        return None, str(exc)[:300], latency_ms
