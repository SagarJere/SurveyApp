from collections.abc import Callable

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncEngine

from app.config import Settings
from app.models import AppUser
from app.scripts.seed import main, seed_dev_accounts


async def _users(engine: AsyncEngine) -> list[tuple[str, str]]:
    async with engine.connect() as conn:
        rows = await conn.execute(
            select(AppUser.employee_id, AppUser.role).order_by(AppUser.employee_id)
        )
        return [(row.employee_id, row.role) for row in rows]


async def test_seed_creates_two_elevated_accounts(engine: AsyncEngine) -> None:
    assert await seed_dev_accounts(engine) == 2

    assert await _users(engine) == [("E1001", "admin"), ("E1002", "hr")]


async def test_seed_is_idempotent(engine: AsyncEngine) -> None:
    await seed_dev_accounts(engine)
    async with engine.begin() as conn:
        await conn.execute(text("UPDATE app_users SET role = 'admin' WHERE employee_id = 'E1002'"))

    await seed_dev_accounts(engine)

    assert await _users(engine) == [("E1001", "admin"), ("E1002", "hr")]


async def test_seed_refuses_production(settings_factory: Callable[..., Settings]) -> None:
    settings = settings_factory().model_copy(update={"app_env": "production"})

    with pytest.raises(SystemExit):
        await main(settings)


@pytest.mark.parametrize(
    ("employee_id", "role"),
    [(" E1 ", "hr"), ("e1", "hr"), ("", "hr"), ("E1", "employee"), ("E1", "owner")],
)
async def test_database_rejects_bad_rows(engine: AsyncEngine, employee_id: str, role: str) -> None:
    with pytest.raises(IntegrityError):
        async with engine.begin() as conn:
            await conn.execute(
                text("INSERT INTO app_users (employee_id, name, role) VALUES (:e, 'X', :r)"),
                {"e": employee_id, "r": role},
            )
