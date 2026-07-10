# Auth Service LLD

Service path: `services/auth`

## Purpose

Auth owns user identity, role-based login, parent-child links, and the classroom roster required by the teacher quiz workflow.

Current Auth is good for login, but not enough for "students registered under teacher". That relationship must become real before Quiz Service can safely publish assignments to a class.

## Current Repo State

Implemented:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `POST /api/auth/link-parent`
- `GET /api/auth/parent/:id/students`

Current schema:

- `School`
- `User`
- `ParentStudent`
- `Role`

Current seed:

- `teacher@demo.com`
- `arjun@demo.com`
- `priya@demo.com`
- `rahul@demo.com`
- `parent1@demo.com` linked to Arjun
- `parent2@demo.com` linked to Priya

## Gaps

Missing:

- Classrooms.
- Teacher ownership of a classroom.
- Student enrollment in a classroom.
- Grade/section/subject metadata.
- API to list teacher's classes.
- API to list students under a teacher.
- Parent dashboard must use actual linked children, not hardcoded child options.

## Required Schema Changes

Add these models to `services/auth/prisma/schema.prisma`.

```prisma
model Classroom {
  id        String   @id @default(uuid()) @db.Uuid
  schoolId  String   @map("school_id") @db.Uuid
  teacherId String   @map("teacher_id") @db.Uuid
  name      String   @db.VarChar(120)
  grade     String   @db.VarChar(20)
  section   String?  @db.VarChar(20)
  subject   String?  @db.VarChar(80)
  createdAt DateTime @default(now()) @map("created_at")

  school      School @relation(fields: [schoolId], references: [id])
  teacher     User   @relation("TeacherClassrooms", fields: [teacherId], references: [id])
  enrollments ClassroomEnrollment[]

  @@index([schoolId, teacherId])
  @@map("classrooms")
  @@schema("auth_db")
}

model ClassroomEnrollment {
  classroomId String   @map("classroom_id") @db.Uuid
  studentId   String   @map("student_id") @db.Uuid
  status      String   @default("active") @db.VarChar(20)
  createdAt   DateTime @default(now()) @map("created_at")

  classroom Classroom @relation(fields: [classroomId], references: [id], onDelete: Cascade)
  student   User      @relation("StudentClassrooms", fields: [studentId], references: [id])

  @@id([classroomId, studentId])
  @@index([studentId])
  @@map("classroom_enrollments")
  @@schema("auth_db")
}
```

Update `User`:

```prisma
teachingClassrooms Classroom[] @relation("TeacherClassrooms")
studentClassrooms  ClassroomEnrollment[] @relation("StudentClassrooms")
```

Optional later:

- `StudentProfile` for roll number, grade, section.
- `TeacherProfile` if the teacher needs school metadata beyond `User`.

## Required APIs

```text
GET  /api/auth/teacher/classes
GET  /api/auth/classes/:classroomId/students
POST /api/auth/classes
POST /api/auth/classes/:classroomId/students
GET  /api/auth/student/classes
```

### `GET /api/auth/teacher/classes`

Role: teacher

Response:

```json
[
  {
    "classroomId": "uuid",
    "name": "Class 6 Science",
    "grade": "6",
    "section": "A",
    "subject": "Science",
    "studentCount": 28
  }
]
```

### `GET /api/auth/classes/:classroomId/students`

Role: teacher

Rule:

- Teacher can list only students in their own classroom.

Response:

```json
[
  {
    "studentId": "uuid",
    "name": "Arjun Sharma",
    "email": "arjun@demo.com"
  }
]
```

### `GET /api/auth/student/classes`

Role: student

Response:

```json
[
  {
    "classroomId": "uuid",
    "name": "Class 6 Science",
    "subject": "Science",
    "teacherName": "Demo Teacher"
  }
]
```

## Authorization Rules

- Teacher can access only classrooms where `classrooms.teacher_id = req.user.userId`.
- Student can access only own enrolled classrooms.
- Parent can access only linked students from `parent_student`.
- Quiz Service should verify classroom ownership through Auth before publishing assignments.

## Seed Updates

Update `services/auth/scripts/seed.js`:

- Create `Class 6 Science`.
- Assign `teacher@demo.com` as teacher.
- Enroll Arjun, Priya, Rahul.
- Keep parent links:
  - Parent One -> Arjun only.
  - Parent Two -> Priya only.

## Done Criteria

- Teacher can list own class.
- Teacher can list students under own class.
- Student can list own class.
- Parent One API returns only Arjun.
- Tests cover forbidden classroom access.

## Tests

Add tests for:

- Missing JWT returns 401.
- Student cannot call teacher class APIs.
- Teacher cannot access another teacher's class.
- Parent cannot read another parent's linked children.
- Enrollment duplicate is handled safely.

