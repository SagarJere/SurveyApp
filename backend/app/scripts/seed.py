"""Seed development data: the HR and admin test accounts.

    uv run python -m app.scripts.seed

Safe to run repeatedly: existing rows are updated, nothing is duplicated.
Refuses to run when APP_ENV=production.
"""

import asyncio
import sys

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncEngine

from app.auth.dev_accounts import DEV_ACCOUNTS
from app.config import Settings, get_settings
from app.db import create_engine
from app.models import AppUser


async def seed_dev_accounts(engine: AsyncEngine) -> int:
    """Upsert the elevated dev accounts. Returns how many rows were written."""
    rows = [
        {"employee_id": a.employee_id, "name": a.name, "email": a.email, "role": a.role}
        for a in DEV_ACCOUNTS
        if a.role != "employee"
    ]
    statement = insert(AppUser).values(rows)
    statement = statement.on_conflict_do_update(
        index_elements=[AppUser.employee_id],
        set_={
            "name": statement.excluded.name,
            "email": statement.excluded.email,
            "role": statement.excluded.role,
        },
    )
    async with engine.begin() as conn:
        await conn.execute(statement)
    return len(rows)


def _print_accounts() -> None:
    lines = ["", "Dev sign-in accounts (AUTH_MODE=dev):", ""]
    lines += [f"  {a.employee_id:<8} {a.role:<9} {a.name}" for a in DEV_ACCOUNTS]
    lines += ["", "Any other employee ID signs in as an employee.", ""]
    sys.stdout.write("\n".join(lines))


async def main(settings: Settings) -> None:
    if settings.is_production:
        sys.stderr.write("Refusing to seed development accounts when APP_ENV=production.\n")
        raise SystemExit(1)
    engine = create_engine(settings)
    try:
        count = await seed_dev_accounts(engine)
    finally:
        await engine.dispose()
    sys.stdout.write(f"Seeded {count} HR/admin accounts.\n")
    _print_accounts()


if __name__ == "__main__":
    asyncio.run(main(get_settings()))
