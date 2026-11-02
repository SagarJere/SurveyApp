# Shortcuts for common tasks. Each target is one command you can also run by hand.
# Run `make help` to list them.

.DEFAULT_GOAL := help
SHELL := /bin/bash

BACKEND_PORT ?= 8001

.PHONY: help setup db db-stop db-reset migrate seed api web lint typecheck test check \
        backend-lint backend-typecheck backend-test frontend-lint frontend-typecheck frontend-test

help: ## Show this list
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

setup: ## Install backend and frontend dependencies, create .env if missing
	@test -f .env || (cp .env.example .env && \
	  sed -i.bak "s|^JWT_SECRET=.*|JWT_SECRET=$$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')|" .env && \
	  rm -f .env.bak && echo "Created .env with a random JWT_SECRET")
	cd backend && uv sync
	cd frontend && npm ci

db: ## Start PostgreSQL (docker compose) and wait until it is healthy
	docker compose up -d --wait db

db-stop: ## Stop PostgreSQL (data is kept)
	docker compose stop db

db-reset: ## Delete the database volume and start fresh (destroys local data)
	docker compose down -v
	docker compose up -d --wait db

migrate: ## Apply migrations to the dev and test databases
	cd backend && uv run alembic upgrade head
	cd backend && DATABASE_URL="$$(grep -E '^TEST_DATABASE_URL=' ../.env | cut -d= -f2-)" uv run alembic upgrade head

seed: ## Create the dev HR/admin accounts and list all test sign-in IDs
	cd backend && uv run python -m app.scripts.seed

api: ## Run the API with auto-reload
	cd backend && uv run uvicorn app.main:app --reload --port $(BACKEND_PORT)

web: ## Run the frontend dev server
	cd frontend && npm run dev

backend-lint:
	cd backend && uv run ruff check . && uv run ruff format --check .
backend-typecheck:
	cd backend && uv run mypy
backend-test:
	cd backend && uv run pytest
frontend-lint:
	cd frontend && npm run lint && npm run format:check
frontend-typecheck:
	cd frontend && npm run typecheck
frontend-test:
	cd frontend && npm run test

lint: backend-lint frontend-lint ## Lint and format-check both sides
typecheck: backend-typecheck frontend-typecheck ## Type-check both sides
test: backend-test frontend-test ## Run both test suites (needs `make db`)
check: lint typecheck test ## Everything CI runs
