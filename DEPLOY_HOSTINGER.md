# Deploy APATECH to Hostinger (Single Node.js App)

This project can run on Hostinger as one Node.js web app:

- Frontend static files are served by `api/kyc-server.js`
- API endpoints remain under `/api/*`
- Root start command uses `package.json` at project root (`npm start`)

## 1) Prepare the project

Deploy the **entire `APATECH` folder** (not only `api/`), because the server now serves static files from project root.

Required root files:

- `package.json`
- `api/kyc-server.js`
- frontend HTML/CSS/JS/assets folders

## 2) Create Node.js app in Hostinger hPanel

1. Go to **Websites** -> **Add website**
2. Choose **Node.js Web Application**
3. Connect your domain (or temporary domain)
4. Deploy via Git or ZIP upload

Recommended runtime settings:

- Node.js version: `20` or `22`
- Install command: `npm install`
- Start command: `npm start`

## 3) Configure environment variables

Set these in hPanel Environment Variables (based on `api/.env.example`):

- `KYC_PORT=5050`
- `PUBLIC_API_BASE=https://your-domain.com`
- `DB_HOST=127.0.0.1`
- `DB_PORT=3306`
- `DB_USER=<your_db_user>`
- `DB_PASSWORD=<your_db_password>`
- `DB_NAME=<your_db_name>`
- `ADMIN_LOGIN_ID=<your_admin_login_id>`
- `ADMIN_PASSWORD=<your_strong_admin_password>`
- `AUTH_SESSION_SECRET=<long_random_secret_min_16_chars>`
- `ALLOW_DEMO_OTP=false`
- `CORS_ALLOWED_ORIGINS=https://your-domain.com,https://www.your-domain.com`

Optional but recommended if using OTP notifications:

- SMTP: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_SECURE`
- SMS: `SEMAPHORE_API_KEY`, `SEMAPHORE_SENDERNAME`, `SEMAPHORE_RELAY_TOKEN`

## 4) Set up database and import schema

1. Create a MySQL database + user in hPanel
2. Open phpMyAdmin
3. Import `api/mysql-schema.sql`

Make sure DB env vars point to the same database credentials.

## 5) Verify after deploy

Health check:

- `https://your-domain.com/api/health`

Frontend check:

- `https://your-domain.com/`
- `https://your-domain.com/frontpage.html`

If the health endpoint works and frontend loads from the same domain, API calls should work without setting `localStorage` API base.

## 6) Troubleshooting quick checks

- If app fails to start: confirm start command is `npm start`
- If login/signup fails with DB errors: re-check `DB_*` vars and imported schema
- If OTP fails: configure SMTP/SMS vars or keep demo OTP off in production
- If assets 404: confirm entire frontend files were included in deployment package
