from django.urls import path

from .views import (
    AdminAuditLogView,
    AdminCustomersView,
    AdminDashboardView,
    AdminInsightsView,
    AdminReportsView,
)

urlpatterns = [
    path("admin/dashboard", AdminDashboardView.as_view()),
    path("admin/insights", AdminInsightsView.as_view()),
    path("admin/customers", AdminCustomersView.as_view()),
    path("admin/reports", AdminReportsView.as_view()),
    path("admin/audit-logs", AdminAuditLogView.as_view()),
]
