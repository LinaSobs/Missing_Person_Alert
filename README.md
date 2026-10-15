# Missing Person Alert

A student-project prototype built with React + Vite, ASP.NET Core Web API, SQL Server, Entity Framework Core, JWT authentication, SignalR, and Leaflet/OpenStreetMap. The project is designed for development in Visual Studio Code.

> **Safety notice:** This is a student project, is not affiliated with or endorsed by SAPS, and is not an emergency service. Do not use it to publish real missing-person details until it has passed appropriate security, privacy, legal, and operational review. In South Africa, contact SAPS immediately when a person is missing; do not wait for this application.

## Main features

- Responsive React interface for desktop and mobile.
- Public alerts show only approved reports.
- Map markers identify active alerts, Found Safe cases, Found Deceased cases, and reviewed possible sightings.
- Separate member/reporter and moderator/administrator dashboards.
- Authentication and role-based authorization through ASP.NET Core Identity and JWT.
- Missing-person reporting with required phone, email, photograph, last-seen date, and approximate map location.
- Reporter consent controls whether contact details appear on an approved public alert.
- Owner-only report editing; every edit is returned to pending review until approved again.
- Moderator approval/rejection for reports and possible sightings.
- Sightings are hidden when their related case is found or closed; old sightings must be reviewed again before being republished.
- Administrator-only correction of Found Safe / Found Deceased status, with a required reason and audit event.
- Administrator-only Audit Trail tab with search, action filtering, and pagination.
- WhatsApp sharing to a specific approved report.
- SQL Server storage for cases, sightings, users, notifications, subscriptions, and audit entries.
- Private photo-file handling and server-side file validation.

## Requirements

- Node.js LTS and npm.
- .NET 10 SDK.
- SQL Server (LocalDB is the default Windows development option; SQL Server Express can also be configured).
- Visual Studio Code.

## Run the frontend in browser-local mode

Browser-local mode is for interface testing only. It stores information in the current browser and does not persist to SQL Server. It does not include a pre-created administrator or moderator account: registering creates a Member account only. Use API mode for role-protected moderation and administrator testing.

1. Open the project folder in VS Code.
2. Open a terminal and run:

   ```powershell
   cd frontend
   npm install
   npm run dev
   ```

3. Open the local URL printed by Vite, normally `http://localhost:5173`.
4. Register a member account to try the browser-local reporting workflow.

Do not enter real people's details while using browser-local mode.

## Configure and run the ASP.NET Core API

The API targets .NET 10. `appsettings.json` is a safe configuration template; keep machine-specific credentials in the ignored `appsettings.Development.json` file or local environment variables.

1. Confirm SQL Server is installed and running.
2. In `backend/MissingPersonAlert.Api/appsettings.Development.json`, configure a local connection string and, if needed, the local administrator seed settings. Do not commit this file.
3. Open a terminal and run:

   ```powershell
   cd backend\MissingPersonAlert.Api
   dotnet restore
   dotnet build
   dotnet run
   ```

4. Visit `http://localhost:5068/health`. A healthy response should include `"status":"ok"`.

The current development bootstrap uses EF Core `EnsureCreated` with compatibility SQL for existing coursework databases. Before a production release, use reviewed EF Core migrations and an explicit database migration process.

### Configure a development administrator safely

The API creates a development administrator only when `SeedAdmin:Enabled` is `true` and `SeedAdmin:Email` and `SeedAdmin:Password` are provided through local development configuration or environment variables. Use a strong, unique local password. Never store administrator passwords or JWT signing keys in committed source files, and disable development seeding in production.

The browser-local frontend does not have a hardcoded administrator account. This prevents shared source code from exposing starter credentials. For approval and audit-trail tests, use the ASP.NET Core API with an administrator account configured on the server.

## Connect React to the API

Copy `frontend/.env.example` to `frontend/.env` and use:

```env
VITE_USE_LOCAL_DATA=false
VITE_API_BASE_URL=http://localhost:5068
```

Keep `VITE_USE_LOCAL_DATA=false` for SQL Server-backed reports, server-side authentication, and photo uploads. Set it to `true` only when intentionally testing the browser-local interface. Vite reads environment settings when it starts, so restart `npm run dev` after changing `.env`.

Run the API and frontend in separate terminals:

```powershell
# Terminal 1
cd backend\MissingPersonAlert.Api
dotnet run
```

```powershell
# Terminal 2
cd frontend
npm install
npm run dev
```

If a protected request fails, check that the API is running at `http://localhost:5068/health`, then sign out and sign in again using an account stored in the API database. The administrator queue and audit trail require the appropriate server-issued JWT and role.

## Main API routes

| Method | Route | Purpose | Access |
|---|---|---|---|
| `POST` | `/api/auth/register` | Register a member | Public |
| `POST` | `/api/auth/login` | Sign in and receive a JWT | Public |
| `GET` | `/api/cases/alerts` | Read approved public alerts | Public |
| `GET` | `/api/cases/{id}` | Read a public or authorized case | Public / record-restricted |
| `GET` | `/api/cases/mine` | List the signed-in user's reports | Authenticated |
| `POST` | `/api/cases` | Submit a report with multipart form data | Authenticated |
| `PUT` | `/api/cases/{id}` | Edit an owned report and return it to review | Owner only |
| `POST` | `/api/sightings` | Submit a possible sighting | Public or as configured; validated |
| `GET` | `/api/sightings/public` | Read reviewed sightings for active cases | Public |
| `GET` | `/api/admin/cases/pending` | List reports awaiting review | Moderator / Administrator |
| `POST` | `/api/admin/cases/{id}/approve` | Approve a pending report | Moderator / Administrator |
| `POST` | `/api/admin/cases/{id}/reject` | Reject a pending report | Moderator / Administrator |
| `PATCH` | `/api/admin/cases/{id}/status` | Update a case status | Moderator / Administrator |
| `PATCH` | `/api/admin/cases/{id}/correct-status` | Correct a found-status decision with reason | Administrator |
| `GET` | `/api/admin/audit-trail` | Search and page through audit entries | Administrator |
| `GET` | `/api/admin/sightings/pending` | List possible sightings awaiting review | Moderator / Administrator |

Check the controller source for the current full endpoint list and any authorization details.

## Build and quality checks

Frontend production build:

```powershell
cd frontend
npm install
npm run build
```

Backend build:

```powershell
cd backend\MissingPersonAlert.Api
dotnet restore
dotnet build
```

Before assessment, test the full user journey: submit a report, confirm it is private while pending, approve it, verify the public alert and map, submit and review a sighting, correct a found status, confirm contact details are published only with consent, and verify owner-only edits return a report to review.

## Git and deployment safety

- Keep `.env`, `appsettings.Development.json`, database files, private uploads, JWT signing keys, and all passwords out of Git.
- The `.env.example` file should contain placeholder values only.
- Configure production connection strings, signing keys, administrator provisioning, allowed frontend origins, and photo storage in Azure App Service settings or a secret store.
- Use Azure App Service for the API, Azure SQL Database for records, private Azure Blob Storage for photos, and Azure Static Web Apps for the React frontend if these services fit your available subscription and budget.
- Review current Azure costs and student credits before creating billable resources.

## Privacy and production limitations

This project is a coursework prototype, not a certified missing-person response platform. Email, SMS and browser-push providers are not configured by default. Before real use, add a threat model, security testing, abuse prevention, privacy and retention policies, POPIA/legal review, monitored backups, secure production secrets, configured notification providers, and a verified escalation process. Moderator approval must never be described as SAPS verification.