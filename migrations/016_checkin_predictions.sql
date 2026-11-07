CREATE TABLE IF NOT EXISTS checkin_predictions (
 shop_id VARCHAR(100) NOT NULL,
 event_id VARCHAR(100) NOT NULL,
 seq VARCHAR(100) NOT NULL,
 external_key VARCHAR(220) NOT NULL,
 deck_id INTEGER REFERENCES decks(id),
 PRIMARY KEY(shop_id,event_id,seq,external_key)
);
