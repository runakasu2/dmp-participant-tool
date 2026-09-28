const {matchParticipants} = require('./deck-memo-matching');
const failure=(message,status=400)=>Object.assign(new Error(message),{status});

async function buildTcgImportPlayers(db,key,archiveRows,manualMappings,classify) {
  if(!Array.isArray(manualMappings)||manualMappings.length>10000) throw failure('手動対応の形式が不正です。');
  // Candidates come exclusively from results of this event, never the participant list or global players.
  const result=await db.query(`
    SELECT p.dmp_id, p.id AS player_id, p.handle_name, r.rank,
      h.id AS history_id, h.deck_name AS current_deck_name, h.created_at AS history_updated_at,
      COALESCE(canonical.name, h.deck_name) AS canonical_deck_name
    FROM events e JOIN event_results r ON r.event_record_id=e.id
    JOIN players p ON p.id=r.player_id
    LEFT JOIN LATERAL (
      SELECT id,deck_name,created_at FROM deck_history
      WHERE player_id=p.id AND shop_id=e.shop_id AND event_id=e.event_id AND seq=e.seq
      ORDER BY created_at DESC NULLS LAST,id DESC LIMIT 1
    ) h ON TRUE
    LEFT JOIN LATERAL (
      SELECT master.name FROM decks master LEFT JOIN deck_aliases alias ON alias.deck_id=master.id
      WHERE LOWER(master.name)=LOWER(h.deck_name) OR LOWER(alias.alias)=LOWER(h.deck_name)
      ORDER BY CASE WHEN LOWER(master.name)=LOWER(h.deck_name) THEN 0 ELSE 1 END,master.id LIMIT 1
    ) canonical ON TRUE
    WHERE e.shop_id=$1 AND e.event_id=$2 AND e.seq=$3
    ORDER BY p.dmp_id
  `,[key.shopId,key.eventId,key.seq]);
  const candidates=new Map(result.rows.map(p=>[p.dmp_id,p]));
  const memos=archiveRows.filter(p=>p.participant_key!=null);
  // Legacy archive/draft DMP mappings are deliberately ignored. Re-match the saved HN now.
  const automatic=matchParticipants(memos.map(p=>({participantKey:p.participant_key,name:p.memo_name})),result.rows);
  const autoByKey=new Map(automatic.map(p=>[p.participantKey,p]));
  const manual=new Map();
  for(const choice of manualMappings) {
    if(!choice||typeof choice.participantKey!=='string'||!autoByKey.has(choice.participantKey)||manual.has(choice.participantKey)||
      !(choice.dmpId===null||typeof choice.dmpId==='string')) throw failure('手動対応の指定が不正です。');
    if(autoByKey.get(choice.participantKey).matchStatus==='matched') throw failure('HN一致済みの参加者には手動対応を指定できません。プレビューを開き直してください。',409);
    if(choice.dmpId!==null&&!candidates.has(choice.dmpId)) throw failure('同じ大会の取得済み大会結果からプレイヤーを選択してください。',409);
    manual.set(choice.participantKey,choice.dmpId);
  }
  const used=new Set();
  const players=memos.map(memo=>{
    const auto=autoByKey.get(memo.participant_key);
    const dmpId=manual.has(memo.participant_key)?manual.get(memo.participant_key):auto.dmpId;
    const candidate=dmpId===null?null:candidates.get(dmpId);
    if(candidate&&used.has(dmpId)) throw failure('同じ大会結果プレイヤーが複数のメモに選択されています。対応先を確認してください。',409);
    if(candidate)used.add(dmpId);
    const matchStatus=candidate&&manual.has(memo.participant_key)?'manual':auto.matchStatus;
    const row={...memo,...candidate,dmp_id:candidate?.dmp_id??null,result_player_id:candidate?.player_id??null};
    // Unselected decks are never imported, even if a player cannot yet be matched.
    const category=memo.deck_id===null?'unselected':classify(row);
    return {participantKey:memo.participant_key,memoName:memo.memo_name,name:candidate?.handle_name||memo.memo_name,
      dmpId:candidate?.dmp_id??null,playerId:candidate?.player_id??null,matchStatus,canMap:auto.matchStatus!=='matched',
      currentDeckName:candidate?.current_deck_name??null,memoDeckName:memo.memo_deck_name,deckId:memo.deck_id,category};
  });
  return {players,candidateRows:result.rows,
    dmpCandidates:result.rows.map(p=>({dmpId:p.dmp_id,playerId:p.player_id,name:p.handle_name})),
    manualMappings:[...manual].sort(([a],[b])=>a.localeCompare(b)).map(([participantKey,dmpId])=>({participantKey,dmpId}))};
}
module.exports={buildTcgImportPlayers};
