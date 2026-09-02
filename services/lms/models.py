"""SQLAlchemy models for the LMS / Classroom service (schema: lms_db).

Ported from Roognis v2's `services/learner` + `core/models` (Google Classroom
model), collapsed from v2's repository/DTO abstraction into the direct-ORM style
main4's RAG service uses. User and school identifiers are plain strings owned by
the Auth Service (auth_db) — no cross-schema foreign keys, preserving the
microservice boundary.
"""
from __future__ import annotations

import enum
import secrets
import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


def new_uuid() -> str:
    return str(uuid.uuid4())


# Unambiguous alphabet — no 0/O/1/I/L — for human-typed join codes.
_JOIN_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

# Google-Classroom-style header palette; assigned round-robin per teacher.
CLASSROOM_COLORS = [
    "#1967d2",
    "#188038",
    "#a142f4",
    "#e37400",
    "#d01884",
    "#00897b",
    "#c5221f",
    "#3949ab",
]


def generate_join_code(length: int = 7) -> str:
    return "".join(secrets.choice(_JOIN_CODE_ALPHABET) for _ in range(length))


class EnrollmentStatus(str, enum.Enum):
    PENDING = "pending"
    ACTIVE = "active"
    REMOVED = "removed"


class EnrollmentRole(str, enum.Enum):
    STUDENT = "student"
    CO_TEACHER = "co_teacher"


class CourseworkType(str, enum.Enum):
    ASSIGNMENT = "assignment"
    QUIZ = "quiz"
    QUESTION = "question"
    MATERIAL = "material"


class CourseworkStatus(str, enum.Enum):
    DRAFT = "draft"
    PUBLISHED = "published"


class SubmissionStatus(str, enum.Enum):
    ASSIGNED = "assigned"
    TURNED_IN = "turned_in"
    RETURNED = "returned"


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class Classroom(Base, TimestampMixin):
    __tablename__ = "classrooms"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    school_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    teacher_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    subject: Mapped[str] = mapped_column(String(120), nullable=False)
    section: Mapped[str | None] = mapped_column(String(80))
    room: Mapped[str | None] = mapped_column(String(80))
    grade: Mapped[str | None] = mapped_column(String(40))
    description: Mapped[str | None] = mapped_column(Text)
    color: Mapped[str] = mapped_column(String(16), nullable=False, default=CLASSROOM_COLORS[0])
    join_code: Mapped[str] = mapped_column(String(16), nullable=False, unique=True, index=True)
    join_code_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    settings: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)

    chapters: Mapped[list[Chapter]] = relationship(
        back_populates="classroom",
        cascade="all, delete-orphan",
    )
    enrollments: Mapped[list[Enrollment]] = relationship(
        back_populates="classroom",
        cascade="all, delete-orphan",
    )
    coursework: Mapped[list[Coursework]] = relationship(
        back_populates="classroom",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("ix_classrooms_school_teacher", "school_id", "teacher_id"),
    )


class Chapter(Base, TimestampMixin):
    __tablename__ = "chapters"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    classroom_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("classrooms.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    school_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(220), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    order_index: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_published: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Optional link to a RAG document grouping so chat/quiz can scope to a chapter.
    knowledge_base_id: Mapped[str | None] = mapped_column(String(36), index=True)

    classroom: Mapped[Classroom] = relationship(back_populates="chapters")
    coursework: Mapped[list[Coursework]] = relationship(back_populates="chapter")

    __table_args__ = (
        Index("ix_chapters_classroom_order", "classroom_id", "order_index"),
    )


class Enrollment(Base):
    __tablename__ = "enrollments"

    classroom_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("classrooms.id", ondelete="CASCADE"),
        primary_key=True,
    )
    student_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    student_name: Mapped[str | None] = mapped_column(String(160))
    school_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    status: Mapped[str] = mapped_column(
        String(20),
        default=EnrollmentStatus.ACTIVE.value,
        nullable=False,
        index=True,
    )
    role: Mapped[str] = mapped_column(
        String(20),
        default=EnrollmentRole.STUDENT.value,
        nullable=False,
    )
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    classroom: Mapped[Classroom] = relationship(back_populates="enrollments")

    __table_args__ = (
        Index("ix_enrollments_student_status", "student_id", "status"),
    )


class Coursework(Base, TimestampMixin):
    __tablename__ = "coursework"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    classroom_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("classrooms.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    chapter_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("chapters.id", ondelete="SET NULL"),
        index=True,
    )
    school_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    teacher_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    type: Mapped[str] = mapped_column(
        String(20),
        default=CourseworkType.ASSIGNMENT.value,
        nullable=False,
    )
    title: Mapped[str] = mapped_column(String(240), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    topic: Mapped[str | None] = mapped_column(String(160))
    # Classwork topic grouping (Google Classroom "Classwork" tab). SET NULL so
    # deleting a topic leaves its coursework in place, un-filed.
    topic_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("topics.id", ondelete="SET NULL"),
        index=True,
    )
    max_points: Mapped[float | None] = mapped_column(Numeric(6, 2))
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(
        String(20),
        default=CourseworkStatus.DRAFT.value,
        nullable=False,
        index=True,
    )
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    attachments: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)

    classroom: Mapped[Classroom] = relationship(back_populates="coursework")
    chapter: Mapped[Chapter | None] = relationship(back_populates="coursework")
    submissions: Mapped[list[Submission]] = relationship(
        back_populates="coursework",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("ix_coursework_classroom_status", "classroom_id", "status"),
    )


class Submission(Base, TimestampMixin):
    __tablename__ = "submissions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    coursework_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("coursework.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    student_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    student_name: Mapped[str | None] = mapped_column(String(160))
    school_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    status: Mapped[str] = mapped_column(
        String(20),
        default=SubmissionStatus.TURNED_IN.value,
        nullable=False,
        index=True,
    )
    content: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    grade: Mapped[float | None] = mapped_column(Numeric(6, 2))
    feedback: Mapped[str | None] = mapped_column(Text)
    turned_in_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    graded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    graded_by: Mapped[str | None] = mapped_column(String(36))

    coursework: Mapped[Coursework] = relationship(back_populates="submissions")

    __table_args__ = (
        UniqueConstraint("coursework_id", "student_id", name="uq_submission_coursework_student"),
        Index("ix_submissions_student", "student_id", "status"),
    )


# ─────────────────────────────────────────────────────────────────────────────
# Google-Classroom parity layer — ported from v2 core/models/lms.py + learner.
# Stream announcements, threaded discussion comments + reactions, reusable
# rubrics, classwork topics, guardian links, and in-app notifications. Every row
# is school-scoped; user/school identity stays in auth_db (plain-string ids, no
# cross-schema FKs), the same boundary the classroom/coursework tables keep.
# ─────────────────────────────────────────────────────────────────────────────

ANNOUNCEMENT_STATUSES = ("draft", "scheduled", "published")
STREAM_PERMISSIONS = ("post_and_comment", "comment_only", "teachers_only")
GUARDIAN_STATUSES = ("pending", "active", "removed")


class Topic(Base, TimestampMixin):
    """Classwork topic — a teacher-owned grouping coursework is filed under."""

    __tablename__ = "topics"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    classroom_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("classrooms.id", ondelete="CASCADE"), nullable=False, index=True
    )
    school_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    order_index: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    __table_args__ = (Index("ix_topics_classroom_order", "classroom_id", "order_index"),)


class Announcement(Base, TimestampMixin):
    """A Stream post (Google Classroom parity). ``attachments`` is a JSON list of
    ``{"type": "file"|"link", "url", "title"}``. A ``scheduled`` post becomes
    visible once its ``scheduled_for`` passes and it is published."""

    __tablename__ = "announcements"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    classroom_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("classrooms.id", ondelete="CASCADE"), nullable=False, index=True
    )
    school_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    author_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    author_name: Mapped[str | None] = mapped_column(String(160))
    title: Mapped[str | None] = mapped_column(String(240))
    body: Mapped[str] = mapped_column(Text, nullable=False)
    attachments: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="published", nullable=False, index=True)
    scheduled_for: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    __table_args__ = (Index("ix_announcements_classroom_status", "classroom_id", "status"),)


class Comment(Base, TimestampMixin):
    """A discussion comment — on the stream (``announcement_id``), on a coursework
    item (``coursework_id``), or a threaded reply (``parent_id``)."""

    __tablename__ = "comments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    classroom_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("classrooms.id", ondelete="CASCADE"), nullable=False, index=True
    )
    school_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    author_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    author_name: Mapped[str | None] = mapped_column(String(160))
    body: Mapped[str] = mapped_column(Text, nullable=False)
    coursework_id: Mapped[str | None] = mapped_column(String(36), index=True)
    announcement_id: Mapped[str | None] = mapped_column(String(36), index=True)
    parent_id: Mapped[str | None] = mapped_column(String(36), index=True)
    mentions: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    reactions: Mapped[list[CommentReaction]] = relationship(
        back_populates="comment", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("ix_comments_thread", "classroom_id", "coursework_id", "announcement_id"),
    )


class CommentReaction(Base):
    __tablename__ = "comment_reactions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    comment_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("comments.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[str] = mapped_column(String(36), nullable=False)
    emoji: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    comment: Mapped[Comment] = relationship(back_populates="reactions")

    __table_args__ = (
        UniqueConstraint("comment_id", "user_id", "emoji", name="uq_reaction_once"),
    )


class Rubric(Base, TimestampMixin):
    """A reusable grading rubric. ``criteria`` is a JSON list of
    ``{"criterion", "description", "maxPoints"}``."""

    __tablename__ = "rubrics"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    classroom_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("classrooms.id", ondelete="CASCADE"), nullable=False, index=True
    )
    school_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    teacher_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    criteria: Mapped[list] = mapped_column(JSON, default=list, nullable=False)


class Guardian(Base, TimestampMixin):
    """A guardian↔student link. One row is both the invitation (``status='pending'``
    + ``token``) and the accepted link (``status='active'``)."""

    __tablename__ = "guardians"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    student_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    school_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    student_name: Mapped[str | None] = mapped_column(String(160))
    guardian_email: Mapped[str] = mapped_column(String(255), nullable=False)
    guardian_user_id: Mapped[str | None] = mapped_column(String(36), index=True)
    status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False, index=True)
    token: Mapped[str | None] = mapped_column(String(64))
    invited_by: Mapped[str | None] = mapped_column(String(36))

    __table_args__ = (
        UniqueConstraint("student_id", "guardian_email", name="uq_guardian_student_email"),
    )


class Notification(Base):
    """In-app notification for one user (student / teacher / guardian)."""

    __tablename__ = "notifications"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    user_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    school_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    type: Mapped[str] = mapped_column(String(40), nullable=False)
    title: Mapped[str] = mapped_column(String(240), nullable=False)
    body: Mapped[str] = mapped_column(Text, default="", nullable=False)
    data: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (Index("ix_notifications_user_read", "user_id", "is_read"),)
