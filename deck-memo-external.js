// Reuse provider-scoped memo rows without replacing decks. DMP IDs are updated only from verified Suga entries; legacy TCG mappings are retained.
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const validId=id=>Number.isInteger(id)&&id>0&&id<=2147483647;
async function upsertExternalRoster(db,memoId,participants,verifiedDmp=false){
 const people=[...new Map(participants.map(p=>[p.participantKey,p])).values()];if(!people.length)return;
 await db.query(`INSERT INTO deck_memo_external_players
  (memo_event_id,participant_key,internal_participant_id,raw_no,handle_name,table_no,round,bye,match_status,dmp_id)
  SELECT $1::integer,x.key,x.internal,x.raw,x.name,x.table_no,x.round,x.bye,'unmatched',x.dmp
  FROM jsonb_to_recordset($2::jsonb) AS x(key text,internal text,raw text,name text,table_no integer,round integer,bye boolean,dmp varchar(50))
  ON CONFLICT(memo_event_id,participant_key) DO UPDATE SET
   internal_participant_id=EXCLUDED.internal_participant_id,raw_no=EXCLUDED.raw_no,handle_name=EXCLUDED.handle_name,
   table_no=EXCLUDED.table_no,round=EXCLUDED.round,bye=EXCLUDED.bye,dmp_id=CASE WHEN $3::boolean THEN EXCLUDED.dmp_id ELSE deck_memo_external_players.dmp_id END,updated_at=CURRENT_TIMESTAMP`,[memoId,JSON.stringify(people.map(p=>({key:p.participantKey,internal:p.internalParticipantId||p.entryId||null,raw:p.rawNo??(p.entryNo==null?null:String(p.entryNo)),name:p.name,table_no:p.table,round:p.round,bye:Boolean(p.bye),dmp:verifiedDmp?p.dmpId??null:null}))),verifiedDmp]);
}
async function upsertDmpRoster(db,memoId,participants){
 const people=[...new Map(participants.filter(p=>p.dmpId).map(p=>[p.dmpId,p])).values()];if(!people.length)return;
 await db.query(`INSERT INTO deck_memo_roster(memo_event_id,dmp_id,handle_name,entry_no,table_no,round)
 SELECT $1::integer,x.id,x.name,x.entry,x.table_no,x.round FROM jsonb_to_recordset($2::jsonb) AS x(id varchar(50),name text,entry text,table_no integer,round integer)
 ON CONFLICT(memo_event_id,dmp_id) DO UPDATE SET handle_name=EXCLUDED.handle_name,entry_no=EXCLUDED.entry_no,table_no=EXCLUDED.table_no,round=EXCLUDED.round`,[memoId,JSON.stringify(people.map(p=>({id:p.dmpId,name:p.name,entry:p.entryNo==null?null:String(p.entryNo),table_no:p.table,round:p.round})))]);
}
async function updateExternalMemo(pool,source,body) {
  const {memoEventId,participantKey,deckId}=body;
  if(!validId(memoEventId)||typeof participantKey!=='string'||!participantKey||participantKey.length>200) throw fail('大会・参加者の指定が不正です。');
  if(!(deckId===null||validId(deckId))) throw fail('選択内容が不正です。');
  let client,active=false,releaseError;
  try {
    client=await pool.connect();await client.query('BEGIN');active=true;
    let deck=null;
    if(deckId!==null) {
      deck=(await client.query('SELECT id,name FROM decks WHERE id=$1 FOR KEY SHARE',[deckId])).rows[0];
      if(!deck) throw fail('デッキが見つかりません。一覧を再取得してください。',404);
    }
    if(!['tcg_meister','sugatool','nojigiku'].includes(source.provider))throw fail('提供元が不正です。');
    const event=await client.query(`SELECT id FROM deck_memo_events WHERE id=$1 AND source=$3 AND admin_key=$2 FOR UPDATE`,[memoEventId,source.adminKey||source.tid,source.provider]);
    if(!event.rows.length) throw fail('メモ大会が見つかりません。',404);
    const result=await client.query(`UPDATE deck_memo_external_players SET deck_id=$3,updated_at=CURRENT_TIMESTAMP
      WHERE memo_event_id=$1 AND participant_key=$2 RETURNING participant_key`,[memoEventId,participantKey,deckId]);
    if(!result.rows.length) throw fail('参加者が見つかりません。再取得してください。',404);
    await client.query('COMMIT');active=false;
    return {success:true,deckId:deck?.id??null,deckName:deck?.name??null};
  } catch(err) {
    if(active) try {await client.query('ROLLBACK');} catch(e) {releaseError=e;}
    throw err;
  } finally {client?.release(releaseError);}
}
module.exports={upsertExternalRoster,upsertDmpRoster,updateExternalMemo};
