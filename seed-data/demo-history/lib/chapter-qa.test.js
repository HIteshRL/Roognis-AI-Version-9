'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  qaAnchors, deriveQaPairs, leadSentences, anchorKindFor,
  passageBody, looksLikeFragment, looksLikeBoilerplate, isUsableAnchor,
} = require('./chapter-qa');

/* ── What these protect ──────────────────────────────────────────────────────
   The demo's headline claim is that the tutoring is generated from whatever the
   school uploaded. If these pairs drift back to authored, subject-keyed text,
   a session card titled "Coal and Petroleum" ends up previewing a question
   about plastics — which reads as broken retrieval, not as a thin fixture.  ── */

/** Shaped exactly like GET /api/rag/internal/chapter-context. */
const CONTEXT = {
  chapter: {
    schoolId: 'demo-school',
    board: 'CBSE',
    curriculum: 'NCERT',
    grade: 8,
    subject: 'Science',
    book: 'Science',
    chapterNumber: 3,
    chapterName: 'Coal and Petroleum',
    language: 'English',
    edition: '2024-25',
  },
  chunks: [
    {
      chunkId: 'c1',
      chunkType: 'passage',
      text: 'Coal is a hard black substance formed from the remains of vegetation. '
        + 'It was buried and compressed over millions of years. Burning it releases carbon dioxide.',
      metadata: { section: 'Natural Resources' },
    },
    {
      chunkId: 'c2',
      chunkType: 'semantic',
      text: 'Fossil fuels\nFossil fuels are formed from dead remains of living organisms.',
      metadata: { section: 'Natural Resources' },
    },
    {
      chunkId: 'c3',
      chunkType: 'passage',
      text: 'Petroleum is a dark oily liquid found between layers of rock. Refining separates it.',
      metadata: { section: 'Petroleum' },
    },
  ],
  entities: [
    {
      entityId: 'e1',
      entityType: 'Definition',
      title: 'Fossil fuels',
      summary: 'Fossil fuels are formed from the dead remains of living organisms buried under the earth.',
      section: 'Natural Resources',
      pageStart: 32,
    },
    {
      entityId: 'e2',
      entityType: 'Question',
      title: 'Why is coal called a fossil fuel',
      summary: 'Why is coal called a fossil fuel?',
      section: 'Petroleum',
      pageStart: 35,
    },
    {
      entityId: 'e3',
      entityType: 'CanonicalConcept',
      title: 'Coal',
      summary: 'Coal',
      section: 'Natural Resources',
      pageStart: 31,
    },
    {
      entityId: 'e4',
      entityType: 'Activity',
      title: 'Activity 3.1',
      summary: 'Heat a small piece of coal in a test tube and note what collects on the sides.',
      section: 'Petroleum',
      pageStart: 36,
    },
  ],
};

const TEMPLATES = {
  definition: [{ question: 'What does "{title}" actually mean in this chapter?', answer: '{summary}' }],
  question: [{ question: '{summary}', answer: '{chunkLead}' }],
  concept: [{ question: 'Can you explain {title}?', answer: '{chunkLead}' }],
  activity: [{ question: 'What am I supposed to observe in {title}?', answer: '{chunkLead}' }],
};

test('anchor kinds map from the RAG entity-type vocabulary', () => {
  // These are PascalCase on the wire; a lowercase-only match silently yields
  // zero anchors and the seeder falls back to off-topic authored text.
  assert.equal(anchorKindFor('Definition'), 'definition');
  assert.equal(anchorKindFor('Question'), 'question');
  assert.equal(anchorKindFor('Experiment'), 'activity');
  assert.equal(anchorKindFor('Figure'), null);
});

test('CanonicalConcept entities are skipped as self-answering', () => {
  // Their title, summary and content are the same string, so a question built
  // from one contains its own answer.
  const anchors = qaAnchors(CONTEXT);
  assert.ok(!anchors.some(anchor => anchor.entityId === 'e3'));
});

test('anchors are ordered by precedence, definitions first', () => {
  const kinds = qaAnchors(CONTEXT).map(anchor => anchor.kind);
  assert.deepEqual(kinds, ['definition', 'question', 'activity']);
  assert.ok(!kinds.includes('concept'), 'Concept entities are too unreliable to anchor on');
});

test('an anchor answers from a passage chunk in its own section', () => {
  // Entity-derived chunks repeat the entity's title and summary, so quoting one
  // back is circular. The surrounding prose is what actually explains it.
  const activity = qaAnchors(CONTEXT).find(anchor => anchor.kind === 'activity');
  assert.match(activity.chunkText, /Petroleum is a dark oily liquid/);
});

test('derived pairs are grounded in the uploaded chapter, not invented', () => {
  const pairs = deriveQaPairs(CONTEXT, { templates: TEMPLATES, limit: 3 });
  assert.equal(pairs.length, 3);

  const definition = pairs.find(pair => pair.anchorId === 'e1');
  assert.equal(definition.question, 'What does "Fossil fuels" actually mean in this chapter?');
  assert.match(definition.answer, /dead remains of living organisms/);

  // The textbook's own exercise question, used verbatim as the student's.
  const question = pairs.find(pair => pair.anchorId === 'e2');
  assert.equal(question.question, 'Why is coal called a fossil fuel?');
});

test('citations name the real book, chapter and page', () => {
  // Section is deliberately absent: it comes from the same heuristic as concept
  // titles and is just as unreliable ("in \"Madhavji shows sal and wild mango\"").
  const [pair] = deriveQaPairs(CONTEXT, {
    templates: TEMPLATES,
    limit: 1,
    citation: "That's from {book}, chapter {chapterNumber} - {chapterName}{pageClause}.",
  });
  assert.match(pair.answer, /That's from Science, chapter 3 - Coal and Petroleum, p\.32\./);
});

test('anchors cycle so a thin chapter still fills a session', () => {
  const pairs = deriveQaPairs(CONTEXT, { templates: TEMPLATES, limit: 7 });
  assert.equal(pairs.length, 7);
  assert.equal(new Set(pairs.map(p => p.anchorId)).size, 3);
});

test('derivation is deterministic', () => {
  const first = deriveQaPairs(CONTEXT, { templates: TEMPLATES, limit: 5 });
  const second = deriveQaPairs(CONTEXT, { templates: TEMPLATES, limit: 5 });
  assert.deepEqual(first, second);
});

test('a chapter with no usable entities yields nothing rather than filler', () => {
  const empty = { ...CONTEXT, entities: [{ entityId: 'x', entityType: 'Figure', title: 'Fig 3.1', summary: '' }] };
  assert.deepEqual(deriveQaPairs(empty, { templates: TEMPLATES, limit: 3 }), []);
});

/* ── Quality gates ───────────────────────────────────────────────────────────
   These are calibrated against what the EKE extractor actually produced for
   "The Rise of the Marathas": 112 Concept entities that were almost all
   mid-sentence clauses with truncated summaries, and passage chunks beginning
   with a figure caption. Rendered faithfully, that reads as broken retrieval.
                                                                          ── */

test('a passage quote skips the caption line it starts with', () => {
  // Real chunk shape: "the 1680s (British Museum)\nWhen he was just 16, ..."
  assert.equal(
    passageBody('the 1680s (British Museum)\nWhen he was just 16, Shivaji launched campaigns.'),
    'When he was just 16, Shivaji launched campaigns.'
  );
  // A single-line chunk has no caption to drop.
  assert.equal(passageBody('Coal is a hard black substance.'), 'Coal is a hard black substance.');
});

test('mid-sentence clauses are recognised as fragments', () => {
  assert.equal(looksLikeFragment('Their formidable navy resisted European naval supremacy'), true);
  assert.equal(looksLikeFragment('opposition from Indian powers, until Chhatrapati Shivaji'), true);
  assert.equal(looksLikeFragment('before the British took over?'), true);
  assert.equal(looksLikeFragment('Fossil fuels'), false);
  assert.equal(looksLikeFragment('Cell Structure and Functions'), false);
});

test('anchors built from clause fragments are rejected', () => {
  const longPassage = 'x'.repeat(120);
  assert.equal(isUsableAnchor('concept', 'Their formidable navy resisted', 'technology of the time.', longPassage), false);
  assert.equal(isUsableAnchor('concept', 'The Maratha navy', 'technology of the time.', longPassage), true);
});

test('a definition with a truncated summary is rejected', () => {
  // It answers from its own summary, so a fragment leaves nothing to say.
  assert.equal(isUsableAnchor('definition', 'Fossil fuels', 'for his subjects.', ''), false);
  assert.equal(
    isUsableAnchor('definition', 'Fossil fuels', 'Fossil fuels are formed from the dead remains of living organisms.', ''),
    true
  );
});

test('a question with no prose to answer from is rejected', () => {
  assert.equal(isUsableAnchor('question', '', 'Why is coal called a fossil fuel?', 'too short'), false);
  assert.equal(isUsableAnchor('question', '', 'Why is coal called a fossil fuel?', 'x'.repeat(120)), true);
});

test('a chapter that only extracted fragments yields no anchors at all', () => {
  // The seeder then drops it below minQaAnchors and picks another chapter,
  // rather than seeding a session full of nonsense.
  const junk = {
    chapter: CONTEXT.chapter,
    chunks: CONTEXT.chunks,
    entities: [
      { entityId: 'j1', entityType: 'Concept', title: 'Their formidable navy resisted European naval supremacy', summary: 'technology of the time.' },
      { entityId: 'j2', entityType: 'Concept', title: 'opposition from Indian powers, until Chhatrapati Shivaji', summary: 'for his subjects.' },
      { entityId: 'j3', entityType: 'Question', title: 'before the British took over', summary: 'before the British took over?' },
    ],
  };
  assert.deepEqual(qaAnchors(junk), []);
});

test('an answer never starts mid-sentence', () => {
  // PDFs break sentences across columns, so chunks routinely open mid-clause.
  assert.equal(
    passageBody('Head\ninto coal is called carbonisation. Since it formed from vegetation, coal is a fossil fuel.'),
    'Since it formed from vegetation, coal is a fossil fuel.'
  );
  // Nothing salvageable rather than a mid-clause quote.
  assert.equal(passageBody('Head\ninto coal is called carbonisation'), '');
});

test('publication furniture is not mistaken for a concept', () => {
  assert.equal(looksLikeBoilerplate('Reprint 2026-27'), true);
  assert.equal(looksLikeBoilerplate('Uses'), true, 'a bare section heading');
  assert.equal(looksLikeBoilerplate('Table 3.1'), true);
  assert.equal(looksLikeBoilerplate('Photosynthesis'), false, 'a long single word is a real concept');
  assert.equal(looksLikeBoilerplate('Coal and Petroleum'), false);
});

test('several anchors in one section do not all quote the same passage', () => {
  const many = {
    chapter: CONTEXT.chapter,
    chunks: [
      { chunkId: 'p1', chunkType: 'passage', text: 'Head\nFirst passage about coal formation over millions of years underground.', metadata: { section: 'S' } },
      { chunkId: 'p2', chunkType: 'passage', text: 'Head\nSecond passage about petroleum refining into useful everyday products.', metadata: { section: 'S' } },
    ],
    entities: [
      { entityId: 'a', entityType: 'Activity', title: 'Activity 3.1', summary: 'Observe how coal burns.', section: 'S' },
      { entityId: 'b', entityType: 'Activity', title: 'Activity 3.2', summary: 'Observe how petroleum separates.', section: 'S' },
    ],
  };
  const [first, second] = qaAnchors(many);
  assert.notEqual(first.chunkText, second.chunkText);
});

test('leadSentences trims on a word boundary, never mid-word', () => {
  const long = `${'word '.repeat(200)}end.`;
  const trimmed = leadSentences(long, 2, 60);
  assert.ok(trimmed.length <= 63, `got ${trimmed.length}`);
  assert.match(trimmed, /\.\.\.$/);
  assert.ok(!/\bwor\.\.\.$/.test(trimmed), 'trimmed mid-word');
});
