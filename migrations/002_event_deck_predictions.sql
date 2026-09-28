-- Only manual overrides are stored. A NULL deck means explicitly unknown.
CREATE TABLE IF NOT EXISTS event_deck_predictions (
  event_record_id INTEGER NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
  manual_deck_id INTEGER REFERENCES decks(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (event_record_id, player_id)
);
CREATE INDEX IF NOT EXISTS event_deck_predictions_deck_idx
  ON event_deck_predictions (manual_deck_id);
