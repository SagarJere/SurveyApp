"""HTTP routers. Keep them thin: parse input, check access, call a service, shape output."""

from fastapi import APIRouter

from app.routers import (
    audience,
    auth,
    health,
    respond,
    results,
    surveys,
    theme_assets,
    videos,
)

api_router = APIRouter(prefix="/api")
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(surveys.router)
# Before theme_assets: its /files/{asset_id} would otherwise claim /files/videos/{id}.
api_router.include_router(videos.router)
api_router.include_router(theme_assets.router)
api_router.include_router(audience.router)
api_router.include_router(respond.router)
api_router.include_router(results.router)

__all__ = ["api_router"]
