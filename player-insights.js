// Match deck-history-store.normalizeDeckName: official name, then alias, then lowest master ID.
const playerHistorySql = `
  SELECT dh.shop_id, dh.event_id, dh.seq,
    COALESCE(e.event_date, dh.event_date)::text AS event_date,
    COALESCE(master.name, dh.deck_name) AS deck_name, e.event_name, e.participant_count
  FROM deck_history dh
  LEFT JOIN events e ON e.shop_id = dh.shop_id AND e.event_id = dh.event_id AND e.seq = dh.seq
  LEFT JOIN LATERAL (
    SELECT d.name FROM decks d
    LEFT JOIN deck_aliases a ON a.deck_id = d.id
    WHERE LOWER(d.name) = LOWER(BTRIM(dh.deck_name)) OR LOWER(a.alias) = LOWER(BTRIM(dh.deck_name))
    ORDER BY CASE WHEN LOWER(d.name) = LOWER(BTRIM(dh.deck_name)) THEN 0 ELSE 1 END, d.id
    LIMIT 1
  ) master ON TRUE
  WHERE dh.player_id = $1
  ORDER BY COALESCE(e.event_date, dh.event_date) DESC NULLS LAST,
    dh.created_at DESC NULLS LAST, dh.id DESC
`;

// History is ordered by event date in SQL; repeats count as separate uses.
function buildDeckInsights(history) {
  const counts = new Map();
  for (const item of history) {
    const deck = counts.get(item.deckName) || {deckName: item.deckName, count: 0, lastUsed: null};
    deck.count++;
    if (item.eventDate && (!deck.lastUsed || item.eventDate > deck.lastUsed)) deck.lastUsed = item.eventDate;
    counts.set(item.deckName, deck);
  }
  const ranked = [...counts.values()].sort((a, b) => b.count - a.count ||
    (b.lastUsed || '').localeCompare(a.lastUsed || '') ||
    a.deckName.localeCompare(b.deckName, 'ja') || (a.deckName < b.deckName ? -1 : a.deckName > b.deckName ? 1 : 0));
  return {recentDecks: history.slice(0, 5), topDecks: ranked.slice(0, 3),
    deckSummary: ranked.map(({deckName, count}) => ({deckName, count}))};
}
module.exports = {playerHistorySql, buildDeckInsights};
