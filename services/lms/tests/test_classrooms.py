from conftest import STUDENT_A, STUDENT_B, TEACHER_B


def cookie(token):
    return {"jwt": token}


def make_classroom(client, teacher, **overrides):
    body = {"name": "Class 8 Science", "subject": "Science", **overrides}
    res = client.post("/api/lms/classrooms", json=body, cookies=cookie(teacher))
    assert res.status_code == 201, res.text
    return res.json()


def test_health(client):
    assert client.get("/health").json() == {"status": "ok", "service": "lms"}


def test_requires_auth(client):
    assert client.get("/api/lms/classrooms").status_code == 401


def test_student_cannot_create_classroom(client, token_factory):
    res = client.post(
        "/api/lms/classrooms",
        json={"name": "X", "subject": "Y"},
        cookies=cookie(token_factory("student")),
    )
    assert res.status_code == 403


def test_create_and_list_classroom(client, token_factory):
    teacher = token_factory("teacher")
    created = make_classroom(client, teacher)
    assert created["joinCode"]
    assert created["studentCount"] == 0
    assert created["color"].startswith("#")

    listed = client.get("/api/lms/classrooms", cookies=cookie(teacher)).json()["classrooms"]
    assert len(listed) == 1
    assert listed[0]["id"] == created["id"]


def test_join_by_code_and_roster(client, token_factory):
    teacher = token_factory("teacher")
    student = token_factory("student")
    classroom = make_classroom(client, teacher)

    join = client.post(
        "/api/lms/enrollments/join",
        json={"joinCode": classroom["joinCode"]},
        cookies=cookie(student),
    )
    assert join.status_code == 200, join.text
    assert join.json()["status"] == "active"

    roster = client.get(
        f"/api/lms/classrooms/{classroom['id']}/students", cookies=cookie(teacher)
    ).json()["students"]
    assert [s["studentId"] for s in roster] == [STUDENT_A]
    # Name captured from the student's JWT at join time (name-based identity).
    assert roster[0]["studentName"] == "Test Student"

    mine = client.get("/api/lms/student/classrooms", cookies=cookie(student)).json()["classrooms"]
    assert mine[0]["id"] == classroom["id"]


def test_join_requires_approval_flow(client, token_factory):
    teacher = token_factory("teacher")
    student = token_factory("student")
    classroom = make_classroom(client, teacher, requireApproval=True)

    join = client.post(
        "/api/lms/enrollments/join",
        json={"joinCode": classroom["joinCode"]},
        cookies=cookie(student),
    )
    assert join.json()["status"] == "pending"

    # Not yet active → not on the active roster.
    roster = client.get(
        f"/api/lms/classrooms/{classroom['id']}/students", cookies=cookie(teacher)
    ).json()["students"]
    assert roster == []

    pending = client.get(
        f"/api/lms/classrooms/{classroom['id']}/enrollments/pending", cookies=cookie(teacher)
    ).json()["pending"]
    assert [p["studentId"] for p in pending] == [STUDENT_A]

    approve = client.post(
        f"/api/lms/classrooms/{classroom['id']}/enrollments/{STUDENT_A}/approve",
        cookies=cookie(teacher),
    )
    assert approve.status_code == 200
    roster = client.get(
        f"/api/lms/classrooms/{classroom['id']}/students", cookies=cookie(teacher)
    ).json()["students"]
    assert [s["studentId"] for s in roster] == [STUDENT_A]


def test_bad_join_code(client, token_factory):
    res = client.post(
        "/api/lms/enrollments/join",
        json={"joinCode": "NOPE123"},
        cookies=cookie(token_factory("student")),
    )
    assert res.status_code == 404


def test_teacher_cannot_touch_other_schools_classroom(client, token_factory):
    owner = token_factory("teacher")
    classroom = make_classroom(client, owner)

    # Same role, different school + user → must not see or own it.
    intruder = token_factory("teacher", user_id=TEACHER_B, school_id="44444444-4444-4444-4444-444444444444")
    res = client.get(f"/api/lms/classrooms/{classroom['id']}", cookies=cookie(intruder))
    assert res.status_code == 404


def test_chapters_publish_visibility(client, token_factory):
    teacher = token_factory("teacher")
    student = token_factory("student")
    classroom = make_classroom(client, teacher)
    client.post(
        "/api/lms/enrollments/join",
        json={"joinCode": classroom["joinCode"]},
        cookies=cookie(student),
    )

    ch1 = client.post(
        f"/api/lms/classrooms/{classroom['id']}/chapters",
        json={"title": "Chapter 1"},
        cookies=cookie(teacher),
    ).json()
    ch2 = client.post(
        f"/api/lms/classrooms/{classroom['id']}/chapters",
        json={"title": "Chapter 2"},
        cookies=cookie(teacher),
    ).json()
    assert ch2["orderIndex"] == ch1["orderIndex"] + 1

    # Unpublish chapter 2 → student sees only chapter 1.
    client.patch(f"/api/lms/chapters/{ch2['id']}", json={"isPublished": False}, cookies=cookie(teacher))
    visible = client.get(
        f"/api/lms/student/classrooms/{classroom['id']}/chapters", cookies=cookie(student)
    ).json()["chapters"]
    assert [c["id"] for c in visible] == [ch1["id"]]


def test_internal_chapter_access(client, token_factory, internal_headers):
    teacher = token_factory("teacher")
    student = token_factory("student")
    classroom = make_classroom(client, teacher)
    chapter = client.post(
        f"/api/lms/classrooms/{classroom['id']}/chapters",
        json={"title": "Photosynthesis", "knowledgeBaseId": "kb-123"},
        cookies=cookie(teacher),
    ).json()

    # Not enrolled yet → not allowed.
    denied = client.get(
        "/api/lms/internal/chapter-access",
        params={"chapterId": chapter["id"], "studentId": STUDENT_A},
        headers=internal_headers,
    ).json()
    assert denied["allowed"] is False

    client.post(
        "/api/lms/enrollments/join",
        json={"joinCode": classroom["joinCode"]},
        cookies=cookie(student),
    )
    allowed = client.get(
        "/api/lms/internal/chapter-access",
        params={"chapterId": chapter["id"], "studentId": STUDENT_A},
        headers=internal_headers,
    ).json()
    assert allowed["allowed"] is True
    assert allowed["knowledgeBaseId"] == "kb-123"


def test_internal_requires_token(client, token_factory):
    res = client.get(
        "/api/lms/internal/enrollment",
        params={"classroomId": "x", "studentId": STUDENT_B},
    )
    assert res.status_code == 401
