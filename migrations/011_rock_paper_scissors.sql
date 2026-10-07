-- Additive and re-runnable. Apply before deploying the RPS API/UI.
BEGIN;
-- Names alone cannot identify a DMP player. Do not insert fabricated DMP IDs.
CREATE TABLE IF NOT EXISTS rps_guests (
  id SERIAL PRIMARY KEY,
  handle_name VARCHAR(100) NOT NULL CHECK (BTRIM(handle_name) <> ''),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS rock_paper_scissors_records (
  id SERIAL PRIMARY KEY,
  player_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
  guest_id INTEGER REFERENCES rps_guests(id) ON DELETE CASCADE,
  hand VARCHAR(8) NOT NULL CHECK (hand IN ('rock', 'scissors', 'paper')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((player_id IS NOT NULL) <> (guest_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS rps_records_player_hand_idx
  ON rock_paper_scissors_records (player_id, hand) WHERE player_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS rps_records_guest_hand_idx
  ON rock_paper_scissors_records (guest_id, hand) WHERE guest_id IS NOT NULL;
COMMIT;
