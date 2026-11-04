import io
import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from httpx import AsyncClient
from openpyxl import Workbook, load_workbook
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from app.tests.conftest import bearer

PULSE: dict[str, Any] = json.loads(
    (Path(__file__).resolve().parents[3] / "shared/test-cases/workplace-pulse.json").read_text()
)["draft"]

Headers = dict[str, str]


@pytest.fixture
def hr(token_for: Callable[..., str]) -> Headers:
    return bearer(token_for("E1002", "hr"))


@pytest.fixture
def other_hr(token_for: Callable[..., str]) -> Headers:
    return bearer(token_for("E1003", "hr"))


def xlsx(rows: list[list[Any]], header: list[str] | None = None) -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    assert sheet is not None
    sheet.append(header or ["EmployeeId", "Name", "Email", "Department", "Location"])
    for row in rows:
        sheet.append(row)
    out = io.BytesIO()
    workbook.save(out)
    return out.getvalue()


async def _survey(client: AsyncClient, hr: Headers, draft: dict[str, Any] = PULSE) -> str:
    survey = (await client.post("/api/surveys", headers=hr)).json()
    await client.put(
        f"/api/surveys/{survey['id']}/draft",
        headers=hr,
        json={"draft": draft, "draft_updated_at": survey["draft_updated_at"]},
    )
    survey_id: str = survey["id"]
    return survey_id


async def _upload(
    client: AsyncClient,
    hr: Headers,
    survey_id: str,
    data: bytes,
    name: str = "audience.xlsx",
    mode: str = "append",
) -> Any:
    return await client.post(
        f"/api/surveys/{survey_id}/audience/uploads?mode={mode}",
        headers=hr,
        files={"file": (name, data, "application/octet-stream")},
    )


async def _apply(client: AsyncClient, hr: Headers, survey_id: str, upload_id: str) -> Any:
    return await client.post(
        f"/api/surveys/{survey_id}/audience/uploads/{upload_id}/apply", headers=hr
    )


async def _add(client: AsyncClient, hr: Headers, survey_id: str, rows: list[list[Any]]) -> None:
    preview = (await _upload(client, hr, survey_id, xlsx(rows))).json()
    assert (await _apply(client, hr, survey_id, preview["upload_id"])).status_code == 200


MESSY: list[list[Any]] = [
    ["E1001", "Asha Rao", "asha@example.com", "Engineering", "Pune"],
    [" e2001 ", "Priya Nair", "", "Engineering", "Pune"],
    ["E1001", "Asha again", "", "", ""],  # duplicate
    ["", "No Id", "noid@example.com", "Sales", ""],  # empty ID
    ["E 3", "Space Id", "", "", ""],  # space inside
    ["E2004", "Arjun", "not-an-email", "Sales", "Delhi"],  # bad email
    [None, None, None, None, None],  # blank row: ignored
    ["X" * 31, "Too long", "", "", ""],
    [12345, "Number cell", "", "Finance", ""],  # Excel number -> "12345"
    ["00123", "Leading zeros", "", "Finance", ""],
]


async def test_messy_file_gives_the_right_counts_and_rows_to_fix(
    client: AsyncClient, engine: AsyncEngine, hr: Headers
) -> None:
    survey_id = await _survey(client, hr)

    response = await _upload(client, hr, survey_id, xlsx(MESSY))

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["status"] == "preview"
    assert (body["valid_count"], body["duplicate_count"], body["error_count"]) == (4, 1, 4)
    assert body["errors"] == [
        {"row": 5, "employee_id": "", "problem": "Employee ID is missing"},
        {"row": 6, "employee_id": "E 3", "problem": "Employee ID can't contain spaces"},
        {"row": 7, "employee_id": "E2004", "problem": "Email address isn't valid"},
        {"row": 9, "employee_id": "X" * 31, "problem": "Employee ID is longer than 30 characters"},
    ]
    assert body["errors_truncated"] is False


async def test_rows_to_fix_download(client: AsyncClient, engine: AsyncEngine, hr: Headers) -> None:
    survey_id = await _survey(client, hr)
    preview = (await _upload(client, hr, survey_id, xlsx(MESSY))).json()

    response = await client.get(
        f"/api/surveys/{survey_id}/audience/uploads/{preview['upload_id']}/errors.xlsx", headers=hr
    )

    assert response.status_code == 200
    assert "rows_to_fix.xlsx" in response.headers["content-disposition"]
    sheet = load_workbook(io.BytesIO(response.content)).active
    assert sheet is not None
    rows = list(sheet.iter_rows(values_only=True))
    assert rows[0] == ("Row", "EmployeeId", "Name", "Email", "Department", "Location", "Problem")
    assert rows[1][0] == 5
    assert rows[3][3] == "not-an-email"
    assert rows[3][6] == "Email address isn't valid"


async def test_template_download(client: AsyncClient, engine: AsyncEngine, hr: Headers) -> None:
    survey_id = await _survey(client, hr)

    response = await client.get(f"/api/surveys/{survey_id}/audience/template", headers=hr)

    workbook = load_workbook(io.BytesIO(response.content))
    assert workbook.sheetnames == ["Audience", "How to fill this in"]
    header = next(workbook["Audience"].iter_rows(values_only=True))
    assert header == ("EmployeeId", "Name", "Email", "Department", "Location")


async def test_apply_then_list_search_and_filter(
    client: AsyncClient, engine: AsyncEngine, hr: Headers
) -> None:
    survey_id = await _survey(client, hr)
    preview = (await _upload(client, hr, survey_id, xlsx(MESSY))).json()

    applied = await _apply(client, hr, survey_id, preview["upload_id"])
    again = await _apply(client, hr, survey_id, preview["upload_id"])
    listing = (await client.get(f"/api/surveys/{survey_id}/audience", headers=hr)).json()
    searched = (
        await client.get(f"/api/surveys/{survey_id}/audience?search=priya", headers=hr)
    ).json()
    finance = (
        await client.get(f"/api/surveys/{survey_id}/audience?department=Finance", headers=hr)
    ).json()

    assert applied.json() == {"audience_count": 4}
    assert again.status_code == 409
    assert listing["total"] == 4
    assert [m["employee_id"] for m in listing["items"]] == ["00123", "12345", "E1001", "E2001"]
    assert listing["departments"] == [
        {"department": "Engineering", "count": 2},
        {"department": "Finance", "count": 2},
    ]
    assert listing["can_replace"] is True
    assert [m["employee_id"] for m in searched["items"]] == ["E2001"]
    assert finance["matching"] == 2


async def test_append_counts_existing_people_as_duplicates(
    client: AsyncClient, engine: AsyncEngine, hr: Headers
) -> None:
    survey_id = await _survey(client, hr)
    await _add(client, hr, survey_id, [["E1"], ["E2"]])

    preview = (await _upload(client, hr, survey_id, xlsx([["e1"], ["E3"]]))).json()

    assert (preview["valid_count"], preview["duplicate_count"]) == (1, 1)


async def test_replace_swaps_the_list_before_publishing(
    client: AsyncClient, engine: AsyncEngine, hr: Headers
) -> None:
    survey_id = await _survey(client, hr)
    await _add(client, hr, survey_id, [["E1"], ["E2"]])

    preview = (await _upload(client, hr, survey_id, xlsx([["E3"]]), mode="replace")).json()
    await _apply(client, hr, survey_id, preview["upload_id"])

    listing = (await client.get(f"/api/surveys/{survey_id}/audience", headers=hr)).json()
    assert [m["employee_id"] for m in listing["items"]] == ["E3"]


async def test_replace_is_refused_after_publishing(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, gallery: list[str]
) -> None:
    survey_id = await _survey(client, hr)
    await _add(client, hr, survey_id, [["E1"]])
    assert (await client.post(f"/api/surveys/{survey_id}/publish", headers=hr)).status_code == 200

    response = await _upload(client, hr, survey_id, xlsx([["E9"]]), mode="replace")
    appended = await _upload(client, hr, survey_id, xlsx([["E9"]]), mode="append")

    assert response.status_code == 409
    assert "Append" in response.json()["error"]["message"]
    assert appended.status_code == 201


async def test_discard(client: AsyncClient, engine: AsyncEngine, hr: Headers) -> None:
    survey_id = await _survey(client, hr)
    preview = (await _upload(client, hr, survey_id, xlsx([["E1"]]))).json()

    discarded = await client.post(
        f"/api/surveys/{survey_id}/audience/uploads/{preview['upload_id']}/discard", headers=hr
    )
    applied = await _apply(client, hr, survey_id, preview["upload_id"])

    assert discarded.status_code == 204
    assert applied.status_code == 409
    listing = (await client.get(f"/api/surveys/{survey_id}/audience", headers=hr)).json()
    assert listing["total"] == 0


async def test_csv_with_bom_semicolons_and_other_header_names(
    client: AsyncClient, engine: AsyncEngine, hr: Headers
) -> None:
    survey_id = await _survey(client, hr)
    data = "﻿Employee ID;Full Name;Dept\r\ne10;Ten;Ops\r\nE11;Eleven;Ops\r\n".encode()

    preview = (await _upload(client, hr, survey_id, data, name="people.CSV")).json()
    await _apply(client, hr, survey_id, preview["upload_id"])

    listing = (await client.get(f"/api/surveys/{survey_id}/audience", headers=hr)).json()
    assert [(m["employee_id"], m["name"], m["department"]) for m in listing["items"]] == [
        ("E10", "Ten", "Ops"),
        ("E11", "Eleven", "Ops"),
    ]


@pytest.mark.parametrize(
    ("data", "name", "message"),
    [
        (b"Name,Email\nA,a@x.com\n", "a.csv", "The file needs an EmployeeId column."),
        (b"EmployeeId\n", "a.txt", "Upload an Excel (.xlsx) or CSV (.csv) file."),
        (b"not really excel", "a.xlsx", "This doesn't look like an Excel file."),
        (b"", "a.csv", "This file is empty."),
        (
            ("EmployeeId\n" + "".join(f"E{i}\n" for i in range(20_001))).encode(),
            "big.csv",
            "This file has more than 20,000 rows.",
        ),
    ],
)
async def test_unusable_files(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, data: bytes, name: str, message: str
) -> None:
    survey_id = await _survey(client, hr)

    response = await _upload(client, hr, survey_id, data, name=name)

    assert response.status_code == 422
    assert response.json()["error"]["message"].startswith(message)


async def test_remove_member_unless_they_responded(
    client: AsyncClient, engine: AsyncEngine, hr: Headers
) -> None:
    survey_id = await _survey(client, hr)
    await _add(client, hr, survey_id, [["E1"], ["E2"]])
    async with engine.begin() as conn:
        await conn.execute(
            text(
                "INSERT INTO survey_participation (survey_id, employee_id, status) "
                "VALUES (:id, 'E2', 'submitted')"
            ),
            {"id": survey_id},
        )

    removed = await client.delete(f"/api/surveys/{survey_id}/audience/e1", headers=hr)
    refused = await client.delete(f"/api/surveys/{survey_id}/audience/E2", headers=hr)
    missing = await client.delete(f"/api/surveys/{survey_id}/audience/E1", headers=hr)

    assert removed.status_code == 204
    assert refused.status_code == 409
    assert refused.json()["error"]["message"] == (
        "They've already responded, so they can't be removed."
    )
    assert missing.status_code == 404
    listing = (await client.get(f"/api/surveys/{survey_id}/audience", headers=hr)).json()
    assert listing["items"][0]["responded"] is True


async def test_publish_needs_an_audience_or_open_to_all(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, gallery: list[str]
) -> None:
    survey_id = await _survey(client, hr)

    blocked = await client.post(f"/api/surveys/{survey_id}/publish", headers=hr)
    opened = await client.put(
        f"/api/surveys/{survey_id}/audience/open-to-all", headers=hr, json={"open_to_all": True}
    )
    listing = (await client.get(f"/api/surveys/{survey_id}/audience", headers=hr)).json()
    published = await client.post(f"/api/surveys/{survey_id}/publish", headers=hr)

    assert blocked.status_code == 422
    assert blocked.json()["error"]["details"]["issues"][0]["code"] == "audience_empty"
    assert opened.json() == {"open_to_all": True}
    assert listing["open_to_all"] is True
    assert published.status_code == 200


async def test_small_anonymous_audience_is_a_warning(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, gallery: list[str]
) -> None:
    draft = {**PULSE, "settings": {**PULSE["settings"], "anonymous": True}}
    survey_id = await _survey(client, hr, draft)
    await _add(client, hr, survey_id, [["E1"], ["E2"], ["E3"]])

    result = (await client.post(f"/api/surveys/{survey_id}/validate", headers=hr)).json()

    assert result["issues"] == []
    assert [w["code"] for w in result["warnings"]] == ["audience_small_anonymous"]
    assert result["warnings"][0]["message"].startswith("Only 3 people are in the audience.")


async def test_audience_permissions(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, other_hr: Headers
) -> None:
    survey_id = await _survey(client, hr)

    assert (await _upload(client, other_hr, survey_id, xlsx([["E1"]]))).status_code == 404
    async with engine.begin() as conn:
        await conn.execute(
            text("INSERT INTO survey_members VALUES (:id, 'E1003', 'viewer')"), {"id": survey_id}
        )
    assert (await _upload(client, other_hr, survey_id, xlsx([["E1"]]))).status_code == 403
    assert (
        await client.get(f"/api/surveys/{survey_id}/audience", headers=other_hr)
    ).status_code == 200
