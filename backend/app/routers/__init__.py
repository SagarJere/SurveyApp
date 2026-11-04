"""HTTP routers. Keep them thin: parse input, check access, call a service, shape output."""

from fastapi import APIRouter

from app.routers import auth, health, surveys, theme_assets

api_router = APIRouter(prefix="/api")
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(surveys.router)
api_router.include_router(theme_assets.router)

__all__ = ["api_router"]
