# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CSM Silks E-Commerce is a full-stack platform for a textile retailer built with Django/DRF (backend) and React/Vite (frontend). The frontend dev server proxies `/api` requests to the Django server.

## Commands

### Backend

```bash
# Run Django dev server (port 8000)
python backend/manage.py runserver 0.0.0.0:8000

# Tests MUST be run from backend/. Invoked from the repo root, stale __pycache__-only
# directories (accounts/, catalog/, ...) left by earlier runs become namespace packages
# that shadow the real apps: the run reports "Found 0 test(s)" and exits 0, which looks
# like a pass. They are gitignored, so CI (a clean checkout) is unaffected.
# SECURE_SSL_REDIRECT defaults on whenever DEBUG=False and 301-redirects every test client
# request; without the override ~18 unrelated tests fail with "301 != 200".
cd backend

# Run all tests
SECURE_SSL_REDIRECT=false python manage.py test accounts catalog cart orders payments \
    inventory loyalty notifications analytics shipping reviews ai csm_backend

# Run single app tests
SECURE_SSL_REDIRECT=false python manage.py test accounts

# Run specific test class
SECURE_SSL_REDIRECT=false python manage.py test accounts.tests.OTPApiTests

# Migrations
python backend/manage.py makemigrations
python backend/manage.py migrate

# Seed development data
python backend/manage.py seed_csm

# Celery worker (run from project root)
celery --workdir backend -A csm_backend worker --loglevel=info

# Celery beat scheduler
celery --workdir backend -A csm_backend beat --loglevel=info
```

### Frontend

```bash
cd frontend

npm install
npm run dev        # Dev server on port 5173
npm run build      # Production build
npm run lint       # ESLint
npm run preview    # Preview production build
```

### Docker

```bash
docker compose up                              # All services (API, Celery, PostgreSQL, Redis)
docker compose -f docker-compose.prod.yml up   # Production stack
docker compose --profile dev up               # Includes pgAdmin
```

## Architecture

### Backend — Django apps in `backend/`

| App | Responsibility |
|-----|---------------|
| `accounts` | OTP/password auth, customer profiles, staff roles, addresses |
| `catalog` | Products, categories, variants, images, search facets |
| `inventory` | Stock ledger, admin inventory management |
| `cart` | Shopping cart and wishlist |
| `orders` | Checkout flow, order status, returns/RTO |
| `payments` | Razorpay integration, COD |
| `shipping` | Shipment tracking, Shiprocket adapter |
| `loyalty` | Points and rewards |
| `reviews` | Product reviews and ratings |
| `notifications` | Email (Resend), SMS (Twilio), WhatsApp (Gupshup) notification logs |
| `analytics` | Dashboard and reporting APIs |
| `ai` | Claude AI helpers |

- Root config: `backend/csm_backend/` (settings, URLs, Celery, WSGI/ASGI)
- All API routes use `/api` prefix; root routing in `backend/csm_backend/urls.py`
- JWT auth via `djangorestframework-simplejwt`
- OpenAPI docs at `GET /api/docs` (drf-spectacular)

### Frontend — `frontend/src/`

- `App.tsx` — React Router 7 setup and main layout
- `pages/` — Full-page screens (customer-facing and admin)
- `features/` — Feature-level components (ProductCard, OrderForm, etc.)
- `components/` — Shared UI components
- `store/` — State management (includes `ThemeContext.tsx`)
- `styles/` — Global CSS: `tokens.css`, `base.css`, `layout.css`, `commerce.css`, `product.css`, `admin.css`

Vite proxies `/api/*` → `http://localhost:8000` in dev. Config in `frontend/vite.config.ts`.

### Infrastructure

- Development: SQLite (default) or PostgreSQL
- Production: PostgreSQL + Redis (required)
- Celery uses Redis as broker for async tasks (email, notifications, reports, PDF generation)
- Media files stored in `backend/media/` (Docker-mounted volume)

## Environment Setup

Copy `.env.example` to `.env`. Key variables:

- `DATABASE_URL` — PostgreSQL connection (defaults to SQLite in dev)
- `REDIS_URL` — Redis broker URL
- `SECRET_KEY` — Django secret key
- `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` — Payment gateway
- `SHIPROCKET_*` — Shipping provider credentials
- `RESEND_API_KEY` — Email delivery
- `TWILIO_*` — SMS delivery
- `GUPSHUP_*` — WhatsApp delivery
- `CORS_ALLOWED_ORIGINS` — Frontend origins

**Dev defaults:** admin login `admin@csmsilks.com` / `admin123`; test customer OTP phone `+918888888888`.

**OTP in dev:** `POST /api/auth/otp/send` returns `dev_otp` only when `DEBUG=True` and `OTP_DEV_FALLBACK_ENABLED=True`. Production customer login must use live SMS or email OTP delivery.

## Key Notes

- **Shipping:** Manual courier flow is available; Shiprocket live calls require real credentials.
- **Database:** SQLite is fine for development but PostgreSQL is required for concurrent production use.
- **PDF generation:** Uses WeasyPrint (system-level dependency; may require OS packages).
- **Static files:** Run `python backend/manage.py collectstatic` in production Docker builds.
- **CORS:** Configured for `localhost:5173` and `127.0.0.1:5173` in dev settings.
