const {test} = require('node:test');
const assert = require('node:assert/strict');
const {buildDeckInsights} = require('../player-insights');

for (const size of [0, 1, 2, 3, 4, 5, 6, 12]) test(`recent history retains uses, maximum five: ${size} records`, () => {
  const history = Array.from({length: size}, (_, i) => ({deckName: '同じデッキ', eventDate: `2026-09-${String(30-i).padStart(2, '0')}`}));
  const result = buildDeckInsights(history);
  assert.deepEqual(result.recentDecks, history.slice(0, 5));
  assert.equal(result.topDecks.length, size ? 1 : 0);
  if (size) assert.equal(result.topDecks[0].count, size);
  assert.equal(history.length, size);
});
test('TOP3 uses all history, then latest date, then stable name; null dates are last', () => {
  const history = [
    {deckName: 'B', eventDate: '2026-10-06'}, {deckName: 'A', eventDate: '2026-10-06'},
    {deckName: 'C', eventDate: '2026-10-04'}, {deckName: 'D', eventDate: null},
    ...['A', 'B', 'C', 'D'].map(deckName => ({deckName, eventDate: '2026-01-01'})),
    ...Array.from({length: 3}, () => ({deckName: '昔の最多', eventDate: '2020-01-01'}))
  ];
  const before = structuredClone(history);
  const result = buildDeckInsights(history);
  assert.deepEqual(result.topDecks.map(d => [d.deckName, d.count]), [['昔の最多',3], ['A',2], ['B',2]]);
  assert.equal(result.deckSummary.length, 5);
  assert.deepEqual(history, before);
});
