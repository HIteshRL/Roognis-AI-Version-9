'use strict';

const crypto = require('node:crypto');

const { seededRandom } = require('./demo-ids');

/**
 * Choosing which real chapters the demo personas study.
 *
 * The fixture used to name chapters literally ("Synthetic Fibres and Plastics"),
 * which quietly rotted: the ingested corpus moved to the 2026-27 editions and
 * every seeded session pointed at a chapter that no longer existed, so the app
 * filtered all of it out. Worse, hardcoding a chapter list bakes NCERT into a
 * product whose claim is that it works off whatever a school uploads.
 *
 * So personas now declare *intent* — preferred subjects and how many chapters —
 * and the concrete chapters come from `GET /api/rag/internal/chapters` at seed
 * time. Whatever is actually ingested is what the demo studies.
 *
 * Everything here is pure. The three seeders run as separate one-shot
 * containers with no channel between them; they agree because they run the same
 * deterministic function over the same chapter list, not because they talk.
 */

// `ChatSession.chapterName` is VarChar(160) while RAG's is String(220), so a
// chapter with a long title would fail the insert. Skipping it here keeps the
// seeder from dying on an otherwise valid upload.
const MAX_CHAT_SESSION_CHAPTER_NAME = 160;

const DEFAULT_ELIGIBILITY = {
  minChunkCount: 8,
  minEntityCount: 5,
};

function casefold(value) {
  return String(value == null ? '' : value).trim().toLowerCase();
}

/**
 * Stable identity for a chapter, mirroring `chapter_identity_key` in
 * `services/rag/main.py`.
 *
 * Deliberately excludes `contentFingerprint`, `updatedAt` and the `*Count`
 * fields: re-ingesting the same PDF changes those, and it must not move a
 * persona onto a different chapter.
 */
function chapterKey(chapter) {
  return [
    casefold(chapter.schoolId),
    casefold(chapter.board),
    casefold(chapter.curriculum),
    Number(chapter.grade || 0),
    casefold(chapter.subject),
    casefold(chapter.book),
    Number(chapter.chapterNumber || 0),
    casefold(chapter.language),
    casefold(chapter.edition),
  ].join('|');
}

/**
 * A short digest of the eligible chapter set.
 *
 * The three seeders each call RAG separately. If the corpus changed between
 * two of those calls they would silently disagree, so each writes this
 * fingerprint into its own output — a divergence then shows up in the data
 * rather than only in a log line nobody kept.
 */
function chapterSetFingerprint(chapters) {
  const keys = chapters.map(chapterKey).sort();
  return crypto.createHash('sha256').update(keys.join('\n'), 'utf8').digest('hex').slice(0, 16);
}

/** A chapter you can actually hold a conversation about. */
function isEligible(chapter, options = {}) {
  const { minChunkCount, minEntityCount } = { ...DEFAULT_ELIGIBILITY, ...options };
  if (!chapter || chapter.status !== 'ready') return false;

  const chapterName = String(chapter.chapterName || '').trim();
  if (!chapterName) return false;
  if (chapterName.length > MAX_CHAT_SESSION_CHAPTER_NAME) return false;
  if (!String(chapter.subject || '').trim()) return false;
  if (!Number(chapter.chapterNumber)) return false;

  if (Number(chapter.chunkCount || 0) < minChunkCount) return false;
  if (Number(chapter.entityCount || 0) < minEntityCount) return false;
  return true;
}

/**
 * Rendezvous (highest-random-weight) ranking.
 *
 * Each chapter is scored independently from (seed, its own identity), so the
 * ranking does not depend on how many other chapters exist or what order RAG
 * returned them in. That is the whole point: with index-modulo selection,
 * uploading one more PDF reshuffles every persona onto a different chapter and
 * the demo's history stops matching its dashboards. Here, a new chapter only
 * displaces an incumbent if it genuinely outranks it.
 */
function rankChapters(seedText, chapters) {
  return chapters
    .map(chapter => {
      const key = chapterKey(chapter);
      return { chapter, key, score: seededRandom(`${seedText}|${key}`)() };
    })
    .sort((a, b) => (b.score - a.score) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map(entry => entry.chapter);
}

/**
 * Bind one persona's declared intent to concrete ingested chapters.
 *
 * Returns `{ chapters, warnings }`. Callers decide what an empty result means —
 * this function does not throw, because "this school uploaded nothing for grade
 * 8" is a legitimate state, not an error.
 */
function selectChaptersForPersona(persona, chapters, options = {}) {
  const warnings = [];
  const intent = persona.chapterIntent || {};
  const sharedCount = Number(intent.shared || 0);
  const personalCount = Number(intent.personal || 0);
  const preferredSubjects = Array.isArray(intent.preferredSubjects) ? intent.preferredSubjects : [];

  const eligible = chapters.filter(
    chapter => isEligible(chapter, options) && Number(chapter.grade || 0) === Number(persona.grade || 0),
  );
  if (!eligible.length) {
    warnings.push(`${persona.email}: no ingested chapters are eligible for grade ${persona.grade}.`);
    return { chapters: [], warnings };
  }

  const picked = [];
  const pickedKeys = new Set();
  const take = chapter => {
    const key = chapterKey(chapter);
    if (pickedKeys.has(key)) return false;
    pickedKeys.add(key);
    picked.push(chapter);
    return true;
  };

  // Shared slots are seeded on the class, not the persona, so every student in
  // the grade lands on the same chapter. That is what makes "the class is weak
  // on chapter X" legible on the teacher dashboard, and it costs nothing.
  for (const chapter of rankChapters(`class|grade|${persona.grade}`, eligible)) {
    if (picked.length >= sharedCount) break;
    take(chapter);
  }

  // Personal slots follow the persona's declared subject preferences in order.
  const wanted = sharedCount + personalCount;
  for (const subject of preferredSubjects) {
    if (picked.length >= wanted) break;
    const inSubject = eligible.filter(
      chapter => casefold(chapter.subject) === casefold(subject) && !pickedKeys.has(chapterKey(chapter)),
    );
    if (!inSubject.length) {
      warnings.push(`${persona.email}: no eligible chapters for preferred subject "${subject}".`);
      continue;
    }
    take(rankChapters(persona.email, inSubject)[0]);
  }

  // Refill any shortfall from whatever else is ingested, so a school that only
  // uploaded one subject still gets a working demo instead of an empty one.
  if (picked.length < wanted) {
    for (const chapter of rankChapters(persona.email, eligible)) {
      if (picked.length >= wanted) break;
      take(chapter);
    }
  }

  if (picked.length < wanted) {
    warnings.push(
      `${persona.email}: wanted ${wanted} chapters, only ${picked.length} eligible — ` +
      'sessions will concentrate on fewer chapters.',
    );
  }

  return { chapters: picked, warnings };
}

module.exports = {
  MAX_CHAT_SESSION_CHAPTER_NAME,
  DEFAULT_ELIGIBILITY,
  chapterKey,
  chapterSetFingerprint,
  isEligible,
  rankChapters,
  selectChaptersForPersona,
};
