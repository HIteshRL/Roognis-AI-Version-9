'use strict';

/**
 * Turning an ingested chapter into the questions a student plausibly asked.
 *
 * The fixture used to carry authored Q&A keyed by subject. Bound to a real
 * chapter that reads badly: a session card titled "Coal and Petroleum" whose
 * preview asks why plastic takes so long to decompose looks like retrieval is
 * broken, which is a worse demo artifact than an empty list.
 *
 * So the substance comes from the corpus and only the framing is authored. The
 * EKE pipeline has already done the hard part — it classifies each extracted
 * object and writes a `summary`, so a Definition entity's summary is a
 * self-contained sentence and a Question entity's summary is the literal
 * exercise question printed in the textbook. Those are real anchors; we wrap
 * them in a question a student would actually type.
 *
 * Deterministic and LLM-free by construction: same chapter in, same pairs out.
 */

// Entity types worth building a conversation turn from, best anchor first.
//
// Only the types whose structure the extractor actually guarantees are here.
// A `Definition`'s summary is a real definition sentence and a `Question`'s
// summary is the question printed in the textbook, so both can be used as-is.
//
// `Concept` is deliberately excluded despite being by far the most common type
// (2680 across the 27 seeded chapters, against 58 definitions and 87
// questions): its title is `first_phrase()` of an arbitrary text block, which
// in practice yields things like "Their formidable navy resisted European naval
// supremacy" and "Reprint 2026-27". Volume is not usefulness, and asking a
// student's question about a mid-sentence clause reads as broken retrieval.
// `CanonicalConcept` is excluded too — title, summary and content are the same
// string, so it yields a question that answers itself.
const ANCHOR_PRECEDENCE = ['definition', 'question', 'activity'];

const ENTITY_TYPE_TO_ANCHOR = {
  definition: 'definition',
  question: 'question',
  exercise: 'question',
  activity: 'activity',
  experiment: 'activity',
};

const MAX_ANSWER_CHARS = 420;
const MIN_ANSWER_CHARS = 60;
const MAX_TITLE_CHARS = 80;
const MIN_TITLE_CHARS = 3;
// Below this share of candidate entities surviving the quality gates, treat the
// whole chapter's extraction as unreliable rather than cherry-picking from it.
const MIN_ANCHOR_ACCEPTANCE = 0.2;

// Words that, leading a supposed concept name, mean the extractor grabbed a
// clause out of the middle of a sentence rather than a thing you can ask about.
// Real chapters produce plenty of these — "Their formidable navy resisted
// European naval supremacy" is a sentence, not a concept.
const CLAUSE_STARTERS = new Set([
  'their', 'this', 'that', 'these', 'those', 'it', 'its', 'they', 'them', 'he', 'she', 'we', 'you',
  'which', 'who', 'whom', 'whose', 'when', 'where', 'while', 'after', 'before', 'until', 'unless',
  'because', 'although', 'though', 'since', 'and', 'but', 'or', 'nor', 'so', 'yet', 'for', 'with',
  'without', 'from', 'into', 'onto', 'upon', 'however', 'therefore', 'thus', 'hence', 'also',
  'then', 'than', 'there', 'here', 'such', 'both', 'each', 'either', 'neither',
]);

function normalise(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

/**
 * A passage chunk is built as `heading\nbody`, and the heading is often a figure
 * caption ("the 1680s (British Museum)"). Quoting from the top therefore starts
 * the tutor's answer mid-caption. Drop the first line when there is a body.
 */
function passageBody(text) {
  const raw = String(text == null ? '' : text);
  const newline = raw.indexOf('\n');
  const body = newline === -1 ? '' : raw.slice(newline + 1);
  // Only fall back to the whole chunk when there was no body after the heading.
  // Falling back because `startAtSentence` rejected the body would put the
  // heading straight back into the answer, which is what this exists to stop.
  return endAtSentence(startAtSentence(body.trim() ? body : raw));
}

/**
 * Stop at the last complete sentence.
 *
 * Chunk boundaries cut mid-sentence, so a passage often trails off ("...his
 * hold over the Pune region by"). Left alone the citation gets appended to that
 * dangling clause. Nothing complete means nothing usable.
 */
function endAtSentence(text) {
  const compact = normalise(text);
  const match = compact.match(/^[\s\S]*[.!?]/);
  return match ? match[0].trim() : '';
}

/**
 * Begin at a real sentence.
 *
 * Textbook PDFs break sentences across columns and pages, so a chunk often
 * opens mid-clause ("into coal is called carbonisation."). Starting a tutor's
 * answer there reads as a truncated database dump. Skip forward to the first
 * sentence that actually starts.
 */
function startAtSentence(text) {
  let compact = normalise(text);
  while (compact && !/^[A-Z]/.test(compact)) {
    const cut = compact.search(/[.!?]\s+/);
    if (cut === -1) return '';
    compact = compact.slice(cut + 1).trim();
  }
  return compact;
}

/**
 * Publication furniture the extractor picks up as though it were a concept:
 * reprint lines, page numbers, edition stamps.
 */
function looksLikeBoilerplate(text) {
  const compact = normalise(text);
  if (!compact) return true;
  if (/\b(19|20)\d{2}\b/.test(compact)) return true;                 // "Reprint 2026-27"
  if (/^(reprint|page|chapter|unit|fig\.?|table|appendix)\b/i.test(compact)) return true;
  if (!/[A-Za-z]{3}/.test(compact)) return true;                      // mostly digits/punctuation
  // A single short word is a section heading ("Uses"), not something a student
  // would name in a question. Longer single words ("Photosynthesis") are fine.
  const words = compact.split(' ').filter(Boolean);
  return words.length < 2 && compact.length < 10;
}

/** Reads as a clause lifted from mid-sentence rather than a nameable thing. */
function looksLikeFragment(text) {
  const compact = normalise(text);
  if (!compact) return true;
  if (/^[a-z]/.test(compact)) return true;
  const firstWord = compact.split(' ')[0].replace(/[^\p{L}]/gu, '').toLowerCase();
  return CLAUSE_STARTERS.has(firstWord);
}

function isCompleteSentence(text, minChars = 40) {
  const compact = normalise(text);
  return compact.length >= minChars && /[.!?]$/.test(compact) && !looksLikeFragment(compact);
}

function anchorKindFor(entityType) {
  return ENTITY_TYPE_TO_ANCHOR[normalise(entityType).toLowerCase()] || null;
}

/** First `count` sentences, capped — enough to answer, short enough to read. */
function leadSentences(text, count = 2, maxChars = MAX_ANSWER_CHARS) {
  const compact = normalise(text);
  if (!compact) return '';
  const sentences = compact.split(/(?<=[.?!])\s+/).slice(0, count).join(' ');
  const chosen = sentences || compact;
  if (chosen.length <= maxChars) return chosen;
  // Trim on a word boundary rather than mid-word.
  return `${chosen.slice(0, maxChars).replace(/\s+\S*$/, '')}...`;
}

/**
 * The passage a given entity sits next to.
 *
 * Entity-derived chunks repeat the entity's own title and summary, so quoting
 * them back as "the answer" is circular. A `passage` chunk from the same
 * section is the surrounding prose, which is what actually explains the thing.
 */
function passageForSection(chunks, section, rotation = 0) {
  const wanted = normalise(section).toLowerCase();
  const passages = chunks.filter(chunk => chunk.chunkType === 'passage');
  if (!passages.length) return '';

  const inSection = wanted
    ? passages.filter(chunk => normalise(chunk.metadata && chunk.metadata.section).toLowerCase() === wanted)
    : [];

  // Rotate over the passages that are actually READABLE. Rotating over the raw
  // list and then cleaning would keep landing on chunks that clean to nothing
  // — a chapter can have plenty of passages and still starve every anchor.
  const clean = pool => pool.map(chunk => passageBody(chunk.text)).filter(text => text.length >= MIN_ANSWER_CHARS);
  const usable = clean(inSection.length ? inSection : passages);
  const fallback = inSection.length ? clean(passages) : [];
  const pool = usable.length ? usable : fallback;
  return pool.length ? pool[rotation % pool.length] : '';
}

/**
 * Would this anchor produce a turn worth showing?
 *
 * The extractor is heuristic and, on some chapters, mostly returns mid-sentence
 * clauses with truncated summaries. Rendering those faithfully yields a tutor
 * asked "Can you explain Their formidable navy resisted European naval
 * supremacy?" and answering with a figure caption — which looks like broken
 * retrieval rather than a thin fixture. Rejecting here lets the chapter fall
 * below `minQaAnchors`, so the persona moves to a better-extracted chapter
 * instead.
 */
function isUsableAnchor(kind, title, summary, chunkText) {
  if (kind === 'question') {
    // The textbook's own exercise question, used verbatim. It has to actually
    // read as a question, and be answerable from the surrounding prose.
    if (!/\?$/.test(summary) || looksLikeFragment(summary)) return false;
    return chunkText.length >= MIN_ANSWER_CHARS;
  }

  if (title.length < MIN_TITLE_CHARS || title.length > MAX_TITLE_CHARS) return false;
  if (looksLikeFragment(title) || looksLikeBoilerplate(title)) return false;

  // A definition answers from its own summary, so that summary must stand alone
  // — but not necessarily end in a full stop, which the extractor often drops.
  if (kind === 'definition') return summary.length >= 40 && !looksLikeFragment(summary);

  // Concepts and activities answer from the passage, but a complete summary is
  // an acceptable substitute.
  return chunkText.length >= MIN_ANSWER_CHARS || isCompleteSentence(summary);
}

/**
 * Ordered, deterministic anchors from one `/api/rag/internal/chapter-context`
 * payload. Entities arrive ordered by (created_at, id), which is stable, so the
 * only reordering here is by anchor precedence.
 */
function qaAnchors(context) {
  return qaAnchorReport(context).anchors;
}

/**
 * Anchors plus how many candidates were considered.
 *
 * The ratio is the useful signal about a chapter as a whole. "The Rise of the
 * Marathas" yields 113 candidates of which almost none survive — the extractor
 * cut that PDF into mid-sentence clauses. A handful of survivors out of a
 * hundred is not a good chapter with a few bad entities; it is a chapter whose
 * extraction cannot be trusted, and the demo is better off on another one.
 */
function qaAnchorReport(context) {
  if (!context || !Array.isArray(context.entities)) return { anchors: [], candidateCount: 0 };
  const chunks = Array.isArray(context.chunks) ? context.chunks : [];

  const anchors = [];
  let candidateCount = 0;
  let rotation = 0;
  for (const entity of context.entities) {
    const kind = anchorKindFor(entity.entityType);
    if (!kind) continue;

    const title = normalise(entity.title);
    const summary = normalise(entity.summary);
    if (!title && !summary) continue;
    candidateCount += 1;

    const chunkText = passageForSection(chunks, entity.section, rotation);

    if (!isUsableAnchor(kind, title, summary, chunkText)) continue;
    rotation += 1;

    anchors.push({
      kind,
      entityId: entity.entityId,
      entityType: entity.entityType,
      title,
      summary,
      section: normalise(entity.section),
      pageStart: entity.pageStart == null ? null : Number(entity.pageStart),
      chunkText,
    });
  }

  // Stable sort: precedence first, original (created_at, id) order within.
  const ordered = anchors
    .map((anchor, index) => ({ anchor, index }))
    .sort((a, b) => {
      const rank = ANCHOR_PRECEDENCE.indexOf(a.anchor.kind) - ANCHOR_PRECEDENCE.indexOf(b.anchor.kind);
      return rank !== 0 ? rank : a.index - b.index;
    })
    .map(entry => entry.anchor);

  return { anchors: ordered, candidateCount };
}

function renderCitation(template, chapter, anchor) {
  if (!template || !chapter) return '';
  const pageClause = anchor.pageStart ? `, p.${anchor.pageStart}` : '';
  return normalise(
    template
      .replace(/\{book\}/g, normalise(chapter.book))
      .replace(/\{chapterNumber\}/g, String(chapter.chapterNumber || ''))
      .replace(/\{chapterName\}/g, normalise(chapter.chapterName))
      .replace(/\{subject\}/g, normalise(chapter.subject))
      .replace(/\{pageClause\}/g, pageClause),
  );
}

function fillTemplate(template, anchor) {
  return normalise(
    String(template || '')
      .replace(/\{title\}/g, anchor.title)
      .replace(/\{summary\}/g, anchor.summary)
      .replace(/\{section\}/g, anchor.section)
      .replace(/\{chunkLead\}/g, leadSentences(anchor.chunkText)),
  );
}

/**
 * Render anchors into question/answer pairs.
 *
 * `templates` is keyed by anchor kind; each value is an array of
 * `{question, answer}` shapes. Anchors cycle if `limit` exceeds their count, so
 * a thin chapter still produces a full session rather than a truncated one.
 */
function deriveQaPairs(context, options = {}) {
  const { templates = {}, limit = 0, citation = '' } = options;
  const anchors = qaAnchors(context);
  if (!anchors.length || limit <= 0) return [];

  const chapter = context.chapter || {};
  const pairs = [];

  for (let i = 0; i < limit; i += 1) {
    const anchor = anchors[i % anchors.length];
    const forKind = templates[anchor.kind];
    if (!Array.isArray(forKind) || !forKind.length) continue;

    // Vary the phrasing across repeats of the same anchor without randomness.
    const template = forKind[Math.floor(i / anchors.length) % forKind.length];
    const question = fillTemplate(template.question, anchor);
    let answer = fillTemplate(template.answer, anchor);
    if (!question || !answer) continue;

    const cited = renderCitation(citation, chapter, anchor);
    if (cited) answer = `${answer} ${cited}`;

    pairs.push({ question, answer, anchorId: anchor.entityId, anchorKind: anchor.kind });
  }

  return pairs;
}

module.exports = {
  ANCHOR_PRECEDENCE,
  MAX_ANSWER_CHARS,
  MIN_ANSWER_CHARS,
  MIN_ANCHOR_ACCEPTANCE,
  anchorKindFor,
  startAtSentence,
  endAtSentence,
  qaAnchorReport,
  looksLikeBoilerplate,
  passageBody,
  looksLikeFragment,
  isCompleteSentence,
  isUsableAnchor,
  leadSentences,
  qaAnchors,
  deriveQaPairs,
};
