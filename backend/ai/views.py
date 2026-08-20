from __future__ import annotations

import base64
import json
import logging
import time
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

from django.conf import settings
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from catalog.models import Product
from catalog.selectors import public_products
from catalog.serializers import ProductListSerializer

from . import services
from .models import TryOnSession
from .serializers import TryOnSerializer, VoiceSearchSerializer

logger = logging.getLogger(__name__)


def _image_url_to_base64(url: str, timeout: int = 12) -> tuple[str, str] | None:
    if not url:
        return None
    try:
        with urlopen(url, timeout=timeout) as response:
            content_type = response.headers.get_content_type() or "image/jpeg"
            data = response.read()
    except (HTTPError, URLError, TimeoutError, ValueError):
        return None
    return content_type, base64.b64encode(data).decode("ascii")


def _extract_text_from_anthropic_message(message) -> str:
    parts = []
    for block in getattr(message, "content", []) or []:
        text = getattr(block, "text", "")
        if text:
            parts.append(text)
    return "\n".join(parts).strip()


def _parse_tryon_json(text: str) -> dict:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        cleaned = cleaned.removeprefix("json").strip()
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start >= 0 and end > start:
        cleaned = cleaned[start:end + 1]
    data = json.loads(cleaned)
    return {
        "draping_tip": str(data.get("draping_tip") or ""),
        "colour_analysis": str(data.get("colour_analysis") or ""),
        "blouse_suggestion": str(data.get("blouse_suggestion") or ""),
        "jewellery_pairing": str(data.get("jewellery_pairing") or ""),
        "footwear": str(data.get("footwear") or ""),
        "confidence_score": max(1, min(99, int(data.get("confidence_score") or 85))),
        "ai_verdict": str(data.get("ai_verdict") or ""),
        "alternative_colours": [str(item) for item in (data.get("alternative_colours") or [])][:5],
        "provider": "anthropic",
    }


def anthropic_tryon_result(
    *, product: Product | None, validated: dict, product_image_url: str = ""
) -> tuple[dict | None, str, int, int]:
    if not settings.ANTHROPIC_API_KEY:
        return None, settings.ANTHROPIC_MODEL, 0, 0
    user_photo = (validated.get("user_photo_base64") or "").strip()
    if not user_photo:
        return None, settings.ANTHROPIC_MODEL, 0, 0

    # product_image_url is resolved and absolutised by the caller, which has the request.
    # urlopen() on a site-relative path raises ValueError, which _image_url_to_base64
    # swallows — the stylist prompt would silently lose the saree image.
    if not product_image_url:
        product_image_url = validated.get("product_image_url") or ""
        if product and not product_image_url:
            image = product.images.filter(is_primary=True).first() or product.images.first()
            product_image_url = image.image_url if image else ""
    product_image = _image_url_to_base64(product_image_url)

    try:
        from anthropic import Anthropic
    except ImportError:
        return None, settings.ANTHROPIC_MODEL, 0, 0

    content = [
        {
            "type": "text",
            "text": (
                "You are a senior Indian textile stylist for CSM Silks. Analyze the customer's uploaded photo "
                "and the saree/product image when present. Return ONLY compact JSON with keys: "
                "draping_tip, colour_analysis, blouse_suggestion, jewellery_pairing, footwear, "
                "confidence_score, ai_verdict, alternative_colours. "
                f"Customer details: skin tone={validated.get('skin_tone') or 'not specified'}, "
                f"body type={validated.get('body_type') or 'not specified'}, "
                f"drape style={validated.get('drape_style') or 'Nivi'}, "
                f"occasion={validated.get('occasion') or 'occasion wear'}. "
                f"Product: {product.name if product else 'selected silk product'}."
            ),
        },
        {
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": validated.get("user_photo_media_type") or "image/jpeg",
                "data": user_photo,
            },
        },
    ]
    if product_image:
        content.append(
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": product_image[0],
                    "data": product_image[1],
                },
            }
        )

    started = time.perf_counter()
    message = Anthropic(api_key=settings.ANTHROPIC_API_KEY).messages.create(
        model=settings.ANTHROPIC_MODEL,
        max_tokens=700,
        messages=[{"role": "user", "content": content}],
    )
    latency_ms = int((time.perf_counter() - started) * 1000)
    result = _parse_tryon_json(_extract_text_from_anthropic_message(message))
    tokens = getattr(getattr(message, "usage", None), "output_tokens", 0) or 0
    return result, settings.ANTHROPIC_MODEL, tokens, latency_ms


class TryOnView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = TryOnSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        v = serializer.validated_data
        product = None
        if v.get("product_id"):
            product = get_object_or_404(Product, id=v["product_id"])

        if not v.get("user_photo_base64"):
            return Response(
                {"detail": "Upload a customer photo to run AI try-on."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # 1. Save customer photo to media
        customer_photo_path = services.save_base64_image(
            v["user_photo_base64"],
            v.get("user_photo_media_type", "image/jpeg"),
            subdir="tryon/customers",
        )
        if not customer_photo_path:
            # save_base64_image returns None for an unsupported media type, an oversized
            # payload, or any write error. A photo was definitely supplied (checked above),
            # so fail here rather than letting the fallback below silently pass the saree
            # itself as the person image into a paid Replicate run.
            return Response(
                {"detail": "That photo could not be read. Upload a JPEG, PNG, or WebP under 8 MB."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        customer_photo_url = request.build_absolute_uri(customer_photo_path)

        # 2. Resolve product image URL. ProductImage.image_url may be site-relative
        # (set_catalog_images writes paths like /images/catalog/x.jpg), and both Replicate
        # and urlopen need an absolute URL, so absolutise once here.
        product_image_url = v.get("product_image_url") or ""
        if product and not product_image_url:
            image = product.images.filter(is_primary=True).first() or product.images.first()
            product_image_url = image.image_url if image else ""
        if product_image_url:
            product_image_url = request.build_absolute_uri(product_image_url)

        # 3. Run Claude text analysis
        ai_error = ""
        result = None
        model_used = settings.ANTHROPIC_MODEL
        tokens_used = 0
        text_latency_ms = 0
        if settings.ANTHROPIC_API_KEY:
            try:
                result, model_used, tokens_used, text_latency_ms = anthropic_tryon_result(
                    product=product, validated=v, product_image_url=product_image_url
                )
            except (HTTPError, URLError, TimeoutError, ValueError, json.JSONDecodeError) as exc:
                logger.error("Claude text analysis failed: %s", exc)
                ai_error = str(exc)[:240]

        # 4. Run Replicate image generation (non-blocking for UX — failure is acceptable)
        result_image_url = None
        vton_error = None
        vton_latency_ms = 0
        person_full_url = customer_photo_url
        garment_url = product_image_url
        if person_full_url and garment_url:
            try:
                result_image_url, vton_error, vton_latency_ms = services.generate_virtual_tryon(
                    person_image_url=person_full_url,
                    garment_image_url=garment_url,
                    category=v.get("vton_category", "dresses"),
                )
            except Exception as exc:
                logger.error("VTON image gen failed: %s", exc)
                vton_error = str(exc)[:240]

        # 5. Build response
        response_data: dict = {}
        if result:
            response_data.update(result)
            response_data["ai_verdict"] = response_data.get("ai_verdict") or ""

        if result_image_url:
            response_data["result_image_url"] = request.build_absolute_uri(result_image_url)

        session = TryOnSession.objects.create(
            user=request.user if request.user.is_authenticated else None,
            product=product,
            skin_tone=v.get("skin_tone", "medium"),
            body_type=v.get("body_type", "regular"),
            drape_style=v.get("drape_style", "traditional"),
            occasion=v.get("occasion", ""),
            customer_photo=customer_photo_path or "",
            result_image=result_image_url or "",
            ai_result=result or {},
            confidence_score=result.get("confidence_score", 0) if result else 0,
            model_used=model_used,
            tokens_used=tokens_used,
            latency_ms=text_latency_ms + vton_latency_ms,
        )
        response_data["session_id"] = session.id

        if not result and not result_image_url:
            detail = "AI try-on failed. Check API configuration."
            if ai_error:
                detail = f"{detail} Claude error: {ai_error}"
            if vton_error:
                detail = f"{detail} VTON error: {vton_error}"
            return Response({"detail": detail}, status=status.HTTP_502_BAD_GATEWAY)

        return Response(response_data)


class VoiceSearchView(APIView):
    def post(self, request):
        serializer = VoiceSearchSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        transcript = serializer.validated_data["transcript"]
        return Response({"intent": "search", "search_query": transcript, "response_text": f"Searching CSM Silks for {transcript}", "filters": {}})


class RecommendView(APIView):
    def get(self, request):
        products = public_products({"featured": "true"})[:6]
        return Response({"items": ProductListSerializer(products, many=True).data})

    def post(self, request):
        return self.get(request)
