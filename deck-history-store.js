// Both individual edits and archive imports must use this transaction boundary.
// Existing schemas have no unique event/player constraint, so serialize history writes.
async function beginHistoryTransaction(client) {
  await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  // Deck merge/rename also touches history: lock master rows before history.
  await client.query('SELECT id FROM decks ORDER BY id FOR SHARE');
  await client.query('LOCK TABLE deck_history IN SHARE ROW EXCLUSIVE MODE');
}

async function normalizeDeckName(client, name) {
  const input = String(name).trim();
  const result = await client.query(`
    SELECT d.name FROM decks d
    LEFT JOIN deck_aliases a ON a.deck_id = d.id
    WHERE LOWER(d.name) = LOWER($1) OR LOWER(a.alias) = LOWER($1)
    ORDER BY CASE WHEN LOWER(d.name) = LOWER($1) THEN 0 ELSE 1 END, d.id
    LIMIT 1
  `, [input]);
  return result.rows[0]?.name || input;
}

async function saveDeckHistory(client, {playerId, shopId, eventId, seq, eventDate, deckName}) {
  const existing = await client.query(`
    SELECT id FROM deck_history
    WHERE player_id = $1 AND shop_id = $2 AND event_id = $3 AND seq = $4
    ORDER BY created_at DESC NULLS LAST, id DESC LIMIT 1
  `, [playerId, String(shopId), String(eventId), String(seq)]);
  if (existing.rows.length) {
    const result = await client.query(`
      UPDATE deck_history SET event_date = $1, deck_name = $2, created_at = CURRENT_TIMESTAMP
      WHERE id = $3 RETURNING *
    `, [eventDate || null, deckName, existing.rows[0].id]);
    return result.rows[0];
  }
  const result = await client.query(`
    INSERT INTO deck_history (player_id, shop_id, event_id, seq, event_date, deck_name)
    VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
  `, [playerId, String(shopId), String(eventId), String(seq), eventDate || null, deckName]);
  return result.rows[0];
}
module.exports = {beginHistoryTransaction, normalizeDeckName, saveDeckHistory};
