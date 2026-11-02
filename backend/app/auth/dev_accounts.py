"""Test accounts for AUTH_MODE=dev. Never used in production (the settings refuse dev mode there).

The two elevated accounts are written to `app_users` by `python -m app.scripts.seed`.
The five employees need no database rows: anyone not in `app_users` is an employee.
Their names here only make the dev login friendlier.
"""

from dataclasses import dataclass

from app.auth.types import Role


@dataclass(frozen=True, slots=True)
class DevAccount:
    employee_id: str
    name: str
    email: str
    role: Role


DEV_ACCOUNTS: tuple[DevAccount, ...] = (
    DevAccount("E1001", "Asha Rao", "asha.rao@example.com", "admin"),
    DevAccount("E1002", "Vikram Mehta", "vikram.mehta@example.com", "hr"),
    DevAccount("E2001", "Priya Nair", "priya.nair@example.com", "employee"),
    DevAccount("E2002", "Rahul Sharma", "rahul.sharma@example.com", "employee"),
    DevAccount("E2003", "Meera Iyer", "meera.iyer@example.com", "employee"),
    DevAccount("E2004", "Arjun Singh", "arjun.singh@example.com", "employee"),
    DevAccount("E2005", "Fatima Khan", "fatima.khan@example.com", "employee"),
)

DEV_NAMES: dict[str, str] = {account.employee_id: account.name for account in DEV_ACCOUNTS}
