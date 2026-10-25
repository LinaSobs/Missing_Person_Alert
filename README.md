# Missing Person Alert

A student-project prototype for publishing, moderating and sharing missing-person alerts. It is built with **React + Vite** (frontend), **ASP.NET Core Web API on .NET 10** (backend), **SQL Server**, **Entity Framework Core**, **JWT authentication**, **SignalR** and **Leaflet / OpenStreetMap**.

> **Safety notice.** This is a coursework prototype. It is not affiliated with or endorsed by SAPS and it is not an emergency service. Do not enter real missing-person details until the system has passed proper security, privacy, legal (POPIA) and operational review. In South Africa, contact SAPS immediately when a person is missing; do not wait for this application.

---

## Table of contents

1. [What the application does](#1-what-the-application-does)
2. [Project structure](#2-project-structure)
3. [Choose how you want to run it](#3-choose-how-you-want-to-run-it)
4. [Install the tools](#4-install-the-tools)
5. [Option A: run the frontend against the hosted API](#5-option-a-run-the-frontend-against-the-hosted-api-easiest)
6. [Option B: run everything locally](#6-option-b-run-everything-locally-frontend--api--database)
7. [Configuration reference](#7-configuration-reference)
8. [Main API routes](#8-main-api-routes)
9. [Upload the project to GitHub](#9-upload-the-project-to-github)
10. [Deploy the API to MonsterASP.NET](#10-deploy-the-api-to-monsteraspnet)
11. [Deploy the frontend](#11-deploy-the-frontend)
12. [Updating a live deployment](#12-updating-a-live-deployment)
13. [Troubleshooting](#13-troubleshooting)
14. [Security checklist](#14-security-checklist)
15. [Privacy and production limitations](#15-privacy-and-production-limitations)

---

## 1. What the application does

- Responsive React interface for desktop and mobile.
- **Public alerts** show only approved reports.
- Map markers show active alerts, Found Safe cases, Found Deceased cases and reviewed possible sightings.
- Separate **member / reporter** and **moderator / administrator** dashboards.
- Sign-in and role-based access through ASP.NET Core Identity and JWT.
- Missing-person reports require a phone number, email, photograph, last-seen date and an approximate map location.
- The reporter's consent decides whether contact details appear on an approved public alert.
- Only the owner can edit a report. Every edit sends the report back to pending review.
- Moderators approve or reject reports and possible sightings.
- Sightings are hidden when their case is found or closed. They must be reviewed again before being republished.
- Administrators can correct Found Safe / Found Deceased statuses (a reason is required and an audit event is written).
- Administrator-only **Audit Trail** with search, filtering and paging.
- WhatsApp sharing for an approved report.
- Private photo storage with server-side file validation (JPEG, PNG or WebP, up to 5 MB).

---

## 2. Project structure

```text
Missing_Person_Alert/
├── backend/
│   └── MissingPersonAlert.Api/      ASP.NET Core Web API
│       ├── Controllers/             Auth, Cases, Sightings, Admin, Notifications, Subscriptions
│       ├── Data/  Models/  DTOs/    Database context, entities, request/response types
│       ├── Hubs/  Services/         SignalR hub, JWT and photo-storage services
│       ├── Program.cs               Startup, CORS, auth, rate limiting, /health
│       └── appsettings.json         Safe template (no real secrets)
├── frontend/
│   ├── src/                         React app (App.jsx, api.js, styles)
│   ├── .env.example                 Example frontend settings
│   └── package.json
├── setup-frontend.bat               Windows helper: writes .env, tests the API, starts the site
├── start-api.bat / start-local.bat  Windows helpers for local development
├── CHANGELOG.md
└── README.md
```

---

## 3. Choose how you want to run it

| | Option A: hosted API | Option B: fully local |
|---|---|---|
| What runs on your laptop | Frontend only | Frontend + API + database |
| Needs .NET SDK and SQL Server | No | Yes |
| Data lives in | The shared hosted database | Your own local database |
| Best for | Demos, marking, showing someone | Development and testing admin features |

If you only need to see the website working, use **Option A**.

---

## 4. Install the tools

Do this once on any laptop that will run the project.

| Tool | Needed for | Where to get it |
|---|---|---|
| **Node.js LTS** (includes npm) | Frontend (both options) | https://nodejs.org/en/download |
| **Visual Studio Code** | Editing and terminals | https://code.visualstudio.com |
| **Git** | Uploading to GitHub | https://git-scm.com/downloads |
| **.NET 10 SDK** | Option B and publishing the API | https://dotnet.microsoft.com/download/dotnet/10.0 |
| **SQL Server LocalDB or Express** | Option B only | https://learn.microsoft.com/sql/database-engine/configure-windows/sql-server-express-localdb |

After installing, **close and reopen your terminal**, then check each tool prints a version:

```powershell
node -v
npm -v
git --version
dotnet --version
```

> **PowerShell tip.** If PowerShell says running scripts is disabled when you use `npm`, use `npm.cmd` instead (for example `npm.cmd run dev`).

---

## 5. Option A: run the frontend against the hosted API (easiest)

### Step 1: get the project

Either download and extract the ZIP to a normal folder such as `C:\Projects\Missing_Person_Alert` (do not run it from inside the ZIP), or clone it:

```powershell
git clone https://github.com/YOUR-USERNAME/Missing_Person_Alert.git
cd Missing_Person_Alert
```

### Step 2: check the hosted API is running

Open this in your browser. It should show `"status":"ok"`:

```text
http://missing-person-alert.runasp.net/health
```

### Step 3: start the frontend (Windows shortcut)

From the project root:

```powershell
cmd /c setup-frontend.bat
```

The script writes `frontend\.env`, tests two API addresses (both should report `HTTP 200`), installs packages if needed and starts the site.

### Step 3 (manual alternative)

Create `frontend/.env` with exactly this content (the file must be named `.env`, not `.env.txt`):

```env
VITE_USE_LOCAL_DATA=false
VITE_API_BASE_URL=http://missing-person-alert.runasp.net
```

Then run:

```powershell
cd frontend
npm install
npm run dev
```

### Step 4: open the website

Open **http://localhost:5173/** in Edge or Chrome and keep the terminal open.

Use the **Local** address, not the **Network** address that Vite also prints. The API only accepts browser requests from addresses on its allow-list (see [CORS](#cors-allowed-origins)).

### To stop and restart

Press **Ctrl + C** in the terminal to stop. To start again:

```powershell
cd frontend
npm run dev
```

You do not need `npm install` every time. `npm run dev` must be run from the `frontend` folder, because that is where `package.json` is.

---

## 6. Option B: run everything locally (frontend + API + database)

### Step 1: start SQL Server LocalDB

```powershell
sqllocaldb info
sqllocaldb start MSSQLLocalDB
```

### Step 2: create the local API settings

Create `backend/MissingPersonAlert.Api/appsettings.Development.json`. This file is ignored by Git. **Never commit it.**

```json
{
  "ConnectionStrings": {
    "DefaultConnection": "Server=(localdb)\\MSSQLLocalDB;Database=MissingPersonAlertDb;Trusted_Connection=True;TrustServerCertificate=True;MultipleActiveResultSets=true"
  },
  "Jwt": {
    "Issuer": "MissingPersonAlert.Api",
    "Audience": "MissingPersonAlert.Frontend",
    "SigningKey": "REPLACE_WITH_YOUR_OWN_RANDOM_KEY_AT_LEAST_32_CHARACTERS"
  },
  "SeedAdmin": {
    "Enabled": true,
    "Email": "admin@example.test",
    "Password": "CHOOSE-A-STRONG-PASSWORD"
  },
  "AllowedOrigins": [ "http://localhost:5173", "http://127.0.0.1:5173" ]
}
```

Generate a signing key with this PowerShell command and paste the output into `SigningKey`:

```powershell
[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }) -as [byte[]])
```

`SeedAdmin` creates an administrator account the first time the API starts. Use a strong password that you do not use anywhere else.

### Step 3: run the API

```powershell
cd backend\MissingPersonAlert.Api
dotnet restore
dotnet build
dotnet run --urls http://localhost:5068
```

Open `http://localhost:5068/health`. It should show `"status":"ok"`. Keep this terminal open. On first start the application creates the database.

### Step 4: point the frontend at the local API

Create `frontend/.env`:

```env
VITE_USE_LOCAL_DATA=false
VITE_API_BASE_URL=http://localhost:5068
```

### Step 5: run the frontend in a second terminal

```powershell
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173/** and sign in with the administrator email and password from Step 2.

### Browser-only demo mode (no API)

Set `VITE_USE_LOCAL_DATA=true` in `frontend/.env` to test the interface without any backend. Data stays in the current browser only, and registering creates a Member account. There is no administrator in this mode. Use it for interface testing only.

> Vite reads `.env` only when it starts. After editing `.env`, stop the dev server with Ctrl + C and run `npm run dev` again.

---

## 7. Configuration reference

### Frontend (`frontend/.env`)

| Variable | Meaning | Example |
|---|---|---|
| `VITE_USE_LOCAL_DATA` | `false` = use the real API, `true` = browser-only demo | `false` |
| `VITE_API_BASE_URL` | Address of the API, with no trailing slash | `http://localhost:5068` |

### Backend settings

ASP.NET Core reads settings from `appsettings.json`, from `appsettings.Development.json` (development only) and from **environment variables**. Environment variables override the files. Use a **double underscore** (`__`) in place of a nested key. These are the same names you enter in a hosting control panel.

| Setting (environment variable name) | Purpose |
|---|---|
| `ASPNETCORE_ENVIRONMENT` | `Production` on a live site, `Development` on your laptop |
| `ConnectionStrings__DefaultConnection` | SQL Server connection string |
| `Jwt__Issuer` | Token issuer, for example `MissingPersonAlert.Api` |
| `Jwt__Audience` | Token audience, for example `MissingPersonAlert.Frontend` |
| `Jwt__SigningKey` | Secret key, at least 32 characters. Keep it private |
| `SeedAdmin__Enabled` | `true` to create an administrator on startup, otherwise `false` |
| `SeedAdmin__Email` / `SeedAdmin__Password` | Seeded administrator login |
| `AllowedOrigins__0`, `AllowedOrigins__1`, ... | Website addresses allowed to call the API |
| `PhotoStorage__Path` | Optional. Folder used to store uploaded photos |

### CORS (allowed origins)

Browsers only let a website call the API if that website's exact address is in `AllowedOrigins`. The address is the scheme, host and port, with no trailing slash, for example `http://localhost:5173`.

- `http://localhost:5173` and `http://192.168.1.20:5173` are different origins.
- Add one entry per address: `AllowedOrigins__0`, `AllowedOrigins__1`, `AllowedOrigins__2`, and so on.
- Changing an environment variable on a host does not take effect until the site is **restarted**.
- A frontend served over `https://` cannot call an API over plain `http://` (the browser blocks it as mixed content). Use HTTPS for both, or HTTP for both.

---

## 8. Main API routes

| Method | Route | Purpose | Access |
|---|---|---|---|
| `GET` | `/health` | Check the API is running | Public |
| `POST` | `/api/auth/register` | Register a member | Public |
| `POST` | `/api/auth/login` | Sign in and receive a JWT | Public |
| `GET` | `/api/cases/alerts` | Read approved public alerts | Public |
| `GET` | `/api/cases/{id}` | Read a public or authorised case | Public / restricted |
| `GET` | `/api/cases/mine` | List the signed-in user's reports | Authenticated |
| `POST` | `/api/cases` | Submit a report (multipart form data with photo) | Authenticated |
| `PUT` | `/api/cases/{id}` | Edit an owned report and return it to review | Owner only |
| `GET` | `/api/cases/{id}/photo` | Read a case photo | Public if approved, otherwise restricted |
| `POST` | `/api/sightings` | Submit a possible sighting (rate limited) | Public |
| `GET` | `/api/sightings/public` | Read reviewed sightings for active cases | Public |
| `GET` | `/api/notifications` | List the user's notifications | Authenticated |
| `GET/POST/DELETE` | `/api/subscriptions` | Manage area subscriptions | Authenticated |
| `GET` | `/api/admin/cases/pending` | Reports awaiting review | Moderator / Administrator |
| `POST` | `/api/admin/cases/{id}/approve` | Approve a report | Moderator / Administrator |
| `POST` | `/api/admin/cases/{id}/reject` | Reject a report | Moderator / Administrator |
| `PATCH` | `/api/admin/cases/{id}/status` | Update case status | Moderator / Administrator |
| `PATCH` | `/api/admin/cases/{id}/correct-status` | Correct a found-status decision | Administrator |
| `GET` | `/api/admin/sightings/pending` | Sightings awaiting review | Moderator / Administrator |
| `POST` | `/api/admin/sightings/{id}/approve` or `/reject` | Review a sighting | Moderator / Administrator |
| `GET` | `/api/admin/audit-trail` | Search and page audit entries | Administrator |

The controller source is the authoritative list.

---

## 9. Upload the project to GitHub

### Step 1: create the empty repository

1. Sign in at https://github.com.
2. Click **+ → New repository**.
3. Name it `Missing_Person_Alert`.
4. Choose **Private** while the project is in development (you can make it public later).
5. **Do not** tick "Add a README", ".gitignore" or a licence, because the project already has them.
6. Click **Create repository** and keep the page open.

### Step 2: check what must NOT be uploaded

The included `.gitignore` already excludes the sensitive and generated items below. Confirm they are still there:

```text
.env                                 frontend settings
**/appsettings.Development.json     local passwords and keys
**/node_modules/   **/dist/          generated frontend files
**/bin/   **/obj/                    generated .NET files
**/private-uploads/                  uploaded photos
```

Also add the folder used when publishing the API, so it is never uploaded:

```powershell
Add-Content .gitignore "`npublish/"
```

### Step 3: set your Git identity (first time only)

```powershell
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

### Step 4: initialise, commit and push

Run these from the **project root** (the folder that contains `frontend` and `backend`):

```powershell
git init
git add .
git status
```

Read the `git status` list carefully before continuing. It must **not** contain `.env`, `appsettings.Development.json`, `node_modules`, `bin`, `obj`, `publish` or a `private-uploads` folder. `frontend/.env.example` **should** appear.

If a forbidden file appears, remove it from the staging area and fix `.gitignore` first:

```powershell
git rm -r --cached path\to\the\file
```

When the list is clean:

```powershell
git commit -m "Initial commit: Missing Person Alert"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/Missing_Person_Alert.git
git push -u origin main
```

Replace `YOUR-USERNAME` with your GitHub username. When prompted, sign in through the browser window (Git Credential Manager). If a password prompt appears, use a **personal access token** from GitHub → Settings → Developer settings, not your account password.

Warnings such as `LF will be replaced by CRLF` are harmless on Windows.

### Step 5: confirm on GitHub

Refresh the repository page. You should see `backend`, `frontend`, `README.md` and `.gitignore`. Open the `frontend` folder and confirm there is **no** `.env` file there.

### Later: save and upload changes

```powershell
git add .
git status
git commit -m "Describe what you changed"
git push
```

### If a secret was ever committed

Deleting the file in a later commit does not remove it from Git history. Treat the secret as exposed: **change the password, rotate the JWT signing key and replace the database credentials**, then remove the file from the repository. Rotating is faster and safer than trying to rewrite history.

---

## 10. Deploy the API to MonsterASP.NET

These steps use MonsterASP.NET, which hosts ASP.NET Core on IIS. The control-panel menu names can change, so look for the closest matching item if a label differs.

### Step 1: create the website and database

1. Create a website in the MonsterASP control panel (a free `*.runasp.net` subdomain works for a student project).
2. In the panel, create an **MSSQL database** for the site and copy its **connection string** (server, database name, user and password). Treat it as a secret.
3. In the site's settings, check the **.NET version** is one that supports **.NET 10**.

### Step 2: publish the API on your laptop

From the project root:

```powershell
cd backend\MissingPersonAlert.Api
dotnet publish -c Release -o ..\..\publish
cd ..\..
```

Then remove local-only settings from the output so they are not uploaded:

```powershell
Remove-Item .\publish\appsettings.Development.json -ErrorAction SilentlyContinue
```

If you set every value through the control panel's environment variables (next step), you can also delete `.\publish\appsettings.json`, so the placeholder template never overrides your real settings:

```powershell
Remove-Item .\publish\appsettings.json -ErrorAction SilentlyContinue
```

### Step 3: set the environment variables on the host

In the panel, go to **Websites → your site → Manage website → Scripting → Environment Variables** and add these (see [Configuration reference](#backend-settings)):

| Name | Value |
|---|---|
| `ASPNETCORE_ENVIRONMENT` | `Production` |
| `ConnectionStrings__DefaultConnection` | the connection string from Step 1 |
| `Jwt__Issuer` | `MissingPersonAlert.Api` |
| `Jwt__Audience` | `MissingPersonAlert.Frontend` |
| `Jwt__SigningKey` | a new random key of 32+ characters (see Section 6, Step 2) |
| `SeedAdmin__Enabled` | `true` for the first start |
| `SeedAdmin__Email` | your administrator email |
| `SeedAdmin__Password` | a strong password |
| `AllowedOrigins__0` | `http://localhost:5173` |
| `AllowedOrigins__1` | the address of your deployed frontend, if any |

Type the names exactly, with two underscores. A single underscore is ignored.

Never reuse a key or password that has appeared in a screenshot, chat or commit.

### Step 4: stop the site

On the site's **Overview** page, click **Stop**. If there is no Stop button, upload a file called `app_offline.htm` to `/wwwroot`, and delete it after the upload. Files in use cannot be overwritten.

### Step 5: upload the `publish` folder with SFTP

1. In the panel, open **Deploy (FTP/WebDeploy/Git)** and note the **server**, **port**, **login** and **password**. Always use the server name, not the IP address.
2. Install **FileZilla Client** from https://filezilla-project.org (download only from that site).
3. In FileZilla open **File → Site Manager → New Site** and enter:

   | Field | Value |
   |---|---|
   | Protocol | SFTP - SSH File Transfer Protocol |
   | Host | your server name, for example `siteNNNNN.siteasp.net` |
   | Port | `22` |
   | Logon type | Normal |
   | User / Password | from the panel |

   If SFTP fails, use FTP on port `21` with **Require explicit FTP over TLS**.
4. Click **Connect** and accept the host key. You should see a `wwwroot` folder on the right.
5. Double-click **wwwroot** on the right.
6. On the left, click in the **Local site** box, press **Ctrl + A**, press Backspace, paste the full path of your `publish` folder and press Enter.
7. Click in the lower-left file list, press **Ctrl + A**, and drag the selection into the lower-right panel. If asked about existing files, choose **Overwrite**, tick *Always use this action* and *Apply to current queue only*.
8. Wait until the **Queued files** tab is empty and the **Failed transfers** tab has nothing in it.

> **Do not delete** `App_Data` or any `private-uploads` folder on the server. That is where uploaded photos are stored. Re-uploading a new `publish` folder does not delete them.

### Step 6: start the site and test it

Start the site from the panel, wait about 30 seconds, then open these addresses (use `http://` if `https://` is not enabled for your domain):

```text
http://YOUR-SITE.runasp.net/health               must show "status":"ok"
http://YOUR-SITE.runasp.net/api/cases/alerts     must show [] or JSON
```

### Step 7: tidy up the first start

- Set `SeedAdmin__Enabled` to `false` once your administrator can sign in, then restart the site.
- Sign in as the administrator and register a test member to confirm the full journey.

---

## 11. Deploy the frontend

The API only serves data. The React website needs somewhere to run.

### Option 1: run it on each person's laptop

Follow [Option A](#5-option-a-run-the-frontend-against-the-hosted-api-easiest). No extra hosting is required. This is the simplest choice for a class demo.

### Option 2: host the built website

Build the production files:

```powershell
cd frontend
npm install
npm run build
```

The output is in `frontend/dist`. Upload that folder to any static host, such as:

- **Azure Static Web Apps** (connect your GitHub repository; set the app location to `frontend`, the build command to `npm run build` and the output folder to `dist`),
- **Netlify** or **Vercel** (connect your GitHub repository; set the base directory to `frontend`, the build command to `npm run build` and the publish directory to `dist`),
- another MonsterASP site, uploaded through SFTP in the same way as the API.

Set the environment variable `VITE_API_BASE_URL` in the host's build settings (or in `frontend/.env` before building). Vite builds this value into the files, so you must **rebuild** after changing it.

**Two things must match after you host the website:**

1. Add the website's exact address as another `AllowedOrigins__N` variable on the API host, then restart the API site.
2. Use the same scheme for both: an `https://` website needs an `https://` API. If your API does not answer on HTTPS (a free subdomain may not), either host the website over plain `http://` or put the API on a domain with an SSL certificate.

---

## 12. Updating a live deployment

**Backend change:** rebuild and repeat Steps 2, 4, 5 and 6 of Section 10. Environment variables stay as they are.

**Frontend change:** if you run it locally, nothing is needed. If you host it, run `npm run build` again and re-upload `dist` (or push to GitHub if the host builds from your repository).

**Settings change:** edit the environment variable in the panel, then **restart the site**. Changes do not apply until it restarts.

---

## 13. Troubleshooting

| Problem | Likely cause and fix |
|---|---|
| `Failed to fetch` or `Cannot reach the API` | The API address in `.env` is wrong, the API is down, or the website's address is not in `AllowedOrigins`. Check `/health` in a browser, check `frontend/.env`, restart Vite. |
| Alerts work on `localhost` but not on the Network address | `http://192.168.x.x:5173` is a different origin. Open `http://localhost:5173/` instead, or add that exact address as an `AllowedOrigins__N` variable and restart the API site. |
| "Could not load moderator queue / notifications" | You are signed in on an origin the API does not allow yet, or your saved sign-in is stale. Restart the API site after adding the origin, then sign out and sign in again. |
| Requests still go to `localhost:5068` | `.env` is in the wrong folder (it must be in `frontend`) or Vite was not restarted after editing it. |
| `npm error ENOENT ... package.json` | You are in the project root. Run `cd frontend` first. |
| `npm` is not recognised | Close and reopen the terminal. If it persists, reinstall Node.js and keep the PATH option ticked. In PowerShell use `npm.cmd`. |
| Port 5173 already in use | Stop old Vite terminals with Ctrl + C, or run `npm run dev -- --port 5173 --strictPort`. The API allows only the origins you list. |
| `https://` shows `ERR_CONNECTION_RESET` | HTTPS is not enabled for that domain. Use `http://`, or enable an SSL certificate in the host panel. |
| 404 on `/api/alerts/public` | That route does not exist. The correct routes are `/api/cases/alerts` and `/api/sightings/public`. |
| Site returns a 500 error after deployment | A required setting is missing (connection string, `Jwt__SigningKey`) or the .NET version is wrong. Check the host's log viewer. |
| `Jwt` key error on startup | `Jwt__SigningKey` is missing, still the placeholder or shorter than 32 characters. |
| Uploaded photos disappear after deploying | The `App_Data/private-uploads` folder was deleted. Never delete it when updating. |
| Cannot sign in as administrator | `SeedAdmin__Enabled` was `false` on first start. Set it to `true` with email and password, restart, then set it back to `false`. |
| FileZilla says a file is in use | The site is still running. Stop it first, or use `app_offline.htm`. |
| `git push` rejected or asks for a password | Sign in through the browser prompt, or use a personal access token instead of your password. |

When asking for help, copy the **full red error text** from the browser console (press **F12**, open **Console**) or the terminal.

---

## 14. Security checklist

Before sharing the project or putting real data into it:

- [ ] `.env`, `appsettings.Development.json` and `private-uploads` are not in Git (`git status` shows none of them).
- [ ] `Jwt__SigningKey` is random, at least 32 characters, and has never appeared in a screenshot, chat or commit.
- [ ] The administrator password is strong and unique, and `SeedAdmin__Enabled` is `false` after setup.
- [ ] `AllowedOrigins` lists only the websites you actually use.
- [ ] The API is served over HTTPS before any real or sensitive information is entered.
- [ ] Test data is fictional, and contact details on test cases are fake.
- [ ] A connection string, key or password that was ever exposed has been rotated.

---

## 15. Privacy and production limitations

This project is a coursework prototype, not a certified missing-person response platform. Email, SMS and browser-push providers are not configured by default. The database is created with EF Core `EnsureCreated`; before any production release, use reviewed EF Core migrations and an explicit migration process.

Before real use, add a threat model, security testing, abuse prevention, privacy and retention policies, POPIA and legal review, monitored backups, secure production secrets, configured notification providers and a verified escalation process. Moderator approval must never be described as SAPS verification.
