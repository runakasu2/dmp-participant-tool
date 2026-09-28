// Resolve every recorded name to at most one master: official name first, then alias.
// Aggregate history before attaching aliases so multiple aliases cannot inflate counts.
const catalogSql = `
  WITH names AS (
    SELECT id AS deck_id, LOWER(name) AS key, 0 AS priority FROM decks
    UNION ALL
    SELECT deck_id, LOWER(alias) AS key, 1 AS priority FROM deck_aliases
  ), ranked_names AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY key ORDER BY priority, deck_id) AS position
    FROM names
  ), history_counts AS (
    SELECT LOWER(deck_name) AS key, COUNT(*) AS count FROM deck_history GROUP BY LOWER(deck_name)
  ), usage AS (
    SELECT n.deck_id, SUM(h.count)::integer AS usage_count
    FROM history_counts h JOIN ranked_names n ON n.key = h.key AND n.position = 1
    GROUP BY n.deck_id
  )
  SELECT d.id, d.name, COALESCE(u.usage_count, 0) AS usage_count,
    COALESCE((SELECT json_agg(a.alias ORDER BY a.alias) FROM deck_aliases a WHERE a.deck_id = d.id), '[]') AS aliases
  FROM decks d LEFT JOIN usage u ON u.deck_id = d.id
`;
async function getDeckCatalog(db, byUsage = false) {
  return db.query(catalogSql + (byUsage
    ? ' ORDER BY usage_count DESC, d.name ASC, d.id ASC'
    : ' ORDER BY d.name ASC, d.id ASC'));
}
module.exports = {getDeckCatalog, catalogSql};
