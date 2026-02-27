## Deploy Ecodrive API on Render (Node)

### 1) Push project to GitHub
- Push this project so Render can read it.
- Your API folder is: `APATECH/api`

### 2) Create a Web Service in Render
- Dashboard: `New` -> `Web Service`
- Connect your GitHub repo
- Settings:
  - `Root Directory`: `APATECH/api`
  - `Runtime`: `Node`
  - `Build Command`: `npm install`
  - `Start Command`: `npm start`

### 3) Add environment variables in Render
Set these in `Environment`:

- `PUBLIC_API_BASE=https://<your-render-service>.onrender.com`
- `MYSQL_URL=mysql://<user>:<password>@<host>:3306/<database>`
- `DB_SSL=true` (if your provider requires SSL)
- `DB_SSL_REJECT_UNAUTHORIZED=false` (common for shared/free DB cert chains)

Alternative (if you don't have `MYSQL_URL`):
- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`

Optional:
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_SECURE`
- `SEMAPHORE_API_KEY` (for built-in SMS relay)
- `SEMAPHORE_SENDERNAME` (optional; use approved sender name)
- `SEMAPHORE_API_BASE=https://api.semaphore.co/api/v4`
- `SEMAPHORE_REQUEST_TIMEOUT_MS=15000`
- `SEMAPHORE_RELAY_TOKEN=<strong-random-token>` (optional; only if you call `/api/integrations/sms/semaphore-relay` from external services)
- `ALLOW_DEMO_OTP=true` (temporary only while testing, not production)

Note:
- With `SEMAPHORE_API_KEY` set, mobile OTP is sent directly by this backend. No separate SMS relay server is required.

#### OTP setup now (no owned domain yet)
Use Mailtrap Sandbox first:

- `SMTP_HOST=sandbox.smtp.mailtrap.io`
- `SMTP_PORT=587`
- `SMTP_USER=<mailtrap-sandbox-username>`
- `SMTP_PASS=<mailtrap-sandbox-password>`
- `SMTP_FROM=Ecodrive <no-reply@ecodrive.local>`
- `SMTP_SECURE=false`
- `ALLOW_DEMO_OTP=false`

Notes:
- OTP emails will appear in Mailtrap inbox (not real Gmail/Yahoo inboxes).
- This is best for testing flow before buying/connecting a domain.

#### OTP setup later (Hostinger domain ready)
After buying a domain in Hostinger, add a sending domain in Mailtrap (recommended subdomain: `mail.<your-domain>`), then add Mailtrap DNS records in Hostinger DNS Zone until verified.

Set:

- `SMTP_HOST=live.smtp.mailtrap.io`
- `SMTP_PORT=587`
- `SMTP_USER=api`
- `SMTP_PASS=<mailtrap-live-stream-password>`
- `SMTP_FROM=Ecodrive <no-reply@mail.<your-domain>>`
- `SMTP_SECURE=false`
- `ALLOW_DEMO_OTP=false`

Important:
- `SMTP_FROM` must match your verified Mailtrap sending domain/subdomain.
- If you see `550 ... Sending from domain is not allowed`, check `SMTP_FROM` and domain verification status.

#### SMS OTP setup (built-in Semaphore relay)
Set these in Render:

- `SEMAPHORE_API_KEY=<your-semaphore-api-key>`
- `SEMAPHORE_SENDERNAME=<optional-approved-sendername>`
- `SEMAPHORE_API_BASE=https://api.semaphore.co/api/v4`
- `SEMAPHORE_REQUEST_TIMEOUT_MS=15000`

Optional for external relay endpoint callers:
- `SEMAPHORE_RELAY_TOKEN=<strong-random-token>`

No `SMS_WEBHOOK_URL` is needed for the built-in setup.

### 4) Import schema to your MySQL database
- Use your DB panel/phpMyAdmin
- Import: `APATECH/api/mysql-schema.sql`

Note: if using InfinityFree phpMyAdmin, import the file while `if0_...` database is selected.
`CREATE DATABASE` is intentionally removed from the schema for compatibility.

### 5) Point frontend to Render API
Open browser console on your site and run:

```js
localStorage.setItem("ecodrive_api_base", "https://<your-render-service>.onrender.com");
localStorage.setItem("ecodrive_kyc_api_base", "https://<your-render-service>.onrender.com");
location.reload();
```

### 6) Verify API health
Open:
- `https://<your-render-service>.onrender.com/api/health`

You should get JSON with:
- `"ok": true`
- `"smtpConfigured": true` (if SMTP env vars are valid)
- `"smsConfigured": true` (if Semaphore or SMS webhook is configured)
- `"smsMode": "semaphore-direct"` (when Semaphore is active)
