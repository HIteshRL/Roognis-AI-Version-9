// ─────────────────────────────────────────────────────────────────────────────
// Roognis AI — AI Service stub
// Replace this file with the full implementation.
// See: roognis-ai-design-complete.pdf → LLD v3 → AI Service :3002
//
// Responsibilities:
//   - POST /api/ai/chat/session  → create chat session
//   - POST /api/ai/chat          → SSE streaming chat (RAG + Ollama)
//   - GET  /api/ai/chat/:id/history
//   - POST /api/ai/image         → async image generation (ComfyUI)
//   - GET  /api/ai/image/:id/status
//   - GET  /api/ai/video/topics
//   - GET  /api/ai/video/:topic
//   - POST /api/ai/feedback
//
// JWT middleware: copy services/auth/middleware/auth.js into middleware/auth.js
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express');
const app     = express();
const PORT    = process.env.PORT || 3002;

app.use(express.json());

app.get('/health', (_req, res) => res.status(200).json({ status: 'stub', service: 'ai' }));

app.use((_req, res) => res.status(503).json({ error: 'AI service not yet implemented.' }));

app.listen(PORT, () => console.log(`[ai] Stub running on :${PORT}`));
