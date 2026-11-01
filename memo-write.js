// Shared confirmed memo persistence. Call inside the caller's transaction, after
// checking the provider-scoped event, participant and selected deck.
async function writeDmpMemo(db,memoEventId,dmpId,deckId){
 if(deckId===null)return db.query('DELETE FROM deck_memos WHERE memo_event_id = $1 AND dmp_id = $2',[memoEventId,dmpId]);
 return db.query(`INSERT INTO deck_memos (memo_event_id, dmp_id, player_id, deck_id)
 VALUES ($1::integer, $2::varchar(50), (SELECT id FROM players WHERE dmp_id = $2::varchar(50)), $3::integer)
 ON CONFLICT (memo_event_id, dmp_id) DO UPDATE SET deck_id = EXCLUDED.deck_id,
 player_id = EXCLUDED.player_id, updated_at = CURRENT_TIMESTAMP`,[memoEventId,dmpId,deckId]);
}
async function writeExternalMemo(db,memoEventId,key,deckId){
 return db.query(`UPDATE deck_memo_external_players SET deck_id=$3,updated_at=CURRENT_TIMESTAMP
 WHERE memo_event_id=$1 AND participant_key=$2 RETURNING participant_key`,[memoEventId,key,deckId]);
}
module.exports={writeDmpMemo,writeExternalMemo};
