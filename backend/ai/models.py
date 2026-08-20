from django.conf import settings
from django.db import models

from catalog.models import Product


class TryOnSession(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="try_on_sessions", null=True, blank=True, on_delete=models.SET_NULL)
    product = models.ForeignKey(Product, related_name="try_on_sessions", null=True, blank=True, on_delete=models.SET_NULL)
    skin_tone = models.CharField(max_length=20)
    body_type = models.CharField(max_length=20)
    drape_style = models.CharField(max_length=50)
    occasion = models.CharField(max_length=80, blank=True)
    # CharField, not URLField: these hold site-relative media paths (/media/tryon/...).
    # URLField's validator rejects those on any full_clean() path — Django admin, ModelForms —
    # even though Model.objects.create() persists them without complaint.
    customer_photo = models.CharField(blank=True, max_length=500)
    result_image = models.CharField(blank=True, max_length=500)
    ai_result = models.JSONField(default=dict, blank=True)
    confidence_score = models.PositiveSmallIntegerField(default=0)
    added_to_cart = models.BooleanField(default=False)
    converted_to_order = models.BooleanField(default=False)
    model_used = models.CharField(max_length=80, default="anthropic")
    tokens_used = models.PositiveIntegerField(default=0)
    latency_ms = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
