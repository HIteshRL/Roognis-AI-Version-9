'use strict';

const { deriveQaPairs } = require('./chapter-qa');

/**
 * Writing the demo's tutor conversations with the LLM, grounded in real text.
 *
 * The deterministic derivation in `chapter-qa.js` is honest but reads badly,
 * because the EKE extractor is heuristic: across the 27 seeded chapters it
 * produced 2680 `Concept` entities (titles like "Reprint 2026-27" and
 * "Their formidable navy resisted European naval supremacy") against 87
 * usable questions. Templating over that yields a tutor asking about
 * mid-sentence clauses, which reads as broken retrieval.
 *
 * So the LLM writes the prose, from the chapter's own retrieved chunks. This is
 * a RENDERING step and nothing more — MASTERCONTEXT §7 forbids an LLM changing
 * what, when, how, or how hard the system teaches, and nothing here touches
 * scoring, selection, difficulty, routing or learner state. It writes sample
 * text for a demo database.
 *
 * It is also strictly optional: with no API key, or on any failure, this falls
 * back to the deterministic derivation, so the seeder still runs offline.
 */

const DEFAULT_GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b';
const DEFAULT_OPENROUTER_MODEL = 'openai/gpt-5-mini';

const MAX_SOURCE_CHUNKS = 18;
const MAX_CHUNK_CHARS = 700;
const TIMEOUT_MS = Number(process.env.DEMO_QA_TIMEOUT_MS || 60000);

function normalizeBaseUrl(value) {
  return String(value || '').replace(/\/+$/, '');
}

/**
 * Every provider we could use, best first.
 *
 * A chain rather than a single pick, because "the key is set" and "the key is
 * funded" are different things — an unfunded OPENROUTER_API_KEY answers 402,
 * and the seeder should move to Groq rather than silently drop to templated
 * text. `LLM_PROVIDER` nominates which to try first; the rest still follow.
 */
function resolveProviders(config = {}) {
  const preferred = String(config.provider || process.env.LLM_PROVIDER || '').toLowerCase();
  const providers = [buildOpenRouter(config), buildGroq(config)].filter(Boolean);
  return providers.sort((a, b) => (b.name === preferred) - (a.name === preferred));
}

function buildOpenRouter(config = {}) {
  const openrouterApiKey = config.openrouterApiKey || process.env.OPENROUTER_API_KEY;
  if (openrouterApiKey) {
    return {
      name: 'openrouter',
      apiKey: openrouterApiKey,
      model: config.model || process.env.DEMO_QA_MODEL || DEFAULT_OPENROUTER_MODEL,
      baseUrl: normalizeBaseUrl(config.baseUrl || process.env.OPENROUTER_API_BASE_URL || DEFAULT_OPENROUTER_BASE_URL),
      body: (messages, model) => ({
        model,
        messages,
        response_format: { type: 'json_object' },
        max_completion_tokens: 3000,
      }),
    };
  }

  return null;
}

function buildGroq(config = {}) {
  const groqApiKey = config.groqApiKey || process.env.GROQ_API_KEY;
  if (groqApiKey) {
    return {
      name: 'groq',
      apiKey: groqApiKey,
      model: config.model || process.env.DEMO_QA_MODEL || DEFAULT_GROQ_MODEL,
      baseUrl: normalizeBaseUrl(config.baseUrl || process.env.GROQ_API_BASE_URL || DEFAULT_GROQ_BASE_URL),
      body: (messages, model) => ({
        model,
        messages,
        response_format: { type: 'json_object' },
        max_tokens: 2600,
        temperature: 0.3,
        // See services/ai/structured-llm.js's buildGroq for why gpt-oss models
        // need reasoning_effort capped — otherwise the hidden reasoning trace
        // can consume the whole token budget and return empty content.
        ...(model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {}),
      }),
    };
  }

  return null;
}

function sourceText(context) {
  const chunks = Array.isArray(context.chunks) ? context.chunks : [];
  return chunks
    .slice(0, MAX_SOURCE_CHUNKS)
    .map((chunk, index) => `[${index + 1}] ${String(chunk.text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_CHUNK_CHARS)}`)
    .filter(line => line.length > 12)
    .join('\n\n');
}

function buildMessages(context, count) {
  const chapter = context.chapter || {};
  const label = `${chapter.subject} grade ${chapter.grade}, chapter ${chapter.chapterNumber} — ${chapter.chapterName}`;

  return [
    {
      role: 'system',
      content: [
        'You write realistic sample tutoring conversations for a product demo.',
        'You will be given verbatim extracts from one school textbook chapter.',
        'Write question-and-answer pairs that a real student and an AI tutor might have exchanged about THAT chapter.',
        '',
        'Rules:',
        '- Every answer must be supported by the supplied extracts. Never introduce facts that are not there.',
        '- Only write a pair when the extracts FULLY answer it. Returning fewer pairs is better than writing',
        '  an answer that admits something is missing. Never say a detail is "not specified", "not mentioned"',
        '  or "not in the text" — if you would have to, choose a different question instead.',
        '- Questions must sound like a 13-year-old typed them: direct, specific, sometimes slightly informal.',
        '- Answers are 2-4 sentences, warm and plain. No headings, no bullet points, no markdown, no emoji.',
        '- Vary the questions: some ask what something means, some ask why, some ask for an example or a comparison.',
        '- The extracts contain OCR noise, figure captions, page furniture and exercise numbering. Ignore all of it.',
        '- Never mention the extracts, the textbook layout, page numbers, or that this is a demo.',
        '',
        'Reply with JSON only: {"pairs":[{"question":"...","answer":"..."}]}',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `Chapter: ${label}\n\nExtracts:\n${sourceText(context)}\n\nWrite ${count} varied question-and-answer pairs about this chapter.`,
    },
  ];
}

// An answer that points at its own sourcing ("not specified in the text") is
// the model being honest about a gap, but in a seeded transcript it reads as
// the tutor failing. Drop those pairs rather than ship them.
const HEDGE = new RegExp([
  // Admits the source did not cover it.
  '\\bnot (?:specified|mentioned|listed|provided|given|stated|included|detailed)\\b',
  '\\b(?:the|this|these) (?:text|extract|extracts|passage|passages|document|excerpt)s?\\b',
  '\\bbased on the (?:text|extract|information)\\b',
  // Narrates the source instead of teaching from it: "the year 1680 is
  // mentioned", "someone important". A tutor states facts, it does not report
  // what a document happens to contain.
  '\\bis mentioned (?:as|in|that)\\b',
  '\\bsomeone important\\b',
  '\\bthe chapter (?:gives|says|states|mentions|talks about)\\b',
].join('|'), 'i');

function parsePairs(text) {
  const trimmed = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const parsed = JSON.parse(trimmed);
  const pairs = Array.isArray(parsed) ? parsed : parsed.pairs;
  if (!Array.isArray(pairs)) return [];

  return pairs
    .map(pair => ({
      question: String(pair && pair.question || '').replace(/\s+/g, ' ').trim(),
      answer: String(pair && pair.answer || '').replace(/\s+/g, ' ').trim(),
    }))
    .filter(pair => pair.question.length >= 8 && pair.answer.length >= 30)
    .filter(pair => !HEDGE.test(pair.answer));
}

/**
 * Q&A for one chapter, LLM-written when possible and derived otherwise.
 *
 * Never throws: a chapter that cannot be rendered falls back, and a chapter
 * that cannot be derived either is dropped by the caller's anchor threshold.
 */
async function renderQaPairs(context, options = {}) {
  const { count = 12, templates = {}, citation = '', fetchFn = fetch, log = () => {} } = options;
  // Over-request: the hedge filter discards a good fraction, and dropping below
  // the usable threshold would fall back to the flatter templated text.
  const requested = Math.ceil(count * 1.6);
  const fallback = () => deriveQaPairs(context, { templates, citation, limit: count });

  const chapter = context.chapter || {};
  const providers = resolveProviders(options);
  if (!providers.length || !sourceText(context)) return { pairs: fallback(), source: 'derived' };

  for (const provider of providers) {
    try {
      const response = await fetchFn(`${provider.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify(provider.body(buildMessages(context, requested), provider.model)),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (!response.ok) {
        log(`${provider.name} returned HTTP ${response.status} for "${chapter.chapterName}".`);
        continue;
      }

      const body = await response.json();
      const pairs = parsePairs(body?.choices?.[0]?.message?.content);
      if (pairs.length < 3) {
        log(`${provider.name} returned ${pairs.length} usable pairs for "${chapter.chapterName}".`);
        continue;
      }

      return { pairs, source: provider.name };
    } catch (error) {
      log(`${provider.name} failed for "${chapter.chapterName}": ${error.message}`);
    }
  }

  log(`No provider could write "${chapter.chapterName}" — using derived text.`);
  return { pairs: fallback(), source: 'derived' };
}

module.exports = {
  MAX_SOURCE_CHUNKS,
  resolveProviders,
  buildMessages,
  parsePairs,
  sourceText,
  renderQaPairs,
};
