-- Seed only when this table is first created; repeated setup must preserve removals.
DO $$
BEGIN
  IF to_regclass('deck_formats') IS NULL THEN
    CREATE TABLE deck_formats (
      deck_id INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
      format VARCHAR(16) NOT NULL CHECK (format IN ('original','advance','2block')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (deck_id, format)
    );
    INSERT INTO deck_formats (deck_id, format) SELECT id, 'original' FROM decks;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS deck_formats_format_idx ON deck_formats(format, deck_id);
