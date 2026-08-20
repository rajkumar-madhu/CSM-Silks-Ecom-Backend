# ── Stage 1: builder ──────────────────────────────────────────────────────────
FROM python:3.12-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev libcairo2 libpango-1.0-0 libpangocairo-1.0-0 \
    libgdk-pixbuf-2.0-0 libffi-dev shared-mime-info \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt


# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM python:3.12-slim AS runtime

# Runtime system deps only (no gcc/build tools)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 libcairo2 libpango-1.0-0 libpangocairo-1.0-0 \
    libgdk-pixbuf-2.0-0 shared-mime-info curl \
    && rm -rf /var/lib/apt/lists/*

# Copy installed Python packages from builder
COPY --from=builder /install /usr/local

WORKDIR /app

COPY . .

ENV PYTHONPATH=/app/backend:/app
ENV DJANGO_SETTINGS_MODULE=csm_backend.settings

RUN DJANGO_SETTINGS_MODULE=csm_backend.settings \
    PYTHONPATH=/app/backend:/app \
    APP_ENV=development \
    DEBUG=True \
    SECRET_KEY=build-secret-key \
    ALLOWED_HOSTS=* \
    python backend/manage.py collectstatic --noinput

# Create non-root user for security
RUN groupadd -r csm && useradd -r -g csm -d /app -s /sbin/nologin csm \
    && mkdir -p backend/logs backend/media backend/staticfiles /app/media \
    && chown -R csm:csm /app

USER csm

ENV PYTHONPATH=/app/backend:/app
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PORT=8000

EXPOSE 8000

CMD ["daphne", "-b", "0.0.0.0", "-p", "8000", "csm_backend.asgi:application"]
