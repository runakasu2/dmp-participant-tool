-- Existing players and events must be created first. Safe to run repeatedly.
CREATE TABLE IF NOT EXISTS event_results (
  id SERIAL PRIMARY KEY,
  event_record_id INTEGER NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
  rank INTEGER CHECK (rank > 0),
  rank_raw TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (event_record_id, player_id)
);
CREATE INDEX IF NOT EXISTS event_results_event_rank_idx
  ON event_results (event_record_id, rank);
CREATE INDEX IF NOT EXISTS event_results_player_idx
  ON event_results (player_id);
