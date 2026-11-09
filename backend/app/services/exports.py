"""Excel export of results (docs/07-reports-dashboard.md, Exports).

Two kinds:
- "responses": one sheet, one row per response, one column per question.
- "analytics": Summary (the dashboard's figures with a bar chart per question), Participation
  (by department, with a chart), Responses per day (with a chart), Responses and Comments.

Every sheet opens with the survey title, the response count, and when it was exported with
which filters; the data below it is an Excel table (filter buttons, works with pivot tables).
Money stays numeric with an "in words" column alongside. Filters apply, and so does the
small-group rule (anonymous surveys only): a small group gets participation figures only.
"""

import io
from datetime import datetime
from math import ceil
from typing import Any, Literal

from openpyxl import Workbook
from openpyxl.chart import BarChart, Reference
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.table import Table, TableStyleInfo

from app.services.money import Currency, amount_in_words
from app.services.results import display_answer

HEADER_FILL = PatternFill("solid", fgColor="0E7A6A")
HEADER_FONT = Font(bold=True, color="FFFFFF")
TITLE_FONT = Font(bold=True, size=14)
BOLD = Font(bold=True)
MUTED_FONT = Font(color="5B6B67")
# Rows 1-3 hold the title block, row 4 is blank, and tables start with their headings on row 5.
HEADING_ROW = 5
# Excel number formats. INR uses Indian grouping (12,34,567); others group in threes.
MONEY_FORMATS: dict[str, str] = {
    "INR": '[>=10000000]"₹"##\\,##\\,##\\,##0.00;[>=100000]"₹"##\\,##\\,##0.00;"₹"##,##0.00',
    "USD": '"$"#,##0.00',
    "EUR": '"€"#,##0.00',
    "GBP": '"£"#,##0.00',
    "AED": '"AED "#,##0.00',
}
_MAX_CELL = 32_000  # Excel's limit is 32,767 characters
SMALL_GROUP_NOTE = (
    "Fewer than 5 people in this group have responded, so their answers are hidden "
    "to protect anonymity."
)
ExportKind = Literal["responses", "analytics"]
WHOLE_NUMBER_FORMAT = "#,##0"
DECIMAL_NUMBER_FORMAT = "#,##0.00"


def _number_format(config: dict[str, Any]) -> str:
    return DECIMAL_NUMBER_FORMAT if config.get("number_decimals") else WHOLE_NUMBER_FORMAT


CHART_COLOUR = "00826C"  # --chart-1 in the app
ROW_CM = 0.53  # default Excel row height (15 pt) in centimetres


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


def response_count_text(summary: dict[str, Any]) -> str:
    """ "421 responses, from 490 invited (86%)" or "3 responses (open to all employees)"."""
    count = summary["responses"]
    text = f"{count:,} {'response' if count == 1 else 'responses'}"
    if summary["invited"] is None:
        return f"{text} (open to all employees)"
    text += f", from {summary['invited']:,} invited"
    if summary["response_rate"] is not None:
        text += f" ({round(summary['response_rate'] * 100)}%)"
    return text


def _title_block(sheet: Any, data: dict[str, Any], extra: str | None = None) -> None:
    """Rows 1-3: survey title, response count, export time and filters. Also the print setup."""
    title = data["title"]
    sheet.cell(row=1, column=1, value=_safe(title)).font = TITLE_FONT
    count = response_count_text(data["summary"])
    sheet.cell(row=2, column=1, value=f"{count} · {extra}" if extra else count).font = BOLD
    sheet.cell(
        row=3,
        column=1,
        value=f"Exported {data['exported_at']:%d %b %Y %H:%M} (UTC) · Filters: "
        f"{data['filters_text']}",
    ).font = MUTED_FONT
    # Printing: the title on every page, page numbers at the bottom.
    sheet.oddHeader.center.text = title.replace("&", "&&")[:200]
    sheet.oddFooter.center.text = "Page &P of &N"
    sheet.page_setup.orientation = "landscape"
    sheet.page_setup.fitToWidth = 1
    sheet.page_setup.fitToHeight = 0
    sheet.sheet_properties.pageSetUpPr.fitToPage = True


def _as_table(sheet: Any, name: str, columns: int) -> None:
    """Make the headings on HEADING_ROW and the rows below them an Excel table."""
    last_row = sheet.max_row
    sheet.freeze_panes = sheet.cell(row=HEADING_ROW + 1, column=1).coordinate
    sheet.print_title_rows = f"{HEADING_ROW}:{HEADING_ROW}"
    if last_row <= HEADING_ROW:
        return  # Excel tables need at least one data row; headings alone stay as they are.
    ref = f"A{HEADING_ROW}:{get_column_letter(columns)}{last_row}"
    table = Table(displayName=name, ref=ref)
    table.tableStyleInfo = TableStyleInfo(name="TableStyleLight9", showRowStripes=True)
    sheet.add_table(table)


def _summary_sheet(sheet: Any, data: dict[str, Any]) -> None:
    summary = data["summary"]
    sheet.title = "Summary"
    sheet.column_dimensions["A"].width = 60
    for column in ("B", "C", "D"):
        sheet.column_dimensions[column].width = 18
    _title_block(sheet, data)
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
        sheet.append([SMALL_GROUP_NOTE])
        return

    for section in data["questions"]["sections"]:
        sheet.append([])
        sheet.append([section["title"] or "Untitled section"])
        sheet.cell(row=sheet.max_row, column=1).font = TITLE_FONT
        for question in section["questions"]:
            _question_block(sheet, question)


def _bar_chart(
    sheet: Any,
    *,
    title: str,
    first_row: int,
    last_row: int,
    label_col: int,
    value_col: int,
    anchor: str,
    percent: bool,
    horizontal: bool = True,
    width_cm: float = 14,
) -> float:
    """A single-series bar chart of `value_col` against `label_col`. Returns its height (cm)."""
    chart = BarChart()
    chart.type = "bar" if horizontal else "col"
    chart.title = title[:250]
    chart.style = 2
    chart.legend = None  # one series: the title names it
    chart.gapWidth = 60
    data = Reference(sheet, min_col=value_col, min_row=first_row - 1, max_row=last_row)
    labels = Reference(sheet, min_col=label_col, min_row=first_row, max_row=last_row)
    chart.add_data(data, titles_from_data=True)
    chart.set_categories(labels)
    series = chart.series[0]
    series.graphicalProperties.solidFill = CHART_COLOUR
    series.graphicalProperties.line.solidFill = CHART_COLOUR
    if horizontal:
        chart.x_axis.scaling.orientation = "maxMin"  # first option at the top, as in the survey
    if percent:
        chart.y_axis.numFmt = "0%"
        chart.y_axis.scaling.min = 0
    chart.y_axis.majorGridlines = None
    chart.x_axis.delete = False
    chart.y_axis.delete = False
    count = last_row - first_row + 1
    height = max(5.0, 0.8 * count + 3) if horizontal else 7.5
    chart.height = height
    chart.width = width_cm
    sheet.add_chart(chart, anchor)
    return height


def _share_rows(
    sheet: Any,
    title: str,
    denominator: str,
    rows: list[tuple[Any, int, float]],
    *,
    chart_title: str | None = None,
    chart_top: int | None = None,
) -> None:
    _header(sheet, sheet.max_row + 1, [title, "Responses", denominator])
    first = sheet.max_row + 1
    for label, n, share in rows:
        sheet.append([_safe(label), n, share])
        sheet.cell(row=sheet.max_row, column=3).number_format = "0%"
    if chart_title is None or not rows:
        return
    top = chart_top or first
    height = _bar_chart(
        sheet,
        title=chart_title,
        first_row=first,
        last_row=sheet.max_row,
        label_col=1,
        value_col=3,
        anchor=f"F{top}",
        percent=True,
    )
    # Leave room so the chart never covers the next question's figures. Writing a blank cell
    # (not appending an empty row) is what moves the sheet's last row down.
    rows_needed = ceil(height / ROW_CM) + 1
    last = top + rows_needed - 1
    if last > sheet.max_row:
        sheet.cell(row=last, column=1, value=None)


def _number_block(sheet: Any, q: dict[str, Any], *, chart_title: str, chart_top: int) -> None:
    stats = q["stats"]
    unit = q.get("unit")
    for label, key in (
        ("Total", "total"),
        ("Average", "average"),
        ("Median", "median"),
        ("Lowest", "min"),
        ("Highest", "max"),
    ):
        sheet.append([label, stats[key], unit or None])
        # Averages and medians can have decimals even when the answers are whole numbers.
        sheet.cell(row=sheet.max_row, column=2).number_format = (
            DECIMAL_NUMBER_FORMAT if key in ("average", "median") else "#,##0.##"
        )
    rows = [(r["label"], r["n"], r["share"]) for r in q["ranges"]]
    _share_rows(
        sheet,
        "Answer",
        "Share of people answering",
        rows,
        chart_title=chart_title,
        chart_top=chart_top,
    )


def _money_block(sheet: Any, q: dict[str, Any], *, chart_title: str, chart_top: int) -> None:
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
    _share_rows(
        sheet,
        "Range",
        "Share of people answering",
        rows,
        chart_title=chart_title,
        chart_top=chart_top,
    )


def _question_block(sheet: Any, q: dict[str, Any]) -> None:
    sheet.append([])
    sheet.append([_safe(f"Q{q['number']}. {q['text']}")])
    sheet.cell(row=sheet.max_row, column=1).font = BOLD
    top = sheet.max_row
    sheet.append(["Shown to", q["shown"], "Answered", q["answered"]])
    kind = q["type"]
    chart_title = f"Q{q['number']}. {q['text']}"
    if q["shown"] == 0:
        sheet.append(["Nobody in this group was shown this question."])
    elif kind in ("single", "multi", "dropdown"):
        rows = [(o["label"], o["n"], o["share"]) for o in q["options"]]
        _share_rows(
            sheet,
            "Option",
            "Share of people shown",
            rows,
            chart_title=chart_title,
            chart_top=top,
        )
        if kind == "multi":
            sheet.append(["People could pick more than one, so shares add up to more than 100%."])
    elif kind == "rating":
        sheet.append(["Average (out of 5)", q["average"]])
        rows = [(d["value"], d["n"], d["share"]) for d in reversed(q["distribution"])]
        _share_rows(
            sheet,
            "Rating",
            "Share of people shown",
            rows,
            chart_title=chart_title,
            chart_top=top,
        )
    elif kind == "money":
        _money_block(sheet, q, chart_title=chart_title, chart_top=top)
    elif kind == "number":
        _number_block(sheet, q, chart_title=chart_title, chart_top=top)
    else:
        sheet.append(["Comments", q["answered"]])


def _answer_cells(q: dict[str, Any], value: Any) -> list[Any]:
    """The cells for one answer: numbers stay numeric; money also gets its amount in words."""
    if q["type"] == "money":
        currency: Currency = q["config"].get("currency", "INR")
        return [value, amount_in_words(value, currency) if value is not None else None]
    if q["type"] in ("rating", "number"):
        return [value]
    return [_safe(display_answer(q, value)) if value is not None else None]


def _responses_sheet(sheet: Any, data: dict[str, Any]) -> None:
    questions: list[dict[str, Any]] = data["question_list"]
    anonymous = data["anonymous"]
    header = ["Response ID"]
    if not anonymous:
        header += ["Employee ID", "Name"]
    header += ["Submitted at", "Department", "Location"]
    fixed_columns = len(header)
    money_columns: list[tuple[int, str]] = []
    number_columns: list[tuple[int, str]] = []
    for q in questions:
        # Excel table column names are limited to 255 characters; the Q number keeps them unique.
        unit = str(q["config"].get("number_unit") or "").strip() if q["type"] == "number" else ""
        title = f"Q{q['number']}. {q['text']}" + (f" ({unit})" if unit else "")
        header.append(title[:250])
        if q["type"] == "number":
            number_columns.append((len(header), _number_format(q["config"])))
        if q["type"] == "money":
            money_columns.append((len(header), q["config"].get("currency", "INR")))
            header.append(f"Q{q['number']} in words")
    _title_block(sheet, data)
    _header(sheet, HEADING_ROW, header)
    for row in data["responses"]:
        values: list[Any] = [str(row["id"])]
        if not anonymous:
            values += [row["employee_id"], row["name"]]
        values += [row["submitted_at"].replace(tzinfo=None), row["department"], row["location"]]
        answers = data["answers"].get(row["id"], {})
        for q in questions:
            values += _answer_cells(q, answers.get(q["key"]))
        sheet.append(values)
    date_column = 4 if not anonymous else 2
    for row_number in range(HEADING_ROW + 1, sheet.max_row + 1):
        sheet.cell(row=row_number, column=date_column).number_format = "dd mmm yyyy hh:mm"
        for column, fmt in number_columns:
            sheet.cell(row=row_number, column=column).number_format = fmt
        for column, code in money_columns:
            sheet.cell(row=row_number, column=column).number_format = MONEY_FORMATS.get(
                code, MONEY_FORMATS["INR"]
            )
    for index in range(1, len(header) + 1):
        is_question = index > fixed_columns
        sheet.column_dimensions[get_column_letter(index)].width = 30 if is_question else 18
    _as_table(sheet, "Responses", len(header))
    # Keep the ID (and name) in view while scrolling across the questions.
    sheet.freeze_panes = sheet.cell(row=HEADING_ROW + 1, column=1 if anonymous else 4).coordinate


def _comments_sheet(sheet: Any, data: dict[str, Any]) -> None:
    numbers = {q["key"]: q for q in data["question_list"]}
    _title_block(sheet, data, f"{len(data['comments']):,} comments")
    _header(sheet, HEADING_ROW, ["Question", "Comment", "Department"])
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
    _as_table(sheet, "Comments", 3)


def _participation_sheet(sheet: Any, data: dict[str, Any]) -> None:
    participation = data["participation"]
    open_to_all = participation["open_to_all"]
    sheet.column_dimensions["A"].width = 30
    for column in ("B", "C", "D"):
        sheet.column_dimensions[column].width = 14
    header = (
        ["Department", "Responded"]
        if open_to_all
        else [
            "Department",
            "Invited",
            "Responded",
            "Rate",
        ]
    )
    _title_block(sheet, data)
    _header(sheet, HEADING_ROW, header)
    for row in participation["departments"]:
        name = row["department"] or "Not recorded"
        if open_to_all:
            sheet.append([_safe(name), row["responded"]])
        else:
            sheet.append([_safe(name), row["invited"], row["responded"], row["rate"]])
            sheet.cell(row=sheet.max_row, column=4).number_format = "0%"
    _as_table(sheet, "Participation", len(header))
    if sheet.max_row <= HEADING_ROW:
        return
    _bar_chart(
        sheet,
        title="Responded by department" if open_to_all else "Response rate by department",
        first_row=HEADING_ROW + 1,
        last_row=sheet.max_row,
        label_col=1,
        value_col=2 if open_to_all else 4,
        anchor=f"F{HEADING_ROW}",
        percent=not open_to_all,
    )


def _daily_sheet(sheet: Any, data: dict[str, Any]) -> None:
    days = data["timeline"]["days"]
    sheet.column_dimensions["A"].width = 16
    sheet.column_dimensions["B"].width = 14
    _title_block(sheet, data)
    _header(sheet, HEADING_ROW, ["Day", "Responses"])
    for day in days:
        sheet.append([day["day"], day["n"]])
        sheet.cell(row=sheet.max_row, column=1).number_format = "dd mmm yyyy"
    _as_table(sheet, "ResponsesPerDay", 2)
    if not days:
        return
    _bar_chart(
        sheet,
        title="Responses per day",
        first_row=HEADING_ROW + 1,
        last_row=sheet.max_row,
        label_col=1,
        value_col=2,
        anchor=f"D{HEADING_ROW}",
        percent=False,
        horizontal=False,
        width_cm=max(14.0, min(40.0, 0.6 * len(days))),
    )


def _small_group_sheet(sheet: Any, data: dict[str, Any]) -> None:
    sheet.column_dimensions["A"].width = 90
    _title_block(sheet, data)
    sheet.cell(row=HEADING_ROW, column=1, value=SMALL_GROUP_NOTE)


def build_export(data: dict[str, Any], kind: ExportKind = "analytics") -> bytes:
    """The workbook for one of the two export kinds (see the module docstring)."""
    workbook = Workbook()
    workbook.properties.title = data["title"][:255]
    workbook.properties.creator = "Pulse"
    first = workbook.active
    assert first is not None  # noqa: S101 - a new workbook always has one sheet
    small = data["summary"]["small_group"]
    if kind == "responses":
        first.title = "Responses"
        if small:
            _small_group_sheet(first, data)
        else:
            _responses_sheet(first, data)
    else:
        _summary_sheet(first, data)
        _participation_sheet(workbook.create_sheet("Participation"), data)
        _daily_sheet(workbook.create_sheet("Responses per day"), data)
        if not small:
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
