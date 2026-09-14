# CSM Silks - Production Retailer V1

Single-brand textile ecommerce platform for CSM Silks, rebuilt around a Django/DRF API and the existing React/Vite storefront.

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

## Core Accounts

- Admin: `admin@csmsilks.com` / `admin123`
- Customer OTP phone: `+918888888888`
- Local OTP fallback is opt-in only: set `DEBUG=True` and `OTP_DEV_FALLBACK_ENABLED=True` if you need `/api/auth/otp/send` to return `dev_otp`. Production login requires live SMS or email OTP delivery.

## Backend

- Django project: `backend/csm_backend`
- Apps: accounts, catalog, inventory, cart, orders, payments, shipping, loyalty, reviews, notifications, analytics, ai
- API docs: `GET /api/docs`
- Health: `GET /health` or `GET /api/health`

## Key API Routes

- Customer: `/api/products`, `/api/search`, `/api/cart`, `/api/checkout/summary`, `/api/orders`, `/api/orders/track`, `/api/orders/{id}/invoice`, `/api/addresses`
- Auth: `/api/auth/otp/send`, `/api/auth/otp/verify`, `/api/auth/admin/login`, `/api/auth/me`
- Payments: `/api/payments/razorpay/order`, `/api/payments/razorpay/verify`, `/api/payments/webhook`
- Admin: `/api/admin/dashboard`, `/api/admin/products`, `/api/admin/variants`, `/api/admin/inventory`, `/api/admin/orders`, `/api/admin/orders/{id}/workflow`, `/api/admin/shipments/{id}/label`

## Fulfillment V1

- Admin can move orders through quality check, packing, label creation, pickup, in transit, out for delivery, delivery failed, RTO, delivered.
- Manual courier labels and manifests are downloadable from the admin API.
- Customer tracking works by login order detail or public order/AWB + phone lookup.
- Shiprocket credentials are represented in `.env.example`; live Shiprocket API calls should replace the manual label adapter when credentials are available.

## Validation

Tests must be run **from `backend/`**. Invoked from the repo root they report `Found 0 test(s)` and exit
`0` — a false pass, because the stale untracked app dirs at this repo's root shadow the real apps under
`backend/`. Two env overrides are also required, both because `DEBUG` is unset:
`SECURE_SSL_REDIRECT=false` (it defaults on whenever `DEBUG=False` and 301-redirects every test-client
request, failing ~18 otherwise-unrelated tests with `301 != 200`) and `CHANNEL_LAYER_BACKEND=memory`
(it defaults to `redis`, so the ~25 tests that publish a realtime update raise
`redis.exceptions.ConnectionError` unless a redis is listening on `:6379`). CI sets the working
directory and both overrides.

```bash
python backend/manage.py check

cd backend
SECURE_SSL_REDIRECT=false CHANNEL_LAYER_BACKEND=memory python manage.py test \
       accounts catalog cart orders payments inventory loyalty notifications \
       analytics shipping reviews ai csm_backend            # 180 tests

cd ../frontend && npm run build
```

For a production deploy check, run with `DEBUG=False`, a long `SECRET_KEY`, real `ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`, and `CSRF_TRUSTED_ORIGINS`. When `DEBUG=False`, the backend now defaults to HTTPS redirect, secure cookies, HSTS, and forwarded-proto support unless explicitly overridden.

The deploy check also fails fast if production is still wired to SQLite, in-memory realtime, missing Redis/Celery broker settings, missing Razorpay credentials/webhook secret, no live OTP channel, or no customer notification channel. `docker-compose.prod.yml` runs `python backend/manage.py check --deploy` before migrations so a bad production environment stops before serving traffic.

## Deploying

`.github/workflows/deploy.yml` ships to production. It fires after CI goes green on `main`,
deploys that exact commit (not the tip of the branch, which may have moved), and fails the run
if the site does not answer afterwards. `workflow_dispatch` deploys a chosen SHA by hand.

There is nothing to run locally: the API container does `check --deploy`, `migrate` and
`collectstatic` on start, so the deploy is a rebuild and recreate of the compose stack.

Six repository secrets are required, under **Settings → Secrets and variables → Actions**:

| Secret | What it holds |
|---|---|
| `DEPLOY_HOST` | the server's hostname or IP |
| `DEPLOY_USER` | the SSH user owning the checkout |
| `DEPLOY_SSH_KEY` | that user's private key, whole file including headers |
| `DEPLOY_PATH` | absolute path to the git checkout on the host |
| `DEPLOY_KNOWN_HOSTS` | output of `ssh-keyscan -H <your-host>` |
| `DEPLOY_HEALTH_URL` | e.g. `https://csmsilks.com/api/health` |

`DEPLOY_KNOWN_HOSTS` is required rather than running `ssh-keyscan` inside the job: scanning at
deploy time trusts whatever answers on the day, which is the thing host-key checking exists to
prevent. Pin it once.

The job declares `environment: production`, so required reviewers or a wait timer can be added
in **Settings → Environments** to gate deploys behind a human.
