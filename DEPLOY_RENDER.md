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
- `ALLOW_DEMO_OTP=true` (temporary only while testing, not production)

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

You should get JSON with `success: true`.
