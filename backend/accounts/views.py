from __future__ import annotations

import logging
import random
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import check_password, make_password
from django.conf import settings
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.generics import RetrieveUpdateAPIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from .email import OTPEmailDeliveryError, mask_email, otp_email_configured, send_otp_email
from .google_auth import (
    GoogleAuthError,
    allowed_google_redirect_uris,
    default_google_redirect_uri,
    exchange_google_authorization_code,
    google_oauth_configured,
    google_redirect_oauth_configured,
    verify_google_id_token,
)
from .models import Address, OTPChallenge, BlacklistedToken
from .serializers import (
    AddressSerializer,
    AdminLoginSerializer,
    GoogleLoginSerializer,
    GoogleCodeExchangeSerializer,
    OTPRequestSerializer,
    OTPVerifySerializer,
    UserSerializer,
)
from .sms import SMSDeliveryError, send_otp_sms, twilio_configured

User = get_user_model()
logger = logging.getLogger(__name__)


def normalize_phone(phone: str) -> str:
    raw = str(phone or "").strip()
    digits = "".join(char for char in raw if char.isdigit())
    if not digits:
        return ""
    if raw.startswith("+"):
        return f"+{digits}"
    if len(digits) == 10:
        return f"+91{digits}"
    if len(digits) == 12 and digits.startswith("91"):
        return f"+{digits}"
    return digits


def normalize_email(email: str) -> str:
    return str(email or "").strip().lower()


def token_payload(user) -> dict:
    refresh = RefreshToken.for_user(user)
    return {
        "access_token": str(refresh.access_token),
        "refresh_token": str(refresh),
        "user": UserSerializer(user).data,
    }


class SendOTPView(APIView):
    authentication_classes = []
    permission_classes = []
    throttle_scope = "otp"

    def post(self, request):
        serializer = OTPRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        phone = normalize_phone(serializer.validated_data["phone"])
        digits = "".join(char for char in phone if char.isdigit())
        if not phone.startswith("+") or len(digits) < 10 or len(digits) > 15:
            return Response({"detail": "Enter a valid phone number with country code"}, status=status.HTTP_400_BAD_REQUEST)
        email = normalize_email(serializer.validated_data.get("email", ""))
        if email:
            email_taken = User.objects.filter(email__iexact=email).exclude(phone=phone).exists()
            if email_taken:
                return Response({"detail": "Email already belongs to another account"}, status=status.HTTP_400_BAD_REQUEST)
        existing_user = User.objects.filter(phone=phone).first()
        email_to = email or normalize_email(getattr(existing_user, "email", ""))
        otp = f"{random.randint(100000, 999999)}"
        response = {
            "message": "OTP sent",
            "sms_sent": False,
            "email_sent": False,
            "email_masked": mask_email(email_to),
            "delivery_channels": [],
        }
        delivery_failures: list[dict[str, str]] = []
        if twilio_configured():
            try:
                send_otp_sms(phone=phone, otp=otp)
                response["sms_sent"] = True
                response["delivery_channels"].append("sms")
            except SMSDeliveryError as exc:
                delivery_failures.append({"channel": "sms", "provider": "twilio", "error": str(exc)})
                logger.warning("OTP SMS delivery failed for %s via Twilio: %s", phone, exc)
        if email_to and otp_email_configured():
            try:
                send_otp_email(to_email=email_to, otp=otp)
                response["email_sent"] = True
                response["delivery_channels"].append("email")
            except OTPEmailDeliveryError as exc:
                delivery_failures.append({"channel": "email", "provider": "resend", "error": str(exc)})
                logger.warning("OTP email delivery failed for %s via Resend: %s", mask_email(email_to), exc)

        # Never expose the OTP outside local development. DEBUG is required in addition to the
        # opt-in flag: settings only forces OTP_DEV_FALLBACK_ENABLED=False when IS_PRODUCTION, so
        # without this guard any non-production non-DEBUG env (staging) would leak login codes.
        if not response["delivery_channels"] and settings.DEBUG and settings.OTP_DEV_FALLBACK_ENABLED:
            response["dev_otp"] = otp
            response["delivery_channels"].append("development")

        if not response["delivery_channels"]:
            if twilio_configured() or (email_to and otp_email_configured()):
                detail = "Unable to send OTP by live SMS or email. Check the phone/email and delivery provider configuration."
                code = status.HTTP_502_BAD_GATEWAY
            else:
                detail = "OTP delivery is not configured. Enable SMS or email OTP before customer login."
                code = status.HTTP_503_SERVICE_UNAVAILABLE
            payload = {"detail": detail}
            if settings.DEBUG and delivery_failures:
                payload["delivery_failures"] = delivery_failures
            return Response(payload, status=code)

        window_start = timezone.now() - timedelta(minutes=settings.OTP_TTL_MINUTES)
        recent_sends = OTPChallenge.objects.filter(phone=phone, created_at__gte=window_start).count()
        if recent_sends >= settings.OTP_RATE_LIMIT:
            return Response({"detail": "Too many OTP requests. Please wait before trying again."}, status=status.HTTP_429_TOO_MANY_REQUESTS)

        OTPChallenge.objects.create(phone=phone, otp_hash=make_password(otp), expires_at=OTPChallenge.expiry_time())
        return Response(response)


class VerifyOTPView(APIView):
    authentication_classes = []
    permission_classes = []
    throttle_scope = "otp"

    def post(self, request):
        serializer = OTPVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        phone = normalize_phone(serializer.validated_data["phone"])
        otp = serializer.validated_data["otp"]
        challenge = OTPChallenge.objects.filter(phone=phone).order_by("-created_at").first()
        if not challenge or not challenge.is_active:
            return Response({"detail": "Invalid or expired OTP"}, status=status.HTTP_400_BAD_REQUEST)
        challenge.attempts += 1
        challenge.save(update_fields=["attempts"])
        if challenge.attempts > 5 or not check_password(otp, challenge.otp_hash):
            return Response({"detail": "Invalid or expired OTP"}, status=status.HTTP_400_BAD_REQUEST)
        full_name = serializer.validated_data.get("full_name", "").strip()
        email = serializer.validated_data.get("email", "").strip().lower()
        if email:
            email_taken = User.objects.filter(email__iexact=email).exclude(phone=phone).exists()
            if email_taken:
                return Response({"detail": "Email already belongs to another account"}, status=status.HTTP_400_BAD_REQUEST)
        user, created = User.objects.get_or_create(
            phone=phone,
            defaults={"username": phone, "is_verified": True, "role": User.Role.CUSTOMER},
        )
        if created is False and not user.is_verified:
            user.is_verified = True
            user.save(update_fields=["is_verified"])
        update_fields = ["last_login"]
        if full_name:
            user.full_name = full_name
            update_fields.append("full_name")
        if email:
            user.email = email
            update_fields.append("email")
        for preference in ["wa_opted_in", "push_opted_in"]:
            if preference in serializer.validated_data:
                setattr(user, preference, serializer.validated_data[preference])
                update_fields.append(preference)
        challenge.mark_consumed()
        user.last_login = timezone.now()
        user.save(update_fields=list(dict.fromkeys(update_fields)))
        return Response(token_payload(user))


def _upsert_google_user(profile) -> User:
    user = User.objects.filter(google_id=profile.sub).first()
    if user:
        if user.is_staff_admin:
            raise GoogleAuthError("Use admin login for staff accounts")
        update_fields: list[str] = []
        if profile.full_name and not user.full_name:
            user.full_name = profile.full_name
            update_fields.append("full_name")
        if profile.avatar_url and user.avatar_url != profile.avatar_url:
            user.avatar_url = profile.avatar_url
            update_fields.append("avatar_url")
        if not user.is_verified:
            user.is_verified = True
            update_fields.append("is_verified")
        if update_fields:
            user.save(update_fields=update_fields)
        return user

    user = User.objects.filter(email__iexact=profile.email).first()
    if user:
        if user.is_staff_admin:
            raise GoogleAuthError("Use admin login for staff accounts")
        if user.google_id and user.google_id != profile.sub:
            raise GoogleAuthError("This email is linked to a different Google account")
        user.google_id = profile.sub
        update_fields = ["google_id"]
        if profile.full_name and not user.full_name:
            user.full_name = profile.full_name
            update_fields.append("full_name")
        if profile.avatar_url:
            user.avatar_url = profile.avatar_url
            update_fields.append("avatar_url")
        if not user.is_verified:
            user.is_verified = True
            update_fields.append("is_verified")
        user.save(update_fields=list(dict.fromkeys(update_fields)))
        return user

    username_base = profile.email.split("@", 1)[0][:30] or f"google_{profile.sub[:20]}"
    username = username_base
    counter = 2
    while User.objects.filter(username=username).exists():
        username = f"{username_base[:24]}{counter}"
        counter += 1

    return User.objects.create(
        username=username,
        email=profile.email,
        google_id=profile.sub,
        full_name=profile.full_name,
        avatar_url=profile.avatar_url,
        is_verified=True,
        role=User.Role.CUSTOMER,
    )


class AuthConfigView(APIView):
    authentication_classes = []
    permission_classes = []

    def get(self, request):
        otp_delivery_configured = twilio_configured() or otp_email_configured()
        return Response(
            {
                "google_oauth_enabled": google_oauth_configured(),
                "google_client_id": settings.GOOGLE_CLIENT_ID if google_oauth_configured() else "",
                "google_redirect_enabled": google_redirect_oauth_configured(),
                "google_redirect_uri": default_google_redirect_uri(),
                "google_redirect_uris": allowed_google_redirect_uris(),
                "otp_dev_fallback_enabled": bool(settings.DEBUG and settings.OTP_DEV_FALLBACK_ENABLED),
                "otp_delivery_configured": otp_delivery_configured,
            }
        )


class GoogleLoginView(APIView):
    authentication_classes = []
    permission_classes = []
    throttle_scope = "otp"

    def post(self, request):
        if not google_oauth_configured():
            return Response({"detail": "Google sign-in is not configured"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        serializer = GoogleLoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            profile = verify_google_id_token(
                serializer.validated_data["id_token"],
                expected_nonce=serializer.validated_data.get("nonce") or None,
            )
            user = _upsert_google_user(profile)
        except GoogleAuthError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        user.last_login = timezone.now()
        user.save(update_fields=["last_login"])
        return Response(token_payload(user))


class GoogleCodeExchangeView(APIView):
    authentication_classes = []
    permission_classes = []
    throttle_scope = "otp"

    def post(self, request):
        if not google_redirect_oauth_configured():
            return Response({"detail": "Google redirect sign-in is not configured"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        serializer = GoogleCodeExchangeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            profile = exchange_google_authorization_code(
                code=serializer.validated_data["code"],
                redirect_uri=serializer.validated_data["redirect_uri"],
            )
            user = _upsert_google_user(profile)
        except GoogleAuthError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        user.last_login = timezone.now()
        user.save(update_fields=["last_login"])
        return Response(token_payload(user))


class AdminLoginView(APIView):
    authentication_classes = []
    permission_classes = []
    throttle_scope = "admin_login"

    def post(self, request):
        serializer = AdminLoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"].lower()
        password = serializer.validated_data["password"]
        user = User.objects.filter(Q(email__iexact=email) | Q(username__iexact=email)).first()
        if not user or not user.check_password(password) or not user.is_staff_admin:
            return Response({"detail": "Invalid admin credentials"}, status=status.HTTP_401_UNAUTHORIZED)
        user.last_login = timezone.now()
        user.save(update_fields=["last_login"])
        return Response(token_payload(user))


class RefreshView(APIView):
    authentication_classes = []
    permission_classes = []

    def post(self, request):
        refresh_value = request.data.get("refresh") or request.data.get("refresh_token")
        if not refresh_value:
            return Response({"detail": "refresh token required"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            refresh = RefreshToken(refresh_value)
            user_id = refresh.get("user_id")
            user = User.objects.get(id=user_id)
        except (TokenError, User.DoesNotExist, KeyError, TypeError):
            return Response({"detail": "Invalid or expired refresh token"}, status=status.HTTP_401_UNAUTHORIZED)
        return Response({"access_token": str(refresh.access_token), "refresh_token": str(refresh), "user": UserSerializer(user).data})


class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        try:
            refresh_token = request.data.get("refresh") or request.data.get("refresh_token")
            if refresh_token:
                from rest_framework_simplejwt.tokens import RefreshToken as RT
                token = RT(refresh_token)
                token_id = token.get("jti", str(token))
                expires_at = token.get("exp")
                if expires_at:
                    from datetime import datetime
                    expires_at_dt = datetime.fromtimestamp(expires_at, tz=timezone.utc)
                    BlacklistedToken.objects.get_or_create(
                        token=token_id,
                        user=request.user,
                        defaults={"expires_at": expires_at_dt}
                    )
            return Response({"message": "Logged out successfully"})
        except Exception as exc:
            logger.error("Logout error for user %s: %s", request.user.id, exc)
            return Response({"message": "Logged out (token blacklist failed)"}, status=status.HTTP_200_OK)


class MeView(RetrieveUpdateAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = UserSerializer

    def get_object(self):
        return self.request.user


class AddressListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(AddressSerializer(request.user.addresses.all(), many=True).data)

    def post(self, request):
        serializer = AddressSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        address = serializer.save()
        return Response(AddressSerializer(address).data, status=status.HTTP_201_CREATED)


class AddressDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, address_id: int):
        address = get_object_or_404(Address, id=address_id, user=request.user)
        serializer = AddressSerializer(address, data=request.data, partial=True, context={"request": request})
        serializer.is_valid(raise_exception=True)
        return Response(AddressSerializer(serializer.save()).data)

    def delete(self, request, address_id: int):
        Address.objects.filter(id=address_id, user=request.user).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
