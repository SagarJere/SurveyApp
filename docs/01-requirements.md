# 01 — Requirements

## Goal

Let HR/Admin create flexible surveys, publish them to a chosen group of employees, collect responses, and see results on modern, responsive dashboards. The UI must be visually appealing, modern and fully responsive (phone to desktop).

## Branding (agreed)

- The product is called **Pulse**. The logo is a check mark on an accent-coloured tile.
- Fonts: Bricolage Grotesque for headings, Figtree for body text. Both are self-hosted, with no calls to Google Fonts.
- The colour palette and component look follow `docs/reference/ui-prototype.html`. See `docs/reference/README.md` for where the prototype and the docs differ.

## Roles

| Role | Can do |
|---|---|
| **Admin** | Everything HR can, plus manage which employees are HR/Admin users |
| **HR** (survey creator) | Create, edit, publish and close surveys; upload audiences; view results of surveys they own or co-own |
| **Employee** (respondent) | See surveys they are in the audience for, take them, see "already submitted" if applicable |

Survey-level access: each survey has an **owner** and optional **co-owners** (full edit and results) and **viewers** (results only). Department-head scoped results are a later phase.

## Authentication (agreed)

- **Test environment:** login page asks for **EmployeeId only**. This is allowed only when `AUTH_MODE=dev`. The app must refuse to start if `AUTH_MODE=dev` and `APP_ENV=production`.
- **Production:** SSO (Active Directory) replaces the login page before go-live.
- Whatever the login method, the backend issues its **own JWT** containing `employee_id` and `role`. Everything else depends only on that JWT, so switching to SSO only replaces the login step (see `02-architecture.md` → Auth).
- EmployeeId is **normalised** the same way everywhere (login, uploads, SSO): trim spaces, uppercase. Leading zeros are kept as typed.
- Seed test users by role for development (2 Admin/HR, 5 employees).

## Survey lifecycle

1. **Draft:** HR builds the survey. The builder autosaves.
2. **Publish:** the server validates the draft and creates a frozen **version**. The survey becomes **Published**.
3. **Edit after publish:** edits go to the draft. "Publish changes" creates a new version. Earlier responses stay linked to their version.
4. **Close:** manually, or automatically at the close date. No new responses after closing.

## Survey content

- **Sections:** at least one per survey. Each has a title, optional description, and optional condition. Questions belong to a section.
- **Question types (v1):** Single choice, Checkboxes (multi choice), Dropdown, Rating 1–5, Short answer, Paragraph, **Money**, **Number** (Number added 2026-11-09).
- **Later types:** Likert matrix, Date, File upload, Ranking, Yes/No, eNPS (0–10).
- **Per question:** text, optional help text, required toggle, type-specific settings, optional condition.
- **Conditions (dependent questions):** a question or section can be shown only when an earlier answer matches. See `05-survey-builder.md`.
- **Number type:** a number answer, such as a headcount or a distance. Lowest and highest allowed, whole numbers or up to 2 decimals, and an optional unit ("people", "km"). Can drive conditions (is at least / is at most). See `05-survey-builder.md`.
- **Money type:** number input that formats while typing and shows the amount in words; currency, min/max and decimals settings. See `05-survey-builder.md`.

## Trainings (agreed 2026-11-12)

A **training** is a survey where employees watch videos and answer a scored quiz about them. Full spec: `09-trainings.md`; approved mockups linked there.

- Separate **Trainings** area for HR and **My trainings** for employees, built on the survey engine.
- Each section can have one **video**: uploaded (MP4/WebM, up to 200 MB) or linked from the internal video server. The section's questions appear after the video ends.
- Per video, the creator chooses whether people may skip ahead and change the playback speed (both off by default).
- **Quiz:** correct answers and points on choice and Number questions; optional pass mark; the creator chooses whether to show the pass mark, the score, and the correct answers (default: once they pass or have no attempts left).
- **Retakes:** none, up to N attempts, until they pass, or until every answer is correct. Retakes skip the videos. The best attempt counts.
- Optional due date. Trainings are never anonymous.
- Reports: completion, pass rate, average score, attempts, % correct per question, and a completion report with Excel download.

## Survey settings

| Setting | Options | Default |
|---|---|---|
| Layout | All on one page / One section per page / One question at a time | One question at a time |
| Show question navigator | on/off (one-question layout only) | on |
| Move on automatically | on/off (one-question layout only; after single choice or rating answers) | off |
| One response per employee | on/off | on |
| Allow editing until the survey closes | on/off | off |
| Anonymous responses | on/off | off |
| Opens / closes | dates | none |

## Theme (agreed)

- **Cover image:** gallery of company-approved images, "accent colour only", or upload.
- **Page background:** None / Colour (from a palette) / Image (gallery or upload), with a "Soften background" blur toggle. Questions always sit on solid cards.
- **Darken images:** overlay slider 0–60%.
- **Accent colour:** pick from a brand palette (not free colour choice).
- On phones, only the cover image is shown, never the page background.
- Uploads: JPG/PNG/WebP, max 2 MB. The server compresses to WebP and makes a mobile-sized copy.
- Theme is saved on the version, so a published survey keeps its look.

## Audience (agreed for v1)

- HR uploads an **Excel or CSV** file. A downloadable template has `EmployeeId` (required) and `Name`, `Email`, `Department`, `Location` (optional).
- Before saving, show a preview: valid / duplicates skipped / rows to fix, with the bad rows listed and downloadable.
- Actions: **append** (allowed after publish), **replace** (only before publish), **remove** individual employees (unless they already responded).
- **"Open to all employees"** toggle skips the audience check.
- Every API call that fetches or submits a survey checks the audience on the server.
- **Later:** rule-based targeting (department, location, grade, manager hierarchy) using an employee master. The audience table already has a `source` column (`upload` now, `rule` later) so this needs no rework.

## Responding

- Employees see a "My surveys" list: pending, in progress, submitted.
- Drafts autosave so people can resume.
- If one-response-per-employee is on and they already submitted, show a confirmation screen instead of the form (or "Edit your response" if editing is allowed and the survey is open).
- Required questions are required only when visible. Answers to hidden questions are discarded.

## Anonymity

- When **Anonymous** is on, answers are stored without the employee ID. A separate **participation** record still prevents responding twice.
- Reports never show names for anonymous surveys. For anonymous surveys they also hide any breakdown with **fewer than 5 responses**. Named surveys show every answer however few there are, because HR already sees who answered (agreed 2026-11-09).
- Warn in the builder if an anonymous survey's audience is under ~10 people.

## Reports and dashboards

See `07-reports-dashboard.md`. Summary:

- Surveys home with status and response rates.
- Per-survey results dashboard: headline figures, responses over time, participation by department, one widget per question grouped by section, comments.
- Filters by department and location (from the audience upload), plus a "non-responders" download.
- Percentages use **people shown the question** as the denominator.
- Excel export in two kinds: **Responses** (one row per person, one column per question) and **Responses with analytics** (summary with a chart per question, participation, responses per day, responses, comments). Money amounts also in words.

## Non-functional

- Scale: up to 8,000 employees, a few hundred surveys per year.
- Respondent pages load fast on mobile networks. Keep the respondent bundle small.
- All times stored in UTC and shown in the user's local time.
- Audit: record who published, closed, uploaded audiences, and changed ownership.

## Open questions (confirm before the relevant phase)

1. SSO details: which AD/identity provider, and how employee ID and role come through.
2. Email: SMTP/relay for invitations and reminders (Phase 6), including training due-date reminders.
3. Image and video storage: local disk on the API server vs object storage. Training videos make this more important (size, backups, hosting).
4. Who can create surveys: only HR/Admin, or also managers?
5. Data retention: how long to keep responses after a survey closes.
6. Hosting: where the app runs (server, container platform).
