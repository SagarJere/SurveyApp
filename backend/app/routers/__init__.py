"""HTTP routers. Keep them thin: parse input, check access, call a service, shape output."""

from fastapi import APIRouter

from app.routers import health

api_router = APIRouter(prefix="/api")
api_router.include_router(health.router)

__all__ = ["api_router"]
