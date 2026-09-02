# ─────────────────────────────────────────────────────────────────────────────
# Roognis AI — LMS / Classroom Service  (:3006, schema: lms_db)
#
# A Google-Classroom-style teaching layer ported from Roognis v2's `learner`
# service into main4's microservice conventions (FastAPI + SQLAlchemy + cookie
# JWT + internal-token, mirroring services/rag). Owns classrooms, chapters,
# enrollment, coursework, submissions, and grading. Identity (users/schools) is
# owned by the Auth Service; this service scopes everything by the JWT's
# schoolId + userId and never reaches across schemas.
# ─────────────────────────────────────────────────────────────────────────────
import logging
import os
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, Query, status
from sqlalchemy.orm import Session

import classrooms as cr
import coursework as cw
from auth import (
    AuthUser,
    get_current_user,
    require_internal_token,
    require_student,
    require_teacher,
)
from clients import fire_analytics_event
from config import Settings, get_settings
from database import get_db, init_db
from schemas import (
    CreateChapterRequest,
    CreateClassroomRequest,
    CreateCourseworkRequest,
    GradeRequest,
    JoinCodeSettingRequest,
    JoinRequest,
    SubmitRequest,
    UpdateChapterRequest,
    UpdateClassroomRequest,
    UpdateCourseworkRequest,
)

# Google-Classroom parity routers (ported from v2 learner). Each mounts under
# /api/lms; kept as APIRouter modules so this file stays focused on the core
# classroom / coursework / submission flow.
import calendar_view
import discussions
import gradebook
import guardians
import notifications
import rubrics
import stream
import topics

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Roognis LMS Service", lifespan=lifespan)
app.state.settings = get_settings()

# Mount the Google-Classroom parity feature routers (stream, discussions,
# topics, rubrics, gradebook, calendar, guardians, notifications).
for _feature in (stream, discussions, topics, rubrics, gradebook, calendar_view, guardians, notifications):
    app.include_router(_feature.router)


@app.get("/health")
def health():
    return {"status": "ok", "service": "lms"}


@app.get("/api/lms/health")
def api_health():
    return {"status": "ok", "service": "lms"}


# ── Teacher · classrooms ─────────────────────────────────────────────────────

@app.post("/api/lms/classrooms", status_code=status.HTTP_201_CREATED)
def create_classroom(
    body: CreateClassroomRequest,
    user: AuthUser = Depends(require_teacher),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    classroom = cr.create_classroom(db, user, body)
    db.commit()
    db.refresh(classroom)
    fire_analytics_event(
        settings,
        {
            "type": "classroom_created",
            "schoolId": user.school_id,
            "subject": classroom.subject,
            "metadata": {"classroomId": classroom.id, "teacherId": user.user_id, "name": classroom.name},
        },
    )
    return cr.serialize_classroom(classroom, 0, 0)


@app.get("/api/lms/classrooms")
def list_classrooms(
    archived: Annotated[bool, Query()] = False,
    user: AuthUser = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    classrooms = cr.list_teacher_classrooms(db, user, only_archived=archived)
    return {
        "classrooms": [
            cr.serialize_classroom(c, cr.count_students(db, c.id), cr.count_chapters(db, c.id))
            for c in classrooms
        ]
    }


@app.get("/api/lms/classrooms/{classroom_id}")
def get_classroom(
    classroom_id: str,
    user: AuthUser = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    classroom = cr.get_owned_classroom(db, user, classroom_id)
    return cr.serialize_classroom(
        classroom, cr.count_students(db, classroom.id), cr.count_chapters(db, classroom.id)
    )


@app.patch("/api/lms/classrooms/{classroom_id}")
def update_classroom(
    classroom_id: str,
    body: UpdateClassroomRequest,
    user: AuthUser = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    classroom = cr.get_owned_classroom(db, user, classroom_id)
    cr.update_classroom(db, classroom, body)
    db.commit()
    db.refresh(classroom)
    return cr.serialize_classroom(
        classroom, cr.count_students(db, classroom.id), cr.count_chapters(db, classroom.id)
    )


@app.delete("/api/lms/classrooms/{classroom_id}")
def delete_classroom(
    classroom_id: str,
    user: AuthUser = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    classroom = cr.get_owned_classroom(db, user, classroom_id)
    cr.soft_delete_classroom(db, classroom)
    db.commit()
    return {"ok": True, "classroomId": classroom_id}


@app.post("/api/lms/classrooms/{classroom_id}/archive")
def archive_classroom(
    classroom_id: str,
    user: AuthUser = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    classroom = cr.get_owned_classroom(db, user, classroom_id)
    cr.set_archived(db, classroom, True)
    db.commit()
    db.refresh(classroom)
    return cr.serialize_classroom(
        classroom, cr.count_students(db, classroom.id), cr.count_chapters(db, classroom.id)
    )


@app.post("/api/lms/classrooms/{classroom_id}/unarchive")
def unarchive_classroom(
    classroom_id: str,
    user: AuthUser = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    classroom = cr.get_owned_classroom(db, user, classroom_id)
    cr.set_archived(db, classroom, False)
    db.commit()
    db.refresh(classroom)
    return cr.serialize_classroom(
        classroom, cr.count_students(db, classroom.id), cr.count_chapters(db, classroom.id)
    )


@app.post("/api/lms/classrooms/{classroom_id}/join-code/regenerate")
def regenerate_join_code(
    classroom_id: str,
    user: AuthUser = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    classroom = cr.get_owned_classroom(db, user, classroom_id)
    cr.regenerate_join_code(db, classroom)
    db.commit()
    db.refresh(classroom)
    return {"classroomId": classroom.id, "joinCode": classroom.join_code}


@app.patch("/api/lms/classrooms/{classroom_id}/join-code")
def set_join_code_enabled(
    classroom_id: str,
    body: JoinCodeSettingRequest,
    user: AuthUser = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    classroom = cr.get_owned_classroom(db, user, classroom_id)
    cr.set_join_code_enabled(db, classroom, body.enabled)
    db.commit()
    db.refresh(classroom)
    return {"classroomId": classroom.id, "joinCodeEnabled": classroom.join_code_enabled}


# ── Teacher · roster & enrollment ────────────────────────────────────────────

@app.get("/api/lms/classrooms/{classroom_id}/students")
def list_roster(
    classroom_id: str,
    user: AuthUser = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    cr.get_owned_classroom(db, user, classroom_id)
    enrollments = cr.list_enrollments(db, classroom_id, status_filter="active")
    return {"students": [cr.serialize_enrollment(e) for e in enrollments]}


@app.get("/api/lms/classrooms/{classroom_id}/enrollments/pending")
def list_pending(
    classroom_id: str,
    user: AuthUser = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    cr.get_owned_classroom(db, user, classroom_id)
    enrollments = cr.list_enrollments(db, classroom_id, status_filter="pending")
    return {"pending": [cr.serialize_enrollment(e) for e in enrollments]}


@app.post("/api/lms/classrooms/{classroom_id}/enrollments/{student_id}/approve")
def approve_enrollment(
    classroom_id: str,
    student_id: str,
    user: AuthUser = Depends(require_teacher),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    classroom = cr.get_owned_classroom(db, user, classroom_id)
    cr.approve_enrollment(db, classroom_id, student_id)
    db.commit()
    fire_analytics_event(
        settings,
        {
            "type": "student_enrolled",
            "studentId": student_id,
            "schoolId": user.school_id,
            "subject": classroom.subject,
            "metadata": {"classroomId": classroom_id, "via": "approval"},
        },
    )
    return {"classroomId": classroom_id, "studentId": student_id, "status": "active"}


@app.post("/api/lms/classrooms/{classroom_id}/enrollments/{student_id}/reject")
def reject_enrollment(
    classroom_id: str,
    student_id: str,
    user: AuthUser = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    cr.get_owned_classroom(db, user, classroom_id)
    cr.reject_enrollment(db, classroom_id, student_id)
    db.commit()
    return {"ok": True, "studentId": student_id}


@app.delete("/api/lms/classrooms/{classroom_id}/students/{student_id}")
def remove_student(
    classroom_id: str,
    student_id: str,
    user: AuthUser = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    cr.get_owned_classroom(db, user, classroom_id)
    cr.remove_student(db, classroom_id, student_id)
    db.commit()
    return {"ok": True, "studentId": student_id}


# ── Teacher · chapters ───────────────────────────────────────────────────────

@app.post("/api/lms/classrooms/{classroom_id}/chapters", status_code=status.HTTP_201_CREATED)
def add_chapter(
    classroom_id: str,
    body: CreateChapterRequest,
    user: AuthUser = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    classroom = cr.get_owned_classroom(db, user, classroom_id)
    chapter = cr.add_chapter(db, classroom, body)
    db.commit()
    db.refresh(chapter)
    return cr.serialize_chapter(chapter)


@app.get("/api/lms/classrooms/{classroom_id}/chapters")
def list_chapters(
    classroom_id: str,
    user: AuthUser = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    cr.get_owned_classroom(db, user, classroom_id)
    chapters = cr.list_chapters(db, classroom_id)
    return {"chapters": [cr.serialize_chapter(ch) for ch in chapters]}


@app.patch("/api/lms/chapters/{chapter_id}")
def update_chapter(
    chapter_id: str,
    body: UpdateChapterRequest,
    user: AuthUser = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    chapter = cr.get_owned_chapter(db, user, chapter_id)
    cr.update_chapter(db, chapter, body)
    db.commit()
    db.refresh(chapter)
    return cr.serialize_chapter(chapter)


@app.delete("/api/lms/chapters/{chapter_id}")
def delete_chapter(
    chapter_id: str,
    user: AuthUser = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    chapter = cr.get_owned_chapter(db, user, chapter_id)
    cr.delete_chapter(db, chapter)
    db.commit()
    return {"ok": True, "chapterId": chapter_id}


# ── Teacher · coursework & grading ───────────────────────────────────────────

@app.post("/api/lms/classrooms/{classroom_id}/coursework", status_code=status.HTTP_201_CREATED)
def create_coursework(
    classroom_id: str,
    body: CreateCourseworkRequest,
    user: AuthUser = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    classroom = cr.get_owned_classroom(db, user, classroom_id)
    coursework = cw.create_coursework(db, user, classroom, body)
    db.commit()
    db.refresh(coursework)
    return cw.serialize_coursework(coursework, stats={"total": 0, "turnedIn": 0, "graded": 0})


@app.get("/api/lms/classrooms/{classroom_id}/coursework")
def list_classroom_coursework(
    classroom_id: str,
    status_filter: Annotated[str | None, Query(alias="status")] = None,
    user: AuthUser = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    cr.get_owned_classroom(db, user, classroom_id)
    items = cw.list_coursework(db, classroom_id, status_filter=status_filter)
    return {
        "coursework": [
            cw.serialize_coursework(item, stats=cw.submission_stats(db, item.id)) for item in items
        ]
    }


@app.get("/api/lms/coursework/{coursework_id}")
def get_coursework(
    coursework_id: str,
    user: AuthUser = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    coursework = cw.get_owned_coursework(db, user, coursework_id)
    return cw.serialize_coursework(coursework, stats=cw.submission_stats(db, coursework.id))


@app.patch("/api/lms/coursework/{coursework_id}")
def update_coursework(
    coursework_id: str,
    body: UpdateCourseworkRequest,
    user: AuthUser = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    coursework = cw.get_owned_coursework(db, user, coursework_id)
    cw.update_coursework(db, coursework, body)
    db.commit()
    db.refresh(coursework)
    return cw.serialize_coursework(coursework, stats=cw.submission_stats(db, coursework.id))


@app.post("/api/lms/coursework/{coursework_id}/publish")
def publish_coursework(
    coursework_id: str,
    user: AuthUser = Depends(require_teacher),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    coursework = cw.get_owned_coursework(db, user, coursework_id)
    cw.publish_coursework(db, coursework)
    db.commit()
    db.refresh(coursework)
    fire_analytics_event(
        settings,
        {
            "type": "coursework_published",
            "schoolId": user.school_id,
            "metadata": {
                "classroomId": coursework.classroom_id,
                "courseworkId": coursework.id,
                "type": coursework.type,
                "title": coursework.title,
            },
        },
    )
    return cw.serialize_coursework(coursework, stats=cw.submission_stats(db, coursework.id))


@app.get("/api/lms/coursework/{coursework_id}/submissions")
def list_submissions(
    coursework_id: str,
    user: AuthUser = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    coursework = cw.get_owned_coursework(db, user, coursework_id)
    submissions = cw.list_submissions(db, coursework.id)
    return {
        "courseworkId": coursework.id,
        "stats": cw.submission_stats(db, coursework.id),
        "submissions": [cw.serialize_submission(s) for s in submissions],
    }


@app.post("/api/lms/submissions/{submission_id}/grade")
def grade_submission(
    submission_id: str,
    body: GradeRequest,
    user: AuthUser = Depends(require_teacher),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    submission, coursework = cw.get_owned_submission(db, user, submission_id)
    cw.grade_submission(db, user, submission, coursework, body)
    db.commit()
    db.refresh(submission)
    fire_analytics_event(
        settings,
        {
            "type": "coursework_graded",
            "studentId": submission.student_id,
            "schoolId": user.school_id,
            "metadata": {
                "classroomId": coursework.classroom_id,
                "courseworkId": coursework.id,
                "submissionId": submission.id,
                "grade": float(submission.grade) if submission.grade is not None else None,
                "maxPoints": float(coursework.max_points) if coursework.max_points is not None else None,
            },
        },
    )
    return cw.serialize_submission(submission)


# ── Student ──────────────────────────────────────────────────────────────────

@app.post("/api/lms/enrollments/join")
def join_classroom(
    body: JoinRequest,
    user: AuthUser = Depends(require_student),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    classroom, enrollment_status = cr.join_by_code(db, user, body.code)
    db.commit()
    if enrollment_status == "active":
        fire_analytics_event(
            settings,
            {
                "type": "student_enrolled",
                "studentId": user.user_id,
                "schoolId": user.school_id,
                "subject": classroom.subject,
                "metadata": {"classroomId": classroom.id, "via": "join_code"},
            },
        )
    return {
        "status": enrollment_status,
        "classroom": cr.serialize_student_classroom(classroom, cr.count_chapters(db, classroom.id)),
    }


@app.get("/api/lms/student/classrooms")
def student_classrooms(
    user: AuthUser = Depends(require_student),
    db: Session = Depends(get_db),
):
    classrooms = cr.list_student_classrooms(db, user)
    return {
        "classrooms": [
            cr.serialize_student_classroom(c, cr.count_chapters(db, c.id)) for c in classrooms
        ]
    }


@app.post("/api/lms/classrooms/{classroom_id}/leave")
def leave_classroom(
    classroom_id: str,
    user: AuthUser = Depends(require_student),
    db: Session = Depends(get_db),
):
    enrollment = cr.get_enrollment(db, classroom_id, user.user_id)
    if not enrollment:
        from fastapi import HTTPException

        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="You are not enrolled in this class.")
    db.delete(enrollment)
    db.commit()
    return {"ok": True, "classroomId": classroom_id}


@app.get("/api/lms/student/classrooms/{classroom_id}/chapters")
def student_chapters(
    classroom_id: str,
    user: AuthUser = Depends(require_student),
    db: Session = Depends(get_db),
):
    cr.require_enrolled(db, user, classroom_id)
    chapters = cr.list_chapters(db, classroom_id, published_only=True)
    return {"chapters": [cr.serialize_chapter(ch) for ch in chapters]}


@app.get("/api/lms/student/classrooms/{classroom_id}/coursework")
def student_coursework(
    classroom_id: str,
    user: AuthUser = Depends(require_student),
    db: Session = Depends(get_db),
):
    cr.require_enrolled(db, user, classroom_id)
    items = cw.list_published_coursework(db, classroom_id)
    return {
        "coursework": [
            cw.serialize_coursework(
                item,
                my_submission=cw.get_student_submission(db, item.id, user.user_id),
                include_my_submission=True,
            )
            for item in items
        ]
    }


@app.post("/api/lms/coursework/{coursework_id}/submit", status_code=status.HTTP_201_CREATED)
def submit_coursework(
    coursework_id: str,
    body: SubmitRequest,
    user: AuthUser = Depends(require_student),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    coursework = cw.get_published_coursework_for_student(db, user, coursework_id)
    content = body.content or ({"text": body.text} if body.text else {})
    submission = cw.submit_coursework(db, user, coursework, content)
    db.commit()
    db.refresh(submission)
    fire_analytics_event(
        settings,
        {
            "type": "coursework_submitted",
            "studentId": user.user_id,
            "schoolId": user.school_id,
            "metadata": {
                "classroomId": coursework.classroom_id,
                "courseworkId": coursework.id,
                "submissionId": submission.id,
                "type": coursework.type,
            },
        },
    )
    return cw.serialize_submission(submission)


@app.get("/api/lms/student/submissions")
def student_submissions(
    user: AuthUser = Depends(require_student),
    db: Session = Depends(get_db),
):
    submissions = cw.list_student_submissions(db, user)
    return {"submissions": [cw.serialize_submission(s) for s in submissions]}


# ── Internal (service-to-service) ────────────────────────────────────────────

@app.get("/api/lms/internal/enrollment")
def internal_enrollment(
    classroomId: Annotated[str, Query()],
    studentId: Annotated[str, Query()],
    _internal: None = Depends(require_internal_token),
    db: Session = Depends(get_db),
):
    return {
        "classroomId": classroomId,
        "studentId": studentId,
        "enrolled": cr.is_enrolled(db, classroomId, studentId),
    }


@app.get("/api/lms/internal/chapter-access")
def internal_chapter_access(
    chapterId: Annotated[str, Query()],
    studentId: Annotated[str, Query()],
    _internal: None = Depends(require_internal_token),
    db: Session = Depends(get_db),
):
    """Used by the AI/RAG services to scope a student's chapter chat: returns the
    chapter's knowledge-base id only when the student is enrolled and the chapter
    is published (ports v2's resolve_chapter_kb_for_student)."""
    from sqlalchemy import select

    from models import Chapter

    chapter = db.scalar(select(Chapter).where(Chapter.id == chapterId))
    if not chapter or not chapter.is_published:
        return {"allowed": False, "knowledgeBaseId": None, "classroomId": None}
    allowed = cr.is_enrolled(db, chapter.classroom_id, studentId)
    return {
        "allowed": allowed,
        "knowledgeBaseId": chapter.knowledge_base_id if allowed else None,
        "classroomId": chapter.classroom_id,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 3006)))
