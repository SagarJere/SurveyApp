# 02 — Architecture

## Overview

```
React SPA (Vite)  ──HTTPS/JSON──▶  FastAPI  ──SQLAlchemy──▶  PostgreSQL
      │                               │
      │                               └── file storage (theme images, exports)
      └── same app serves builder (HR) and respondent (employee) routes
```

One frontend app with role-based routes. One FastAPI service. One PostgreSQL database.

## Repository layout

```
survey-app/
├── CLAUDE.md
├── docs/
├── docker-compose.yml          # postgres for local dev
├── .env.example
├── backend/
│   ├── pyproject.toml
│   ├── alembic/
│   └── app/
│       ├── main.py             # app factory, routers, startup checks
│       ├── config.py           # pydantic-settings, env vars
│       ├── db.py               # async engine, session dependency
│       ├── auth/
│       │   ├── jwt.py          # issue / verify tokens
│       │   ├── providers.py    # AuthProvider interface + DevIdProvider (+ SsoProvider later)
│       │   └── deps.py         # get_current_user, require_role
│       ├── models/             # SQLAlchemy models, one file per area
│       ├── schemas/            # Pydantic request/response models
│       ├── routers/            # auth, surveys, builder, audience, respond, results, assets
│       ├── services/
│       │   ├── survey_logic.py     # condition evaluation, visibility, validation
│       │   ├── publish.py          # draft → version
│       │   ├── audience_import.py  # Excel/CSV parsing and validation
│       │   ├── results.py          # aggregation queries
│       │   ├── exports.py          # Excel export
│       │   ├── money.py            # formatting + words (num2words)
│       │   └── images.py           # theme image processing
│       └── tests/
└── frontend/
    ├── package.json
    └── src/
        ├── app/                # router, providers, layout shells
        ├── lib/                # axios client, query client, utils
        ├── components/ui/      # shadcn components
        ├── features/
        │   ├── auth/
        │   ├── surveys-home/
        │   ├── builder/            # builder screens, store, question editors
        │   ├── question-types/     # type registry (editor, renderer, validation, report widget)
        │   ├── survey-logic/       # condition evaluator (mirrors backend)
        │   ├── theme/
        │   ├── settings/
        │   ├── audience/
        │   ├── respond/            # respondent experience
        │   └── results/            # dashboards
        └── test/
```

## Auth

### Design

```python
class AuthProvider(Protocol):
    async def authenticate(self, request: LoginRequest) -> AuthenticatedUser: ...

class DevIdProvider:   # AUTH_MODE=dev — EmployeeId only
class SsoProvider:     # AUTH_MODE=sso — added before production
```

- `POST /api/auth/login` calls the configured provider and returns a JWT (`sub` = employee_id, `role`, `exp`).
- Access token lifetime: 8 hours (configurable). Sent as `Authorization: Bearer`.
- `get_current_user` dependency decodes the JWT. All routers depend on it, never on the provider.
- Roles come from the `app_users` table (`admin`, `hr`). Anyone not in it is `employee`.
- **Startup guard:** if `APP_ENV=production` and `AUTH_MODE=dev`, raise and stop.

### Environment variables

```
APP_ENV=development|test|production
AUTH_MODE=dev|sso
JWT_SECRET=...
JWT_EXPIRES_MINUTES=480
DATABASE_URL=postgresql+asyncpg://...
FILE_STORAGE_PATH=/data/files
CORS_ORIGINS=http://localhost:5173
```

## Backend conventions

- Async SQLAlchemy 2.0 with typed `Mapped[]` models. UUID primary keys (`uuid7` or `gen_random_uuid()`).
- Routers stay thin. Business logic lives in `services/`.
- Pydantic v2 schemas for every request and response. No ORM objects returned directly.
- Errors: raise `HTTPException` with a consistent body `{ "error": { "code": "...", "message": "...", "details": {...} } }`.
- Validation errors from publish and submit return **all** problems at once, each with `question_id`/`section_id` so the UI can point to them.
- Permission checks are explicit helpers (`assert_can_edit(survey, user)`, `assert_in_audience(survey, user)`).

## Frontend conventions

- TanStack Query for all server state. Query keys: `['surveys']`, `['survey', id]`, `['survey', id, 'results', filters]`.
- Zustand store only for the builder's in-progress draft (see `05-survey-builder.md`).
- Axios instance with interceptors: attach the JWT, redirect to login on 401, show a toast on 5xx.
- **Dev auth mock:** when `import.meta.env.DEV`, the login page shows the EmployeeId field. In production it starts the SSO flow.
- Route groups:
  - `/login`
  - `/` → "My surveys" (everyone)
  - `/s/:surveyId` → take a survey
  - `/admin/surveys` → surveys home (HR/Admin)
  - `/admin/surveys/:id/edit` → builder (tabs: Questions, Theme, Settings, Audience)
  - `/admin/surveys/:id/results` → dashboard
- Filters on the results page live in the URL query string so filtered views can be shared.
- Respondent routes are lazy-loaded separately from builder and results to keep the respondent bundle small.

## Question type registry

Each type is one module in `frontend/src/features/question-types/<type>/` exporting:

```ts
export interface QuestionTypeDef<Config, Answer> {
  type: QuestionType;                 // 'single' | 'multi' | 'dropdown' | 'rating' | 'short' | 'long' | 'money'
  label: string;                      // "Single choice"
  icon: LucideIcon;
  hasOptions: boolean;
  defaultConfig(): Config;
  Editor: React.FC<EditorProps<Config>>;        // builder card body
  Renderer: React.FC<RendererProps<Config, Answer>>; // respondent input
  validate(answer: Answer | undefined, q: Question<Config>): string | null;
  isAnswered(answer: Answer | undefined): boolean;
  conditionOps: ConditionOp[];        // [] if it can't be a condition source
  ReportWidget: React.FC<ReportWidgetProps>;
}
```

The backend mirrors it with a `QUESTION_TYPES` dict in `services/survey_logic.py` (validation, answer storage, condition ops). Adding a type means adding one frontend module and one backend entry.

## Performance notes

- Results use live SQL aggregates with indexes (see `03-data-model.md`). Cache result endpoints for 60 seconds per survey + filter combination.
- Add materialized views only if a real survey becomes slow.
- Audience import of 10,000 rows must finish in a few seconds. Use bulk inserts.
