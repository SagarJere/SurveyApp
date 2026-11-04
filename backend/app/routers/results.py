"""Survey results (docs/04-api.md, "Results")."""

import re
import uuid
from datetime import UTC, date, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request, Response, status

from app.auth.deps import CurrentUser
from app.config import Settings
from app.db import SessionDep
from app.errors import AppError, ErrorResponse
from app.schemas.results import (
    Comments,
    Participation,
    QuestionsResult,
    ResponseDetail,
    ResponsesPage,
    Summary,
    Timeline,
)
from app.services import results as service
from app.services import surveys as survey_service
from app.services.exports import build_export, export_filename, non_responders_workbook
from app.services.results_cache import results_cache

router = APIRouter(prefix="/surveys/{survey_id}/results", tags=["results"])

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
_ANSWER_PARAM = re.compile(r"^q_([0-9a-fA-F-]{36})$")
_ERRORS: dict[int | str, dict[str, object]] = {
    status.HTTP_403_FORBIDDEN: {"model": ErrorResponse},
    status.HTTP_404_NOT_FOUND: {"model": ErrorResponse},
    status.HTTP_409_CONFLICT: {"model": ErrorResponse},
}


def _bad(message: str) -> AppError:
    return AppError(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, code="VALIDATION_FAILED", message=message
    )


def parse_filters(request: Request) -> service.Filters:
    """department, location, from, to (YYYY-MM-DD), version, and q_<question key>=<option key>.

    An empty department or location means "no department" / "no location".
    """
    params = request.query_params

    def day(name: str) -> date | None:
        value = params.get(name)
        if not value:
            return None
        try:
            return date.fromisoformat(value)
        except ValueError:
            raise _bad(f"'{name}' must be a date like 2026-11-24.") from None

    version = params.get("version")
    if version and not version.isdigit():
        raise _bad("'version' must be a version number.")
    answers: list[tuple[str, str]] = []
    for name, value in params.items():
        match = _ANSWER_PARAM.match(name)
        if not match:
            continue
        try:
            answers.append((str(uuid.UUID(match.group(1))), str(uuid.UUID(value))))
        except ValueError:
            raise _bad(f"'{name}' must be an option key.") from None
    return service.Filters(
        department=params.get("department"),
        location=params.get("location"),
        date_from=day("from"),
        date_to=day("to"),
        version=int(version) if version else None,
        answers=tuple(sorted(answers)),
    )


FiltersDep = Annotated[service.Filters, Depends(parse_filters)]


async def _scope(
    request: Request,
    session: SessionDep,
    user: CurrentUser,
    survey_id: uuid.UUID,
    filters: service.Filters,
    *,
    need: survey_service.Need = "view",
) -> tuple[service.Scope, survey_service.SurveyAccess]:
    access = await survey_service.get_access(session, user, survey_id, need)
    if access.survey.current_version_id is None:
        raise AppError(
            status_code=status.HTTP_409_CONFLICT,
            code="NOT_PUBLISHED",
            message="This survey hasn't been published yet, so there are no results.",
        )
    settings: Settings = request.app.state.settings
    scope = await service.build_scope(session, settings, access.survey, filters)
    if filters.version and filters.version not in {v["version_no"] for v in scope.versions}:
        raise _bad("That version doesn't exist.")
    return scope, access


def _cache_key(name: str, scope: service.Scope, *extra: Any) -> tuple[Any, ...]:
    return (name, scope.version_applied, *scope.filters.cache_key(), *extra)


@router.get("/summary", response_model=Summary, responses=_ERRORS)
async def summary(
    survey_id: uuid.UUID,
    request: Request,
    user: CurrentUser,
    session: SessionDep,
    filters: FiltersDep,
) -> Summary:
    scope, access = await _scope(request, session, user, survey_id, filters)

    async def compute() -> dict[str, Any]:
        data = await service.summary(session, scope)
        data["filter_options"] = await service.filter_options(session, survey_id)
        return data

    data = await results_cache.get_or_compute(survey_id, _cache_key("summary", scope), compute)
    settings = scope.version.content["settings"]
    return Summary(
        **data,
        title=scope.version.content["title"],
        status=access.survey.status,  # type: ignore[arg-type]
        anonymous=scope.anonymous,
        open_to_all=access.survey.open_to_all,
        versions=scope.versions,  # type: ignore[arg-type]
        compatible_versions=scope.compatible,
        version_applied=scope.version_applied,
        can_download_non_responders=access.can_edit and not access.survey.open_to_all,
        closes_at=date.fromisoformat(settings["closes_at"]) if settings.get("closes_at") else None,
    )


@router.get("/timeline", response_model=Timeline, responses=_ERRORS)
async def timeline(
    survey_id: uuid.UUID,
    request: Request,
    user: CurrentUser,
    session: SessionDep,
    filters: FiltersDep,
) -> Timeline:
    scope, _ = await _scope(request, session, user, survey_id, filters)
    data = await results_cache.get_or_compute(
        survey_id, _cache_key("timeline", scope), lambda: service.timeline(session, scope)
    )
    return Timeline(**data)


@router.get("/participation", response_model=Participation, responses=_ERRORS)
async def participation(
    survey_id: uuid.UUID,
    request: Request,
    user: CurrentUser,
    session: SessionDep,
    filters: FiltersDep,
) -> Participation:
    scope, _ = await _scope(request, session, user, survey_id, filters)
    data = await results_cache.get_or_compute(
        survey_id, _cache_key("participation", scope), lambda: service.participation(session, scope)
    )
    return Participation(**data)


@router.get("/questions", response_model=QuestionsResult, responses=_ERRORS)
async def questions(
    survey_id: uuid.UUID,
    request: Request,
    user: CurrentUser,
    session: SessionDep,
    filters: FiltersDep,
) -> QuestionsResult:
    scope, _ = await _scope(request, session, user, survey_id, filters)
    data = await results_cache.get_or_compute(
        survey_id, _cache_key("questions", scope), lambda: service.questions(session, scope)
    )
    return QuestionsResult(**data)


@router.get("/comments", response_model=Comments, responses=_ERRORS)
async def comments(
    survey_id: uuid.UUID,
    request: Request,
    user: CurrentUser,
    session: SessionDep,
    filters: FiltersDep,
    *,
    question_key: Annotated[uuid.UUID | None, Query()] = None,
    search: Annotated[str | None, Query(max_length=100)] = None,
    page: Annotated[int, Query(ge=1, le=10_000)] = 1,
) -> Comments:
    scope, _ = await _scope(request, session, user, survey_id, filters)
    key = str(question_key) if question_key else None
    data = await results_cache.get_or_compute(
        survey_id,
        _cache_key("comments", scope, key, search, page),
        lambda: service.comments(session, scope, question_key=key, search=search, page=page),
    )
    return Comments(**data)


def _refuse_anonymous(scope: service.Scope) -> None:
    if scope.anonymous:
        raise AppError(
            status_code=status.HTTP_403_FORBIDDEN,
            message="Individual responses aren't available for anonymous surveys.",
        )


@router.get("/responses", response_model=ResponsesPage, responses=_ERRORS)
async def responses(
    survey_id: uuid.UUID,
    request: Request,
    user: CurrentUser,
    session: SessionDep,
    filters: FiltersDep,
    *,
    page: Annotated[int, Query(ge=1, le=10_000)] = 1,
) -> ResponsesPage:
    scope, _ = await _scope(request, session, user, survey_id, filters)
    _refuse_anonymous(scope)
    return ResponsesPage(**await service.responses_list(session, scope, page=page))


@router.get("/responses/{response_id}", response_model=ResponseDetail, responses=_ERRORS)
async def response_detail(
    survey_id: uuid.UUID,
    response_id: uuid.UUID,
    request: Request,
    user: CurrentUser,
    session: SessionDep,
) -> ResponseDetail:
    scope, _ = await _scope(request, session, user, survey_id, service.Filters())
    _refuse_anonymous(scope)
    detail = await service.response_detail(session, scope, response_id)
    if detail is None:
        raise AppError(status_code=status.HTTP_404_NOT_FOUND, message="That response wasn't found.")
    return ResponseDetail(**detail)


def _xlsx(data: bytes, filename: str) -> Response:
    ascii_name = filename.encode("ascii", "ignore").decode() or "export.xlsx"
    return Response(
        content=data,
        media_type=XLSX,
        headers={"Content-Disposition": f'attachment; filename="{ascii_name}"'},
    )


@router.get("/non-responders.xlsx", response_class=Response, responses=_ERRORS)
async def non_responders(
    survey_id: uuid.UUID,
    request: Request,
    user: CurrentUser,
    session: SessionDep,
    filters: FiltersDep,
) -> Response:
    scope, access = await _scope(request, session, user, survey_id, filters, need="edit")
    if access.survey.open_to_all:
        raise AppError(
            status_code=status.HTTP_409_CONFLICT,
            message="This survey is open to all employees, so there's no list of who was invited.",
        )
    rows = await service.non_responders(session, scope)
    title = scope.version.content["title"] or "Survey"
    return _xlsx(
        non_responders_workbook(rows),
        export_filename(title, datetime.now(UTC), "not yet responded"),
    )


def _filters_text(filters: service.Filters, scope: service.Scope) -> str:
    parts = []
    if filters.department is not None:
        parts.append(f"Department: {filters.department or 'No department'}")
    if filters.location is not None:
        parts.append(f"Location: {filters.location or 'No location'}")
    if filters.date_from or filters.date_to:
        parts.append(f"Dates: {filters.date_from or '…'} to {filters.date_to or '…'}")
    if scope.version_applied:
        parts.append(f"Version {scope.version_applied}")
    if filters.answers:
        parts.append(f"{len(filters.answers)} answer filter(s)")
    return ", ".join(parts) or "None"


@router.get("/export.xlsx", response_class=Response, responses=_ERRORS)
async def export(
    survey_id: uuid.UUID,
    request: Request,
    user: CurrentUser,
    session: SessionDep,
    filters: FiltersDep,
) -> Response:
    scope, _ = await _scope(request, session, user, survey_id, filters)
    summary_data = await service.summary(session, scope)
    data: dict[str, Any] = {
        "title": scope.version.content["title"] or "Survey",
        "exported_at": datetime.now(UTC),
        "filters_text": _filters_text(filters, scope),
        "summary": summary_data,
        "anonymous": scope.anonymous,
        "question_list": [
            {**q, "number": i} for i, q in enumerate(scope.version.content["questions"], start=1)
        ],
    }
    if not summary_data["small_group"]:
        data["questions"] = await service.questions(session, scope)
        data["responses"] = await service.all_responses(session, scope)
        data["answers"] = await service.all_answers(session, scope)
        data["comments"] = await service.text_answers_for_export(session, scope)
    return _xlsx(build_export(data), export_filename(data["title"], data["exported_at"], "results"))
