const express = require('express');
const cookieParser = require('cookie-parser');
const { PrismaClient } = require('@prisma/client');
const { TextDecoder } = require('util');
const fs = require('fs/promises');
const path = require('path');

const requireAuth = require('./middleware/auth');
const videoLibrary = require('./data/video-library.json');

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3002;
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://ollama:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5';
const RAG_SERVICE_URL = process.env.RAG_SERVICE_URL || 'http://rag:3003';
const ANALYTICS_URL = process.env.ANALYTICS_URL || 'http://analytics:3004';
const INTERNAL_SERVICE_TOKEN = process.env.INTERNAL_SERVICE_TOKEN || '';
const COMFYUI_URL = process.env.COMFYUI_URL || 'http://comfyui:8188';
const FILE_STORAGE_PATH = process.env.FILE_STORAGE_PATH || path.join(__dirname, 'storage');
const IMAGE_OUTPUT_DIR = path.join(FILE_STORAGE_PATH, 'images');
const IMAGE_PROMPT_MAX_LENGTH = 300;
const IMAGE_JOB_TIMEOUT_MS = Number(process.env.IMAGE_JOB_TIMEOUT_MS || 5 * 60 * 1000);
const IMAGE_POLL_INTERVAL_MS = Number(process.env.IMAGE_POLL_INTERVAL_MS || 3000);
const IMAGE_TIMEOUT_CLEANUP_MS = Number(process.env.IMAGE_TIMEOUT_CLEANUP_MS || 2 * 60 * 1000);

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.locals.prisma = prisma;

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'ai' });
});

const studentOnly = [requireAuth, requireAuth.requireRole('student')];

app.post('/api/ai/chat/session', ...studentOnly, asyncHandler(async (req, res) => {
  const subject = normalizeSubject(req.body?.subject);
  if (!subject) {
    return res.status(400).json({ error: 'subject is required and must be 1-80 characters.' });
  }

  const session = await prisma.chatSession.create({
    data: {
      studentId: req.user.userId,
      schoolId: req.user.schoolId,
      subject,
    },
    select: { id: true },
  });

  res.status(201).json({ sessionId: session.id });
}));

app.get('/api/ai/chat/:sessionId/history', ...studentOnly, asyncHandler(async (req, res) => {
  const session = await findOwnedSession(req.params.sessionId, req.user.userId);
  if (!session) return res.status(404).json({ error: 'Chat session not found.' });

  const messages = await prisma.message.findMany({
    where: { sessionId: session.id },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      role: true,
      content: true,
      createdAt: true,
    },
  });

  res.status(200).json(messages.map(message => ({
    messageId: message.id,
    role: message.role,
    content: message.content,
    timestamp: message.createdAt,
  })));
}));

app.post('/api/ai/chat', ...studentOnly, asyncHandler(async (req, res) => {
  const { sessionId } = req.body || {};
  const message = normalizeMessage(req.body?.message);

  if (!sessionId) return res.status(400).json({ error: 'sessionId is required.' });
  if (!message) return res.status(400).json({ error: 'message is required and must be 1-500 characters.' });

  const session = await findOwnedSession(sessionId, req.user.userId);
  if (!session) return res.status(404).json({ error: 'Chat session not found.' });

  const history = await loadRecentHistory(session.id);
  const userMessage = await prisma.message.create({
    data: {
      sessionId: session.id,
      role: 'user',
      content: message,
    },
    select: { id: true },
  });

  setSseHeaders(res);
  sendSseEvent(res, 'status', { status: 'loading' });

  const streamController = new AbortController();
  let clientClosed = false;
  res.on('close', () => {
    clientClosed = true;
    streamController.abort();
  });

  try {
    const chunks = await retrieveRagChunks({
      q: message,
      schoolId: session.schoolId,
      subject: session.subject,
      top: 5,
    });

    const prompt = buildTutorPrompt({
      chunks,
      history,
      question: message,
    });

    const assistantContent = await streamOllamaResponse({
      prompt,
      res,
      signal: streamController.signal,
      isClientClosed: () => clientClosed,
    });

    if (clientClosed) return;

    const finalAssistantContent = assistantContent.trim() || "I don't have information on that yet.";
    const assistantMessage = await prisma.message.create({
      data: {
        sessionId: session.id,
        role: 'assistant',
        content: finalAssistantContent,
      },
      select: { id: true },
    });

    fireAnalyticsEvent({
      type: 'chat_message',
      studentId: req.user.userId,
      schoolId: req.user.schoolId,
      subject: session.subject,
      sessionId: session.id,
      metadata: {
        userMessageId: userMessage.id,
        assistantMessageId: assistantMessage.id,
        messageLength: message.length,
        ragChunkCount: chunks.length,
      },
    });

    sendSseEvent(res, 'done', '[DONE]');
    res.end();
  } catch (err) {
    if (clientClosed) return;

    console.error('[ai] chat stream error:', err);
    sendSseEvent(res, 'error', { error: 'AI response failed. Please try again.' });
    sendSseEvent(res, 'done', '[DONE]');
    res.end();
  }
}));

app.get('/api/ai/video/topics', ...studentOnly, (_req, res) => {
  const topics = videoLibrary.map(topic => {
    const approvedVideos = getApprovedVideos(topic);
    return {
      topic: topic.topic,
      label: topic.label,
      subject: topic.subject,
      gradeLevel: topic.gradeLevel,
      description: topic.description,
      videoCount: approvedVideos.length,
      averageQualityScore: calculateAverageQualityScore(approvedVideos),
    };
  });

  res.status(200).json(topics);
});

app.get('/api/ai/video/:topic', ...studentOnly, (req, res) => {
  const topic = findVideoTopic(req.params.topic);
  if (!topic) {
    return res.status(404).json({ error: 'Video topic not found.' });
  }

  const videos = getApprovedVideos(topic);
  res.status(200).json({
    topic: topic.topic,
    label: topic.label,
    subject: topic.subject,
    gradeLevel: topic.gradeLevel,
    description: topic.description,
    videos,
  });
});

app.post('/api/ai/feedback', ...studentOnly, asyncHandler(async (req, res) => {
  const { messageId, sessionId } = req.body || {};
  const rating = Number(req.body?.rating);
  const comment = normalizeOptionalComment(req.body?.comment);

  if (!messageId) return res.status(400).json({ error: 'messageId is required.' });
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'rating must be an integer from 1 to 5.' });
  }
  if (comment === false) {
    return res.status(400).json({ error: 'comment must be a string up to 1000 characters.' });
  }

  const message = await prisma.message.findFirst({
    where: {
      id: messageId,
      role: 'assistant',
      session: {
        studentId: req.user.userId,
      },
    },
    select: {
      id: true,
      sessionId: true,
      session: {
        select: {
          id: true,
          schoolId: true,
          subject: true,
        },
      },
    },
  });

  if (!message) return res.status(404).json({ error: 'Assistant message not found.' });
  if (sessionId && sessionId !== message.sessionId) {
    return res.status(400).json({ error: 'sessionId does not match message session.' });
  }

  const feedback = await prisma.feedback.create({
    data: {
      messageId: message.id,
      studentId: req.user.userId,
      schoolId: message.session.schoolId,
      rating,
      comment: comment || null,
    },
    select: { id: true },
  });

  fireAnalyticsEvent({
    type: 'feedback_submitted',
    studentId: req.user.userId,
    schoolId: message.session.schoolId,
    subject: message.session.subject,
    sessionId: message.session.id,
    metadata: {
      messageId: message.id,
      feedbackId: feedback.id,
      rating,
      hasComment: Boolean(comment),
    },
  });

  res.status(201).json({ feedbackId: feedback.id });
}));

app.post('/api/ai/image', ...studentOnly, asyncHandler(async (req, res) => {
  const prompt = normalizeImagePrompt(req.body?.prompt);
  if (!prompt) {
    return res.status(400).json({ error: `prompt is required and must be 1-${IMAGE_PROMPT_MAX_LENGTH} characters.` });
  }

  const job = await prisma.imageJob.create({
    data: {
      studentId: req.user.userId,
      schoolId: req.user.schoolId,
      prompt,
      status: 'queued',
    },
    select: {
      id: true,
      status: true,
    },
  });

  runImageJobInBackground(job.id);

  res.status(202).json({
    jobId: job.id,
    status: job.status,
  });
}));

app.get('/api/ai/image/:jobId/status', ...studentOnly, asyncHandler(async (req, res) => {
  if (!isValidUuid(req.params.jobId)) {
    return res.status(404).json({ error: 'Image job not found.' });
  }

  const job = await prisma.imageJob.findFirst({
    where: {
      id: req.params.jobId,
      studentId: req.user.userId,
    },
    select: {
      id: true,
      status: true,
      imageUrl: true,
      failureReason: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!job) return res.status(404).json({ error: 'Image job not found.' });

  res.status(200).json({
    jobId: job.id,
    status: job.status,
    imageUrl: job.imageUrl,
    failureReason: job.failureReason,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  });
}));

app.get('/api/ai/images/:filename', ...studentOnly, asyncHandler(async (req, res) => {
  const filename = req.params.filename;
  if (!isValidImageFilename(filename)) {
    return res.status(404).json({ error: 'Image not found.' });
  }

  const jobId = filename.slice(0, -'.png'.length);
  const job = await prisma.imageJob.findFirst({
    where: {
      id: jobId,
      studentId: req.user.userId,
      status: 'done',
    },
    select: {
      id: true,
    },
  });

  if (!job) return res.status(404).json({ error: 'Image not found.' });

  const imagePath = path.join(IMAGE_OUTPUT_DIR, filename);
  try {
    const image = await fs.readFile(imagePath);
    res.type('png').status(200).send(image);
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Image not found.' });
    throw err;
  }
}));

app.use('/api/ai', (_req, res) => {
  res.status(404).json({ error: 'AI endpoint not implemented yet.' });
});

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, _req, res, _next) => {
  console.error('[ai] unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const server = app.listen(PORT, () => {
  console.log(`[ai] Service running on :${PORT}`);
});

const imageTimeoutTimer = setInterval(() => {
  cleanupStaleImageJobs().catch(err => {
    console.warn('[ai] image timeout cleanup failed:', err.message);
  });
}, IMAGE_TIMEOUT_CLEANUP_MS);
imageTimeoutTimer.unref?.();

async function shutdown(signal) {
  console.log(`[ai] ${signal} received. Shutting down...`);
  clearInterval(imageTimeoutTimer);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function normalizeSubject(subject) {
  if (typeof subject !== 'string') return null;
  const trimmed = subject.trim();
  if (!trimmed || trimmed.length > 80) return null;
  return trimmed;
}

function normalizeMessage(message) {
  if (typeof message !== 'string') return null;
  const trimmed = message.trim();
  if (!trimmed || trimmed.length > 500) return null;
  return trimmed;
}

function normalizeOptionalComment(comment) {
  if (comment == null) return null;
  if (typeof comment !== 'string') return false;
  const trimmed = comment.trim();
  if (trimmed.length > 1000) return false;
  return trimmed || null;
}

function normalizeImagePrompt(prompt) {
  if (typeof prompt !== 'string') return null;
  const trimmed = prompt.trim();
  if (!trimmed || trimmed.length > IMAGE_PROMPT_MAX_LENGTH) return null;
  return trimmed;
}

function findVideoTopic(topic) {
  if (!topic) return null;
  const normalized = topic.trim().toLowerCase();
  return videoLibrary.find(item => item.topic.toLowerCase() === normalized);
}

function getApprovedVideos(topic) {
  return topic.videos
    .filter(video => video.reviewStatus === 'approved_source')
    .sort((a, b) => b.qualityScore - a.qualityScore);
}

function calculateAverageQualityScore(videos) {
  if (!videos.length) return null;
  const total = videos.reduce((sum, video) => sum + video.qualityScore, 0);
  return Math.round(total / videos.length);
}

function runImageJobInBackground(jobId) {
  setImmediate(() => {
    processImageJob(jobId).catch(err => {
      console.error(`[ai] image job ${jobId} failed unexpectedly:`, err);
    });
  });
}

async function processImageJob(jobId) {
  const claimed = await prisma.imageJob.updateMany({
    where: {
      id: jobId,
      status: 'queued',
    },
    data: {
      status: 'processing',
      failureReason: null,
    },
  });

  if (claimed.count !== 1) return;

  const job = await prisma.imageJob.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      prompt: true,
      studentId: true,
      schoolId: true,
    },
  });

  if (!job) return;

  try {
    await fs.mkdir(IMAGE_OUTPUT_DIR, { recursive: true });

    const promptId = await submitComfyPrompt(job.prompt, job.id);
    const outputImage = await waitForComfyOutput(promptId);
    const image = await downloadComfyImage(outputImage);
    const filename = `${job.id}.png`;
    const imageUrl = `/api/ai/images/${filename}`;

    await fs.writeFile(path.join(IMAGE_OUTPUT_DIR, filename), image);

    await prisma.imageJob.update({
      where: { id: job.id },
      data: {
        status: 'done',
        imageUrl,
        failureReason: null,
      },
    });

    fireAnalyticsEvent({
      type: 'image_generated',
      studentId: job.studentId,
      schoolId: job.schoolId,
      metadata: {
        jobId: job.id,
        promptLength: job.prompt.length,
      },
    });
  } catch (err) {
    console.warn(`[ai] image job ${job.id} failed:`, err.message);
    await prisma.imageJob.update({
      where: { id: job.id },
      data: {
        status: 'failed',
        failureReason: buildImageFailureReason(err),
      },
    }).catch(updateErr => {
      console.warn(`[ai] image job ${job.id} failure update failed:`, updateErr.message);
    });
  }
}

async function submitComfyPrompt(prompt, jobId) {
  const response = await fetchJsonWithTimeout(
    `${COMFYUI_URL}/api/prompt`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildComfyWorkflow(prompt, jobId)),
    },
    10000
  );

  const promptId = response?.prompt_id;
  if (!promptId) throw new Error('ComfyUI did not return a prompt_id.');
  return promptId;
}

function buildComfyWorkflow(prompt, jobId) {
  return {
    prompt: {
      '4': {
        class_type: 'CheckpointLoaderSimple',
        inputs: { ckpt_name: 'v1-5-pruned-emaonly.ckpt' },
      },
      '5': {
        class_type: 'EmptyLatentImage',
        inputs: { width: 512, height: 512, batch_size: 1 },
      },
      '6': {
        class_type: 'CLIPTextEncode',
        inputs: {
          clip: ['4', 1],
          text: `${prompt}, educational, colorful, diagram style`,
        },
      },
      '7': {
        class_type: 'CLIPTextEncode',
        inputs: {
          clip: ['4', 1],
          text: 'ugly, blurry, nsfw, text, watermark, low quality',
        },
      },
      '3': {
        class_type: 'KSampler',
        inputs: {
          model: ['4', 0],
          positive: ['6', 0],
          negative: ['7', 0],
          latent_image: ['5', 0],
          seed: 42,
          steps: 20,
          cfg: 7,
          sampler_name: 'euler',
          scheduler: 'normal',
          denoise: 1,
        },
      },
      '8': {
        class_type: 'VAEDecode',
        inputs: { samples: ['3', 0], vae: ['4', 2] },
      },
      '9': {
        class_type: 'SaveImage',
        inputs: {
          filename_prefix: `roognis_${jobId}`,
          images: ['8', 0],
        },
      },
    },
  };
}

async function waitForComfyOutput(promptId) {
  const deadline = Date.now() + IMAGE_JOB_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const history = await fetchJsonWithTimeout(
      `${COMFYUI_URL}/history/${encodeURIComponent(promptId)}`,
      { method: 'GET' },
      10000
    );
    const image = findComfyOutputImage(history, promptId);
    if (image) return image;
    await sleep(IMAGE_POLL_INTERVAL_MS);
  }

  throw new Error('Image generation timed out.');
}

function findComfyOutputImage(history, promptId) {
  const promptHistory = history?.[promptId] || history;
  const outputs = promptHistory?.outputs;
  if (!outputs || typeof outputs !== 'object') return null;

  for (const output of Object.values(outputs)) {
    if (!Array.isArray(output?.images)) continue;
    const image = output.images.find(item => typeof item?.filename === 'string');
    if (image) return image;
  }

  return null;
}

async function downloadComfyImage(image) {
  if (!image?.filename) throw new Error('ComfyUI output image is missing a filename.');

  const params = new URLSearchParams({
    filename: image.filename,
    type: image.type || 'output',
  });
  if (image.subfolder) params.set('subfolder', image.subfolder);

  return fetchBufferWithTimeout(`${COMFYUI_URL}/view?${params.toString()}`, 30000);
}

async function cleanupStaleImageJobs() {
  const cutoff = new Date(Date.now() - IMAGE_JOB_TIMEOUT_MS);
  const result = await prisma.imageJob.updateMany({
    where: {
      status: 'processing',
      updatedAt: {
        lt: cutoff,
      },
    },
    data: {
      status: 'failed',
      failureReason: 'Image generation timed out.',
    },
  });

  if (result.count > 0) {
    console.warn(`[ai] marked ${result.count} stale image job(s) as failed`);
  }
}

function buildImageFailureReason(err) {
  if (err?.name === 'AbortError') return 'Image generation service timed out.';
  const message = typeof err?.message === 'string' ? err.message : '';
  if (!message) return 'Image generation failed.';
  if (message.length > 500) return `${message.slice(0, 497)}...`;
  return message;
}

function isValidImageFilename(filename) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/i.test(filename);
}

function isValidUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function findOwnedSession(sessionId, studentId) {
  if (!sessionId) return null;
  return prisma.chatSession.findFirst({
    where: {
      id: sessionId,
      studentId,
    },
    select: {
      id: true,
      studentId: true,
      schoolId: true,
      subject: true,
    },
  });
}

async function loadRecentHistory(sessionId) {
  const messages = await prisma.message.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      role: true,
      content: true,
      createdAt: true,
    },
  });

  return messages.reverse();
}

async function retrieveRagChunks({ q, schoolId, subject, top }) {
  const params = new URLSearchParams({
    q,
    schoolId,
    subject,
    top: String(top),
  });

  try {
    const response = await fetchJsonWithTimeout(
      `${RAG_SERVICE_URL}/api/rag/retrieve?${params.toString()}`,
      { method: 'GET' },
      5000
    );
    const chunks = Array.isArray(response) ? response : response?.chunks;
    if (!Array.isArray(chunks)) return [];

    return chunks
      .map(chunk => ({
        text: typeof chunk?.text === 'string' ? chunk.text.trim() : '',
        source: typeof chunk?.source === 'string' ? chunk.source : 'unknown',
        score: chunk?.score,
      }))
      .filter(chunk => chunk.text)
      .slice(0, top);
  } catch (err) {
    console.warn('[ai] RAG retrieve failed, continuing without chunks:', err.message);
    return [];
  }
}

function buildTutorPrompt({ chunks, history, question }) {
  const hasChunks = chunks.length > 0;
  const ragContext = hasChunks
    ? chunks.map((chunk, index) => `[${index + 1}] ${chunk.text} (source: ${chunk.source})`).join('\n\n')
    : 'No retrieved textbook context is available for this question yet.';

  const historyText = history.length
    ? history.map(message => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content}`).join('\n')
    : 'No previous conversation.';

  const noContextRule = hasChunks
    ? '- Answer ONLY based on the provided context below.'
    : `- Since no textbook context was retrieved, do not invent facts. Say: "I don't have information on that yet."`;

  return `You are Roognis, an AI tutor for school students.
Rules:
${noContextRule}
- If the answer is not in the context, say:
  "I don't have information on that yet."
- Be concise, friendly, and use simple language suitable for school students.
- Never make up facts.
- Format answers with bullet points when listing.

Context:
${ragContext}

Conversation so far:
${historyText}

Student question:
${question}`;
}

function setSseHeaders(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
}

function sendSseEvent(res, event, data) {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  res.write(`event: ${event}\n`);
  res.write(`data: ${payload}\n\n`);
}

async function streamOllamaResponse({ prompt, res, signal, isClientClosed }) {
  const response = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
      stream: true,
    }),
    signal,
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`Ollama request failed with ${response.status}: ${errorBody}`);
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let assistantContent = '';

  for await (const chunk of response.body) {
    if (isClientClosed()) break;

    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;

      const parsed = JSON.parse(line);
      if (parsed.response) {
        assistantContent += parsed.response;
        sendSseEvent(res, 'token', { text: parsed.response });
      }
      if (parsed.done) break;
    }
  }

  if (buffer.trim()) {
    const parsed = JSON.parse(buffer);
    if (parsed.response) {
      assistantContent += parsed.response;
      sendSseEvent(res, 'token', { text: parsed.response });
    }
  }

  return assistantContent;
}

async function fetchJsonWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchBufferWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}: ${errorBody}`);
    }

    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }
}

function fireAnalyticsEvent(event) {
  fetchJsonWithTimeout(
    `${ANALYTICS_URL}/api/analytics/event`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Service-Token': INTERNAL_SERVICE_TOKEN,
      },
      body: JSON.stringify(event),
    },
    3000
  ).catch(err => {
    console.warn('[ai] analytics event failed:', err.message);
  });
}
