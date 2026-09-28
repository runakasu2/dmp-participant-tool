-- Add provider-scoped participants without ever treating external numbers as DMP IDs.
CREATE TABLE IF NOT EXISTS deck_memo_dmp_candidates (
  memo_event_id INTEGER NOT NULL REFERENCES deck_memo_events(id) ON DELETE CASCADE,
  dmp_id VARCHAR(50) NOT NULL,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  handle_name TEXT NOT NULL,
  PRIMARY KEY (memo_event_id, dmp_id)
);
CREATE TABLE IF NOT EXISTS deck_memo_external_players (
  memo_event_id INTEGER NOT NULL REFERENCES deck_memo_events(id) ON DELETE CASCADE,
  participant_key TEXT NOT NULL,
  internal_participant_id TEXT,
  raw_no TEXT,
  handle_name TEXT NOT NULL,
  table_no INTEGER,
  round INTEGER,
  bye BOOLEAN NOT NULL DEFAULT FALSE,
  dmp_id VARCHAR(50),
  player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
  dmp_handle_name TEXT,
  match_status TEXT NOT NULL CHECK (match_status IN ('matched','unmatched','ambiguous','manual')),
  deck_id INTEGER REFERENCES decks(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (memo_event_id, participant_key),
  UNIQUE (memo_event_id, dmp_id)
);
CREATE INDEX IF NOT EXISTS deck_memo_external_players_deck_idx ON deck_memo_external_players(deck_id);
ALTER TABLE deck_memo_archives ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'nojigiku';
ALTER TABLE deck_memo_archive_players ADD COLUMN IF NOT EXISTS participant_key TEXT;
ALTER TABLE deck_memo_archive_players ADD COLUMN IF NOT EXISTS internal_participant_id TEXT;
ALTER TABLE deck_memo_archive_players ADD COLUMN IF NOT EXISTS raw_no TEXT;
ALTER TABLE deck_memo_archive_players ADD COLUMN IF NOT EXISTS bye BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE deck_memo_archive_players ADD COLUMN IF NOT EXISTS match_status TEXT;
ALTER TABLE deck_memo_archive_players ADD COLUMN IF NOT EXISTS dmp_handle_name TEXT;
UPDATE deck_memo_archive_players SET participant_key = 'dmp:' || dmp_id WHERE participant_key IS NULL;
-- Only replace the old primary key on the first application. Retain every existing row.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'deck_memo_archive_players'::regclass
    AND conname = 'deck_memo_archive_players_participant_pkey') THEN
    ALTER TABLE deck_memo_archive_players DROP CONSTRAINT IF EXISTS deck_memo_archive_players_pkey;
    ALTER TABLE deck_memo_archive_players ALTER COLUMN dmp_id DROP NOT NULL;
    ALTER TABLE deck_memo_archive_players ALTER COLUMN participant_key SET NOT NULL;
    ALTER TABLE deck_memo_archive_players ADD CONSTRAINT deck_memo_archive_players_participant_pkey
      PRIMARY KEY (archive_id, participant_key);
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS deck_memo_archive_players_dmp_unique ON deck_memo_archive_players(archive_id, dmp_id);
