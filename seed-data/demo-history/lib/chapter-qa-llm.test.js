'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveProviders, parsePairs, buildMessages, sourceText, renderQaPairs } = require('./chapter-qa-llm');

/* ── What these protect ──────────────────────────────────────────────────────
   The LLM writes the demo's conversation text, so the risks are: shipping an
   answer that admits it could not answer, and letting an API outage produce a
   silently empty demo. Both are covered here; neither needs the network.   ── */

const CONTEXT = {
  chapter: { subject: 'Science', grade: 8, chapterNumber: 3, chapterName: 'Coal and Petroleum', book: 'Science' },
  chunks: [
    { chunkType: 'passage', text: 'Coal is a hard black substance formed from the remains of vegetation buried underground.' },
    { chunkType: 'passage', text: 'Petroleum is a dark oily liquid found between layers of rock, separated by refining.' },
  ],
  entities: [
    {
      entityId: 'e1',
      entityType: 'Definition',
      title: 'Fossil fuels',
      summary: 'Fossil fuels are formed from the dead remains of living organisms buried under the earth.',
      pageStart: 32,
    },
  ],
};

const okBody = pairs => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content: JSON.stringify({ pairs }) } }] }),
});

const GOOD_PAIRS = [
  { question: 'Why is coal called a fossil fuel?', answer: 'Because it formed from the buried remains of ancient vegetation over millions of years.' },
  { question: 'How is petroleum separated?', answer: 'Petroleum is separated by refining, which splits the dark oily liquid into different useful products.' },
  { question: 'Where is petroleum found?', answer: 'It collects between layers of rock deep underground, which is why wells have to be drilled to reach it.' },
];

test('providers are tried in order, with LLM_PROVIDER first', () => {
  const both = resolveProviders({ openrouterApiKey: 'a', groqApiKey: 'b', provider: 'groq' });
  assert.deepEqual(both.map(p => p.name), ['groq', 'openrouter']);

  const defaulted = resolveProviders({ openrouterApiKey: 'a', groqApiKey: 'b', provider: '' });
  assert.deepEqual(defaulted.map(p => p.name), ['openrouter', 'groq']);
});

test('no key at all means no providers, not a crash', () => {
  assert.deepEqual(resolveProviders({ openrouterApiKey: '', groqApiKey: '' }), []);
});

test('answers that admit a gap are dropped', () => {
  // "Not specified in the text" is the model being honest, but in a seeded
  // transcript it reads as the tutor failing.
  const pairs = parsePairs(JSON.stringify({
    pairs: [
      { question: 'What were the chief weapons?', answer: 'The chief weapons are not specified in the text, but traffic was controlled.' },
      { question: 'Tell me more about the navy', answer: 'Based on the text, their navy resisted European supremacy at sea for decades.' },
      { question: 'What was their position?', answer: 'They were the largest pan-Indian power of their time, holding territory across the subcontinent.' },
    ],
  }));
  assert.deepEqual(pairs.map(p => p.question), ['What was their position?']);
});

test('answers that narrate the source rather than teach are dropped', () => {
  const pairs = parsePairs(JSON.stringify({
    pairs: [
      { question: 'When did he die?', answer: 'The year 1680 is mentioned as the year of death of someone important.' },
      { question: 'What example is used?', answer: 'The chapter gives the example of multiplying 23 and 27 to show the pattern.' },
      { question: 'What was the navy like?', answer: 'Their navy was formidable enough to resist European naval supremacy along the western coast.' },
    ],
  }));
  assert.deepEqual(pairs.map(p => p.question), ['What was the navy like?']);
});

test('fenced JSON and bare arrays both parse', () => {
  const fenced = '```json\n{"pairs":[{"question":"Why is coal black?","answer":"Because of the carbon left behind when vegetation is compressed underground."}]}\n```';
  assert.equal(parsePairs(fenced).length, 1);
  const bare = JSON.stringify([{ question: 'Why is coal black?', answer: 'Because of the carbon left behind when vegetation is compressed underground.' }]);
  assert.equal(parsePairs(bare).length, 1);
});

test('the prompt carries the chapter and its extracts, and forbids hedging', () => {
  const [system, user] = buildMessages(CONTEXT, 5);
  assert.match(user.content, /Coal and Petroleum/);
  assert.match(user.content, /hard black substance/);
  assert.match(user.content, /Write 5 varied/);
  assert.match(system.content, /not specified/);
});

test('a chapter with no extracts never reaches the network', () => {
  assert.equal(sourceText({ chunks: [] }), '');
});

test('an unfunded provider falls through to the next one', async () => {
  // An OPENROUTER_API_KEY that is set but unfunded answers 402. That must move
  // to Groq, not drop the whole chapter to templated text.
  const seen = [];
  const result = await renderQaPairs(CONTEXT, {
    openrouterApiKey: 'a',
    groqApiKey: 'b',
    provider: '',
    fetchFn: async url => {
      seen.push(url);
      if (url.includes('openrouter')) return { ok: false, status: 402, json: async () => ({}) };
      return okBody(GOOD_PAIRS);
    },
  });
  assert.equal(result.source, 'groq');
  assert.equal(result.pairs.length, 3);
  assert.equal(seen.length, 2);
});

test('every provider failing falls back to derived text, never to nothing', async () => {
  const result = await renderQaPairs(CONTEXT, {
    openrouterApiKey: 'a',
    groqApiKey: 'b',
    fetchFn: async () => { throw new Error('ECONNREFUSED'); },
    templates: { definition: [{ question: 'What does "{title}" mean?', answer: '{summary}' }] },
    count: 3,
  });
  assert.equal(result.source, 'derived');
  assert.ok(result.pairs.length > 0, 'a network outage must not empty the demo');
});

test('a response too thin to use falls through rather than shipping it', async () => {
  const result = await renderQaPairs(CONTEXT, {
    groqApiKey: 'b',
    fetchFn: async () => okBody([GOOD_PAIRS[0]]),
    templates: { definition: [{ question: 'What does "{title}" mean?', answer: '{summary}' }] },
    count: 3,
  });
  assert.equal(result.source, 'derived');
});
