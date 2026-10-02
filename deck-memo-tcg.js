const {fetchTcgMatching} = require('./matching-providers/tcg-meister');
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const validId=id=>Number.isInteger(id)&&id>0&&id<=2147483647;

function participant(row, source) {
  return {provider:'tcg_meister',tid:source.tid,participantKey:row.participant_key,
    name:row.handle_name,handleName:row.handle_name,internalParticipantId:row.internal_participant_id,
    rawNo:row.raw_no,entryNo:row.raw_no,table:row.table_no,tableNumber:row.table_no,round:row.round,bye:row.bye,
    deckId:row.deck_id,deckName:row.deck_name};
}
async function loadTcgMemo({source,detail,pool,fetchImpl}) {
  if(!detail) throw fail('TCGマイスターではDMPランキング大会詳細URLも指定してください。');
  const matching=await fetchTcgMatching(source,fetchImpl);
  let client,active=false,releaseError;
  try {
    client=await pool.connect();await client.query('BEGIN');active=true;
    const event=await client.query(`INSERT INTO events (shop_id,event_id,seq,event_name,event_date,format)
      VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (shop_id,event_id,seq) DO UPDATE SET
      format=COALESCE(events.format,EXCLUDED.format),event_name=EXCLUDED.event_name,event_date=EXCLUDED.event_date,updated_at=CURRENT_TIMESTAMP RETURNING id,format`,
      [detail.shopId,detail.eventId,detail.held,detail.eventName,detail.eventDate,detail.format || null]);
    detail.format=event.rows[0].format || null;
    const memo=await client.query(`INSERT INTO deck_memo_events (source,admin_key,source_url,event_record_id)
      VALUES ('tcg_meister',$1,$2,$3) ON CONFLICT (source,admin_key,event_record_id) DO UPDATE SET
      source_url=EXCLUDED.source_url,updated_at=CURRENT_TIMESTAMP RETURNING id`,[source.tid,source.sourceUrl,event.rows[0].id]);
    const memoId=memo.rows[0].id;
    // Keep decks by provider-scoped participant key. No DMP player lookup or assignment here.
    if(matching.participants.length) await client.query(`INSERT INTO deck_memo_external_players
      (memo_event_id,participant_key,internal_participant_id,raw_no,handle_name,table_no,round,bye,match_status)
      SELECT $1::integer,x.key,x.internal,x.raw,x.name,x.table_no,x.round,x.bye,'unmatched'
      FROM jsonb_to_recordset($2::jsonb) AS x(key text,internal text,raw text,name text,table_no integer,round integer,bye boolean)
      ON CONFLICT (memo_event_id,participant_key) DO UPDATE SET
        internal_participant_id=EXCLUDED.internal_participant_id,raw_no=EXCLUDED.raw_no,handle_name=EXCLUDED.handle_name,
        table_no=EXCLUDED.table_no,round=EXCLUDED.round,bye=EXCLUDED.bye,updated_at=CURRENT_TIMESTAMP`,
      [memoId,JSON.stringify(matching.participants.map(p=>({key:p.participantKey,internal:p.internalParticipantId,raw:p.rawNo,name:p.name,
        table_no:p.table,round:p.round,bye:p.bye})))]);
    const saved=await client.query(`SELECT p.*,d.name AS deck_name FROM deck_memo_external_players p
      LEFT JOIN decks d ON d.id=p.deck_id WHERE p.memo_event_id=$1`,[memoId]);
    const byKey=new Map(saved.rows.map(p=>[p.participant_key,p]));
    const participants=matching.participants.map(p=>participant(byKey.get(p.participantKey),source));
    await client.query('COMMIT');active=false;
    return {success:true,...source,event:detail,memoEventId:memoId,latestRound:matching.latestRound,
      countDiagnostic:{build:'memo-count-diagnostic-20261001',latestRound:matching.latestRound,
        fetchedCount:matching.participants.length,uniqueKeyCount:new Set(matching.participants.map(p=>p.participantKey)).size,
        savedMatchingCount:matching.participants.filter(p=>byKey.has(p.participantKey)).length,responseCount:participants.length},
      participants,participantCount:participants.length,registeredCount:participants.filter(p=>p.deckId!==null).length};
  } catch(err) {
    if(active) try {await client.query('ROLLBACK');} catch(e) {releaseError=e;}
    throw err;
  } finally {client?.release(releaseError);}
}
async function updateTcgMemo(pool,source,body) {
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
    const event=await client.query(`SELECT id FROM deck_memo_events WHERE id=$1 AND source='tcg_meister' AND admin_key=$2 FOR UPDATE`,[memoEventId,source.tid]);
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
module.exports={loadTcgMemo,updateTcgMemo};
