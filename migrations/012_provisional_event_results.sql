-- Additive only: an explicit, replaceable snapshot independent of official results/history.
CREATE TABLE IF NOT EXISTS provisional_event_results (
  event_record_id INTEGER PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  source_archive_id INTEGER REFERENCES deck_memo_archives(id) ON DELETE SET NULL,
  source_name TEXT NOT NULL,
  source_key TEXT NOT NULL,
  players JSONB NOT NULL CHECK (jsonb_typeof(players) = 'array'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
