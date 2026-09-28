-- Retain legacy admin-only drafts; new drafts are scoped to a DMP event.
ALTER TABLE deck_memo_events ADD COLUMN IF NOT EXISTS event_record_id INTEGER REFERENCES events(id) ON DELETE RESTRICT;
ALTER TABLE deck_memo_events DROP CONSTRAINT IF EXISTS deck_memo_events_source_admin_key_key;
CREATE UNIQUE INDEX IF NOT EXISTS deck_memo_events_legacy_unique
  ON deck_memo_events(source, admin_key) WHERE event_record_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS deck_memo_events_dmp_unique
  ON deck_memo_events(source, admin_key, event_record_id);
CREATE TABLE IF NOT EXISTS deck_memo_roster (
  memo_event_id INTEGER NOT NULL REFERENCES deck_memo_events(id) ON DELETE RESTRICT,
  dmp_id VARCHAR(50) NOT NULL,
  handle_name TEXT NOT NULL,
  entry_no TEXT,
  table_no INTEGER,
  round INTEGER,
  PRIMARY KEY(memo_event_id, dmp_id)
);
CREATE TABLE IF NOT EXISTS deck_memo_archives (
  id SERIAL PRIMARY KEY,
  event_record_id INTEGER NOT NULL UNIQUE REFERENCES events(id) ON DELETE RESTRICT,
  event_name TEXT NOT NULL,
  event_date DATE NOT NULL,
  admin_key VARCHAR(100) NOT NULL,
  source_url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS deck_memo_archive_players (
  archive_id INTEGER NOT NULL REFERENCES deck_memo_archives(id) ON DELETE RESTRICT,
  dmp_id VARCHAR(50) NOT NULL,
  player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
  handle_name TEXT NOT NULL,
  entry_no TEXT,
  table_no INTEGER,
  round INTEGER,
  deck_id INTEGER REFERENCES decks(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(archive_id, dmp_id)
);
CREATE INDEX IF NOT EXISTS deck_memo_archive_players_deck_idx ON deck_memo_archive_players(deck_id);
