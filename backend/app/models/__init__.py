"""SQLAlchemy models, one module per area.

Import every model module here so `Base.metadata` is complete for Alembic autogenerate.
"""

from app.models.base import Base
from app.models.user import AppUser

__all__ = ["AppUser", "Base"]
