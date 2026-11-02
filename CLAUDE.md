# Survey App — project guide for Claude Code

Internal survey application for an organisation of ~5,000–8,000 employees. HR/Admin users build surveys (sections, questions, conditional logic, themes), publish them to an uploaded list of employees, and view results on dashboards.

## Read these before writing code

| File | What it covers |
|---|---|
| `docs/01-requirements.md` | What the product does, roles, every agreed decision, open questions |
| `docs/02-architecture.md` | Stack, repo layout, auth design, backend and frontend structure |
| `docs/03-data-model.md` | PostgreSQL schema (tables, columns, constraints, indexes) |
| `docs/04-api.md` | FastAPI endpoints, request/response shapes, validation rules |
| `docs/05-survey-builder.md` | Builder UI, question types, sections, conditions, Money type |
| `docs/06-respondent-experience.md` | Taking a survey: layouts, navigator, validation, themes |
| `docs/07-reports-dashboard.md` | Results dashboards, calculations, anonymity rules, exports |
| `docs/08-implementation-plan.md` | Phased build plan with acceptance criteria |
| `docs/reference/ui-prototype.html` | Working HTML prototype of the builder, theme, settings and preview. Open it in a browser. It is the visual and behavioural reference, not production code |
| `docs/reference/README.md` | Where the prototype and the docs differ and which wins, plus the full "Workplace pulse" sample survey |

When a doc and this file disagree, ask before choosing.

## Stack

- **Frontend:** React 18 + Vite + TypeScript, Tailwind CSS + shadcn/ui, TanStack Query v5, Zustand (builder state), React Hook Form + Zod (forms), dnd-kit (drag and drop), Recharts (charts), framer-motion (small transitions), Axios with interceptors.
- **Backend:** Python 3.12, FastAPI, Pydantic v2, SQLAlchemy 2.0 (async) + Alembic, PostgreSQL 15+, openpyxl (Excel import/export), Pillow (image processing), num2words (amount in words, `lang="en_IN"` for INR), PyJWT.
- **Local dev:** Docker Compose for PostgreSQL 16 (host port 5433).
- **Product name and look:** the app is called **Pulse**. Fonts are Bricolage Grotesque (headings) and Figtree (body), self-hosted via `@fontsource-variable`. Colours come from the prototype (see `frontend/src/index.css`).
- **Approved in Phase 0:** React Router v7 (stay on v7: v8 needs React 19), Radix UI primitives, lucide-react, sonner, class-variance-authority, clsx, tailwind-merge, tw-animate-css (shadcn/ui helpers); uvicorn, asyncpg, pydantic-settings.
- **Tooling:** TypeScript 6.0 (typescript-eslint does not support 7 yet), ESLint 9 + typescript-eslint + jsx-a11y, Prettier, Vitest + Testing Library + jsdom; ruff, mypy (strict), pytest + pytest-asyncio + httpx.
- **shadcn/ui on React 18:** components in `frontend/src/components/ui/` use `React.forwardRef`. Current shadcn CLI output targets React 19, so adapt any newly added component to `forwardRef` before use.

## Working rules

1. **Build phase by phase** following `docs/08-implementation-plan.md`. Finish and verify one phase before starting the next. Don't build features from later phases early.
2. **Ask before** changing the data model, adding a dependency not listed above, or changing an agreed decision in `docs/01-requirements.md`.
3. **Business rules live in the backend.** The frontend evaluates conditions for display, but the backend re-validates everything on save and submit (visibility, required, ranges, one response per employee, audience access).
4. **Shared condition logic:** the condition evaluator exists once in TypeScript (`frontend/src/features/survey-logic/`) and once in Python (`backend/app/services/survey_logic.py`). Both must pass the same test cases in `docs/05-survey-builder.md` → "Condition test cases".
5. **Every schema change is an Alembic migration.** Never edit the database by hand.
6. **Write tests with each feature:** pytest for backend services and endpoints, Vitest + Testing Library for frontend logic and key components.
7. **Responsive and accessible:** every screen works at 375px wide, supports keyboard use, and has visible focus states. Support light and dark mode via shadcn theme tokens.
8. **No secrets in code.** Configuration comes from environment variables (`.env.example` documents them).
9. Keep components small. Use one folder per feature (see `docs/02-architecture.md`).

## Commands

```bash
# backend (port 8001; the Vite proxy forwards /api there)
cd backend && uv run uvicorn app.main:app --reload --port 8001
cd backend && uv run alembic upgrade head
cd backend && uv run pytest                       # needs the db running; uses surveyapp_test
cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy

# frontend
cd frontend && npm run dev
cd frontend && npm run test
cd frontend && npm run lint && npm run format:check && npm run typecheck
cd frontend && npm run build

# database
docker compose up -d db

# everything CI runs
make check
```

## Glossary

- **Survey**: the editable item HR works on. Has a draft and zero or more published versions.
- **Version**: frozen copy of a survey created on each publish. Responses always link to a version.
- **Section**: group of questions. Every survey has at least one. The builder hides section UI while there is only one.
- **Condition**: rule that shows a question or section only when an earlier answer matches.
- **Audience**: employees allowed to respond, from an uploaded list (or "open to all").
- **Participation**: the record that an employee has started or submitted a survey. Kept separate from answers so anonymous surveys still enforce one response per person.
- **Shown**: an employee was shown a question because its conditions were met. Report percentages use "shown" as the denominator.
