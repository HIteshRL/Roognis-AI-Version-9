// ─────────────────────────────────────────────────────────────────────────────
// Roognis AI — Analytics Service stub
// Replace this file with the full implementation.
// See: roognis-ai-design-complete.pdf → LLD v3 → Analytics Service :3004
//
// Responsibilities:
//   - POST /api/analytics/event          → fire-and-forget event ingestion (no JWT)
//   - POST /api/analytics/attendance     → mark attendance (teacher only)
//   - POST /api/analytics/score          → enter test score (teacher only)
//   - POST /api/analytics/class/assign   → add student to class (teacher only)
//   - GET  /api/analytics/student/:id    → full student profile
//   - GET  /api/analytics/teacher/dashboard
//   - GET  /api/analytics/teacher/interventions
//   - GET  /api/analytics/parent/dashboard?studentId=xxx
//   - GET  /api/analytics/queries/trends
//
// JWT middleware: copy services/auth/middleware/auth.js into middleware/auth.js
// DB schema: analytics_db — events, attendance, scores, class_assignments
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express');
const app     = express();
const PORT    = process.env.PORT || 3004;

app.use(express.json());

app.get('/health', (_req, res) => res.status(200).json({ status: 'stub', service: 'analytics' }));

// Accept fire-and-forget events so AI service doesn't crash on boot
app.post('/api/analytics/event', (_req, res) => res.status(202).json({ received: true }));

app.use((_req, res) => res.status(503).json({ error: 'Analytics service not yet implemented.' }));

app.listen(PORT, () => console.log(`[analytics] Stub running on :${PORT}`));
