const OPENROUTER_CHAT_COMPLETIONS_PATH = '/chat/completions';
const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_OPENROUTER_QUIZ_MODEL = 'openai/gpt-5-mini';
const DEFAULT_QUIZ_QUESTION_COUNT = 10;
const DIFFICULTY_WEIGHTS = [
  ['simple', 0.5],
  ['medium', 0.3],
  ['hard', 0.2],
];

const quizDraftSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    chapterSummary: { type: 'string' },
    coverage: {
      type: 'array',
      minItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          concept: { type: 'string' },
          sourceChunkIds: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['concept', 'sourceChunkIds'],
      },
    },
    questions: {
      type: 'array',
      minItems: 5,
      maxItems: 30,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          order: { type: 'integer' },
          type: { type: 'string', enum: ['mcq', 'short_answer'] },
          difficulty: { type: 'string', enum: ['simple', 'medium', 'hard'] },
          bloomLevel: {
            type: 'string',
            enum: ['remember', 'understand', 'apply', 'analyze', 'evaluate'],
          },
          conceptTag: { type: 'string' },
          weakAreaLabel: { type: 'string' },
          prompt: { type: 'string' },
          options: {
            type: 'array',
            minItems: 0,
            maxItems: 4,
            items: { type: 'string' },
          },
          correctAnswer: { type: 'string' },
          explanation: { type: 'string' },
          sourceChunkIds: {
            type: 'array',
            minItems: 1,
            items: { type: 'string' },
          },
          marks: { type: 'integer', minimum: 1, maximum: 5 },
        },
        required: [
          'order',
          'type',
          'difficulty',
          'bloomLevel',
          'conceptTag',
          'weakAreaLabel',
          'prompt',
          'options',
          'correctAnswer',
          'explanation',
          'sourceChunkIds',
          'marks',
        ],
      },
    },
  },
  required: ['title', 'chapterSummary', 'coverage', 'questions'],
};

function buildDifficultyPlan(questionCount = DEFAULT_QUIZ_QUESTION_COUNT) {
  const count = normalizeQuestionCount(questionCount);
  const planned = DIFFICULTY_WEIGHTS.map(([difficulty, weight], index) => {
    const exact = count * weight;
    return {
      difficulty,
      count: Math.floor(exact),
      remainder: exact - Math.floor(exact),
      index,
    };
  });

  let assigned = planned.reduce((sum, item) => sum + item.count, 0);
  planned
    .slice()
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
    .forEach(item => {
      if (assigned >= count) return;
      item.count += 1;
      assigned += 1;
    });

  return Object.fromEntries(planned.map(item => [item.difficulty, item.count]));
}

function normalizeQuestionCount(value) {
  const numeric = Number(value || DEFAULT_QUIZ_QUESTION_COUNT);
  if (!Number.isInteger(numeric) || numeric < 5 || numeric > 30) {
    throw new Error('questionCount must be an integer from 5 to 30.');
  }
  return numeric;
}

function normalizeQuizDraftRequest(body = {}) {
  const chapter = body.chapter || body.metadata || {};
  const chunks = Array.isArray(body.sourceChunks)
    ? body.sourceChunks
    : Array.isArray(body.chunks)
      ? body.chunks
      : [];
  const questionCount = normalizeQuestionCount(body.questionCount || DEFAULT_QUIZ_QUESTION_COUNT);
  const difficultyCounts = body.difficultyCounts && typeof body.difficultyCounts === 'object'
    ? normalizeDifficultyCounts(body.difficultyCounts, questionCount)
    : buildDifficultyPlan(questionCount);

  const requiredChapterFields = ['schoolId', 'grade', 'subject', 'chapterNumber', 'chapterName'];
  for (const field of requiredChapterFields) {
    const value = chapter[field];
    if (value === undefined || value === null || String(value).trim() === '') {
      throw new Error(`chapter.${field} is required.`);
    }
  }

  const sourceChunks = chunks
    .map((chunk, index) => normalizeSourceChunk(chunk, index))
    .filter(Boolean)
    .slice(0, 40);

  if (sourceChunks.length < 2) {
    throw new Error('At least two chapter context chunks are required for quiz generation.');
  }

  return {
    chapter: {
      schoolId: String(chapter.schoolId).trim(),
      board: cleanOptionalString(chapter.board),
      curriculum: cleanOptionalString(chapter.curriculum),
      grade: Number(chapter.grade),
      subject: String(chapter.subject).trim(),
      book: cleanOptionalString(chapter.book),
      chapterNumber: Number(chapter.chapterNumber),
      chapterName: String(chapter.chapterName).trim(),
      language: cleanOptionalString(chapter.language) || 'English',
      edition: cleanOptionalString(chapter.edition),
    },
    sourceChunks,
    questionCount,
    difficultyCounts,
    teacherId: cleanOptionalString(body.teacherId),
  };
}

function normalizeDifficultyCounts(counts, questionCount) {
  const normalized = {};
  let total = 0;
  for (const [difficulty] of DIFFICULTY_WEIGHTS) {
    const value = Number(counts[difficulty] || 0);
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`difficultyCounts.${difficulty} must be a non-negative integer.`);
    }
    normalized[difficulty] = value;
    total += value;
  }
  if (total !== questionCount) {
    throw new Error('difficultyCounts must add up to questionCount.');
  }
  return normalized;
}

function cleanOptionalString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeSourceChunk(chunk, index) {
  const text = typeof chunk?.text === 'string' ? chunk.text.trim() : '';
  if (!text) return null;
  return {
    chunkId: String(chunk.chunkId || chunk.id || `chunk-${index + 1}`),
    text: text.slice(0, 1800),
    source: typeof chunk.source === 'string' ? chunk.source : '',
    section: cleanOptionalString(chunk.metadata?.section || chunk.section),
    entityType: cleanOptionalString(chunk.metadata?.entityType || chunk.entityType),
    pageStart: chunk.pageStart || chunk.metadata?.pageStart || null,
    pageEnd: chunk.pageEnd || chunk.metadata?.pageEnd || null,
  };
}

async function generateQuizDraft({ payload, config = {}, fetchFn = fetch }) {
  const normalized = normalizeQuizDraftRequest(payload);
  const apiKey = config.openrouterApiKey || process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is required for quiz generation.');

  const model = config.model || process.env.OPENROUTER_QUIZ_MODEL || DEFAULT_OPENROUTER_QUIZ_MODEL;
  assertOpenRouterOpenAiModel(model);
  const reasoningEffort = config.reasoningEffort || process.env.OPENROUTER_QUIZ_REASONING_EFFORT || 'medium';
  const timeoutMs = Number(config.timeoutMs || process.env.OPENROUTER_QUIZ_TIMEOUT_MS || 60000);
  const maxCompletionTokens = Number(config.maxCompletionTokens || process.env.OPENROUTER_QUIZ_MAX_COMPLETION_TOKENS || 4200);
  const baseUrl = normalizeOpenRouterBaseUrl(config.baseUrl || process.env.OPENROUTER_API_BASE_URL || DEFAULT_OPENROUTER_BASE_URL);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchFn(`${baseUrl}${OPENROUTER_CHAT_COMPLETIONS_PATH}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...openRouterAttributionHeaders(config),
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: buildQuizSystemPrompt() },
          { role: 'user', content: buildQuizUserPrompt(normalized) },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'chapter_quiz_draft',
            description: 'A grounded, age-appropriate chapter quiz draft for teacher review.',
            strict: true,
            schema: quizDraftSchema,
          },
        },
        provider: {
          require_parameters: true,
        },
        reasoning: {
          effort: reasoningEffort,
        },
        max_completion_tokens: maxCompletionTokens,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`OpenRouter quiz generation failed with ${response.status}: ${errorBody}`);
    }

    const raw = await response.json();
    const text = extractResponseText(raw);
    if (!text) throw new Error('OpenRouter quiz generation returned no output text.');

    const draft = repairQuizDraftCitations(JSON.parse(text), normalized);
    validateQuizDraft(draft, normalized);
    return {
      draft,
      model: raw.model || model,
      usage: raw.usage || null,
      difficultyCounts: normalized.difficultyCounts,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function assertOpenRouterOpenAiModel(model) {
  const value = String(model || '').trim();
  if (!value.startsWith('openai/') && !value.startsWith('~openai/')) {
    throw new Error('OPENROUTER_QUIZ_MODEL must be an OpenRouter OpenAI-family model slug such as openai/gpt-5-mini.');
  }
}

function normalizeOpenRouterBaseUrl(value) {
  return String(value || DEFAULT_OPENROUTER_BASE_URL).trim().replace(/\/+$/, '');
}

function openRouterAttributionHeaders(config = {}) {
  const headers = {};
  const referer = config.siteUrl || process.env.OPENROUTER_SITE_URL;
  const title = config.appName || process.env.OPENROUTER_APP_NAME || 'Roognis';
  if (referer) headers['HTTP-Referer'] = referer;
  if (title) headers['X-OpenRouter-Title'] = title;
  return headers;
}

function buildQuizSystemPrompt() {
  return [
    'You are Roognis, a careful school assessment designer.',
    'Create curriculum-grounded chapter quizzes for teacher review.',
    'Use only the provided chapter context for factual claims.',
    'Make questions age-appropriate for the grade, clear, unambiguous, and academically useful.',
    'Simple questions should test recall and direct understanding.',
    'Medium questions should require applying, comparing, or explaining ideas.',
    'Hard questions should require real thinking for the grade: multi-step reasoning, analysis, or transfer to a new but familiar situation.',
    'Avoid trivia, trick wording, duplicate questions, unsupported facts, and answer choices that are obviously wrong.',
    'Keep every answer explanation useful but compact: one sentence, maximum 14 words.',
  ].join('\n');
}

function buildQuizUserPrompt(request) {
  const { chapter, difficultyCounts, questionCount } = request;
  const context = request.sourceChunks.map((chunk, index) => {
    const meta = [
      chunk.section ? `section=${chunk.section}` : null,
      chunk.entityType ? `type=${chunk.entityType}` : null,
      chunk.pageStart ? `page=${chunk.pageStart}` : null,
    ].filter(Boolean).join(', ');
    return [
      `SOURCE ${index + 1}`,
      `chunkId: ${chunk.chunkId}`,
      meta ? `metadata: ${meta}` : null,
      `source: ${chunk.source || 'chapter PDF'}`,
      `text: ${chunk.text}`,
    ].filter(Boolean).join('\n');
  }).join('\n\n');

  return [
    `Chapter metadata: ${JSON.stringify(chapter)}`,
    `Create exactly ${questionCount} questions.`,
    `Difficulty counts must be exactly: simple=${difficultyCounts.simple}, medium=${difficultyCounts.medium}, hard=${difficultyCounts.hard}.`,
    'Use a healthy mix of MCQ and short-answer questions. MCQs must have exactly four options and the correctAnswer must exactly match one option. Short-answer questions must have an empty options array.',
    'Cover the full chapter: definitions, core concepts, processes, activities/examples, applications, diagrams/tables when present, and exercises/key points.',
    'Prefer concept-level coverage over page-order repetition.',
    'Use grade-level language and thinking depth.',
    'Set weakAreaLabel to the smallest useful remediation topic a teacher could act on.',
    'Keep chapterSummary under 20 words, coverage to exactly 5 concepts, and concept/weak-area labels under 5 words.',
    'Return only the structured JSON.',
    '',
    'Chapter context:',
    context,
  ].join('\n');
}

function extractResponseText(response) {
  const choiceContent = response?.choices?.[0]?.message?.content;
  if (typeof choiceContent === 'string') return choiceContent;
  if (Array.isArray(choiceContent)) {
    return choiceContent
      .map(part => typeof part?.text === 'string' ? part.text : '')
      .join('');
  }

  if (typeof response?.output_text === 'string') return response.output_text;
  const output = Array.isArray(response?.output) ? response.output : [];
  const parts = [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const contentItem of content) {
      if (contentItem?.type === 'output_text' && typeof contentItem.text === 'string') {
        parts.push(contentItem.text);
      }
    }
  }
  return parts.join('');
}

function repairQuizDraftCitations(draft, request) {
  if (!draft || typeof draft !== 'object') return draft;
  const validChunkIds = new Set(request.sourceChunks.map(chunk => chunk.chunkId));
  const fallbackChunkId = request.sourceChunks[0]?.chunkId;
  if (!fallbackChunkId) return draft;

  if (Array.isArray(draft.coverage)) {
    draft.coverage.forEach(item => {
      if (!item || typeof item !== 'object') return;
      item.sourceChunkIds = cleanSourceChunkIds(item.sourceChunkIds, validChunkIds);
      if (!item.sourceChunkIds.length) {
        item.sourceChunkIds = [bestMatchingChunkId(item.concept, request) || fallbackChunkId];
      }
    });
  }

  if (Array.isArray(draft.questions)) {
    draft.questions.forEach(question => {
      if (!question || typeof question !== 'object') return;
      question.sourceChunkIds = cleanSourceChunkIds(question.sourceChunkIds, validChunkIds);
      if (!question.sourceChunkIds.length) {
        question.sourceChunkIds = [
          bestMatchingChunkId([
            question.conceptTag,
            question.weakAreaLabel,
            question.prompt,
            question.correctAnswer,
            question.explanation,
          ].filter(Boolean).join(' '), request) || fallbackChunkId,
        ];
      }
    });
  }

  return draft;
}

function cleanSourceChunkIds(sourceChunkIds, validChunkIds) {
  if (!Array.isArray(sourceChunkIds)) return [];
  const cleaned = [];
  for (const chunkId of sourceChunkIds) {
    const value = String(chunkId || '').trim();
    if (!value || !validChunkIds.has(value) || cleaned.includes(value)) continue;
    cleaned.push(value);
    if (cleaned.length >= 3) break;
  }
  return cleaned;
}

function bestMatchingChunkId(query, request) {
  const queryTokens = tokenizeForCitationMatch(query);
  if (!queryTokens.length) return null;

  let bestChunk = null;
  let bestScore = 0;
  for (const chunk of request.sourceChunks) {
    const chunkTokens = tokenizeForCitationMatch([
      chunk.section,
      chunk.entityType,
      chunk.source,
      chunk.text,
    ].filter(Boolean).join(' '));
    const chunkTokenSet = new Set(chunkTokens);
    const score = queryTokens.reduce((sum, token) => sum + (chunkTokenSet.has(token) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      bestChunk = chunk;
    }
  }

  return bestChunk?.chunkId || null;
}

function tokenizeForCitationMatch(value) {
  const stopWords = new Set([
    'about',
    'after',
    'also',
    'answer',
    'because',
    'chapter',
    'correct',
    'does',
    'from',
    'have',
    'into',
    'that',
    'their',
    'this',
    'what',
    'when',
    'where',
    'which',
    'with',
    'would',
  ]);
  return String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(token => token.length > 2 && !stopWords.has(token));
}

function validateQuizDraft(draft, request) {
  if (!draft || typeof draft !== 'object') throw new Error('Quiz draft must be an object.');
  if (!Array.isArray(draft.questions)) throw new Error('Quiz draft questions must be an array.');
  if (draft.questions.length !== request.questionCount) {
    throw new Error(`Quiz draft must contain exactly ${request.questionCount} questions.`);
  }

  const validChunkIds = new Set(request.sourceChunks.map(chunk => chunk.chunkId));
  const seenPrompts = new Set();
  const counts = { simple: 0, medium: 0, hard: 0 };

  draft.questions.forEach((question, index) => {
    const prefix = `questions[${index}]`;
    if (!question || typeof question !== 'object') throw new Error(`${prefix} must be an object.`);
    if (!['mcq', 'short_answer'].includes(question.type)) throw new Error(`${prefix}.type is invalid.`);
    if (!Object.prototype.hasOwnProperty.call(counts, question.difficulty)) {
      throw new Error(`${prefix}.difficulty is invalid.`);
    }
    counts[question.difficulty] += 1;

    const promptKey = normalizeForDuplicateCheck(question.prompt);
    if (!promptKey || promptKey.length < 12) throw new Error(`${prefix}.prompt is too short.`);
    if (seenPrompts.has(promptKey)) throw new Error(`${prefix}.prompt duplicates another question.`);
    seenPrompts.add(promptKey);

    if (!question.conceptTag || !question.weakAreaLabel) {
      throw new Error(`${prefix} must include conceptTag and weakAreaLabel.`);
    }
    if (!question.correctAnswer || !question.explanation) {
      throw new Error(`${prefix} must include correctAnswer and explanation.`);
    }
    if (!Array.isArray(question.sourceChunkIds) || !question.sourceChunkIds.length) {
      throw new Error(`${prefix}.sourceChunkIds must include at least one chunk id.`);
    }
    for (const chunkId of question.sourceChunkIds) {
      if (!validChunkIds.has(chunkId)) throw new Error(`${prefix}.sourceChunkIds contains an unknown chunk id.`);
    }

    if (question.type === 'mcq') {
      if (!Array.isArray(question.options) || question.options.length !== 4) {
        throw new Error(`${prefix}.options must contain exactly four options for MCQ.`);
      }
      if (!question.options.includes(question.correctAnswer)) {
        throw new Error(`${prefix}.correctAnswer must exactly match one MCQ option.`);
      }
    } else if (Array.isArray(question.options) && question.options.length > 0) {
      throw new Error(`${prefix}.options must be empty for short-answer questions.`);
    }
  });

  for (const [difficulty, expected] of Object.entries(request.difficultyCounts)) {
    if (counts[difficulty] !== expected) {
      throw new Error(`Expected ${expected} ${difficulty} questions but got ${counts[difficulty]}.`);
    }
  }

  return true;
}

function normalizeForDuplicateCheck(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

module.exports = {
  DEFAULT_QUIZ_QUESTION_COUNT,
  quizDraftSchema,
  buildDifficultyPlan,
  normalizeQuizDraftRequest,
  generateQuizDraft,
  assertOpenRouterOpenAiModel,
  buildQuizSystemPrompt,
  buildQuizUserPrompt,
  extractResponseText,
  repairQuizDraftCitations,
  validateQuizDraft,
};
