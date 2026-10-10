-- Additive and re-runnable. Existing records remain unchanged and have no tie rows.
BEGIN;
CREATE TABLE IF NOT EXISTS rps_record_ties (
  record_id INTEGER NOT NULL REFERENCES rock_paper_scissors_records(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position > 0),
  hand VARCHAR(8) NOT NULL CHECK (hand IN ('rock', 'scissors', 'paper')),
  PRIMARY KEY (record_id, position)
);
COMMIT;
