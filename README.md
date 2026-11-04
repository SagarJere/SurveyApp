# Pulse

Pulse is an internal survey application. HR and admin users build surveys, publish them to a list of employees, and view results on dashboards.

- **Backend:** Python 3.12, FastAPI, SQLAlchemy 2 (async), Alembic, PostgreSQL 16
- **Frontend:** React 18, Vite, TypeScript, Tailwind CSS v4, shadcn/ui, TanStack Query, React Router 7

Product and design documents live in [`docs/`](docs/). Start with [`CLAUDE.md`](CLAUDE.md) and [`docs/08-implementation-plan.md`](docs/08-implementation-plan.md).

## Prerequisites

| Tool | Version | Install |
|---|---|---|
| Docker (Docker Desktop or OrbStack) | with Compose v2 | https://docs.docker.com/get-docker/ |
| uv | 0.13+ | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| Python | 3.12 (uv installs it) | `uv python install 3.12` |
| Node.js | 20.19+ (24 recommended) | https://nodejs.org |

## First-time setup

```bash
make setup      # creates .env with a random JWT_SECRET, installs backend and frontend deps
make db         # starts PostgreSQL on localhost:5433 and waits until healthy
make migrate    # applies migrations to the dev and test databases
make seed       # creates the test HR/admin accounts and lists the sign-in IDs
```

Without `make`:

```bash
cp .env.example .env          # then set JWT_SECRET to a long random string
cd backend && uv sync && cd ..
cd frontend && npm ci && cd ..
docker compose up -d db
cd backend && uv run alembic upgrade head
cd backend && uv run python -m app.scripts.seed
```

## Run

Each in its own terminal:

```bash
docker compose up -d db                                      # database
cd backend && uv run uvicorn app.main:app --reload --port 8001   # API  -> http://localhost:8001/api
cd frontend && npm run dev                                   # web  -> http://localhost:5173
```

The Vite dev server proxies `/api` to the backend, so the browser only talks to one origin. The header shows a green dot when the API and database are reachable.

## Signing in (test environments)

With `AUTH_MODE=dev`, the sign-in page asks for an employee ID only. IDs are trimmed and uppercased, so ` e1002 ` signs in as `E1002`.

| Employee ID | Role | Name |
|---|---|---|
| E1001 | Admin | Asha Rao |
| E1002 | HR | Vikram Mehta |
| E2001 to E2005 | Employee | test employees |

Any other ID signs in as an employee. Run `make seed` once so E1001 and E1002 get their roles and the theme gallery is loaded. HR and admin users see **Surveys** in the header. Employees don't, and get a "no access" page if they open an admin link.

The API refuses to start when `APP_ENV=production` and `AUTH_MODE=dev`. Single sign-on replaces this sign-in page before go-live. Until then `AUTH_MODE=sso` is refused too.

Sessions last 8 hours (`JWT_EXPIRES_MINUTES`). When a session expires, the app returns to the sign-in page and says why.

Useful URLs in development:

- `GET http://localhost:8001/api/health`: API and database status
- `http://localhost:8001/api/docs`: interactive API docs (disabled when `APP_ENV=production`)

## Checks

| | Backend (`cd backend`) | Frontend (`cd frontend`) |
|---|---|---|
| Lint + format | `uv run ruff check . && uv run ruff format --check .` | `npm run lint && npm run format:check` |
| Type check | `uv run mypy` | `npm run typecheck` |
| Tests | `uv run pytest` | `npm run test` |
| Auto-fix | `uv run ruff check --fix . && uv run ruff format .` | `npm run lint:fix && npm run format` |

`make check` runs all of them. Backend tests need the database running (`make db`) and use the separate `surveyapp_test` database. CI runs the same steps in `.github/workflows/ci.yml`.

## Configuration

All configuration comes from environment variables. [`.env.example`](.env.example) documents every one. The backend and the frontend both read the single `.env` at the repo root. Only `VITE_*` values reach the browser.

The backend refuses to start in production (`APP_ENV=production`) when:

- `AUTH_MODE` is `dev`
- `JWT_SECRET` is still the placeholder from `.env.example`

- `JWT_SECRET` is shorter than 32 characters
- `CORS_ORIGINS` contains `*`
- `DB_ECHO` is on
- `FILE_STORAGE_PATH` is a relative path

## Theme gallery

The 8 gallery images live in `backend/app/assets/gallery/` as `ocean.jpg`, `dawn.jpg`, and so on. They are placeholders drawn to match the UI prototype. To use approved company artwork, replace a file with an image of the same name (JPG, PNG or WebP), then run:

```bash
cd backend && uv run python -m app.scripts.seed_gallery
```

Every environment needs this once, production included. Gallery images keep fixed IDs, so surveys that use them don't change. `uv run python -m app.scripts.make_gallery_placeholders` redraws the placeholders.

Uploaded and gallery images are stored as WebP under `FILE_STORAGE_PATH`. Browsers load them through signed links that expire after about a day, because `<img>` tags can't send a sign-in token.

## Audiences and responding

- **Audience:** in the builder's Audience tab, upload an Excel or CSV file (use "Download template"), check the preview, then Apply. Or switch on "Open to all employees". A survey can't be published with an empty audience.
- **Dates:** open and close dates are calendar days in `SURVEY_TIMEZONE` (default `Asia/Kolkata`). A survey closes itself after its close date.
- **Taking a survey:** employees see it under "My surveys" and answer at `/s/<survey id>`. Answers autosave as a draft, so people can pick up where they left off.
- **Anonymous surveys:** responses store no employee ID, and times are rounded to the hour. A separate participation record still stops anyone answering twice. Anonymous responses can't be edited after submitting, because nothing links them to the person.

## Results

- **Dashboard:** open a published survey's **Results** from the surveys home, or go to `/admin/surveys/<survey id>/results`. Filters (department, location, dates, version) live in the URL, so a filtered view can be shared.
- **Percentages** are out of the people who were shown each question.
- **Small groups:** when filters leave fewer than 5 responses, the API sends no answer data and the page shows only participation figures.
- **Exports:** "Export to Excel" gives Summary, Responses and Comments sheets for the current filters. Owners and co-owners can download the people who haven't responded yet.
- **Individual responses** are listed only for surveys that aren't anonymous.
- **Test data:** to fill a published survey with generated responses in development (refused when `APP_ENV=production`):

```bash
cd backend && uv run python -m app.scripts.seed_responses <survey id> 420
```

This adds test people T3001 onwards to the survey's audience and submits through the real submit path.

`npm run ui-check` publishes the sample survey (if it's still a draft) with the dev test accounts as its audience, open from today for 30 days, so you can try it as E2001.

## Browser check

With `make api` and `make web` running:

```bash
cd frontend && npx playwright install chromium   # once
cd frontend && npm run ui-check -- http://localhost:5173 ui-check
```

This takes screenshots at desktop, 375px and dark mode into `frontend/ui-check/`, and runs Lighthouse accessibility on the surveys home, results, builder, Preview and respondent pages. It signs in as E1002 and creates the "Workplace pulse" sample survey if it's missing.

## Database migrations

Every schema change is an Alembic migration. Never edit the database by hand.

```bash
cd backend
uv run alembic revision --autogenerate -m "add surveys table"
uv run alembic upgrade head
uv run alembic downgrade -1
```

Import each new model module in `backend/app/models/__init__.py` so autogenerate sees it.

## Project layout

```
backend/
  app/
    main.py            app factory: settings, middleware, error handlers, routers
    config.py          settings from environment variables
    db.py              async engine and per-request session
    errors.py          the shared error response format
    middleware.py      request IDs and request logging
    routers/           HTTP endpoints (thin)
    services/          business logic
    models/            SQLAlchemy models
    schemas/           Pydantic request and response models
    tests/             pytest
  alembic/             migrations
frontend/
  src/
    app/               router, providers, layouts, theme
    components/        shared components; ui/ holds shadcn/ui components
    features/          one folder per feature
    lib/               API client, query client, utilities
    test/              test setup and helpers
docker/postgres/init/  runs once on a new database volume (creates the test database)
shared/test-cases/     rules tested on both sides: money words, conditions, validation, sample survey
```

## API errors

Every error response has the same shape:

```json
{ "error": { "code": "NOT_FOUND", "message": "Not Found", "details": {} } }
```

Every response carries an `X-Request-ID` header. The same ID appears in the API logs, and error toasts in the UI show it as a reference.

## Troubleshooting

- **Port 5432 is in use:** the compose file maps Postgres to 5433 by default. Change `POSTGRES_PORT` and the port in both database URLs in `.env` to use another.
- **Port 8001 is in use:** set `BACKEND_PORT` in `.env` and pass the same value to `--port`. The Vite proxy reads `BACKEND_PORT`.
- **Port 5173 is in use:** Vite picks the next free port. `CORS_ORIGINS` already allows 5173–5175.
- **`docker compose` isn't found with OrbStack:** open the OrbStack app once so it can relink its command-line tools, or run `/Applications/OrbStack.app/Contents/MacOS/xbin/docker-compose` directly.
- **The test database is missing:** it's created only when the volume is first created. Run `make db-reset` (this deletes local data), or create it by hand with `docker compose exec db createdb -U surveyapp surveyapp_test`.
