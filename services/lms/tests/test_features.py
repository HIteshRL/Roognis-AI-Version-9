"""Tests for the Google-Classroom parity feature routers ported from v2:
stream, discussions, rubrics, topics, gradebook, calendar, guardians,
notifications."""
from conftest import STUDENT_A, STUDENT_B


def cookie(token):
    return {"jwt": token}


def make_class(client, teacher, name="Class 8 Science", subject="Science"):
    return client.post(
        "/api/lms/classrooms",
        json={"name": name, "subject": subject},
        cookies=cookie(teacher),
    ).json()


def enroll(client, classroom, student):
    return client.post(
        "/api/lms/enrollments/join",
        json={"joinCode": classroom["joinCode"]},
        cookies=cookie(student),
    )


def make_class_with_student(client, teacher, student):
    classroom = make_class(client, teacher)
    enroll(client, classroom, student)
    return classroom


# ── Stream ───────────────────────────────────────────────────────────────────

def test_teacher_posts_announcement_student_sees_it(client, token_factory):
    teacher, student = token_factory("teacher"), token_factory("student")
    classroom = make_class_with_student(client, teacher, student)

    res = client.post(
        f"/api/lms/classrooms/{classroom['id']}/announcements",
        json={"body": "Welcome to class!", "title": "Hello"},
        cookies=cookie(teacher),
    )
    assert res.status_code == 201, res.text
    assert res.json()["status"] == "published"

    seen = client.get(
        f"/api/lms/classrooms/{classroom['id']}/announcements", cookies=cookie(student)
    ).json()["announcements"]
    assert len(seen) == 1
    assert seen[0]["body"] == "Welcome to class!"


def test_student_cannot_post_to_stream_by_default(client, token_factory):
    teacher, student = token_factory("teacher"), token_factory("student")
    classroom = make_class_with_student(client, teacher, student)
    res = client.post(
        f"/api/lms/classrooms/{classroom['id']}/announcements",
        json={"body": "can I post?"},
        cookies=cookie(student),
    )
    assert res.status_code == 403


def test_teacher_draft_hidden_from_students(client, token_factory):
    teacher, student = token_factory("teacher"), token_factory("student")
    classroom = make_class_with_student(client, teacher, student)
    client.post(
        f"/api/lms/classrooms/{classroom['id']}/announcements",
        json={"body": "draft post", "status": "draft"},
        cookies=cookie(teacher),
    )
    student_view = client.get(
        f"/api/lms/classrooms/{classroom['id']}/announcements", cookies=cookie(student)
    ).json()["announcements"]
    assert student_view == []
    teacher_view = client.get(
        f"/api/lms/classrooms/{classroom['id']}/announcements", cookies=cookie(teacher)
    ).json()["announcements"]
    assert len(teacher_view) == 1


# ── Notifications ────────────────────────────────────────────────────────────

def test_published_announcement_notifies_students(client, token_factory):
    teacher, student = token_factory("teacher"), token_factory("student")
    classroom = make_class_with_student(client, teacher, student)
    client.post(
        f"/api/lms/classrooms/{classroom['id']}/announcements",
        json={"body": "Quiz tomorrow"},
        cookies=cookie(teacher),
    )
    notifs = client.get("/api/lms/notifications", cookies=cookie(student)).json()
    assert notifs["unreadCount"] >= 1
    assert notifs["notifications"][0]["type"] == "new_announcement"

    nid = notifs["notifications"][0]["id"]
    client.post(f"/api/lms/notifications/{nid}/read", cookies=cookie(student))
    after = client.get("/api/lms/notifications", cookies=cookie(student)).json()
    assert after["unreadCount"] == 0


# ── Discussions ──────────────────────────────────────────────────────────────

def test_comment_thread_and_reactions(client, token_factory):
    teacher, student = token_factory("teacher"), token_factory("student")
    classroom = make_class_with_student(client, teacher, student)
    announcement = client.post(
        f"/api/lms/classrooms/{classroom['id']}/announcements",
        json={"body": "Discuss chapter 3"},
        cookies=cookie(teacher),
    ).json()

    # Student comments on the announcement.
    comment = client.post(
        f"/api/lms/classrooms/{classroom['id']}/comments",
        json={"body": "Great chapter!", "announcementId": announcement["id"]},
        cookies=cookie(student),
    )
    assert comment.status_code == 201, comment.text
    comment = comment.json()

    # Teacher replies.
    reply = client.post(
        f"/api/lms/classrooms/{classroom['id']}/comments",
        json={"body": "Glad you liked it", "announcementId": announcement["id"], "parentId": comment["id"]},
        cookies=cookie(teacher),
    ).json()

    roots = client.get(
        f"/api/lms/classrooms/{classroom['id']}/comments",
        params={"announcementId": announcement["id"]},
        cookies=cookie(student),
    ).json()["comments"]
    assert len(roots) == 1
    assert roots[0]["replyCount"] == 1

    replies = client.get(
        f"/api/lms/classrooms/{classroom['id']}/comments",
        params={"parentId": comment["id"]},
        cookies=cookie(student),
    ).json()["comments"]
    assert replies[0]["id"] == reply["id"]

    # Reaction summary.
    reacted = client.post(
        f"/api/lms/comments/{comment['id']}/reactions",
        json={"emoji": "👍"},
        cookies=cookie(teacher),
    ).json()
    assert reacted["reactions"]["👍"] == 1


def test_mention_notifies_target(client, token_factory):
    teacher = token_factory("teacher")
    student = token_factory("student")
    classroom = make_class_with_student(client, teacher, student)
    client.post(
        f"/api/lms/classrooms/{classroom['id']}/comments",
        json={"body": f"hey @{STUDENT_A}", "mentions": [STUDENT_A]},
        cookies=cookie(teacher),
    )
    notifs = client.get("/api/lms/notifications", cookies=cookie(student)).json()
    assert any(n["type"] == "mention" for n in notifs["notifications"])


# ── Rubrics ──────────────────────────────────────────────────────────────────

def test_rubric_create_and_attach(client, token_factory):
    teacher = token_factory("teacher")
    classroom = make_class(client, teacher)
    rubric = client.post(
        f"/api/lms/classrooms/{classroom['id']}/rubrics",
        json={"title": "Essay rubric", "criteria": [
            {"criterion": "Clarity", "maxPoints": 5},
            {"criterion": "Grammar", "maxPoints": 5},
        ]},
        cookies=cookie(teacher),
    )
    assert rubric.status_code == 201, rubric.text
    rubric = rubric.json()
    assert rubric["maxPoints"] == 10

    coursework = client.post(
        f"/api/lms/classrooms/{classroom['id']}/coursework",
        json={"title": "Essay", "type": "assignment", "maxPoints": 10},
        cookies=cookie(teacher),
    ).json()
    client.post(
        f"/api/lms/rubrics/{rubric['id']}/attach",
        json={"courseworkId": coursework["id"]},
        cookies=cookie(teacher),
    )
    fetched = client.get(f"/api/lms/coursework/{coursework['id']}", cookies=cookie(teacher)).json()
    assert len(fetched["attachments"]["rubric"]) == 2


# ── Topics ───────────────────────────────────────────────────────────────────

def test_topic_grouping(client, token_factory):
    teacher = token_factory("teacher")
    classroom = make_class(client, teacher)
    topic = client.post(
        f"/api/lms/classrooms/{classroom['id']}/topics",
        json={"name": "Unit 1: Cells"},
        cookies=cookie(teacher),
    )
    assert topic.status_code == 201, topic.text
    topic = topic.json()
    coursework = client.post(
        f"/api/lms/classrooms/{classroom['id']}/coursework",
        json={"title": "Cell diagram", "type": "assignment"},
        cookies=cookie(teacher),
    ).json()
    client.post(
        f"/api/lms/coursework/{coursework['id']}/topic",
        json={"topicId": topic["id"]},
        cookies=cookie(teacher),
    )
    fetched = client.get(f"/api/lms/coursework/{coursework['id']}", cookies=cookie(teacher)).json()
    assert fetched["topicId"] == topic["id"]


# ── Gradebook ────────────────────────────────────────────────────────────────

def test_gradebook_matrix(client, token_factory):
    teacher, student = token_factory("teacher"), token_factory("student")
    classroom = make_class_with_student(client, teacher, student)
    coursework = client.post(
        f"/api/lms/classrooms/{classroom['id']}/coursework",
        json={"title": "Test 1", "type": "assignment", "maxPoints": 10},
        cookies=cookie(teacher),
    ).json()
    client.post(f"/api/lms/coursework/{coursework['id']}/publish", cookies=cookie(teacher))
    submission = client.post(
        f"/api/lms/coursework/{coursework['id']}/submit",
        json={"text": "answer"},
        cookies=cookie(student),
    ).json()
    client.post(
        f"/api/lms/submissions/{submission['id']}/grade",
        json={"grade": 8},
        cookies=cookie(teacher),
    )

    book = client.get(f"/api/lms/classrooms/{classroom['id']}/gradebook", cookies=cookie(teacher)).json()
    assert len(book["columns"]) == 1
    assert len(book["rows"]) == 1
    row = book["rows"][0]
    assert row["studentId"] == STUDENT_A
    assert row["cells"][coursework["id"]]["score"] == 8.0
    assert row["averagePercent"] == 80.0
    assert book["classAveragePercent"] == 80.0

    csv_res = client.get(f"/api/lms/classrooms/{classroom['id']}/gradebook.csv", cookies=cookie(teacher))
    assert csv_res.status_code == 200
    assert "Average %" in csv_res.text


# ── Calendar ─────────────────────────────────────────────────────────────────

def test_calendar_aggregates_due_dates(client, token_factory):
    teacher, student = token_factory("teacher"), token_factory("student")
    classroom = make_class_with_student(client, teacher, student)
    coursework = client.post(
        f"/api/lms/classrooms/{classroom['id']}/coursework",
        json={"title": "Homework", "type": "assignment", "dueAt": "2030-01-15T10:00:00Z"},
        cookies=cookie(teacher),
    ).json()
    client.post(f"/api/lms/coursework/{coursework['id']}/publish", cookies=cookie(teacher))

    cal = client.get(
        "/api/lms/calendar",
        params={"start": "2030-01-01T00:00:00Z", "end": "2030-02-01T00:00:00Z"},
        cookies=cookie(student),
    ).json()
    assert cal["total"] == 1
    assert cal["days"][0]["events"][0]["title"] == "Homework"


# ── Guardians ────────────────────────────────────────────────────────────────

def test_guardian_invite_and_summary(client, token_factory):
    teacher, student = token_factory("teacher"), token_factory("student")
    classroom = make_class_with_student(client, teacher, student)

    # Teacher invites a guardian for their enrolled student.
    invited = client.post(
        f"/api/lms/students/{STUDENT_A}/guardians",
        json={"guardianEmail": "parent@example.com"},
        cookies=cookie(teacher),
    )
    assert invited.status_code == 201, invited.text
    assert invited.json()["status"] == "pending"

    # A parent linked to STUDENT_A (via JWT studentIds) reads their students + summary.
    parent = token_factory("parent", user_id="77777777-7777-7777-7777-777777777777", studentIds=[STUDENT_A])
    students = client.get("/api/lms/guardian/students", cookies=cookie(parent)).json()["students"]
    assert students[0]["studentId"] == STUDENT_A

    summary = client.get(f"/api/lms/guardian/students/{STUDENT_A}/summary", cookies=cookie(parent))
    assert summary.status_code == 200
    assert "upcoming" in summary.json()


def test_teacher_cannot_invite_guardian_for_unrelated_student(client, token_factory):
    teacher = token_factory("teacher")
    make_class(client, teacher)  # teacher owns a class but STUDENT_B is not enrolled
    res = client.post(
        f"/api/lms/students/{STUDENT_B}/guardians",
        json={"guardianEmail": "x@example.com"},
        cookies=cookie(teacher),
    )
    assert res.status_code == 403


def test_parent_cannot_view_unlinked_student(client, token_factory):
    parent = token_factory("parent", user_id="77777777-7777-7777-7777-777777777777", studentIds=[STUDENT_A])
    res = client.get(f"/api/lms/guardian/students/{STUDENT_B}/summary", cookies=cookie(parent))
    assert res.status_code == 403
