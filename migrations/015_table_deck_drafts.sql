CREATE TABLE IF NOT EXISTS deck_memo_table_drafts (
 id SERIAL PRIMARY KEY,
 memo_event_id INTEGER NOT NULL REFERENCES deck_memo_events(id) ON DELETE CASCADE,
 round INTEGER NOT NULL CHECK(round>0),
 table_no TEXT NOT NULL,
 pair TEXT[] NOT NULL CHECK(cardinality(pair)=2),
 decks INTEGER[] NOT NULL CHECK(cardinality(decks)=2),
 resolved JSONB NOT NULL DEFAULT '{}',
 UNIQUE(memo_event_id,round,table_no,pair)
);
