from __future__ import annotations

import logging

from celery import shared_task
from django.utils import timezone

from notifications.services import (
    gupshup_configured,
    resend_configured,
    send_gupshup_whatsapp,
    send_resend_email,
)

from .models import StockAlert

logger = logging.getLogger(__name__)


def _alert_body(variant) -> str:
    product = variant.product
    return (
        f"{product.name} is back in stock at CSM Silks. "
        f"Reserve yours: /product/{product.slug}"
    )


def notify_restocked_watchers() -> dict:
    """Notify customers whose watched variant is back in stock.

    StockAlertView promises "we will WhatsApp/SMS you when this weave is back", but
    nothing read the table and notified_at was never set. Polling here rather than
    hooking each restock path means every route back into stock is covered: order
    cancellation, return restock, admin inventory adjustment and ledger imports alike.
    """
    pending = (
        StockAlert.objects.filter(notified_at__isnull=True)
        .select_related("variant", "variant__product")
        .order_by("id")
    )
    notified = 0
    for alert in pending.iterator():
        variant = alert.variant
        if variant.available_qty <= 0:
            continue
        body = _alert_body(variant)
        delivered = False
        if alert.phone and gupshup_configured():
            try:
                send_gupshup_whatsapp(to_phone=alert.phone, body=body)
                delivered = True
            except Exception as exc:
                logger.warning("Stock alert WhatsApp failed for %s: %s", alert.phone, exc)
        if alert.email and resend_configured():
            try:
                send_resend_email(
                    to_email=alert.email,
                    subject=f"{variant.product.name} is back in stock",
                    html_body=f"<p>{body}</p>",
                )
                delivered = True
            except Exception as exc:
                logger.warning("Stock alert email failed for %s: %s", alert.email, exc)
        if not delivered:
            # Leave notified_at unset so the next run retries once a provider is configured.
            continue
        alert.notified_at = timezone.now()
        alert.save(update_fields=["notified_at"])
        notified += 1
    return {"notified": notified}


@shared_task(name="catalog.notify_restocked_watchers")
def notify_restocked_watchers_task() -> dict:
    return notify_restocked_watchers()
