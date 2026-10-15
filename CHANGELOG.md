# Missing Person Alert — Change Log

This log records the major feature and quality changes made to the project. It does not store passwords, signing keys, or other secrets.

## Reporting and location

- Added location lookup for typed place names and map-pin selection with reverse geocoding.
- Improved locality labels to prefer a suburb/neighbourhood plus a useful nearby locality where map data provides it; ward-only labels are filtered out.
- Added culture-independent parsing for latitude and longitude values.
- Required a recent JPEG, PNG, or WebP photograph (maximum 5 MB) when creating a report; the API validates uploads independently.
- Required contact phone and email and added validation for email format and dates not in the future.

## Report review and public alerts

- New reports are stored as pending and are not shown publicly until approved.
- Public alerts, map markers, and WhatsApp sharing expose approved report information only.
- Added report-specific WhatsApp links.
- Added explicit consent before reporter contact details are shown on public alerts.
- Added owner-only report editing. Edits return reports to pending review and hide them publicly until reapproved.

## Possible sightings

- Added sighting submission with required description, date/time, area and approximate map location.
- Normalized the frontend JSON payload to use numeric case IDs and coordinates and an ISO timestamp.
- Added moderator review before sightings appear publicly.
- Related sightings are hidden when a case is Found Safe, Found Deceased, closed, or edited; sightings must be reviewed again before republishing.

## Case status and map

- Added Found Safe and Found Deceased case outcomes with distinct map marker colours and legend entries.
- Added an Administrator-only status correction workflow with a required reason and audit logging.
- Added notifications when case status changes or is corrected.

## Accounts, permissions and audit

- Added separate member/reporter and moderator/administrator dashboards.
- Added ASP.NET Core Identity role-based authorization and JWT authentication.
- Removed hardcoded administrator credentials from frontend code and committed documentation. Browser-local mode now authenticates only accounts registered in that browser; privileged review workflows require API mode with an administrator configured securely on the server.
- Added an Administrator-only Audit Trail tab with search, action filtering and pagination.
- Added audit entries for reporting, editing, moderation, status changes, sightings, account events and area subscriptions where supported.

## Data and configuration

- Removed preloaded missing-person and sighting examples; new environments start with empty public lists.
- Added a one-time cleanup for two specifically requested old records in the previous build. The cleanup routine should be removed after it has run and the records have been confirmed deleted.
- Added backward-compatible SQL checks for optional sighting coordinates and reporter contact-publication consent.
- Set the React frontend to use the ASP.NET Core API by default. Browser-local storage is opt-in for UI testing only.
- Added setup, build, acceptance-testing and deployment documentation.

## Validation reminder

Before assessment or deployment, run `npm install` and `npm run build` in `frontend`, and `dotnet restore` and `dotnet build` in `backend/MissingPersonAlert.Api`. Test owner-only edits, administrator-only status correction and audit access, contact consent, approval gates, location binding, photo validation, and sighting visibility against a running database.