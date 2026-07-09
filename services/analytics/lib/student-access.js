const { isValidUuid } = require('./validation');

async function findStudentUser(prisma, studentId) {
  const rows = await prisma.$queryRaw`
    SELECT id, school_id AS "schoolId", role
    FROM auth_db.users
    WHERE id = CAST(${studentId} AS uuid)
    LIMIT 1
  `;
  return rows[0] || null;
}

async function assertStudentInSchool(prisma, studentId, schoolId) {
  if (!isValidUuid(studentId))
    return { status: 400, error: 'studentId must be a valid UUID.' };

  const student = await findStudentUser(prisma, studentId);
  if (!student || student.role !== 'student')
    return { status: 404, error: 'Student not found.' };

  if (student.schoolId !== schoolId)
    return { status: 403, error: 'Forbidden.' };

  return { student };
}

async function assertTeacherCanAccessStudent(prisma, teacher, studentId) {
  const schoolCheck = await assertStudentInSchool(prisma, studentId, teacher.schoolId);
  if (schoolCheck.error) return schoolCheck;

  const assignment = await prisma.classAssignment.findFirst({
    where: {
      teacherId: teacher.userId,
      studentId,
      schoolId: teacher.schoolId,
    },
  });

  if (!assignment)
    return { status: 404, error: 'Student is not assigned to your class.' };

  return { student: schoolCheck.student, assignment };
}

async function assertParentCanAccessStudent(parent, studentId) {
  if (!isValidUuid(studentId))
    return { status: 400, error: 'studentId must be a valid UUID.' };

  if (!parent.studentIds?.includes(studentId))
    return { status: 403, error: 'Forbidden.' };

  return { ok: true };
}

async function getTeacherAssignedStudentIds(prisma, teacher) {
  const assignments = await prisma.classAssignment.findMany({
    where: {
      teacherId: teacher.userId,
      schoolId: teacher.schoolId,
    },
    select: { studentId: true },
  });

  return [...new Set(assignments.map(a => a.studentId))];
}

module.exports = {
  findStudentUser,
  assertStudentInSchool,
  assertTeacherCanAccessStudent,
  assertParentCanAccessStudent,
  getTeacherAssignedStudentIds,
};
