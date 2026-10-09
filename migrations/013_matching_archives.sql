-- Additive, provider-independent pairing archive. Existing memo/history tables are untouched.
CREATE TABLE IF NOT EXISTS matching_archives (
  id SERIAL PRIMARY KEY,
  event_record_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  source_key TEXT NOT NULL,
  source_url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(event_record_id, provider, source_key)
);
CREATE TABLE IF NOT EXISTS matching_archive_matches (
  archive_id INTEGER NOT NULL REFERENCES matching_archives(id) ON DELETE CASCADE,
  round INTEGER NOT NULL CHECK(round>0),
  match_key TEXT NOT NULL,
  table_no INTEGER,
  sides JSONB NOT NULL CHECK(jsonb_typeof(sides)='array'),
  outcome TEXT NOT NULL,
  winner_key TEXT,
  reason TEXT,
  raw_result JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(archive_id,round,match_key)
);
