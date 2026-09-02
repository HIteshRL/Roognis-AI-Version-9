'use strict';

const { fetchReadyChapters, fetchChapterContext } = require('./rag-chapters');
const { isEligible, selectChaptersForPersona, chapterKey } = require('./chapter-select');
const { renderQaPairs } = require('./chapter-qa-llm');

/**
 * The shared "what has this school actually uploaded?" step.
 *
 * All three seeders run this independently and must reach the same answer —
 * they have no channel between them, so agreement comes from running identical
 * logic over identical inputs.
 *
 * That is why chapter SELECTION depends only on what
 * `GET /api/rag/internal/chapters` reports (chunk and entity counts), and never
 * on anything downstream. The AI seeder additionally renders conversation text
 * for the chapters it was given, and whether that rendering used the LLM or the
 * deterministic fallback must not be able to change which chapters were chosen
 * — otherwise a seeder with an API key and one without would disagree about
 * what the demo student studied.
 */

async function loadDemoCorpus(plan, options = {}) {
  const label = options.label || 'demo-history';
  const schoolId = options.schoolId || process.env.DEMO_SCHOOL_ID;
  if (!schoolId) throw new Error('DEMO_SCHOOL_ID is required to read the demo corpus.');

  const grades = [...new Set(plan.personas.map(persona => Number(persona.grade)).filter(Boolean))];
  const seen = new Set();
  const chapters = [];

  for (const grade of grades) {
    const found = await fetchReadyChapters({ ...options, schoolId, grade });
    for (const chapter of found) {
      const key = chapterKey(chapter);
      if (seen.has(key)) continue;
      seen.add(key);
      chapters.push(chapter);
    }
  }

  const binding = plan.chapterBinding || {};
  const eligible = chapters.filter(chapter => isEligible(chapter, binding));

  if (!eligible.length) {
    const reason = chapters.length
      ? `${chapters.length} ready chapters, none with enough extracted content ` +
        `(need >=${binding.minChunkCount} chunks and >=${binding.minEntityCount} entities)`
      : 'no ready chapters are ingested for this school';
    console.log(`[${label}] Skipping: ${reason}. Upload chapter PDFs and let ingestion finish first.`);
    return { chapters: [], skip: true, reason };
  }

  console.log(`[${label}] Bound to ${eligible.length} ingested chapters across grades ${grades.join(', ')}.`);
  return { chapters: eligible, skip: false, reason: null };
}

/**
 * Conversation text for the chapters the personas actually landed on.
 *
 * AI-seeder only — it is the one that writes messages. Fetching per bound
 * chapter rather than per ingested chapter keeps this to a handful of calls
 * even against a full textbook corpus.
 */
async function loadChapterQa(plan, chapters, options = {}) {
  const label = options.label || 'demo-history';
  const binding = plan.chapterBinding || {};
  const templates = plan.qaTemplates || {};
  const citation = plan.qaCitation || '';
  // Two or three turns per session, cycling; this covers the worst case.
  const count = Math.min(16, plan.activeDayOffsets.length);

  const wanted = new Map();
  for (const persona of plan.personas) {
    const { chapters: bound } = selectChaptersForPersona(persona, chapters, binding);
    for (const chapter of bound) wanted.set(chapterKey(chapter), chapter);
  }

  const byKey = new Map();
  const sources = [];

  for (const [key, chapter] of wanted) {
    let context = null;
    try {
      context = await fetchChapterContext(chapter, { ...options, maxChunks: binding.maxChunks });
    } catch (error) {
      console.warn(`[${label}] Could not read "${chapter.chapterName}": ${error.message}`);
    }
    if (!context) continue;

    const { pairs, source } = await renderQaPairs(context, {
      ...options,
      count,
      templates,
      citation,
      log: message => console.warn(`[${label}] ${message}`),
    });
    if (!pairs.length) continue;

    byKey.set(key, pairs);
    sources.push(`${chapter.chapterName} (${source}, ${pairs.length} pairs)`);
  }

  if (sources.length) console.log(`[${label}] Conversation text: ${sources.join('; ')}`);
  return byKey;
}

module.exports = { loadDemoCorpus, loadChapterQa };
