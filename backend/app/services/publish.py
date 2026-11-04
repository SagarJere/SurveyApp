"""Publishing and closing surveys (docs/01-requirements.md, Survey lifecycle).

Publish validates the saved draft and copies it into new, read-only version rows. Keys are
copied unchanged, so version 2 has the same question and option keys as version 1.
"""

import uuid
from dataclasses import asdict
from typing import Any

from fastapi import status
from sqlalchemy import func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import AppError
from app.models import QuestionOption, Survey, SurveyVersion, VersionQuestion, VersionSection
from app.schemas.draft import Draft
from app.services.audience import audience_count
from app.services.results_cache import results_cache
from app.services.survey_logic import Issue, validate_draft
from app.services.surveys import SurveyAccess
from app.services.theme_assets import usable_asset_ids

CHOICE_TYPES = frozenset({"single", "multi", "dropdown"})


async def theme_issues(session: AsyncSession, survey_id: uuid.UUID, draft: Draft) -> list[Issue]:
    """Theme images must still exist and belong to the gallery or this survey."""
    theme = draft.theme
    usable = await usable_asset_ids(session, survey_id)
    issues: list[Issue] = []
    if theme.cover is not None and theme.cover not in usable:
        issues.append(
            Issue("theme_image_missing", "The cover image is no longer available. Choose another.")
        )
    if theme.background_style == "image" and (
        theme.background is None or theme.background not in usable
    ):
        issues.append(
            Issue(
                "theme_image_missing",
                "The page background image is no longer available. Choose another.",
            )
        )
    return issues


SMALL_ANONYMOUS_AUDIENCE = 10


async def audience_issues(session: AsyncSession, survey: Survey) -> list[Issue]:
    if survey.open_to_all or await audience_count(session, survey.id) > 0:
        return []
    return [
        Issue(
            "audience_empty",
            "Add people to the audience, or open the survey to all employees.",
        )
    ]


async def publish_warnings(session: AsyncSession, survey: Survey) -> list[Issue]:
    """Things worth knowing that don't block publishing."""
    draft = Draft.model_validate(survey.draft)
    if not draft.settings.anonymous or survey.open_to_all:
        return []
    count = await audience_count(session, survey.id)
    if 0 < count < SMALL_ANONYMOUS_AUDIENCE:
        return [
            Issue(
                "audience_small_anonymous",
                f"Only {count} {'person is' if count == 1 else 'people are'} in the audience. "
                "With anonymous responses, answers from a group this small may be easy to "
                "identify.",
            )
        ]
    return []


async def publish_issues(session: AsyncSession, survey: Survey) -> list[Issue]:
    draft = Draft.model_validate(survey.draft)
    return [
        *validate_draft(draft.as_logic_dict()),
        *await theme_issues(session, survey.id, draft),
        *await audience_issues(session, survey),
    ]


def _issues_error(issues: list[Issue]) -> AppError:
    count = len(issues)
    first = issues[0].message
    return AppError(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        code="VALIDATION_FAILED",
        message=f"Fix {count} issue{'s' if count > 1 else ''} before publishing. {first}",
        details={"issues": [asdict(issue) for issue in issues]},
    )


async def current_version_no(session: AsyncSession, survey: Survey) -> int | None:
    if survey.current_version_id is None:
        return None
    return await session.scalar(
        select(SurveyVersion.version_no).where(SurveyVersion.id == survey.current_version_id)
    )


async def publish(session: AsyncSession, access: SurveyAccess, published_by: str) -> SurveyVersion:
    # Lock the survey row so two publishes can't race for the same version number.
    survey = await session.scalar(
        select(Survey).where(Survey.id == access.survey.id).with_for_update()
    )
    if survey is None:
        raise AppError(
            status_code=status.HTTP_404_NOT_FOUND, message="We couldn't find that survey."
        )
    if survey.status == "closed":
        raise AppError(
            status_code=status.HTTP_409_CONFLICT,
            message="This survey is closed, so it can't be published again.",
        )
    if survey.status == "published" and not survey.has_unpublished_changes:
        raise AppError(
            status_code=status.HTTP_409_CONFLICT, message="There are no changes to publish."
        )

    issues = await publish_issues(session, survey)
    if issues:
        await session.rollback()
        raise _issues_error(issues)

    draft = Draft.model_validate(survey.draft)
    data: dict[str, Any] = draft.model_dump(mode="json")
    next_no = (
        await session.scalar(
            select(func.coalesce(func.max(SurveyVersion.version_no), 0)).where(
                SurveyVersion.survey_id == survey.id
            )
        )
        or 0
    ) + 1

    version_id = uuid.uuid4()
    await session.execute(
        insert(SurveyVersion).values(
            id=version_id,
            survey_id=survey.id,
            version_no=next_no,
            title=draft.title,
            description=draft.description,
            settings=data["settings"],
            theme=data["theme"],
            published_by=published_by,
        )
    )

    # Bulk inserts in dependency order: sections, then questions, then options.
    section_ids = {section["key"]: uuid.uuid4() for section in data["sections"]}
    await session.execute(
        insert(VersionSection),
        [
            {
                "id": section_ids[section["key"]],
                "version_id": version_id,
                "key": uuid.UUID(section["key"]),
                "sort_order": order,
                "title": section["title"],
                "description": section["description"],
                "condition": section["condition"],
            }
            for order, section in enumerate(data["sections"])
        ],
    )
    question_rows: list[dict[str, Any]] = []
    option_rows: list[dict[str, Any]] = []
    for order, question in enumerate(data["questions"]):
        question_id = uuid.uuid4()
        is_money = question["type"] == "money"
        question_rows.append(
            {
                "id": question_id,
                "version_id": version_id,
                "section_id": section_ids[question["section_key"]],
                "key": uuid.UUID(question["key"]),
                "sort_order": order,
                "type": question["type"],
                "text": question["text"],
                "help": question["help"],
                "required": question["required"],
                # Only money settings matter in a published version.
                "config": question["config"] if is_money else {},
                "condition": question["condition"],
            }
        )
        if question["type"] in CHOICE_TYPES:
            option_rows.extend(
                {
                    "question_id": question_id,
                    "key": uuid.UUID(option["key"]),
                    "sort_order": option_order,
                    "label": option["label"].strip(),
                }
                for option_order, option in enumerate(question["options"])
            )
    if question_rows:
        await session.execute(insert(VersionQuestion), question_rows)
    if option_rows:
        await session.execute(insert(QuestionOption), option_rows)

    await session.execute(
        update(Survey)
        .where(Survey.id == survey.id)
        .values(
            status="published",
            current_version_id=version_id,
            has_unpublished_changes=False,
            updated_at=func.clock_timestamp(),
        )
    )
    await session.commit()
    results_cache.invalidate(survey.id)
    version = await session.get(SurveyVersion, version_id)
    assert version is not None  # noqa: S101 - inserted above
    return version


async def close(session: AsyncSession, access: SurveyAccess) -> Survey:
    survey = access.survey
    if survey.status == "draft":
        raise AppError(
            status_code=status.HTTP_409_CONFLICT,
            message="Only published surveys can be closed. This one is still a draft.",
        )
    if survey.status == "closed":
        raise AppError(
            status_code=status.HTTP_409_CONFLICT, message="This survey is already closed."
        )
    await session.execute(
        update(Survey)
        .where(Survey.id == survey.id)
        .values(
            status="closed", closed_at=func.clock_timestamp(), updated_at=func.clock_timestamp()
        )
    )
    await session.commit()
    await session.refresh(survey)
    return survey
