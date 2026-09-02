from conftest import STUDENT_A


def cookie(token):
    return {"jwt": token}


def setup_class_with_student(client, teacher, student):
    classroom = client.post(
        "/api/lms/classrooms",
        json={"name": "Class 8 Science", "subject": "Science"},
        cookies=cookie(teacher),
    ).json()
    client.post(
        "/api/lms/enrollments/join",
        json={"joinCode": classroom["joinCode"]},
        cookies=cookie(student),
    )
    return classroom


def test_full_coursework_lifecycle(client, token_factory):
    teacher = token_factory("teacher")
    student = token_factory("student")
    classroom = setup_class_with_student(client, teacher, student)

    # Teacher creates a draft assignment.
    coursework = client.post(
        f"/api/lms/classrooms/{classroom['id']}/coursework",
        json={"title": "Photosynthesis worksheet", "type": "assignment", "maxPoints": 10},
        cookies=cookie(teacher),
    ).json()
    assert coursework["status"] == "draft"

    # Draft is invisible to students.
    student_view = client.get(
        f"/api/lms/student/classrooms/{classroom['id']}/coursework", cookies=cookie(student)
    ).json()["coursework"]
    assert student_view == []

    # Publish → now visible.
    published = client.post(
        f"/api/lms/coursework/{coursework['id']}/publish", cookies=cookie(teacher)
    ).json()
    assert published["status"] == "published"
    assert published["publishedAt"]

    student_view = client.get(
        f"/api/lms/student/classrooms/{classroom['id']}/coursework", cookies=cookie(student)
    ).json()["coursework"]
    assert len(student_view) == 1
    assert student_view[0]["mySubmission"] is None

    # Student submits.
    submission = client.post(
        f"/api/lms/coursework/{coursework['id']}/submit",
        json={"text": "Plants convert light into energy."},
        cookies=cookie(student),
    )
    assert submission.status_code == 201, submission.text
    submission = submission.json()
    assert submission["status"] == "turned_in"
    assert submission["content"] == {"text": "Plants convert light into energy."}

    # Teacher sees one turned-in submission.
    submissions = client.get(
        f"/api/lms/coursework/{coursework['id']}/submissions", cookies=cookie(teacher)
    ).json()
    assert submissions["stats"]["turnedIn"] == 1
    assert submissions["submissions"][0]["studentId"] == STUDENT_A
    assert submissions["submissions"][0]["studentName"] == "Test Student"

    # Teacher grades and returns.
    graded = client.post(
        f"/api/lms/submissions/{submission['id']}/grade",
        json={"grade": 9, "feedback": "Great work"},
        cookies=cookie(teacher),
    ).json()
    assert graded["grade"] == 9.0
    assert graded["status"] == "returned"

    # Student sees the grade on their submission list.
    my_subs = client.get("/api/lms/student/submissions", cookies=cookie(student)).json()["submissions"]
    assert my_subs[0]["grade"] == 9.0
    assert my_subs[0]["feedback"] == "Great work"


def test_non_enrolled_student_cannot_submit(client, token_factory):
    teacher = token_factory("teacher")
    enrolled = token_factory("student")
    classroom = setup_class_with_student(client, teacher, enrolled)
    coursework = client.post(
        f"/api/lms/classrooms/{classroom['id']}/coursework",
        json={"title": "W", "type": "assignment"},
        cookies=cookie(teacher),
    ).json()
    client.post(f"/api/lms/coursework/{coursework['id']}/publish", cookies=cookie(teacher))

    outsider = token_factory("student", user_id="99999999-9999-9999-9999-999999999999")
    res = client.post(
        f"/api/lms/coursework/{coursework['id']}/submit",
        json={"text": "hi"},
        cookies=cookie(outsider),
    )
    assert res.status_code == 403


def test_grade_cannot_exceed_max_points(client, token_factory):
    teacher = token_factory("teacher")
    student = token_factory("student")
    classroom = setup_class_with_student(client, teacher, student)
    coursework = client.post(
        f"/api/lms/classrooms/{classroom['id']}/coursework",
        json={"title": "W", "type": "assignment", "maxPoints": 5},
        cookies=cookie(teacher),
    ).json()
    client.post(f"/api/lms/coursework/{coursework['id']}/publish", cookies=cookie(teacher))
    submission = client.post(
        f"/api/lms/coursework/{coursework['id']}/submit",
        json={"text": "answer"},
        cookies=cookie(student),
    ).json()

    res = client.post(
        f"/api/lms/submissions/{submission['id']}/grade",
        json={"grade": 8},
        cookies=cookie(teacher),
    )
    assert res.status_code == 400


def test_material_cannot_be_submitted(client, token_factory):
    teacher = token_factory("teacher")
    student = token_factory("student")
    classroom = setup_class_with_student(client, teacher, student)
    material = client.post(
        f"/api/lms/classrooms/{classroom['id']}/coursework",
        json={"title": "Read this", "type": "material"},
        cookies=cookie(teacher),
    ).json()
    client.post(f"/api/lms/coursework/{material['id']}/publish", cookies=cookie(teacher))

    res = client.post(
        f"/api/lms/coursework/{material['id']}/submit",
        json={"text": "x"},
        cookies=cookie(student),
    )
    assert res.status_code == 400


def test_teacher_cannot_grade_across_schools(client, token_factory):
    teacher = token_factory("teacher")
    student = token_factory("student")
    classroom = setup_class_with_student(client, teacher, student)
    coursework = client.post(
        f"/api/lms/classrooms/{classroom['id']}/coursework",
        json={"title": "W", "type": "assignment"},
        cookies=cookie(teacher),
    ).json()
    client.post(f"/api/lms/coursework/{coursework['id']}/publish", cookies=cookie(teacher))
    submission = client.post(
        f"/api/lms/coursework/{coursework['id']}/submit",
        json={"text": "answer"},
        cookies=cookie(student),
    ).json()

    intruder = token_factory("teacher", user_id="88888888-8888-8888-8888-888888888888", school_id="44444444-4444-4444-4444-444444444444")
    res = client.post(
        f"/api/lms/submissions/{submission['id']}/grade",
        json={"grade": 1},
        cookies=cookie(intruder),
    )
    assert res.status_code == 404
