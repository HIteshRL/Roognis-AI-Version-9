const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseRssFeed,
  isStudentSafeNews,
  selectStudentNews,
  balanceNewsCategories,
  extractOriginalImageUrl,
} = require('../student-news');

const FEED = { key: 'science', name: 'Trusted Science', category: 'Science' };

test('parses original RSS image, source fields, and description without generating media', () => {
  const xml = `
    <rss><channel><item>
      <title><![CDATA[Students test a new Moon rover]]></title>
      <description><![CDATA[A school engineering team tested a rover for future exploration.]]></description>
      <link>https://example.org/moon-rover</link>
      <pubDate>Fri, 17 Jul 2026 08:00:00 GMT</pubDate>
      <media:thumbnail url="https://images.example.org/rover.jpg" />
    </item></channel></rss>`;
  const [article] = parseRssFeed(xml, FEED);
  assert.equal(article.title, 'Students test a new Moon rover');
  assert.equal(article.imageUrl, 'https://images.example.org/rover.jpg');
  assert.equal(article.sourceName, 'Trusted Science');
});

test('returns no image when the publisher supplies none', () => {
  assert.equal(extractOriginalImageUrl('<item><title>Text only</title></item>'), null);
});

test('blocks murder and graphic violence while allowing educational war diplomacy coverage', () => {
  assert.equal(isStudentSafeNews({ category: 'Technology', title: 'Man murdered', summary: 'Police report' }), false);
  assert.equal(isStudentSafeNews({ category: 'Science', title: 'One dead in floods', summary: 'Campers died nearby' }), false);
  assert.equal(isStudentSafeNews({
    category: 'World Affairs',
    title: 'Countries discuss peace agreement during war',
    summary: 'Students can understand how diplomacy works.',
  }), true);
});

test('world affairs requires constructive educational context', () => {
  assert.equal(isStudentSafeNews({ category: 'World Affairs', title: 'Political dispute grows', summary: 'Leaders trade claims.' }), false);
  assert.equal(isStudentSafeNews({ category: 'World Affairs', title: 'Leader accuses country of election meddling', summary: 'The claim may undermine an election.' }), false);
  assert.equal(isStudentSafeNews({ category: 'World Affairs', title: 'A couple paid off debt', summary: 'She said they share an account.' }), false);
  assert.equal(isStudentSafeNews({ category: 'World Affairs', title: 'Youth cooperation programme opens', summary: 'Students learn together.' }), true);
});

test('science and technology reject distressing or market-led stories', () => {
  assert.equal(isStudentSafeNews({ category: 'Science', title: 'Heatwave continues', summary: 'Temperatures remain high.' }), false);
  assert.equal(isStudentSafeNews({ category: 'Technology', title: 'Space company share price drops', summary: 'Stock market trading was volatile.' }), false);
  assert.equal(isStudentSafeNews({ category: 'Science', title: 'Curlew chicks released', summary: 'A conservation project aims to boost species numbers.' }), true);
});

test('selects recent safe stories, removes duplicates, and keeps newest first', () => {
  const now = new Date('2026-07-17T12:00:00Z');
  const selected = selectStudentNews([
    { category: 'Science', title: 'Older', summary: 'Space research', url: 'https://example.org/a', publishedAt: new Date('2026-07-15') },
    { category: 'Science', title: 'Newest', summary: 'Space research', url: 'https://example.org/b', publishedAt: new Date('2026-07-17') },
    { category: 'Science', title: 'Duplicate', summary: 'Space research', url: 'https://example.org/b?utm_source=x', publishedAt: new Date('2026-07-16') },
    { category: 'Sports', title: 'Old result', summary: 'Tournament', url: 'https://example.org/c', publishedAt: new Date('2026-06-01') },
  ], { now });
  assert.deepEqual(selected.map(item => item.title), ['Newest', 'Older']);
});

test('balances categories so a busy sports feed cannot crowd out educational stories', () => {
  const articles = [
    { category: 'Sports', title: 'Sport 1' },
    { category: 'Sports', title: 'Sport 2' },
    { category: 'Sports', title: 'Sport 3' },
    { category: 'Technology', title: 'Tech 1' },
    { category: 'Science', title: 'Science 1' },
    { category: 'World Affairs', title: 'World 1' },
  ];
  assert.deepEqual(
    balanceNewsCategories(articles, 5).map(article => article.title),
    ['Tech 1', 'Science 1', 'World 1', 'Sport 1', 'Sport 2']
  );
});
