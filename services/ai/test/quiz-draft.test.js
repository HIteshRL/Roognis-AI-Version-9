const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildDifficultyPlan,
  normalizeQuizDraftRequest,
  generateQuizDraft,
  assertOpenRouterOpenAiModel,
  extractResponseText,
  repairQuizDraftCitations,
  validateQuizDraft,
} = require('../quiz-draft');

function sampleRequest() {
  return normalizeQuizDraftRequest({
    chapter: {
      schoolId: '22222222-2222-2222-2222-222222222222',
      board: 'CBSE',
      curriculum: 'NCERT',
      grade: 6,
      subject: 'Science',
      book: 'Curiosity',
      chapterNumber: 1,
      chapterName: 'Plants and nutrition',
      language: 'English',
      edition: '2026-27',
    },
    questionCount: 5,
    sourceChunks: [
      { chunkId: 'chunk-a', text: 'Plants make food by photosynthesis.', source: 'Chapter 1' },
      { chunkId: 'chunk-b', text: 'Roots absorb water and minerals from soil.', source: 'Chapter 1' },
      { chunkId: 'chunk-c', text: 'Leaves have stomata for gas exchange.', source: 'Chapter 1' },
    ],
  });
}

function sampleDraft() {
  return {
    title: 'Plants and nutrition quiz',
    chapterSummary: 'A quiz covering plant food-making, roots, and leaves.',
    coverage: [
      { concept: 'Photosynthesis', sourceChunkIds: ['chunk-a'] },
      { concept: 'Roots', sourceChunkIds: ['chunk-b'] },
      { concept: 'Stomata', sourceChunkIds: ['chunk-c'] },
    ],
    questions: [
      question(1, 'simple', 'remember', 'What process helps green plants make food?', ['chunk-a']),
      question(2, 'simple', 'understand', 'Which plant part absorbs water and minerals?', ['chunk-b']),
      question(3, 'simple', 'understand', 'What are stomata used for in leaves?', ['chunk-c']),
      question(4, 'medium', 'apply', 'Why would a plant wilt if its roots are damaged?', ['chunk-b']),
      question(5, 'hard', 'analyze', 'A plant is kept in darkness for two days. What should happen to food-making and why?', ['chunk-a']),
    ],
  };
}

function question(order, difficulty, bloomLevel, prompt, sourceChunkIds) {
  return {
    order,
    type: 'short_answer',
    difficulty,
    bloomLevel,
    conceptTag: prompt.split(' ').slice(0, 3).join(' '),
    weakAreaLabel: 'Chapter concept',
    prompt,
    options: [],
    correctAnswer: 'A concise correct answer.',
    explanation: 'The answer follows from the provided chapter context.',
    sourceChunkIds,
    marks: difficulty === 'hard' ? 3 : 1,
  };
}

test('builds deterministic 50/30/20 difficulty counts', () => {
  assert.deepEqual(buildDifficultyPlan(10), { simple: 5, medium: 3, hard: 2 });
  assert.deepEqual(buildDifficultyPlan(5), { simple: 3, medium: 1, hard: 1 });
  assert.deepEqual(buildDifficultyPlan(7), { simple: 4, medium: 2, hard: 1 });
});

test('normalizes quiz draft request and source chunks', () => {
  const request = sampleRequest();

  assert.equal(request.questionCount, 5);
  assert.deepEqual(request.difficultyCounts, { simple: 3, medium: 1, hard: 1 });
  assert.equal(request.sourceChunks.length, 3);
  assert.equal(request.chapter.grade, 6);
});

test('validates a grounded quiz draft with exact difficulty distribution', () => {
  assert.equal(validateQuizDraft(sampleDraft(), sampleRequest()), true);
});

test('rejects duplicate prompts and unknown source chunks', () => {
  const request = sampleRequest();
  const duplicate = sampleDraft();
  duplicate.questions[1].prompt = duplicate.questions[0].prompt;

  assert.throws(() => validateQuizDraft(duplicate, request), /duplicates/);

  const unknownChunk = sampleDraft();
  unknownChunk.questions[0].sourceChunkIds = ['missing'];
  assert.throws(() => validateQuizDraft(unknownChunk, request), /unknown chunk/);
});

test('repairs unknown source citations with valid chapter chunks', () => {
  const request = sampleRequest();
  const draft = sampleDraft();
  draft.coverage[0].sourceChunkIds = ['missing-coverage'];
  draft.questions[0].sourceChunkIds = ['missing-question'];

  const repaired = repairQuizDraftCitations(draft, request);

  assert.deepEqual(repaired.coverage[0].sourceChunkIds, ['chunk-a']);
  assert.deepEqual(repaired.questions[0].sourceChunkIds, ['chunk-a']);
  assert.equal(validateQuizDraft(repaired, request), true);
});

test('accepts only OpenRouter OpenAI-family quiz models', () => {
  assert.doesNotThrow(() => assertOpenRouterOpenAiModel('openai/gpt-5-mini'));
  assert.doesNotThrow(() => assertOpenRouterOpenAiModel('~openai/gpt-latest'));
  assert.throws(() => assertOpenRouterOpenAiModel('anthropic/claude-sonnet-4.5'), /OpenAI-family/);
});

test('extracts OpenRouter chat completion output text', () => {
  const output = extractResponseText({
    choices: [
      {
        message: {
          content: '{"ok":true}',
        },
      },
    ],
  });

  assert.equal(output, '{"ok":true}');
});

test('keeps compatibility with Responses-style output text extraction', () => {
  const output = extractResponseText({
    output: [
      {
        type: 'message',
        content: [
          { type: 'output_text', text: '{"ok":true}' },
        ],
      },
    ],
  });

  assert.equal(output, '{"ok":true}');
});

test('sends OpenRouter structured-output request with OpenAI model slug', async () => {
  const request = sampleRequest();
  const draft = JSON.stringify(sampleDraft());
  let capturedUrl = '';
  let capturedRequest = null;

  const result = await generateQuizDraft({
    payload: request,
    config: {
      openrouterApiKey: 'test-openrouter-key',
      model: 'openai/gpt-5-mini',
      reasoningEffort: 'high',
      timeoutMs: 1000,
      maxCompletionTokens: 4000,
      siteUrl: 'https://example.test',
      appName: 'Roognis Tests',
    },
    fetchFn: async (url, options) => {
      capturedUrl = url;
      capturedRequest = {
        headers: options.headers,
        body: JSON.parse(options.body),
      };
      return {
        ok: true,
        json: async () => ({
          model: 'openai/gpt-5-mini',
          choices: [{ message: { content: draft } }],
          usage: { total_tokens: 123 },
        }),
      };
    },
  });

  assert.equal(capturedUrl, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(capturedRequest.headers.Authorization, 'Bearer test-openrouter-key');
  assert.equal(capturedRequest.headers['HTTP-Referer'], 'https://example.test');
  assert.equal(capturedRequest.headers['X-OpenRouter-Title'], 'Roognis Tests');
  assert.equal(capturedRequest.body.model, 'openai/gpt-5-mini');
  assert.equal(capturedRequest.body.provider.require_parameters, true);
  assert.equal(capturedRequest.body.response_format.type, 'json_schema');
  assert.equal(capturedRequest.body.response_format.json_schema.strict, true);
  assert.equal(capturedRequest.body.reasoning.effort, 'high');
  assert.equal(capturedRequest.body.max_completion_tokens, 4000);
  assert.equal(Object.prototype.hasOwnProperty.call(capturedRequest.body, 'temperature'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(capturedRequest.body, 'metadata'), false);
  assert.equal(result.model, 'openai/gpt-5-mini');
  assert.equal(result.usage.total_tokens, 123);
});
