"""FastAPI application factory.

Run locally with:  uv run uvicorn app.main:app --reload --port 8001
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import Settings, get_settings
from app.db import create_engine, create_sessionmaker
from app.errors import register_error_handlers
from app.logging_config import configure_logging
from app.middleware import REQUEST_ID_HEADER, RequestContextMiddleware
from app.routers import api_router
from app.services.storage import LocalFileStorage

API_VERSION = "0.1.0"


def create_app(settings: Settings | None = None, *, setup_logging: bool = True) -> FastAPI:
    settings = settings or get_settings()
    if setup_logging:
        configure_logging(settings.log_level)

    engine = create_engine(settings)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        settings.file_storage_path.mkdir(parents=True, exist_ok=True)
        try:
            yield
        finally:
            await engine.dispose()

    docs_enabled = not settings.is_production
    app = FastAPI(
        title=settings.app_name,
        version=API_VERSION,
        lifespan=lifespan,
        docs_url="/api/docs" if docs_enabled else None,
        redoc_url=None,
        openapi_url="/api/openapi.json" if docs_enabled else None,
    )
    app.state.settings = settings
    app.state.engine = engine
    app.state.sessionmaker = create_sessionmaker(engine)
    app.state.storage = LocalFileStorage(settings.file_storage_path)

    register_error_handlers(app)

    app.add_middleware(RequestContextMiddleware)
    # Added last so it is the outermost middleware and also covers error responses.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,  # auth uses a bearer token, not cookies
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", REQUEST_ID_HEADER],
        expose_headers=[REQUEST_ID_HEADER, "Content-Disposition"],
        max_age=600,
    )

    app.include_router(api_router)
    return app


app = create_app()
