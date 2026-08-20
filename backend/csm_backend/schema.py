from __future__ import annotations

from drf_spectacular.extensions import OpenApiAuthenticationExtension
from drf_spectacular.openapi import AutoSchema
from rest_framework import serializers
from rest_framework.views import APIView


class BlacklistJWTScheme(OpenApiAuthenticationExtension):
    """Teach drf-spectacular about accounts.auth.BlacklistJWTAuthentication.

    It is the DEFAULT_AUTHENTICATION_CLASS, so without this every one of the ~50
    protected endpoints emitted a drf_spectacular.W001 warning and was documented
    as unauthenticated in the published /api/docs schema.
    """

    target_class = "accounts.auth.BlacklistJWTAuthentication"
    name = "jwtAuth"

    def get_security_definition(self, auto_schema):
        return {
            "type": "http",
            "scheme": "bearer",
            "bearerFormat": "JWT",
        }


class OpenApiFallbackSerializer(serializers.Serializer):
    detail = serializers.CharField(required=False)


class CSMAutoSchema(AutoSchema):
    def _get_serializer(self):
        view = self.view
        has_explicit_serializer = any(
            callable(getattr(view, name, None))
            for name in ("get_serializer", "get_serializer_class")
        ) or hasattr(view, "serializer_class")
        if isinstance(view, APIView) and not has_explicit_serializer:
            return OpenApiFallbackSerializer
        return super()._get_serializer()

    def get_operation_id(self) -> str:
        operation_id = super().get_operation_id()
        path_variables = [part.strip("{}") for part in self.path.split("/") if part.startswith("{") and part.endswith("}")]
        if not path_variables:
            return operation_id
        base, _, action = operation_id.rpartition("_")
        if not base:
            return operation_id
        return f"{base}_by_{path_variables[-1]}_{action}"
