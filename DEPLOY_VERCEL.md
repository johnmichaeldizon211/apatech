# Deploy Ecodrive on Vercel (Frontend + API)

This repo is now configured so:

- Static pages are served by Vercel.
- All `/api/*` requests are routed to one Node.js function (`api/index.js` -> `api/kyc-server.js`).

## 1) Push to GitHub

Push the `APATECH` folder to your GitHub repo.

## 2) Create a Vercel Project

In Vercel:

1. `Add New` -> `Project`
2. Import your GitHub repo
3. Set **Root Directory** to `APATECH` (if repo root contains this folder)
4. Keep framework as **Other**
5. Deploy

## 3) Add Environment Variables in Vercel

Set these in Project Settings -> Environment Variables:

- `PUBLIC_API_BASE=https://<your-project>.vercel.app`
- `DB_HOST`
- `DB_PORT`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`
- `DB_URL` (optional alternative to DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME)
- `DB_SSL` (optional, set `true` if provider requires TLS)
- `DB_SSL_REJECT_UNAUTHORIZED` (optional; common managed DB setup is `false`)
- `ADMIN_LOGIN_ID`
- `ADMIN_PASSWORD`
- `AUTH_SESSION_SECRET` (required for stable auth tokens across serverless instances)

Optional but recommended:

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`
- `SMTP_SECURE`
- `SEMAPHORE_API_KEY`
- `SEMAPHORE_SENDERNAME`
- `SEMAPHORE_API_BASE`
- `SEMAPHORE_REQUEST_TIMEOUT_MS`
- `SEMAPHORE_RELAY_TOKEN`
- `CORS_ALLOWED_ORIGINS=https://<your-project>.vercel.app`
- `ALLOW_DEMO_OTP=false`
- `INSTALLMENT_REMINDER_ENABLED=false`

## 4) Verify After Deploy

Check:

- `https://<your-project>.vercel.app/api/health`

Expected:

- `"ok": true`
- `dbConfigured: true`

## 5) Notes for Production Stability

- Auth/OTP state in this API is currently memory-based. In serverless platforms, memory can reset across invocations.
- For strict production reliability under higher traffic, move auth/OTP/rate-limit state to a shared store (MySQL/Redis).
