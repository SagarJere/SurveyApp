"""Liveness and readiness check used by the frontend shell, load balancers and monitoring."""

import asyncio
import logging
from typing import Literal

from fastapi import APIRouter, Request, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from app.config import Settings
from app.errors import AppError, ErrorResponse

logger = logging.getLogger(__name__)

router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    status: Literal["ok"]
    database: Literal["ok"]
    environment: str
    version: str


async def _ping_database(engine: AsyncEngine) -> None:
    async with engine.connect() as conn:
        await conn.execute(text("SELECT 1"))


@router.get(
    "/health",
    response_model=HealthResponse,
    responses={status.HTTP_503_SERVICE_UNAVAILABLE: {"model": ErrorResponse}},
    summary="Check that the API and its database are reachable",
)
async def health(request: Request) -> HealthResponse:
    settings: Settings = request.app.state.settings
    engine: AsyncEngine = request.app.state.engine
    try:
        await asyncio.wait_for(_ping_database(engine), timeout=settings.health_db_timeout_seconds)
    except Exception as exc:
        logger.warning("Health check: database unreachable (%s)", type(exc).__name__)
        raise AppError(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            message="The database is not reachable.",
            details={"database": "unreachable"},
        ) from exc
    return HealthResponse(
        status="ok",
        database="ok",
        environment=settings.app_env,
        version=request.app.version,
    )
