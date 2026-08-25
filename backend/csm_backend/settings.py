from __future__ import annotations

import os
import secrets
from datetime import timedelta
from decimal import Decimal
from pathlib import Path
from urllib.parse import urlparse

BASE_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BASE_DIR.parent

try:
    from dotenv import load_dotenv

    load_dotenv(PROJECT_ROOT / ".env", override=False)
except ImportError:
    pass


TRUE_VALUES = {"1", "true", "yes", "on"}


def env_bool(name: str, default: bool = False) -> bool:
    return os.getenv(name, str(default)).lower() in TRUE_VALUES


def env_list(name: str, default: str = "") -> list[str]:
    return [item.strip() for item in os.getenv(name, default).split(",") if item.strip()]


SECRET_KEY = os.getenv("SECRET_KEY", "")
DEBUG = env_bool("DEBUG", False)
APP_ENV = os.getenv("APP_ENV", "development")

IS_PRODUCTION = APP_ENV == "production"

if not SECRET_KEY:
    if IS_PRODUCTION:
        raise ValueError("SECRET_KEY environment variable must be set in production")
    if DEBUG:
        # Stable so dev sessions survive an autoreload. Only ever reachable with DEBUG=True.
        SECRET_KEY = "dev-secret-key-change-in-production-min-32-chars"
    else:
        # DEBUG=False without APP_ENV=production is the ambiguous case: it covers CI and
        # ad-hoc management commands, but it also covers a real deploy that simply forgot
        # to set APP_ENV. Falling back to the literal above would have signed that deploy's
        # sessions, CSRF tokens and JWTs with a key committed to this repo. An ephemeral
        # random key keeps those commands working while making a silent insecure serve
        # impossible — anything that needs key continuity has to set SECRET_KEY.
        SECRET_KEY = secrets.token_urlsafe(64)

if IS_PRODUCTION and DEBUG:
    raise ValueError("DEBUG cannot be True in production. Set DEBUG=False in environment variables.")

ALLOWED_HOSTS = env_list("ALLOWED_HOSTS", "")
if not ALLOWED_HOSTS:
    if IS_PRODUCTION:
        raise ValueError("ALLOWED_HOSTS must be configured in production")
    ALLOWED_HOSTS = ["localhost", "127.0.0.1"]

INSTALLED_APPS = [
    "daphne",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "django_filters",
    "rest_framework",
    "drf_spectacular",
    "channels",
    "accounts",
    "catalog",
    "inventory",
    "cart",
    "orders",
    "payments",
    "shipping",
    "loyalty",
    "reviews",
    "notifications",
    "analytics",
    "ai",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "csm_backend.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    }
]

WSGI_APPLICATION = "csm_backend.wsgi.application"
ASGI_APPLICATION = "csm_backend.asgi.application"


def database_config() -> dict:
    url = os.getenv("DATABASE_URL", "")
    if not url:
        if IS_PRODUCTION:
            raise ValueError("DATABASE_URL must be configured in production")
        url = f"sqlite:///{PROJECT_ROOT / 'csm_silks_django.db'}"
    
    parsed = urlparse(url)
    if parsed.scheme in {"postgres", "postgresql"}:
        return {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": parsed.path.lstrip("/"),
            "USER": parsed.username or "",
            "PASSWORD": parsed.password or "",
            "HOST": parsed.hostname or "localhost",
            "PORT": str(parsed.port or 5432),
            "OPTIONS": {
                # "prefer" silently falls back to an unencrypted connection; production must not.
                "sslmode": os.getenv("PGSSLMODE", "require" if IS_PRODUCTION else "prefer"),
            },
        }
    if parsed.scheme in {"postgresql+asyncpg", "postgres+asyncpg"}:
        return {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": parsed.path.lstrip("/"),
            "USER": parsed.username or "",
            "PASSWORD": parsed.password or "",
            "HOST": parsed.hostname or "localhost",
            "PORT": str(parsed.port or 5432),
            "OPTIONS": {
                # "prefer" silently falls back to an unencrypted connection; production must not.
                "sslmode": os.getenv("PGSSLMODE", "require" if IS_PRODUCTION else "prefer"),
            },
        }
    if IS_PRODUCTION:
        raise ValueError("Production must use PostgreSQL, not SQLite. Set DATABASE_URL to a postgres:// URL")
    if parsed.scheme == "sqlite":
        # Honour the path the URL actually names. This used to fall through to the
        # hardcoded dev database below, so pointing a command at a scratch file
        # (DATABASE_URL=sqlite:////tmp/scratch.db) silently ran against the real one
        # instead — which cost two accidental reverse-migrations of
        # csm_silks_django.db while rehearsing a destructive migration.
        # Path convention follows SQLAlchemy: one leading slash is the separator, so
        # sqlite:///rel.db is relative to PROJECT_ROOT and sqlite:////abs.db is absolute.
        name = ":memory:" if parsed.netloc == ":memory:" else parsed.path[1:]
        if not name:
            name = str(PROJECT_ROOT / "csm_silks_django.db")
        elif name != ":memory:" and not name.startswith("/"):
            name = str(PROJECT_ROOT / name)
        return {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": name,
        }
    return {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": str(PROJECT_ROOT / "csm_silks_django.db"),
    }


DATABASES = {"default": database_config()}

AUTH_USER_MODEL = "accounts.User"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "Asia/Kolkata"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
# Django replaces STORAGES wholesale (no per-key merge with global_settings), so "default"
# must be declared here too — omitting it makes default_storage raise InvalidStorageError,
# which breaks every FileField/ImageField save (e.g. admin product-image upload).
STORAGES = {
    "default": {
        "BACKEND": "django.core.files.storage.FileSystemStorage",
    },
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    },
}
MEDIA_URL = os.getenv("MEDIA_URL", "/media/")
if not MEDIA_URL.endswith("/"):
    MEDIA_URL = f"{MEDIA_URL}/"
MEDIA_ROOT = Path(os.getenv("MEDIA_ROOT", str(BASE_DIR / "media")))

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
APPEND_SLASH = False

CORS_ALLOWED_ORIGINS = env_list(
    "ALLOWED_ORIGINS",
    os.getenv(
        "CORS_ALLOWED_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173" if not IS_PRODUCTION else "",
    ),
)
if IS_PRODUCTION and not CORS_ALLOWED_ORIGINS:
    raise ValueError("CORS_ALLOWED_ORIGINS must be configured in production")
CORS_ALLOW_CREDENTIALS = True
CSRF_TRUSTED_ORIGINS = env_list("CSRF_TRUSTED_ORIGINS", ",".join(CORS_ALLOWED_ORIGINS))
if IS_PRODUCTION and not CSRF_TRUSTED_ORIGINS:
    raise ValueError("CSRF_TRUSTED_ORIGINS must be configured in production")

SECURE_SSL_REDIRECT = env_bool("SECURE_SSL_REDIRECT", not DEBUG)
SESSION_COOKIE_SECURE = env_bool("SESSION_COOKIE_SECURE", not DEBUG)
CSRF_COOKIE_SECURE = env_bool("CSRF_COOKIE_SECURE", not DEBUG)
SECURE_HSTS_SECONDS = int(os.getenv("SECURE_HSTS_SECONDS", "31536000" if not DEBUG else "0"))
SECURE_HSTS_INCLUDE_SUBDOMAINS = env_bool("SECURE_HSTS_INCLUDE_SUBDOMAINS", not DEBUG)
SECURE_HSTS_PRELOAD = env_bool("SECURE_HSTS_PRELOAD", not DEBUG)
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https") if env_bool("USE_X_FORWARDED_PROTO", not DEBUG) else None

if IS_PRODUCTION and not DEBUG:
    behind_proxy = env_bool("BEHIND_REVERSE_PROXY", env_bool("USE_X_FORWARDED_PROTO", False))
    SECURE_SSL_REDIRECT = env_bool("SECURE_SSL_REDIRECT", not behind_proxy)
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = int(os.getenv("SECURE_HSTS_SECONDS", "31536000"))
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True
    if behind_proxy:
        SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    if not CSRF_TRUSTED_ORIGINS:
        CSRF_TRUSTED_ORIGINS = [origin for origin in CORS_ALLOWED_ORIGINS if origin.startswith("https://")]

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "accounts.auth.BlacklistJWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.AllowAny",
    ),
    "DEFAULT_FILTER_BACKENDS": (
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ),
    "DEFAULT_THROTTLE_CLASSES": (
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
        "rest_framework.throttling.ScopedRateThrottle",
    ),
    "DEFAULT_THROTTLE_RATES": {
        "anon": os.getenv("DRF_ANON_THROTTLE", "100/hour" if IS_PRODUCTION else "500/hour"),
        "user": os.getenv("DRF_USER_THROTTLE", "1000/hour" if IS_PRODUCTION else "5000/hour"),
        "otp": os.getenv("DRF_OTP_THROTTLE", "3/minute" if IS_PRODUCTION else "120/minute"),
        "admin_login": os.getenv("DRF_ADMIN_LOGIN_THROTTLE", "5/minute" if IS_PRODUCTION else "10/minute"),
        # Production is the stricter side, as with every other scope here. This pair was
        # inverted (10/minute prod vs 5/minute dev), making dev the tighter environment.
        "tracking": os.getenv("DRF_TRACKING_THROTTLE", "10/minute" if IS_PRODUCTION else "30/minute"),
        "courier_webhook": os.getenv("DRF_COURIER_WEBHOOK_THROTTLE", "60/minute" if IS_PRODUCTION else "120/minute"),
        "payment": os.getenv("DRF_PAYMENT_THROTTLE", "10/minute" if IS_PRODUCTION else "30/minute"),
        "checkout": os.getenv("DRF_CHECKOUT_THROTTLE", "20/hour" if IS_PRODUCTION else "100/hour"),
    },
    "DEFAULT_SCHEMA_CLASS": "csm_backend.schema.CSMAutoSchema",
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "7"))),
    "AUTH_HEADER_TYPES": ("Bearer",),
}

SPECTACULAR_SETTINGS = {
    "TITLE": "CSM Silks Retailer API",
    "DESCRIPTION": "Django/DRF API for the CSM Silks textile ecommerce platform.",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
}

GST_RATE = float(os.getenv("GST_RATE", "0.05"))
CGST_RATE = GST_RATE / 2
SGST_RATE = GST_RATE / 2
HSN_CODE = os.getenv("HSN_CODE", "5007")
BLOUSE_STITCH_FEE = Decimal(os.getenv("BLOUSE_STITCH_FEE", "350"))
FALL_PICO_FEE = Decimal(os.getenv("FALL_PICO_FEE", "150"))
STORE_CONTACT_EMAIL = os.getenv("STORE_CONTACT_EMAIL", "orders@csmsilks.com")
FREE_SHIPPING_THRESHOLD = float(os.getenv("FREE_SHIPPING_THRESHOLD", "999"))
LOYALTY_POINTS_PER_RUPEE = float(os.getenv("LOYALTY_POINTS_PER_RUPEE", "0.05"))
UNSOLD_ALERT_DAYS = int(os.getenv("UNSOLD_ALERT_DAYS", "20"))

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
CELERY_BROKER_URL = os.getenv("CELERY_BROKER_URL") or REDIS_URL
CELERY_RESULT_BACKEND = os.getenv("CELERY_RESULT_BACKEND") or REDIS_URL
CHANNEL_LAYER_BACKEND = os.getenv("CHANNEL_LAYER_BACKEND", "redis" if not DEBUG else "memory").lower()
if CHANNEL_LAYER_BACKEND == "redis":
    CHANNEL_LAYERS = {
        "default": {
            "BACKEND": "channels_redis.core.RedisChannelLayer",
            "CONFIG": {"hosts": [REDIS_URL]},
        }
    }
else:
    CHANNEL_LAYERS = {
        "default": {
            "BACKEND": "channels.layers.InMemoryChannelLayer",
        }
    }
CELERY_BEAT_SCHEDULE = {
    "release-expired-stock-reservations": {
        "task": "inventory.release_expired_stock_reservations",
        "schedule": 300.0,
    }
}

RAZORPAY_KEY_ID = os.getenv("RAZORPAY_KEY_ID", "")
RAZORPAY_KEY_SECRET = os.getenv("RAZORPAY_KEY_SECRET", "")
RAZORPAY_WEBHOOK_SECRET = os.getenv("RAZORPAY_WEBHOOK_SECRET", "")
PAYMENT_DEV_FALLBACK_ENABLED = os.getenv("PAYMENT_DEV_FALLBACK_ENABLED", "False").lower() in {"1", "true", "yes", "on"}

SHIPROCKET_EMAIL = os.getenv("SHIPROCKET_EMAIL", "")
SHIPROCKET_PASSWORD = os.getenv("SHIPROCKET_PASSWORD", "")
SHIPROCKET_BASE_URL = os.getenv("SHIPROCKET_BASE_URL", "https://apiv2.shiprocket.in/v1/external")
SHIPROCKET_WEBHOOK_SECRET = os.getenv("SHIPROCKET_WEBHOOK_SECRET", "")
SHIPROCKET_PICKUP_LOCATION = os.getenv("SHIPROCKET_PICKUP_LOCATION", "Primary")
SHIPROCKET_PACKAGE_LENGTH_CM = float(os.getenv("SHIPROCKET_PACKAGE_LENGTH_CM", "32"))
SHIPROCKET_PACKAGE_BREADTH_CM = float(os.getenv("SHIPROCKET_PACKAGE_BREADTH_CM", "24"))
SHIPROCKET_PACKAGE_HEIGHT_CM = float(os.getenv("SHIPROCKET_PACKAGE_HEIGHT_CM", "5"))
SHIPROCKET_PACKAGE_WEIGHT_KG = float(os.getenv("SHIPROCKET_PACKAGE_WEIGHT_KG", "0.5"))
DEFAULT_COURIER_PROVIDER = os.getenv("DEFAULT_COURIER_PROVIDER", "manual")

RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
RESEND_FROM_EMAIL = os.getenv("RESEND_FROM_EMAIL", "onboarding@resend.dev")
NOTIFICATION_EMAIL_ENABLED = os.getenv("NOTIFICATION_EMAIL_ENABLED", "False").lower() in {"1", "true", "yes", "on"}
OTP_EMAIL_ENABLED = os.getenv("OTP_EMAIL_ENABLED", str(NOTIFICATION_EMAIL_ENABLED)).lower() in {"1", "true", "yes", "on"}

SMS_OTP_ENABLED = os.getenv("SMS_OTP_ENABLED", "False").lower() in {"1", "true", "yes", "on"}
TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "")
TWILIO_API_KEY_SID = os.getenv("TWILIO_API_KEY_SID", "")
TWILIO_API_KEY_SECRET = os.getenv("TWILIO_API_KEY_SECRET", "")
TWILIO_FROM_PHONE = os.getenv("TWILIO_FROM_PHONE", "")
TWILIO_MESSAGING_SERVICE_SID = os.getenv("TWILIO_MESSAGING_SERVICE_SID", "")

WHATSAPP_ENABLED = os.getenv("WHATSAPP_ENABLED", "False").lower() in {"1", "true", "yes", "on"}
GUPSHUP_API_KEY = os.getenv("GUPSHUP_API_KEY", "")
GUPSHUP_SOURCE_PHONE = os.getenv("GUPSHUP_SOURCE_PHONE", "")
GUPSHUP_APP_NAME = os.getenv("GUPSHUP_APP_NAME", "")

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-3-5-sonnet-20241022")

REPLICATE_API_TOKEN = os.getenv("REPLICATE_API_TOKEN", "")
VIRTUAL_TRYON_MODEL = os.getenv("VIRTUAL_TRYON_MODEL", "yisol/idm-vton")
VIRTUAL_TRYON_ENABLED = bool(REPLICATE_API_TOKEN)
# Keep below ingress-nginx's proxy_read_timeout (60s) so the customer gets a real answer
# instead of a 504 while the Replicate job runs on.
AI_VTON_TIMEOUT_SECONDS = int(os.getenv("AI_VTON_TIMEOUT_SECONDS", "45"))
AI_MAX_IMAGE_BYTES = int(os.getenv("AI_MAX_IMAGE_BYTES", str(8 * 1024 * 1024)))
# Try-on uploads are photos of real people on a public endpoint; purge them on a schedule.
AI_TRYON_PHOTO_RETENTION_DAYS = int(os.getenv("AI_TRYON_PHOTO_RETENTION_DAYS", "30"))

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
GOOGLE_OAUTH_ENABLED = env_bool("GOOGLE_OAUTH_ENABLED", bool(GOOGLE_CLIENT_ID))
GOOGLE_OAUTH_REDIRECT_PATH = os.getenv("GOOGLE_OAUTH_REDIRECT_PATH", "/auth/google/callback")
GOOGLE_OAUTH_REDIRECT_URIS = os.getenv("GOOGLE_OAUTH_REDIRECT_URIS", "")

OTP_TTL_MINUTES = int(os.getenv("OTP_TTL_MINUTES", "5"))
OTP_RATE_LIMIT = int(os.getenv("OTP_RATE_LIMIT", "100" if DEBUG else "3"))
OTP_DEV_FALLBACK_ENABLED = env_bool("OTP_DEV_FALLBACK_ENABLED", False)

if IS_PRODUCTION:
    OTP_DEV_FALLBACK_ENABLED = False
    PAYMENT_DEV_FALLBACK_ENABLED = False
    if env_bool("OTP_DEV_FALLBACK_ENABLED", False):
        raise ValueError("OTP_DEV_FALLBACK_ENABLED cannot be True in production")
    if env_bool("PAYMENT_DEV_FALLBACK_ENABLED", False):
        raise ValueError("PAYMENT_DEV_FALLBACK_ENABLED cannot be True in production")

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "verbose": {
            "format": "{levelname} {asctime} {module} {process:d} {thread:d} {message}",
            "style": "{",
        },
        "simple": {
            "format": "{levelname} {asctime} {message}",
            "style": "{",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "verbose" if DEBUG else "simple",
        },
        "file": {
            "class": "logging.handlers.RotatingFileHandler",
            "filename": BASE_DIR / "logs" / "django.log",
            "maxBytes": 1024 * 1024 * 50,  # 50 MB
            "backupCount": 5,
            "formatter": "verbose",
        },
        "error_file": {
            "class": "logging.handlers.RotatingFileHandler",
            "filename": BASE_DIR / "logs" / "django_error.log",
            "maxBytes": 1024 * 1024 * 50,  # 50 MB
            "backupCount": 10,
            "formatter": "verbose",
            "level": "ERROR",
        },
    },
    "root": {
        "handlers": ["console"] if DEBUG else ["console", "file", "error_file"],
        "level": "INFO" if IS_PRODUCTION else "DEBUG",
    },
    "loggers": {
        "django": {
            "handlers": ["console"] if DEBUG else ["console", "file"],
            "level": "INFO" if IS_PRODUCTION else "DEBUG",
            "propagate": False,
        },
        "django.db.backends": {
            "handlers": ["console"] if DEBUG else ["file"],
            "level": "WARNING" if IS_PRODUCTION else "DEBUG",
            "propagate": False,
        },
        "django.security": {
            "handlers": ["console", "error_file"],
            "level": "WARNING",
            "propagate": False,
        },
        "celery": {
            "handlers": ["console"] if DEBUG else ["console", "file"],
            "level": "INFO" if IS_PRODUCTION else "DEBUG",
            "propagate": False,
        },
    },
}

# Ensure logs directory exists
import os
os.makedirs(BASE_DIR / "logs", exist_ok=True)

# Error monitoring configuration
SENTRY_DSN = os.getenv("SENTRY_DSN", "")
SENTRY_TRACES_SAMPLE_RATE = float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.1"))

# Validate environment on startup.
#
# NOTE: SKIP_ENV_VALIDATION is load-bearing — the wecrew deployment sets it to "true" in
# ECOM/k8s-wecrew/30-backend.yaml (a different repo from this one) because the cluster runs
# without live Razorpay credentials. Removing this gate crashloops the production backend.
# It is still a blunt instrument: it disables every startup guard, not just the payments one.
# The right fix is to make env_validation require provider creds only when that provider is
# enabled, then drop this flag — do that before removing the escape hatch.
if IS_PRODUCTION and not env_bool("SKIP_ENV_VALIDATION", False):
    from .env_validation import validate_on_startup
    validate_on_startup()

# Sentry error monitoring (no-ops when SENTRY_DSN is not set)
from .sentry import init_sentry
init_sentry()
