# 08 — Implementation plan

Build in this order. Each phase ends with working, tested software. Don't start the next phase until the current phase's acceptance criteria pass.

Suggested way to work with Claude Code: start each phase with "Read CLAUDE.md and docs/08-implementation-plan.md, then plan Phase N before writing code." Review the plan, then let it build.

---

## Phase 0 — Project setup

**Build**
- Repo layout from `02-architecture.md`. Docker Compose with PostgreSQL 16.
- Backend: FastAPI app factory, settings, async DB session, Alembic, health endpoint, error format, pytest setup.
- Frontend: Vite + React + TS, Tailwind, shadcn/ui, TanStack Query, Axios client, router with layout shells, light/dark mode, Vitest.
- Lint/format: ruff + mypy (backend), ESLint + Prettier + `tsc --noEmit` (frontend).
- `.env.example`, README with run commands.

**Done when**
- `docker compose up -d db`, backend and frontend all start with one command each.
- `GET /api/health` returns ok. Frontend shows an empty shell that calls it.
- CI-style scripts (`lint`, `typecheck`, `test`) pass on both sides.

## Phase 1 — Auth (dev mode)

**Build**
- `app_users` table + seed script (2 HR/Admin, 5 employees).
- `AuthProvider` interface, `DevIdProvider`, JWT issue/verify, `get_current_user`, `require_role`.
- Startup guard: refuse `AUTH_MODE=dev` in production.
- Login page (EmployeeId field), auth store, protected routes, role-based navigation, logout.

**Done when**
- Logging in as a seeded HR user shows admin navigation; an employee doesn't see it.
- Unknown employee IDs log in as employees. IDs are normalised (" e123 " → "E123").
- Tests cover token expiry, role checks, and the production guard.

## Phase 2 — Survey builder (questions, sections, conditions)

**Build**
- Tables: `surveys`, `survey_members`. Draft JSON Pydantic model.
- Endpoints: list, create, get, save draft (with 409 conflict), validate, duplicate, delete.
- Surveys home (basic list + "New survey").
- Builder: header card, question cards, all 7 types including **Money**, option editor, required, move/duplicate/delete with Undo, sections (add, move, collapse, delete with Undo), condition editor with broken-condition states, autosave.
- Shared logic: condition evaluator + validation in TS and Python with the **condition test cases** from `05-survey-builder.md`. Money formatting and words helpers in both, with tests.

**Done when**
- HR can build the sample "Workplace pulse" survey from `docs/reference/ui-prototype.html` (3 sections, 9 questions, conditions on Q3, Q4, Q5 and section 2).
- Reloading the page restores everything. Two tabs editing the same survey get a conflict message.
- Moving Q2 below Q3 shows the broken-condition message, and validate returns that issue.
- All condition and money test cases pass on both sides.

## Phase 3 — Settings, theme, preview, publish

**Build**
- Settings tab (layout, navigator, auto-next, responses, schedule).
- Theme tab: gallery (seed 8 images), uploads with Pillow processing, cover, background, blur, darken, accent, live mini preview.
- Respondent component with all three layouts, navigator, auto-next, money input, theme rendering. Used by Preview with phone-width toggle and reset.
- Publish: `survey_versions`, `survey_sections`, `survey_questions`, `question_options`. Publish changes → new version. Close.

**Done when**
- Preview behaves like the prototype in all three layouts, including conditions, navigator locking, and money validation.
- Publishing creates version 1; editing and publishing again creates version 2 with the same question keys.
- Uploading a 5 MB image is rejected; a 1.5 MB JPG becomes WebP with a mobile copy.
- Lighthouse accessibility score ≥ 90 on the preview.

## Phase 4 — Audience and responding

**Build**
- Audience tables, template download, upload → preview → apply/discard, rows-to-fix download, list/search/remove, open-to-all.
- Respondent endpoints: my surveys, get survey (with audience and date checks), draft autosave, submit (one transaction: response, answers, shown rows, participation).
- "My surveys" page, respondent route `/s/:id`, thank-you and error states, edit-after-submit when allowed.
- Anonymous mode storage rules.

**Done when**
- Uploading a file with duplicates, empty IDs and bad emails shows the right counts and rows to fix.
- Employees not in the audience get the "not available" screen. Server returns 403 too.
- Submitting twice with one-response-per-employee returns 409. Submitting with a hidden required question succeeds.
- Hidden-question answers sent by a tampered client are dropped on the server.
- Anonymous survey: `survey_responses.employee_id` is null, and participation still blocks a second submission.
- Draft resumes after closing the browser.

## Phase 5 — Results dashboard and exports

**Build**
- Results endpoints (summary, timeline, participation, questions, comments, responses, exports) with filters, the small-group rule, and 60 s caching.
- Surveys home with response-rate rings and KPIs.
- Results dashboard as in `07-reports-dashboard.md`. Individual responses tab for non-anonymous surveys.
- Excel export (Summary, Responses, Comments) with money words. Non-responders download.

**Done when**
- With a seeded survey of 400+ generated responses, every widget's numbers match hand-written SQL checks.
- Filtering to a department with fewer than 5 responses hides answers in both the UI and the API payload.
- Checkbox shares use "shown" as the denominator.
- The Excel export opens cleanly, and money columns are numeric with words alongside.
- Dashboard is usable at 375px wide.

## Phase 6 — Production readiness

**Build**
- `SsoProvider` (details from the open questions in `01-requirements.md`).
- Email invitations and reminders (if SMTP is available), with reminder dates shown on the daily chart.
- Audit log entries and an admin view of them.
- Rate limiting on login and submit, security headers, structured logging, backups.

**Done when**
- Production config cannot start with dev auth.
- End-to-end test: HR creates, publishes, employee responds, HR sees results and exports.

---

## Later backlog (not in v1)

Rule-based audience targeting with an employee master · multiple conditions with all/any · section-skip rules · more question types (Likert matrix, date, number, file upload, ranking, eNPS) · section intro screens in one-question layout · survey templates and reusable question blocks · compare and cross-tab views · PDF export and scheduled reports · department-head scoped results · keyword analysis of comments · translations.
