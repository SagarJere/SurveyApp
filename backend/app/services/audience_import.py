"""Read and check audience files (docs/04-api.md, "Import rules").

Accepts .xlsx and .csv with an EmployeeId column (any case or spacing) and optional Name,
Email, Department and Location. IDs are normalised the same way as at login. Duplicates keep
the first row; the rest are counted, not listed as problems.
"""

import csv
import io
import re
from collections.abc import Iterable, Iterator, Sequence
from dataclasses import dataclass, field
from typing import Any
from zipfile import BadZipFile

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill
from openpyxl.utils.exceptions import InvalidFileException

from app.services.employee_ids import MAX_EMPLOYEE_ID_LENGTH, normalize_employee_id

MAX_ROWS = 20_000
MAX_FILE_BYTES = 10 * 1024 * 1024
FIELDS = ("employee_id", "name", "email", "department", "location")
TEMPLATE_HEADERS = ("EmployeeId", "Name", "Email", "Department", "Location")
_MAX_TEXT = 200

# Header spellings people actually use, compared after lowercasing and removing spaces,
# dashes and underscores.
_HEADER_ALIASES = {
    "employeeid": "employee_id",
    "empid": "employee_id",
    "employeeno": "employee_id",
    "employeenumber": "employee_id",
    "name": "name",
    "fullname": "name",
    "employeename": "name",
    "email": "email",
    "emailaddress": "email",
    "workemail": "email",
    "department": "department",
    "dept": "department",
    "location": "location",
    "office": "location",
    "city": "location",
}
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class AudienceFileError(ValueError):
    """The whole file can't be used. The message can be shown as is."""


@dataclass(frozen=True, slots=True)
class AudienceRow:
    employee_id: str
    name: str | None
    email: str | None
    department: str | None
    location: str | None

    def as_dict(self) -> dict[str, str | None]:
        return {
            "employee_id": self.employee_id,
            "name": self.name,
            "email": self.email,
            "department": self.department,
            "location": self.location,
        }


@dataclass(slots=True)
class ImportResult:
    rows: list[AudienceRow] = field(default_factory=list)
    duplicate_count: int = 0
    # One entry per row to fix: spreadsheet row number, what was typed, and the problem.
    errors: list[dict[str, Any]] = field(default_factory=list)


def _cell(value: object) -> str:
    """Spreadsheet cell to text. 12345.0 (a number cell) becomes "12345"."""
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def _header_key(value: str) -> str:
    return re.sub(r"[\s_\-.]", "", value.lower())


def _map_headers(header: Sequence[str]) -> dict[int, str]:
    columns: dict[int, str] = {}
    for index, title in enumerate(header):
        name = _HEADER_ALIASES.get(_header_key(title))
        if name and name not in columns.values():
            columns[index] = name
    if "employee_id" not in columns.values():
        msg = "The file needs an EmployeeId column. Download the template to see the layout."
        raise AudienceFileError(msg)
    return columns


def _xlsx_rows(data: bytes) -> Iterator[list[str]]:
    try:
        workbook = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    except (InvalidFileException, BadZipFile, KeyError, OSError, ValueError) as exc:
        msg = "This doesn't look like an Excel file. Save it as .xlsx or .csv and try again."
        raise AudienceFileError(msg) from exc
    try:
        sheet = workbook.worksheets[0]
        for row in sheet.iter_rows(values_only=True):
            yield [_cell(value) for value in row]
    finally:
        workbook.close()


def _decode(data: bytes) -> str:
    for encoding in ("utf-8-sig", "cp1252"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    msg = "We couldn't read this CSV file. Save it as UTF-8 CSV and try again."
    raise AudienceFileError(msg)


def _csv_rows(data: bytes) -> Iterator[list[str]]:
    text = _decode(data)
    try:
        dialect: type[csv.Dialect] | csv.Dialect = csv.Sniffer().sniff(text[:4096], ",;\t")
    except csv.Error:
        dialect = csv.excel
    for row in csv.reader(io.StringIO(text), dialect):
        yield [cell.strip() for cell in row]


def _optional(value: str) -> str | None:
    value = value.strip()
    return value[:_MAX_TEXT] if value else None


def _row_problem(employee_id: str, email: str | None) -> str | None:
    if not employee_id:
        return "Employee ID is missing"
    if any(char.isspace() for char in employee_id):
        return "Employee ID can't contain spaces"
    if len(employee_id) > MAX_EMPLOYEE_ID_LENGTH:
        return f"Employee ID is longer than {MAX_EMPLOYEE_ID_LENGTH} characters"
    if email and not _EMAIL.match(email):
        return "Email address isn't valid"
    return None


def parse_audience_file(
    data: bytes, filename: str, existing_ids: Iterable[str] = ()
) -> ImportResult:
    """Check every row. `existing_ids` (append mode) count as duplicates."""
    if len(data) > MAX_FILE_BYTES:
        msg = "This file is larger than 10 MB. Split it into smaller files."
        raise AudienceFileError(msg)
    lower = filename.lower()
    if lower.endswith(".xlsx"):
        source = _xlsx_rows(data)
    elif lower.endswith(".csv"):
        source = _csv_rows(data)
    else:
        msg = "Upload an Excel (.xlsx) or CSV (.csv) file."
        raise AudienceFileError(msg)

    header = next(source, None)
    if header is None:
        msg = "This file is empty."
        raise AudienceFileError(msg)
    columns = _map_headers(header)

    result = ImportResult()
    seen = set(existing_ids)
    data_rows = 0
    for line, raw in enumerate(source, start=2):
        values = {name: (raw[index] if index < len(raw) else "") for index, name in columns.items()}
        if not any(values.values()):
            continue  # blank line, e.g. trailing rows in Excel
        data_rows += 1
        if data_rows > MAX_ROWS:
            msg = f"This file has more than {MAX_ROWS:,} rows. Split it into smaller files."
            raise AudienceFileError(msg)

        typed_id = values.get("employee_id", "")
        employee_id = normalize_employee_id(typed_id)
        email = _optional(values.get("email", ""))
        problem = _row_problem(employee_id, email)
        if problem:
            result.errors.append(
                {
                    "row": line,
                    "employee_id": typed_id,
                    "name": values.get("name", ""),
                    "email": values.get("email", ""),
                    "department": values.get("department", ""),
                    "location": values.get("location", ""),
                    "problem": problem,
                }
            )
            continue
        if employee_id in seen:
            result.duplicate_count += 1
            continue
        seen.add(employee_id)
        result.rows.append(
            AudienceRow(
                employee_id=employee_id,
                name=_optional(values.get("name", "")),
                email=email,
                department=_optional(values.get("department", "")),
                location=_optional(values.get("location", "")),
            )
        )
    return result


def _workbook_bytes(workbook: Workbook) -> bytes:
    out = io.BytesIO()
    workbook.save(out)
    return out.getvalue()


def _style_header(sheet: Any, widths: Sequence[int]) -> None:
    for cell in sheet[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="0E7A6A")
    for index, width in enumerate(widths):
        sheet.column_dimensions[chr(ord("A") + index)].width = width
    sheet.freeze_panes = "A2"


def template_workbook() -> bytes:
    """audience_template.xlsx: the header row, text-formatted ID column and instructions."""
    workbook = Workbook()
    sheet = workbook.active
    assert sheet is not None  # noqa: S101 - a new workbook always has one sheet
    sheet.title = "Audience"
    sheet.append(list(TEMPLATE_HEADERS))
    _style_header(sheet, (16, 28, 32, 22, 18))
    for row in range(2, 1002):
        sheet.cell(row=row, column=1).number_format = "@"  # keep leading zeros
    help_sheet = workbook.create_sheet("How to fill this in")
    for line in (
        "One employee per row on the Audience sheet.",
        "EmployeeId is required. Spaces around it are removed and letters are made uppercase.",
        "Name, Email, Department and Location are optional. Department and Location power the "
        "results filters.",
        "Duplicate IDs are skipped. Rows with problems are listed so you can fix and re-upload.",
        f"Up to {MAX_ROWS:,} rows per file. You can also save this sheet as CSV.",
    ):
        help_sheet.append([line])
    help_sheet.column_dimensions["A"].width = 110
    return _workbook_bytes(workbook)


def errors_workbook(errors: Sequence[dict[str, Any]]) -> bytes:
    """Rows to fix, with the original values and the problem, ready to correct and re-upload."""
    workbook = Workbook()
    sheet = workbook.active
    assert sheet is not None  # noqa: S101 - a new workbook always has one sheet
    sheet.title = "Rows to fix"
    sheet.append(["Row", *TEMPLATE_HEADERS, "Problem"])
    _style_header(sheet, (8, 16, 28, 32, 22, 18, 40))
    for error in errors:
        sheet.append(
            [
                error["row"],
                error.get("employee_id", ""),
                error.get("name", ""),
                error.get("email", ""),
                error.get("department", ""),
                error.get("location", ""),
                error["problem"],
            ]
        )
    return _workbook_bytes(workbook)
