const express    = require('express');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const rateLimit  = require('express-rate-limit');
const { PrismaClient } = require('@prisma/client');

const requireAuth = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

const SESSION_MAX_AGE_MS = 86_400_000; // 24 hours

const loginLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again in a minute.' },
});

function isSecureCookieEnabled() {
  if (process.env.COOKIE_SECURE) return process.env.COOKIE_SECURE === 'true';
  return process.env.NODE_ENV === 'production';
}

function jwtCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'Strict',
    secure: isSecureCookieEnabled(),
    path: '/',
    maxAge: SESSION_MAX_AGE_MS,
  };
}

function issueJwtCookie(res, token) {
  res.cookie('jwt', token, jwtCookieOptions());
}

function clearJwtCookie(res) {
  const { maxAge, ...clearOptions } = jwtCookieOptions();
  res.clearCookie('jwt', clearOptions);
}

function selfRegistrationEnabled() {
  return process.env.ALLOW_SELF_REGISTRATION === 'true';
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    if (!selfRegistrationEnabled())
      return res.status(403).json({ error: 'Self registration is disabled. Contact your school administrator.' });

    const { name, email, password, role, schoolId } = req.body;

    if (!name || !email || !password || !role || !schoolId)
      return res.status(400).json({ error: 'Missing required fields: name, email, password, role, schoolId' });

    if (role === 'teacher')
      return res.status(400).json({ error: 'Teacher accounts cannot self-register. Contact your administrator.' });

    if (!['student', 'parent'].includes(role))
      return res.status(400).json({ error: 'Invalid role. Must be student or parent.' });

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing)
      return res.status(400).json({ error: 'An account with this email already exists.' });

    const school = await prisma.school.findUnique({ where: { id: schoolId } });
    if (!school)
      return res.status(400).json({ error: 'Invalid schoolId.' });

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: { name, email, passwordHash, role, schoolId },
    });

    return res.status(201).json({ userId: user.id, role: user.role });
  } catch (err) {
    console.error('[auth] register error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password)
      return res.status(400).json({ error: 'Email and password are required.' });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user)
      return res.status(401).json({ error: 'Invalid email or password.' });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid)
      return res.status(401).json({ error: 'Invalid email or password.' });

    const payload = {
      userId:   user.id,
      role:     user.role,
      schoolId: user.schoolId,
    };

    // Parents carry their children's IDs so downstream services can
    // authorise parent-scoped queries without additional DB lookups.
    if (user.role === 'parent') {
      const links = await prisma.parentStudent.findMany({
        where:  { parentId: user.id },
        select: { studentId: true },
      });
      payload.studentIds = links.map(l => l.studentId);
    }

    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '24h' });
    issueJwtCookie(res, token);

    return res.status(200).json({ userId: user.id, role: user.role, name: user.name });
  } catch (err) {
    console.error('[auth] login error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/logout
router.post('/logout', requireAuth, (req, res) => {
  clearJwtCookie(res);
  return res.status(200).json({ message: 'Logged out successfully.' });
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where:  { id: req.user.userId },
      select: { id: true, name: true, email: true, role: true, schoolId: true },
    });

    if (!user)
      return res.status(404).json({ error: 'User not found.' });

    return res.status(200).json({
      userId:   user.id,
      name:     user.name,
      email:    user.email,
      role:     user.role,
      schoolId: user.schoolId,
    });
  } catch (err) {
    console.error('[auth] /me error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/link-parent
router.post(
  '/link-parent',
  requireAuth,
  requireAuth.requireRole('teacher'),
  async (req, res) => {
    try {
      const { parentId, studentId } = req.body;

      if (!parentId || !studentId)
        return res.status(400).json({ error: 'parentId and studentId are required.' });

      const [parent, student] = await Promise.all([
        prisma.user.findUnique({ where: { id: parentId } }),
        prisma.user.findUnique({ where: { id: studentId } }),
      ]);

      if (!parent || parent.role !== 'parent')
        return res.status(400).json({ error: 'parentId does not reference a valid parent account.' });

      if (!student || student.role !== 'student')
        return res.status(400).json({ error: 'studentId does not reference a valid student account.' });

      if (parent.schoolId !== req.user.schoolId || student.schoolId !== req.user.schoolId)
        return res.status(403).json({ error: 'Forbidden. Parent and student must belong to your school.' });

      // Upsert — safe to call multiple times
      await prisma.parentStudent.upsert({
        where:  { parentId_studentId: { parentId, studentId } },
        create: { parentId, studentId },
        update: {},
      });

      return res.status(200).json({ message: 'Parent-student link established.' });
    } catch (err) {
      console.error('[auth] link-parent error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// GET /api/auth/parent/:id/students
router.get(
  '/parent/:id/students',
  requireAuth,
  requireAuth.requireRole('parent', 'teacher'),
  async (req, res) => {
    try {
      const { id } = req.params;

      // Parents can only query their own children; teachers can query parents in their school.
      if (req.user.role === 'parent' && req.user.userId !== id)
        return res.status(403).json({ error: 'Forbidden. You can only view your own children.' });

      if (req.user.role === 'teacher') {
        const parent = await prisma.user.findUnique({
          where:  { id },
          select: { role: true, schoolId: true },
        });
        if (!parent || parent.role !== 'parent' || parent.schoolId !== req.user.schoolId)
          return res.status(403).json({ error: 'Forbidden. You can only view parents in your school.' });
      }

      const links = await prisma.parentStudent.findMany({
        where:   { parentId: id },
        include: { student: { select: { id: true, name: true } } },
      });

      return res.status(200).json(
        links.map(l => ({ studentId: l.student.id, name: l.student.name }))
      );
    } catch (err) {
      console.error('[auth] parent/:id/students error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

module.exports = router;
