# Ecodrive API (MySQL + OTP + KYC)

This API now supports:

- User signup with verification:
  - `POST /api/signup/send-code`
  - `POST /api/signup/verify-code`
  - `POST /api/signup`
  - Verify either email or mobile before final signup submit
- User login (`POST /api/login`) with blocked-user check
- Session auth:
  - `GET /api/auth/me`
  - `POST /api/logout`
- Admin users list (`GET /api/admin/users`)
- Admin block/unblock user (`POST /api/admin/users/:id/block`, `POST /api/admin/users/:id/unblock`)
- Chat support:
  - User thread/messages: `GET /api/chat/thread`, `POST /api/chat/messages`, `POST /api/chat/thread/clear`
  - Admin thread view: `GET /api/admin/chat/users/:id`
  - Admin takeover/release: `POST /api/admin/chat/users/:id/takeover`, `POST /api/admin/chat/users/:id/release`
  - Admin send message: `POST /api/admin/chat/users/:id/messages`
- Profile settings and password:
  - `GET /api/profile/settings?email=...`
  - `POST /api/profile/settings`
  - `POST /api/profile/password`
- Bookings:
  - `POST /api/bookings`
  - `GET /api/bookings?email=...`
  - `POST /api/bookings/:orderId/cancel`
  - `GET /api/admin/dashboard`
  - `GET /api/admin/bookings?scope=pending|all`
  - `GET /api/admin/bookings/:orderId`
  - `POST /api/admin/bookings/:orderId/approve`
  - `POST /api/admin/bookings/:orderId/reject`
  - `POST /api/admin/bookings/:orderId/payment-status`
- Forgot password OTP:
  - `POST /api/forgot/send-code`
  - `POST /api/forgot/verify-code`
  - `POST /api/reset-password`
- SMS integrations:
  - `POST /api/integrations/sms/semaphore-relay`
- KYC endpoints:
  - `POST /api/kyc/verify-id`
  - `POST /api/kyc/verify-face`

## 1) Install Dependencies

From `api` folder:

```bash
cd api
npm install
```

## 2) Create MySQL Database

Run the schema:

```bash
mysql -u root -p < mysql-schema.sql
```

This creates database `ecodrive_db` with users, bookings, products, and chat tables.

## 3) Configure Environment Variables

Use values from `.env.example` (or create `api/.env`):

- `DB_HOST`
- `DB_PORT`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`
- `ADMIN_LOGIN_ID` (required if `api/admin-credentials.json` does not exist)
- `ADMIN_PASSWORD` (required if `api/admin-credentials.json` does not exist)

Optional OTP delivery config:

- Email SMTP:
  - `SMTP_HOST`
  - `SMTP_PORT`
  - `SMTP_USER`
  - `SMTP_PASS`
  - `SMTP_FROM`
  - `SMTP_SECURE`
- SMS via built-in Semaphore relay (recommended):
  - `SEMAPHORE_API_KEY`
  - `SEMAPHORE_SENDERNAME` (optional)
  - `SEMAPHORE_API_BASE` (optional)
  - `SEMAPHORE_REQUEST_TIMEOUT_MS` (optional)
  - `SEMAPHORE_RELAY_TOKEN` (optional, only needed if external services call relay endpoint)
- Legacy SMS webhook fallback (optional):
  - `SMS_WEBHOOK_URL`
  - `SMS_WEBHOOK_TOKEN`

Optional auth/OTP behavior:

- `AUTH_SESSION_TTL_MS` (default: `86400000` / 24h)
- `ALLOW_DEMO_OTP=true` only for local development fallback OTP
- If `ALLOW_DEMO_OTP` is not `true`, SMTP/SMS provider must be configured for forgot-password and signup OTP.
- `CORS_ALLOWED_ORIGINS` comma-separated origin allowlist (example: `http://127.0.0.1:5500,http://localhost:5500`)
- `RATE_LIMIT_WINDOW_MS` (default `900000`)
- `LOGIN_RATE_LIMIT_MAX` (default `10`)
- `OTP_SEND_RATE_LIMIT_MAX` (default `6`)
- `OTP_VERIFY_RATE_LIMIT_MAX` (default `10`)

## 4) Run API

```bash
node kyc-server.js
```

On startup, the server tries to auto-load `api/.env` and auto-create missing DB schema pieces (users, bookings, products, and chat tables/columns).

Default URL:

`http://127.0.0.1:5050`

## 5) Frontend API Base

If frontend is on another origin (like Live Server `127.0.0.1:5500`), set this in browser console:

```js
localStorage.setItem("ecodrive_api_base", "http://127.0.0.1:5050");
```

Reload pages afterwards.

## 6) Domain / Production Setup

If you deploy with a real domain, use one of these:

- Same domain for frontend + API (recommended): keep API paths under `/api/*` on that domain.
  Example:
  - Frontend: `https://ecodrive.example.com`
  - API: `https://ecodrive.example.com/api/*`
- Separate API domain:
  - Frontend: `https://ecodrive.example.com`
  - API: `https://api.ecodrive.example.com`
  - Set in browser once:
    ```js
    localStorage.setItem("ecodrive_api_base", "https://api.ecodrive.example.com");
    ```

Optional server log label:

- Set `PUBLIC_API_BASE` in `api/.env` so startup logs show your public API URL:
  - `PUBLIC_API_BASE=https://api.ecodrive.example.com`

## 7) Admin Login Recovery

If admin login cannot access because the login ID changed, you can update credentials safely from `api` folder.

Keep the existing password hash and set login ID to `ecodrive`:

```bash
npm run admin:credentials -- --login-id ecodrive --keep-password-hash
```

Set both login ID and a new strong password:

```bash
npm run admin:credentials -- --login-id ecodrive --password "NewStrongPassword123!"
```

After updating credentials, restart the API server.

You can verify auth config via health endpoint (`GET /api/health`) and check `adminAuthConfigured: true`.

## Notes

- No default admin password is exposed anymore. Initialize admin credentials using either:
  - `ADMIN_LOGIN_ID` + `ADMIN_PASSWORD` in `api/.env` before first run, or
  - a generated `api/admin-credentials.json` file.
- `ALLOW_DEMO_OTP=true` is ignored when `NODE_ENV=production`.
- If `SEMAPHORE_API_KEY` is set, mobile OTP is sent directly by this backend (no separate SMS relay server needed).
- Passwords in MySQL are stored as `scrypt` hashes (`password_hash` column).
- `POST /api/login` and `POST /api/signup` now return:
  - `token` (Bearer token)
  - `expiresInMs`
  - `expiresAt`
- Bookings now include `paymentStatus`:
  - `awaiting_payment_confirmation`
  - `pending_cod`
  - `installment_review`
  - `paid`
  - `failed`
  - `refunded`
  - `not_applicable`
- Protected endpoints require `Authorization: Bearer <token>`:
  - `/api/admin/*`
  - `/api/chat/*`
  - `/api/profile/*`
  - `/api/bookings*`
