"""Phase T1: trainings, video sections, video uploads and streaming, watch rules on submit."""

import uuid
from collections.abc import Callable
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from app.config import Settings
from app.schemas.draft import Draft
from app.services.storage import LocalFileStorage
from app.services.videos import sniff_video_type, video_issues
from app.tests.conftest import bearer

Headers = dict[str, str]

# The first bytes of real files: an MP4 ("ftyp" box, brand isom) and a WebM (EBML + "webm").
MP4_HEAD = b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isomiso2"
WEBM_HEAD = b"\x1a\x45\xdf\xa3\x9f\x42\x86\x81\x01\x42\xf7\x81\x01\x42\xf2\x81\x04\x42\x82\x84webm"
MOV_HEAD = b"\x00\x00\x00\x14ftypqt  \x00\x00\x02\x00qt  "


def mp4(size: int = 4096) -> bytes:
    body = bytes(i % 251 for i in range(size - len(MP4_HEAD)))
    return MP4_HEAD + body


def today() -> date:
    return datetime.now(ZoneInfo("Asia/Kolkata")).date()


S1, S2 = str(uuid.uuid4()), str(uuid.uuid4())
Q1, Q2, Q3 = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())


def training_draft(
    upload_id: str | None, link: str = "https://videos.example/fire.mp4"
) -> dict[str, Any]:
    return {
        "title": "Fire safety basics",
        "description": "",
        "settings": {
            "layout": "all",
            "opens_at": (today() - timedelta(days=1)).isoformat(),
            "closes_at": (today() + timedelta(days=7)).isoformat(),
            "anonymous": True,  # ignored: trainings are never anonymous
            "allow_edit": True,  # ignored too
        },
        "sections": [
            {
                "key": S1,
                "title": "Preventing fires",
                "description": "",
                "condition": None,
                "video": {"source": "upload", "asset_id": upload_id, "allow_seek": False},
            },
            {
                "key": S2,
                "title": "Using an extinguisher",
                "description": "",
                "condition": None,
                "video": {"source": "link", "url": link, "allow_speed": True},
            },
        ],
        "questions": [
            {
                "key": Q1,
                "section_key": S1,
                "type": "short",
                "text": "What should you do first?",
                "required": True,
            },
            {
                "key": Q2,
                "section_key": S1,
                "type": "short",
                "text": "Anything else?",
                "required": False,
            },
            {
                "key": Q3,
                "section_key": S2,
                "type": "short",
                "text": "What does PASS stand for?",
                "required": False,
            },
        ],
    }


@pytest.fixture
def hr(token_for: Callable[..., str]) -> Headers:
    return bearer(token_for("E1002", "hr"))


@pytest.fixture
def person(token_for: Callable[..., str]) -> Callable[[str], Headers]:
    return lambda employee_id: bearer(token_for(employee_id, "employee", f"Person {employee_id}"))


async def create_training(client: AsyncClient, hr: Headers) -> dict[str, Any]:
    response = await client.post("/api/surveys", headers=hr, json={"kind": "training"})
    assert response.status_code == 201, response.text
    return dict(response.json())


async def upload(
    client: AsyncClient, hr: Headers, survey_id: str, data: bytes, name: str = "fire.mp4"
) -> Any:
    return await client.post(
        f"/api/surveys/{survey_id}/videos",
        headers=hr,
        files={"file": (name, data, "video/mp4")},
        data={"duration_seconds": "512"},
    )


async def save(
    client: AsyncClient, hr: Headers, survey: dict[str, Any], draft: dict[str, Any]
) -> Any:
    current = (await client.get(f"/api/surveys/{survey['id']}", headers=hr)).json()
    return await client.put(
        f"/api/surveys/{survey['id']}/draft",
        headers=hr,
        json={"draft": draft, "draft_updated_at": current["draft_updated_at"]},
    )


async def published_training(client: AsyncClient, hr: Headers) -> tuple[str, str]:
    survey = await create_training(client, hr)
    video = (await upload(client, hr, survey["id"], mp4())).json()
    assert (await save(client, hr, survey, training_draft(video["id"]))).status_code == 200
    await client.put(
        f"/api/surveys/{survey['id']}/audience/open-to-all",
        headers=hr,
        json={"open_to_all": True},
    )
    published = await client.post(f"/api/surveys/{survey['id']}/publish", headers=hr)
    assert published.status_code == 200, published.text
    return survey["id"], video["id"]


# --- trainings as a kind of survey ------------------------------------------------------------


async def test_trainings_are_listed_apart_and_never_anonymous(
    client: AsyncClient, engine: AsyncEngine, hr: Headers
) -> None:
    survey = (await client.post("/api/surveys", headers=hr)).json()
    training = await create_training(client, hr)
    video = (await upload(client, hr, training["id"], mp4())).json()
    saved = await save(client, hr, training, training_draft(video["id"]))

    surveys = (await client.get("/api/surveys", headers=hr)).json()
    trainings = (await client.get("/api/surveys?kind=training", headers=hr)).json()
    stored = (await client.get(f"/api/surveys/{training['id']}", headers=hr)).json()

    assert saved.status_code == 200, saved.text
    assert [s["id"] for s in surveys] == [survey["id"]]
    assert [t["id"] for t in trainings] == [training["id"]]
    assert trainings[0]["kind"] == "training"
    assert stored["kind"] == "training"
    assert stored["draft"]["settings"]["anonymous"] is False
    assert stored["draft"]["settings"]["allow_edit"] is False
    assert stored["draft"]["sections"][0]["video"]["asset_id"] == video["id"]


async def test_only_trainings_have_videos(
    client: AsyncClient, engine: AsyncEngine, hr: Headers
) -> None:
    survey = (await client.post("/api/surveys", headers=hr)).json()
    saved = await save(client, hr, survey, training_draft(None))
    uploaded = await upload(client, hr, survey["id"], mp4())

    assert saved.status_code == 422
    assert saved.json()["error"]["message"] == "Only trainings can have videos."
    assert uploaded.status_code == 409


# --- uploads ----------------------------------------------------------------------------------


def test_videos_are_recognised_by_their_first_bytes() -> None:
    assert sniff_video_type(MP4_HEAD) == "video/mp4"
    assert sniff_video_type(WEBM_HEAD) == "video/webm"
    assert sniff_video_type(MOV_HEAD) is None  # QuickTime: most browsers can't play it
    assert sniff_video_type(b"Hello, this is a text file") is None
    assert sniff_video_type(b"\x1a\x45\xdf\xa3matroska") is None  # MKV, not WebM


@pytest.mark.parametrize(
    ("data", "name"),
    [
        (b"just some text pretending to be a video", "notes.mp4"),
        (MOV_HEAD + bytes(100), "phone.mov"),
    ],
)
async def test_files_that_are_not_mp4_or_webm_are_refused(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, data: bytes, name: str
) -> None:
    training = await create_training(client, hr)
    response = await upload(client, hr, training["id"], data, name)

    assert response.status_code == 422
    assert response.json()["error"]["message"] == (
        "That file isn't an MP4 or WebM video. Convert it to MP4 and try again."
    )


async def test_videos_over_the_size_limit_are_refused(
    app: FastAPI, client: AsyncClient, engine: AsyncEngine, hr: Headers, settings: Settings
) -> None:
    # VIDEO_MAX_MB=1 stands in for the 200 MB default: the same rule, with a 1 MB file.
    app.state.settings = settings.model_copy(update={"video_max_mb": 1})
    training = await create_training(client, hr)

    too_big = await upload(client, hr, training["id"], mp4(1024 * 1024 + 1))
    just_fits = await upload(client, hr, training["id"], mp4(1024 * 1024))

    assert too_big.status_code == 413
    assert too_big.json()["error"]["message"] == "That video is 1 MB. Use one up to 1 MB."
    assert just_fits.status_code == 201
    assert just_fits.json()["size_bytes"] == 1024 * 1024


async def test_uploaded_videos_stream_with_range_requests(
    client: AsyncClient, engine: AsyncEngine, hr: Headers
) -> None:
    training = await create_training(client, hr)
    data = mp4(10_000)
    video = (await upload(client, hr, training["id"], data)).json()

    whole = await client.get(video["url"])
    part = await client.get(video["url"], headers={"Range": "bytes=100-199"})
    forged = await client.get(video["url"][:-1] + ("0" if video["url"][-1] != "0" else "1"))

    assert video["content_type"] == "video/mp4"
    assert video["duration_seconds"] == 512
    assert whole.status_code == 200
    assert whole.content == data
    assert whole.headers["content-type"] == "video/mp4"
    assert part.status_code == 206
    assert part.content == data[100:200]
    assert part.headers["content-range"] == f"bytes 100-199/{len(data)}"
    assert forged.status_code == 403


async def test_videos_used_by_a_published_version_cannot_be_deleted(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, settings: Settings
) -> None:
    survey_id, video_id = await published_training(client, hr)
    spare = await create_training(client, hr)
    unused = (await upload(client, hr, spare["id"], mp4())).json()

    in_use = await client.delete(f"/api/surveys/{survey_id}/videos/{video_id}", headers=hr)
    removed = await client.delete(f"/api/surveys/{spare['id']}/videos/{unused['id']}", headers=hr)
    listed = (await client.get(f"/api/surveys/{survey_id}/videos", headers=hr)).json()

    assert in_use.status_code == 409
    assert removed.status_code == 204
    assert listed[0]["published"] is True


async def test_duplicating_a_training_copies_its_videos_and_deleting_removes_files(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, settings: Settings
) -> None:
    storage = LocalFileStorage(settings.file_storage_path)
    training = await create_training(client, hr)
    video = (await upload(client, hr, training["id"], mp4())).json()
    await save(client, hr, training, training_draft(video["id"]))

    copy = (await client.post(f"/api/surveys/{training['id']}/duplicate", headers=hr)).json()
    copied_id = copy["draft"]["sections"][0]["video"]["asset_id"]
    async with engine.connect() as conn:
        rows = (await conn.execute(text("SELECT id::text, path FROM video_assets"))).all()
    paths: dict[str, str] = {row[0]: row[1] for row in rows}

    assert copy["kind"] == "training"
    assert copied_id not in (None, video["id"])
    assert storage.exists(paths[copied_id])

    deleted = await client.delete(f"/api/surveys/{training['id']}", headers=hr)
    assert deleted.status_code == 204
    assert not storage.exists(paths[video["id"]])
    assert storage.exists(paths[copied_id])  # the copy keeps its own file


# --- publishing ----------------------------------------------------------------------------


async def test_publish_needs_each_video_to_be_there(
    client: AsyncClient, engine: AsyncEngine, hr: Headers
) -> None:
    training = await create_training(client, hr)
    await save(client, hr, training, training_draft(str(uuid.uuid4()), link=""))

    issues = (await client.post(f"/api/surveys/{training['id']}/validate", headers=hr)).json()

    assert [
        (i["code"], i["message"]) for i in issues["issues"] if i["code"] == "video_missing"
    ] == [
        ("video_missing", "Preventing fires: upload its video, or remove it."),
        ("video_missing", "Using an extinguisher: add the video's address."),
    ]


async def test_secure_sites_need_https_video_links(
    app: FastAPI, client: AsyncClient, engine: AsyncEngine, settings: Settings
) -> None:
    draft = Draft.model_validate(training_draft(None, link="http://videos.intranet/fire.mp4"))
    draft.sections = draft.sections[1:]
    secure = settings.model_copy(update={"app_env": "production"})
    async with app.state.sessionmaker() as session:
        dev = await video_issues(session, settings, uuid.uuid4(), draft)
        prod = await video_issues(session, secure, uuid.uuid4(), draft)

    assert dev == []
    assert [i.message for i in prod] == [
        "Using an extinguisher: the video address must start with https:// "
        "(browsers block http:// videos on a secure site)."
    ]


# --- taking a training ------------------------------------------------------------------------


async def test_respondents_get_playable_videos_but_not_their_settings(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, person: Callable[[str], Headers]
) -> None:
    survey_id, video_id = await published_training(client, hr)

    body = (await client.get(f"/api/respond/{survey_id}", headers=person("W1"))).json()

    assert body["kind"] == "training"
    assert body["settings"]["anonymous"] is False
    assert all("video" not in section for section in body["sections"])
    assert body["videos"][S1]["url"].startswith(f"/api/files/videos/{video_id}?exp=")
    assert body["videos"][S1]["allow_seek"] is False
    assert body["videos"][S1]["duration_seconds"] == 512
    assert body["videos"][S2] == {
        "url": "https://videos.example/fire.mp4",
        "allow_seek": False,
        "allow_speed": True,
        "duration_seconds": None,
    }
    assert body["video_progress"] == {}


async def test_progress_only_moves_forward_and_finishing_sticks(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, person: Callable[[str], Headers]
) -> None:
    survey_id, _ = await published_training(client, hr)
    url = f"/api/respond/{survey_id}/videos/{S1}"
    who = person("W1")

    first = (await client.put(url, headers=who, json={"furthest_seconds": 120})).json()
    back = (await client.put(url, headers=who, json={"furthest_seconds": 30})).json()
    done = (
        await client.put(url, headers=who, json={"furthest_seconds": 512, "completed": True})
    ).json()
    again = (
        await client.put(url, headers=who, json={"furthest_seconds": 10, "completed": False})
    ).json()
    body = (await client.get(f"/api/respond/{survey_id}", headers=who)).json()
    missing = await client.put(
        f"/api/respond/{survey_id}/videos/{uuid.uuid4()}", headers=who, json={"furthest_seconds": 1}
    )

    assert first == {"furthest_seconds": 120, "completed": False}
    assert back == {"furthest_seconds": 120, "completed": False}
    assert done == {"furthest_seconds": 512, "completed": True}
    assert again == {"furthest_seconds": 512, "completed": True}
    assert body["video_progress"][S1] == {"furthest_seconds": 512, "completed": True}
    assert missing.status_code == 404


async def test_answers_wait_for_the_video(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, person: Callable[[str], Headers]
) -> None:
    survey_id, _ = await published_training(client, hr)
    who = person("W1")
    submit_url = f"/api/respond/{survey_id}/submit"

    # A tampered client answers before watching: refused, per question.
    early = await client.post(
        submit_url, headers=who, json={"answers": {Q1: "Raise the alarm", Q3: "Pull"}}
    )
    early_problems = {
        i["question_key"]: i["message"] for i in early.json()["error"]["details"]["issues"]
    }

    await client.put(
        f"/api/respond/{survey_id}/videos/{S1}",
        headers=who,
        json={"furthest_seconds": 512, "completed": True},
    )
    half = await client.post(
        submit_url, headers=who, json={"answers": {Q1: "Raise the alarm", Q3: "Pull"}}
    )

    await client.put(
        f"/api/respond/{survey_id}/videos/{S2}",
        headers=who,
        json={"furthest_seconds": 250, "completed": True},
    )
    done = await client.post(
        submit_url, headers=who, json={"answers": {Q1: "Raise the alarm", Q3: "Pull"}}
    )

    watch = "Watch this section's video to the end before answering."
    assert early.status_code == 422
    assert early_problems == {Q1: watch, Q3: watch}  # Q2 is optional and empty: no problem
    assert half.status_code == 422
    assert [i["question_key"] for i in half.json()["error"]["details"]["issues"]] == [Q3]
    assert done.status_code == 200, done.text


async def test_my_trainings_lists_trainings_with_video_progress(
    client: AsyncClient, engine: AsyncEngine, hr: Headers, person: Callable[[str], Headers]
) -> None:
    survey_id, _ = await published_training(client, hr)
    who = person("W1")
    await client.put(
        f"/api/respond/{survey_id}/videos/{S1}",
        headers=who,
        json={"furthest_seconds": 512, "completed": True},
    )

    trainings = (await client.get("/api/me/trainings", headers=who)).json()
    surveys = (await client.get("/api/me/surveys", headers=who)).json()

    assert [t["id"] for t in trainings] == [survey_id]
    assert (trainings[0]["videos_total"], trainings[0]["videos_done"]) == (2, 1)
    assert surveys == []
