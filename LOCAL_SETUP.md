# Run Ecodrive locally

Double-click [start-local.cmd](start-local.cmd), or open a terminal in this folder and run:

```powershell
npm.cmd start
```

Open [http://localhost:5050](http://localhost:5050) after the message `Ecodrive is ready` appears. Keep the terminal open while using the app. Press `Ctrl+C` to stop it.

The first run creates a project-only MariaDB database in `.local/mysql`. It uses port `3307`, so it does not use or change an existing XAMPP database. The API and website run together on port `5050`.

Local demo mode is enabled automatically:

- Signup and password-reset OTPs appear on the page; email and SMS are never sent.
- The address dropdowns work from the included Bulacan location data.
- Home Service repair bookings use local branch-area coordinates so an external map service is not required.
- The five branch admins are created only on the first run. Their initial password is `ecodriveadmin123`.

To restore that password for every local branch admin, run `npm.cmd run reset:local-admin`, then restart the local app.

| Branch | Admin username |
| --- | --- |
| City of Baliwag | `ecodrive` |
| Pulilan | `ecodrivepulilan` |
| San Ildefonso | `ecodrivesanildefonso` |
| San Rafael | `ecodrivesanrafael` |
| Bustos | `ecodrivebustos` |

Run these while the local app is running to verify it:

```powershell
npm.cmd run test:local
npm.cmd run test:browser
npm.cmd run test:static
```

The local database, generated admin credential hashes, and test data are ignored by Git. This local setup does not read or use a production `.env`, database, email account, or SMS provider.
