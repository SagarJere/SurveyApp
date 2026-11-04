"""Excel export of results (docs/07-reports-dashboard.md, Exports).

Sheets: Summary (the dashboard's figures), Responses (one row per response) and Comments.
Money stays numeric with an "in words" column alongside. Filters and the small-group rule
apply: a small group gets the Summary sheet with participation only.
"""

import io
from datetime import datetime
from typing import Any

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from app.services.money import Currency, amount_in_words
from app.services.results import display_answer

HEADER_FILL = PatternFill("solid", fgColor="0E7A6A")
HEADER_FONT = Font(bold=True, color="FFFFFF")
TITLE_FONT = Font(bold=True, size=14)
BOLD = Font(bold=True)
# Excel number formats. INR uses Indian grouping (12,34,567); others group in threes.
MONEY_FORMATS: dict[str, str] = {
    "INR": '[>=10000000]"₹"##\\,##\\,##\\,##0.00;[>=100000]"₹"##\\,##\\,##0.00;"₹"##,##0.00',
    "USD": '"$"#,##0.00',
    "EUR": '"€"#,##0.00',
    "GBP": '"£"#,##0.00',
    "AED": '"AED "#,##0.00',
}
_MAX_CELL = 32_000  # Excel's limit is 32,767 characters


def _header(sheet: Any, row: int, values: list[str]) -> None:
    for column, value in enumerate(values, start=1):
        cell = sheet.cell(row=row, column=column, value=value)
        cell.font = HEADER_FONT
        cell.fill = HEADER_FILL
        cell.alignment = Alignment(vertical="top", wrap_text=True)


def _safe(value: Any) -> Any:
    """Text that starts with = + - @ would run as a formula when opened; keep it as text."""
    if isinstance(value, str):
        value = value[:_MAX_CELL]
        if value[:1] in ("=", "+", "-", "@"):
            return "'" + value
    return value


def _summary_sheet(sheet: Any, data: dict[str, Any]) -> None:
    summary = data["summary"]
    sheet.title = "Summary"
    sheet.column_dimensions["A"].width = 60
    for column in ("B", "C", "D"):
        sheet.column_dimensions[column].width = 18
    sheet.append([data["title"]])
    sheet["A1"].font = TITLE_FONT
    sheet.append([f"Exported {data['exported_at']:%d %b %Y %H:%M} (UTC)"])
    sheet.append([f"Filters: {data['filters_text']}"])
    sheet.append([])
    sheet.append(["Responses", summary["responses"]])
    sheet.append(
        ["Invited", summary["invited"] if summary["invited"] is not None else "Open to all"]
    )
    rate_row = sheet.max_row + 1
    sheet.append(["Response rate", summary["response_rate"]])
    if summary["response_rate"] is not None:
        sheet.cell(row=rate_row, column=2).number_format = "0%"
    if summary["small_group"]:
        sheet.append([])
        sheet.append(
            [
                "Fewer than 5 people in this group have responded, so their answers are hidden "
                "to protect anonymity."
            ]
        )
        return

    for section in data["questions"]["sections"]:
        sheet.append([])
        sheet.append([section["title"] or "Untitled section"])
        sheet.cell(row=sheet.max_row, column=1).font = TITLE_FONT
        for question in section["questions"]:
            _question_block(sheet, question)


def _share_rows(
    sheet: Any, title: str, denominator: str, rows: list[tuple[Any, int, float]]
) -> None:
    _header(sheet, sheet.max_row + 1, [title, "Responses", denominator])
    for label, n, share in rows:
        sheet.append([_safe(label), n, share])
        sheet.cell(row=sheet.max_row, column=3).number_format = "0%"


def _money_block(sheet: Any, q: dict[str, Any]) -> None:
    currency: Currency = q["currency"]
    fmt = MONEY_FORMATS.get(currency, MONEY_FORMATS["INR"])
    stats = q["stats"]
    for label, key in (
        ("Total", "total"),
        ("Average", "average"),
        ("Median", "median"),
        ("Lowest", "min"),
        ("Highest", "max"),
    ):
        value = stats[key]
        words = amount_in_words(value, currency) if value is not None else ""
        sheet.append([label, value, words])
        sheet.cell(row=sheet.max_row, column=2).number_format = fmt
    rows = [(r["label"], r["n"], r["share"]) for r in q["ranges"]]
    _share_rows(sheet, "Range", "Share of people answering", rows)


def _question_block(sheet: Any, q: dict[str, Any]) -> None:
    sheet.append([])
    sheet.append([_safe(f"Q{q['number']}. {q['text']}")])
    sheet.cell(row=sheet.max_row, column=1).font = BOLD
    sheet.append(["Shown to", q["shown"], "Answered", q["answered"]])
    kind = q["type"]
    if kind in ("single", "multi", "dropdown"):
        rows = [(o["label"], o["n"], o["share"]) for o in q["options"]]
        _share_rows(sheet, "Option", "Share of people shown", rows)
    elif kind == "rating":
        sheet.append(["Average (out of 5)", q["average"]])
        rows = [(d["value"], d["n"], d["share"]) for d in q["distribution"]]
        _share_rows(sheet, "Rating", "Share of people shown", rows)
    elif kind == "money":
        _money_block(sheet, q)
    else:
        sheet.append(["Comments", q["answered"]])


def _responses_sheet(sheet: Any, data: dict[str, Any]) -> None:
    questions: list[dict[str, Any]] = data["question_list"]
    anonymous = data["anonymous"]
    header = ["Response ID"]
    if not anonymous:
        header += ["Employee ID", "Name"]
    header += ["Submitted at", "Department", "Location"]
    fixed_columns = len(header)
    money_columns: list[tuple[int, str]] = []
    for q in questions:
        title = f"Q{q['number']}. {q['text']}"
        header.append(title)
        if q["type"] == "money":
            money_columns.append((len(header), q["config"].get("currency", "INR")))
            header.append(f"Q{q['number']} in words")
    _header(sheet, 1, header)
    sheet.freeze_panes = "B2"
    for row in data["responses"]:
        values: list[Any] = [str(row["id"])]
        if not anonymous:
            values += [row["employee_id"], row["name"]]
        values += [row["submitted_at"].replace(tzinfo=None), row["department"], row["location"]]
        answers = data["answers"].get(row["id"], {})
        for q in questions:
            value = answers.get(q["key"])
            if q["type"] == "money":
                currency: Currency = q["config"].get("currency", "INR")
                values += [value, amount_in_words(value, currency) if value is not None else None]
            elif q["type"] == "rating":
                values.append(value)
            else:
                values.append(_safe(display_answer(q, value)) if value is not None else None)
        sheet.append(values)
    date_column = 5 if not anonymous else 2
    for row_number in range(2, sheet.max_row + 1):
        sheet.cell(row=row_number, column=date_column).number_format = "dd mmm yyyy hh:mm"
        for column, code in money_columns:
            sheet.cell(row=row_number, column=column).number_format = MONEY_FORMATS.get(
                code, MONEY_FORMATS["INR"]
            )
    for index in range(1, len(header) + 1):
        is_question = index > fixed_columns
        sheet.column_dimensions[get_column_letter(index)].width = 30 if is_question else 18


def _comments_sheet(sheet: Any, data: dict[str, Any]) -> None:
    numbers = {q["key"]: q for q in data["question_list"]}
    _header(sheet, 1, ["Question", "Comment", "Department"])
    sheet.column_dimensions["A"].width = 50
    sheet.column_dimensions["B"].width = 80
    sheet.column_dimensions["C"].width = 22
    for key, text, department in data["comments"]:
        q = numbers.get(key)
        sheet.append(
            [
                _safe(f"Q{q['number']}. {q['text']}") if q else "",
                _safe(text),
                department,
            ]
        )
        sheet.cell(row=sheet.max_row, column=2).alignment = Alignment(
            wrap_text=True, vertical="top"
        )


def build_export(data: dict[str, Any]) -> bytes:
    workbook = Workbook()
    summary_sheet = workbook.active
    assert summary_sheet is not None  # noqa: S101 - a new workbook always has one sheet
    _summary_sheet(summary_sheet, data)
    if not data["summary"]["small_group"]:
        _responses_sheet(workbook.create_sheet("Responses"), data)
        _comments_sheet(workbook.create_sheet("Comments"), data)
    out = io.BytesIO()
    workbook.save(out)
    return out.getvalue()


def non_responders_workbook(rows: list[Any]) -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    assert sheet is not None  # noqa: S101
    sheet.title = "Not yet responded"
    _header(sheet, 1, ["EmployeeId", "Name", "Email", "Department", "Location"])
    for member in rows:
        sheet.append(
            [member.employee_id, member.name, member.email, member.department, member.location]
        )
    for column, width in zip("ABCDE", (16, 28, 32, 22, 18), strict=True):
        sheet.column_dimensions[column].width = width
    out = io.BytesIO()
    workbook.save(out)
    return out.getvalue()


def export_filename(title: str, when: datetime, suffix: str) -> str:
    safe = "".join(c if c.isalnum() or c in " -_" else "" for c in title).strip()[:60] or "survey"
    return f"{safe} - {suffix} {when:%Y-%m-%d}.xlsx"
