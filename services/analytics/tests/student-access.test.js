const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  assertStudentInSchool,
  assertTeacherCanAccessStudent,
  assertParentCanAccessStudent,
} = require('../lib/student-access');

const SCHOOL_A = '550e8400-e29b-41d4-a716-446655440000';
const SCHOOL_B = '660e8400-e29b-41d4-a716-446655440001';
const STUDENT_A = '770e8400-e29b-41d4-a716-446655440002';
const TEACHER_A = '880e8400-e29b-41d4-a716-446655440003';

function mockPrisma({ student = null, assignment = null } = {}) {
  return {
    $queryRaw: async () => (student ? [student] : []),
    classAssignment: {
      findFirst: async () => assignment,
    },
  };
}

describe('student access', () => {
  it('returns 404 for unknown student', async () => {
    const result = await assertStudentInSchool(mockPrisma(), STUDENT_A, SCHOOL_A);
    assert.equal(result.status, 404);
  });

  it('returns 403 for student from another school', async () => {
    const prisma = mockPrisma({
      student: { id: STUDENT_A, schoolId: SCHOOL_B, role: 'student' },
    });
    const result = await assertStudentInSchool(prisma, STUDENT_A, SCHOOL_A);
    assert.equal(result.status, 403);
  });

  it('accepts valid student in same school', async () => {
    const prisma = mockPrisma({
      student: { id: STUDENT_A, schoolId: SCHOOL_A, role: 'student' },
    });
    const result = await assertStudentInSchool(prisma, STUDENT_A, SCHOOL_A);
    assert.ok(result.student);
  });

  it('requires class assignment for teacher writes', async () => {
    const prisma = mockPrisma({
      student: { id: STUDENT_A, schoolId: SCHOOL_A, role: 'student' },
      assignment: null,
    });
    const teacher = { userId: TEACHER_A, schoolId: SCHOOL_A };
    const result = await assertTeacherCanAccessStudent(prisma, teacher, STUDENT_A);
    assert.equal(result.status, 404);
  });

  it('allows teacher access for assigned student', async () => {
    const prisma = mockPrisma({
      student: { id: STUDENT_A, schoolId: SCHOOL_A, role: 'student' },
      assignment: { id: 'assign-1' },
    });
    const teacher = { userId: TEACHER_A, schoolId: SCHOOL_A };
    const result = await assertTeacherCanAccessStudent(prisma, teacher, STUDENT_A);
    assert.ok(result.student);
    assert.ok(result.assignment);
  });

  it('allows parent access only for linked children', async () => {
    const parent = { studentIds: [STUDENT_A] };
    assert.ok(!(await assertParentCanAccessStudent(parent, STUDENT_A)).error);
    assert.equal((await assertParentCanAccessStudent(parent, TEACHER_A)).status, 403);
  });
});
