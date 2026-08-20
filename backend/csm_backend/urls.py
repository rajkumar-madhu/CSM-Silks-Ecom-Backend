from django.conf import settings
from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path, re_path
from django.views.static import serve
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
from accounts.views import AddressDetailView, AddressListCreateView
from .health import readiness


def health(_request):
    return JsonResponse(
        {
            "status": "healthy",
            "service": "CSM Silks Django API",
            "env": settings.APP_ENV,
        }
    )


def serve_media(request, path):
    """Serve uploads from MEDIA_ROOT even when DEBUG=False (static() is a no-op then)."""
    return serve(request, path, document_root=str(settings.MEDIA_ROOT))


urlpatterns = [
    path("django-admin/", admin.site.urls),
    path("health", health),
    path("api/health", health),
    path("readiness", readiness),
    path("api/readiness", readiness),
    path("api/schema", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
    path("api/auth/", include("accounts.urls")),
    path("api/addresses", AddressListCreateView.as_view()),
    path("api/addresses/<int:address_id>", AddressDetailView.as_view()),
    path("api/", include("catalog.urls")),
    path("api/", include("cart.urls")),
    path("api/", include("orders.urls")),
    path("api/", include("payments.urls")),
    path("api/", include("inventory.urls")),
    path("api/", include("loyalty.urls")),
    path("api/", include("notifications.urls")),
    path("api/", include("analytics.urls")),
    path("api/", include("shipping.urls")),
    path("api/", include("reviews.urls")),
    path("api/", include("ai.urls")),
    # Django's static() helper is a no-op when DEBUG=False, so production would
    # 404 every /media/... upload. Keep an explicit serve route (ingress already
    # path-routes /media to this backend; PVC is MEDIA_ROOT).
    re_path(r"^media/(?P<path>.*)$", serve_media),
]
