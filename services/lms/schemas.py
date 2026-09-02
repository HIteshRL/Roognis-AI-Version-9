"""Request bodies for the LMS service. Responses are plain dicts built by the
serializers in classrooms.py / coursework.py (camelCase, matching the Node
services), so only inbound payloads need Pydantic validation here."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class _Body(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)


class CreateClassroomRequest(_Body):
    name: str = Field(min_length=1, max_length=160)
    subject: str = Field(min_length=1, max_length=120)
    section: str | None = Field(default=None, max_length=80)
    room: str | None = Field(default=None, max_length=80)
    grade: str | None = Field(default=None, max_length=40)
    description: str | None = None
    color: str | None = Field(default=None, max_length=16)
    require_approval: bool = Field(default=False, alias="requireApproval")

    model_config = ConfigDict(populate_by_name=True, extra="ignore", str_strip_whitespace=True)


class UpdateClassroomRequest(_Body):
    name: str | None = Field(default=None, max_length=160)
    subject: str | None = Field(default=None, max_length=120)
    section: str | None = Field(default=None, max_length=80)
    room: str | None = Field(default=None, max_length=80)
    grade: str | None = Field(default=None, max_length=40)
    description: str | None = None
    color: str | None = Field(default=None, max_length=16)


class JoinCodeSettingRequest(_Body):
    enabled: bool


class JoinRequest(_Body):
    code: str = Field(min_length=4, max_length=16, alias="joinCode")

    model_config = ConfigDict(populate_by_name=True, extra="ignore", str_strip_whitespace=True)


class CreateChapterRequest(_Body):
    title: str = Field(min_length=1, max_length=220)
    description: str | None = None
    order_index: int | None = Field(default=None, alias="orderIndex", ge=0)
    knowledge_base_id: str | None = Field(default=None, alias="knowledgeBaseId", max_length=36)

    model_config = ConfigDict(populate_by_name=True, extra="ignore", str_strip_whitespace=True)


class UpdateChapterRequest(_Body):
    title: str | None = Field(default=None, max_length=220)
    description: str | None = None
    order_index: int | None = Field(default=None, alias="orderIndex", ge=0)
    is_published: bool | None = Field(default=None, alias="isPublished")
    knowledge_base_id: str | None = Field(default=None, alias="knowledgeBaseId", max_length=36)

    model_config = ConfigDict(populate_by_name=True, extra="ignore", str_strip_whitespace=True)


class CreateCourseworkRequest(_Body):
    title: str = Field(min_length=1, max_length=240)
    type: str = Field(default="assignment")
    description: str | None = None
    topic: str | None = Field(default=None, max_length=160)
    chapter_id: str | None = Field(default=None, alias="chapterId", max_length=36)
    max_points: float | None = Field(default=None, alias="maxPoints", ge=0)
    due_at: datetime | None = Field(default=None, alias="dueAt")
    attachments: dict | None = None

    model_config = ConfigDict(populate_by_name=True, extra="ignore", str_strip_whitespace=True)


class UpdateCourseworkRequest(_Body):
    title: str | None = Field(default=None, max_length=240)
    description: str | None = None
    topic: str | None = Field(default=None, max_length=160)
    chapter_id: str | None = Field(default=None, alias="chapterId", max_length=36)
    max_points: float | None = Field(default=None, alias="maxPoints", ge=0)
    due_at: datetime | None = Field(default=None, alias="dueAt")
    attachments: dict | None = None

    model_config = ConfigDict(populate_by_name=True, extra="ignore", str_strip_whitespace=True)


class SubmitRequest(_Body):
    content: dict | None = None
    text: str | None = None


class GradeRequest(_Body):
    grade: float = Field(ge=0)
    feedback: str | None = None
    return_to_student: bool = Field(default=True, alias="returnToStudent")

    model_config = ConfigDict(populate_by_name=True, extra="ignore", str_strip_whitespace=True)
