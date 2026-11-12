"""A published version as plain data: the draft's JSON shape (for services.survey_logic and
the respondent form) plus the database IDs needed to store answers."""

import uuid
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import QuestionOption, SurveyVersion, VersionQuestion, VersionSection


@dataclass(frozen=True, slots=True)
class QuestionRef:
    id: uuid.UUID
    key: str
    type: str
    required: bool
    config: dict[str, Any]
    option_ids: dict[str, uuid.UUID]  # option key -> option row id, in display order


@dataclass(frozen=True, slots=True)
class VersionContent:
    version: SurveyVersion
    content: dict[str, Any]  # title, description, settings, theme, sections, questions
    questions: dict[str, QuestionRef] = field(default_factory=dict)

    @property
    def logic(self) -> Any:
        """The DraftDict shape services.survey_logic expects."""
        return self.content


async def load_version(session: AsyncSession, version_id: uuid.UUID) -> VersionContent:
    version = await session.get(SurveyVersion, version_id)
    if version is None:
        msg = f"Version {version_id} not found"
        raise LookupError(msg)
    sections = (
        await session.scalars(
            select(VersionSection)
            .where(VersionSection.version_id == version_id)
            .order_by(VersionSection.sort_order)
        )
    ).all()
    questions = (
        await session.scalars(
            select(VersionQuestion)
            .where(VersionQuestion.version_id == version_id)
            .order_by(VersionQuestion.sort_order)
        )
    ).all()
    options = (
        await session.scalars(
            select(QuestionOption)
            .join(VersionQuestion, VersionQuestion.id == QuestionOption.question_id)
            .where(VersionQuestion.version_id == version_id)
            .order_by(QuestionOption.question_id, QuestionOption.sort_order)
        )
    ).all()
    by_question: dict[uuid.UUID, list[QuestionOption]] = {}
    for option in options:
        by_question.setdefault(option.question_id, []).append(option)
    section_key = {s.id: str(s.key) for s in sections}

    refs: dict[str, QuestionRef] = {}
    question_dicts: list[dict[str, Any]] = []
    for q in questions:
        q_options = by_question.get(q.id, [])
        key = str(q.key)
        refs[key] = QuestionRef(
            id=q.id,
            key=key,
            type=q.type,
            required=q.required,
            config=q.config,
            option_ids={str(o.key): o.id for o in q_options},
        )
        question_dicts.append(
            {
                "key": key,
                "section_key": section_key[q.section_id],
                "type": q.type,
                "text": q.text,
                "help": q.help,
                "required": q.required,
                "options": [{"key": str(o.key), "label": o.label} for o in q_options],
                "config": q.config,
                "condition": q.condition,
            }
        )
    content = {
        "title": version.title,
        "description": version.description,
        "settings": version.settings,
        "theme": version.theme,
        "sections": [
            {
                "key": str(s.key),
                "title": s.title,
                "description": s.description,
                "condition": s.condition,
                "video": s.video,
            }
            for s in sections
        ],
        "questions": question_dicts,
    }
    return VersionContent(version=version, content=content, questions=refs)
