"""Who you can sign in as in AUTH_MODE=dev: the test accounts, everyone with an elevated role,
and everyone on any survey's audience. Used only by the dev sign-in page's employee picker.
"""

from dataclasses import dataclass

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dev_accounts import DEV_ACCOUNTS
from app.auth.types import Role
from app.models import AppUser, SurveyAudience

MAX_LIMIT = 50


@dataclass(slots=True)
class DevPerson:
    employee_id: str
    name: str | None
    role: Role
    department: str | None = None
    location: str | None = None
    surveys: int = 0


def _escape_like(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _matches(person: DevPerson, term: str) -> bool:
    if not term:
        return True
    lowered = term.lower()
    return lowered in person.employee_id.lower() or lowered in (person.name or "").lower()


async def search_people(
    session: AsyncSession, search: str = "", limit: int = 20
) -> tuple[list[DevPerson], int]:
    """People whose ID or name contains `search`, test and elevated accounts first.

    Returns the page of people and how many match in total.
    """
    term = search.strip()
    limit = max(1, min(limit, MAX_LIMIT))

    known: dict[str, DevPerson] = {
        a.employee_id: DevPerson(a.employee_id, a.name, a.role) for a in DEV_ACCOUNTS
    }
    for user in (await session.scalars(select(AppUser))).all():
        role: Role = "admin" if user.role == "admin" else "hr"
        known[user.employee_id] = DevPerson(user.employee_id, user.name, role)

    audience = select(
        SurveyAudience.employee_id,
        func.max(SurveyAudience.name).label("name"),
        func.max(SurveyAudience.department).label("department"),
        func.max(SurveyAudience.location).label("location"),
        func.count().label("surveys"),
    ).group_by(SurveyAudience.employee_id)
    if term:
        pattern = f"%{_escape_like(term)}%"
        audience = audience.where(
            or_(
                SurveyAudience.employee_id.ilike(pattern, escape="\\"),
                SurveyAudience.name.ilike(pattern, escape="\\"),
            )
        )
    audience_sub = audience.subquery()

    # Fill in department, location and survey counts for the known accounts.
    known_rows = await session.execute(
        select(audience_sub).where(audience_sub.c.employee_id.in_(list(known)))
    )
    for employee_id, name, department, location, surveys in known_rows.all():
        person = known[employee_id]
        person.name = person.name or name
        person.department, person.location, person.surveys = department, location, surveys

    matching_known = sorted(
        (p for p in known.values() if _matches(p, term)),
        key=lambda p: ({"admin": 0, "hr": 1, "employee": 2}[p.role], p.employee_id),
    )
    others_total = (
        await session.scalar(
            select(func.count())
            .select_from(audience_sub)
            .where(audience_sub.c.employee_id.not_in(list(known)))
        )
    ) or 0

    items = matching_known[:limit]
    room = limit - len(items)
    if room > 0:
        rows = await session.execute(
            select(audience_sub)
            .where(audience_sub.c.employee_id.not_in(list(known)))
            .order_by(audience_sub.c.employee_id)
            .limit(room)
        )
        items += [
            DevPerson(employee_id, name, "employee", department, location, surveys)
            for employee_id, name, department, location, surveys in rows.all()
        ]
    return items, len(matching_known) + others_total


async def audience_name(session: AsyncSession, employee_id: str) -> str | None:
    """The name this person was uploaded with, from any survey's audience."""
    return await session.scalar(
        select(func.max(SurveyAudience.name)).where(SurveyAudience.employee_id == employee_id)
    )
