-- Additive only. Run statements individually, outside a transaction.
-- CONCURRENTLY keeps normal reads/writes available during production index creation.
CREATE INDEX CONCURRENTLY IF NOT EXISTS deck_history_event_player_recent_idx
  ON deck_history (shop_id, event_id, seq, player_id, created_at DESC, id DESC);
