from typing import Literal
from uuid import UUID

from pydantic import BaseModel


class ThemeAssetOut(BaseModel):
    id: UUID
    kind: Literal["gallery", "upload"]
    name: str
    width: int
    height: int
    url: str
    mobile_url: str
