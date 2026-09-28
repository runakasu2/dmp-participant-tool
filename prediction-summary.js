// Pure aggregation: use final predictions without recalculating prediction rules.
function buildPredictionSummary(participants = [], decks = []) {
  const canonical = new Map();
  for (const deck of decks) canonical.set(deck.name.trim().toLowerCase(), deck.name);
  for (const deck of decks) {
    for (const alias of deck.aliases || []) {
      const key = alias.trim().toLowerCase();
      if (!canonical.has(key)) canonical.set(key, deck.name);
    }
  }
  const counts = new Map();
  let unknownCount = 0;
  for (const participant of participants) {
    const name = participant.prediction?.finalDeckName?.trim();
    if (!name) { unknownCount++; continue; }
    const normalized = canonical.get(name.toLowerCase()) || name;
    counts.set(normalized, (counts.get(normalized) || 0) + 1);
  }
  const participantCount = participants.length;
  const predictedCount = participantCount - unknownCount;
  const percentage = count => participantCount ? (count / participantCount * 100).toFixed(1) : '0.0';
  return {
    participantCount, predictedCount, unknownCount, coverage: percentage(predictedCount),
    decks: [...Array.from(counts, ([deckName, count]) => ({deckName, count, percentage: percentage(count), unknown: false}))
      .sort((a, b) => b.count - a.count || a.deckName.localeCompare(b.deckName, 'ja')),
      {deckName: '不明', count: unknownCount, percentage: percentage(unknownCount), unknown: true}]
  };
}
if (typeof module !== 'undefined' && module.exports) module.exports = {buildPredictionSummary};
