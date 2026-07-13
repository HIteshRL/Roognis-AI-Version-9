const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

const DEMO_SCHOOL_ID = process.env.DEMO_SCHOOL_ID;
const SEED_DEMO_USERS = process.env.SEED_DEMO_USERS === 'true';

const DEMO_USERS = [
  { name: 'Demo Teacher',  email: 'teacher@demo.com', password: 'demo1234', role: 'teacher' },
  { name: 'Arjun Sharma',  email: 'arjun@demo.com',   password: 'demo1234', role: 'student' },
  { name: 'Priya Singh',   email: 'priya@demo.com',   password: 'demo1234', role: 'student' },
  { name: 'Rahul Verma',   email: 'rahul@demo.com',   password: 'demo1234', role: 'student' },
  { name: 'Parent One',    email: 'parent1@demo.com', password: 'demo1234', role: 'parent'  },
  { name: 'Parent Two',    email: 'parent2@demo.com', password: 'demo1234', role: 'parent'  },
];

async function main() {
  if (!SEED_DEMO_USERS) {
    console.log('[seed] Demo user seeding disabled.');
    return;
  }

  const count = await prisma.user.count();
  if (count > 0) {
    console.log('[seed] Database already seeded — skipping.');
    return;
  }

  if (!DEMO_SCHOOL_ID) {
    console.error('[seed] DEMO_SCHOOL_ID environment variable is required.');
    process.exit(1);
  }

  await prisma.school.upsert({
    where:  { id: DEMO_SCHOOL_ID },
    create: { id: DEMO_SCHOOL_ID, name: 'Demo School' },
    update: { name: 'Demo School' },
  });
  console.log('[seed] School upserted:', DEMO_SCHOOL_ID);

  const created = {};
  for (const u of DEMO_USERS) {
    const passwordHash = await bcrypt.hash(u.password, 12);
    const user = await prisma.user.create({
      data: {
        name:         u.name,
        email:        u.email,
        passwordHash,
        role:         u.role,
        schoolId:     DEMO_SCHOOL_ID,
      },
    });
    created[u.email] = user.id;
    console.log(`[seed] Created ${u.role}: ${u.email}`);
  }

  await prisma.parentStudent.createMany({
    data: [
      { parentId: created['parent1@demo.com'], studentId: created['arjun@demo.com'] },
      { parentId: created['parent2@demo.com'], studentId: created['priya@demo.com'] },
    ],
    skipDuplicates: true,
  });

  console.log('[seed] Parent-student links created.');
  console.log('[seed] Seeding complete.');
}

main()
  .catch(err => {
    console.error('[seed] Fatal error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
