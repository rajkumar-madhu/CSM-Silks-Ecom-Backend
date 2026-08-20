# CSM Silks E-Commerce - Agent Guide

## Stack
- Backend: Python 3.12+ / Django 6 / Django REST Framework / PostgreSQL in production / SQLite for local dev
- Frontend: React 19 / TypeScript 6 / Vite 8 / React Router 7
- Queue: Celery + Redis
- Infra: Docker Compose with Django API, Celery worker/beat, PostgreSQL, Redis, Nginx

## Quick Start
```bash
python backend/manage.py migrate
python backend/manage.py seed_csm
cd backend
daphne -b 0.0.0.0 -p 8000 csm_backend.asgi:application

cd ../frontend
npm install
npm run dev
```

Frontend runs on `http://localhost:5173` and proxies `/api` and `/ws` to the Django ASGI app on `http://localhost:8000`.

## Commands
| Action | Command |
|--------|---------|
| Seed DB | `python backend/manage.py seed_csm` |
| Django migration | `python backend/manage.py makemigrations` |
| Django migrate | `python backend/manage.py migrate` |
| Backend check | `python backend/manage.py check` |
| Backend tests (**run from `backend/`**) | `cd backend && SECURE_SSL_REDIRECT=false python manage.py test accounts catalog cart orders payments inventory loyalty notifications analytics shipping reviews ai csm_backend` |
| Docker up (dev) | `docker compose up` |
| Docker up (prod) | `docker compose -f docker-compose.prod.yml up` |
| Frontend lint | `cd frontend && npm run lint` |
| Frontend build | `cd frontend && npm run build` |

## API
- All routes use the `/api` prefix.
- Health: `GET /health` or `GET /api/health`.
- API docs: `GET /api/docs`.
- Auth: customer phone OTP and admin email/password.
- Dev OTP is returned as `dev_otp` only when `DEBUG=True` and `OTP_DEV_FALLBACK_ENABLED=True`.

## Architecture
```text
backend/
  csm_backend/        Django project/settings/urls/celery
  accounts/           customers, staff roles, OTP, addresses
  catalog/            categories, products, variants, images, facets
  inventory/          stock ledger and admin inventory
  cart/               cart and wishlist
  orders/             checkout, order status, returns
  payments/           Razorpay/COD payment flow
  shipping/           shipment and tracking helpers
  loyalty/            points and rewards
  reviews/            product reviews
  notifications/      notification logs
  analytics/          dashboard/report APIs
  ai/                 non-critical AI helpers
frontend/
  src/pages/          customer and admin screens
  src/features/       feature-level UI
  src/ui/             shared UI primitives
  src/styles/         tokens/base/layout/product/commerce/admin CSS
```

## Core Accounts
- Admin: `admin@csmsilks.com` / `admin123`
- Customer OTP phone: `+918888888888`

## Google Sign-In (local)
1. Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Web client.
2. Authorized redirect URIs:
   - `http://localhost:5173/auth/google/callback`
   - `http://127.0.0.1:5173/auth/google/callback`
3. Backend `.env`: `GOOGLE_CLIENT_ID=<web-client-id>` and `GOOGLE_OAUTH_ENABLED=True`.
4. Optional: `frontend/.env.local` with `VITE_GOOGLE_CLIENT_ID=<same id>`.
5. Restart API, open `/login`, use **Continue with Google**.

Print the exact URIs anytime: `python backend/manage.py google_oauth_setup`.

## Production checklist
- [ ] `APP_ENV=production`, `DEBUG=False`, long random `SECRET_KEY`
- [ ] `DATABASE_URL=postgres://...`, `REDIS_URL=redis://...`, `CHANNEL_LAYER_BACKEND=redis`
- [ ] `OTP_DEV_FALLBACK_ENABLED=False`, `PAYMENT_DEV_FALLBACK_ENABLED=False`
- [ ] Live OTP: Twilio SMS and/or Resend email (`OTP_EMAIL_ENABLED=True`)
- [ ] Notifications: Resend and/or Gupshup WhatsApp
- [ ] Razorpay: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`
- [ ] Shipping: `DEFAULT_COURIER_PROVIDER=manual` or full Shiprocket credentials
- [ ] `ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`, `CSRF_TRUSTED_ORIGINS` for the real domain
- [ ] Google: production redirect URI `https://your-domain/auth/google/callback`
- [ ] `python backend/manage.py check --deploy` must pass
- [ ] Deploy: `docker compose -f docker-compose.prod.yml up --build -d`
- Do not commit local SQLite DBs, screenshots, logs, or `.env`.

## Frontend tests
```bash
cd frontend
npm test
npm run test:e2e          # requires API on :8000 and Vite on :5173
npm run test:e2e:icons
```
