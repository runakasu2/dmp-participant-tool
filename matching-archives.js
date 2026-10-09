const {detectProvider,fetchSource}=require('./deck-memo');
const {normalizeNojigikuMatches}=require('./matching-providers/nojigiku-results');
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
function keyOf(body){const {shopId,eventId,seq}=body||{};if(![shopId,eventId,seq].every(v=>typeof v==='string'&&v.trim()&&v.length<=100))throw fail('ShopID・EventID・Seqを指定してください。');return {shopId,eventId,seq};}
const validId=id=>/^\d+$/.test(String(id))&&Number.isInteger(Number(id))&&Number(id)>0&&Number(id)<=2147483647;
async function readMatchingArchive(db,id){
  const found=await db.query(`SELECT a.*,e.shop_id,e.event_id,e.seq,e.event_name,e.event_date::text AS event_date,e.format
    FROM matching_archives a JOIN events e ON e.id=a.event_record_id WHERE a.id=$1`,[id]);
  const archive=found.rows[0];if(!archive)throw fail('保存済み対戦表が見つかりません。',404);
  const records=await db.query('SELECT * FROM matching_archive_matches WHERE archive_id=$1 ORDER BY round,table_no,match_key',[id]);
  const memo=await db.query('SELECT id FROM deck_memo_events WHERE event_record_id=$1 AND source=$2 AND admin_key=$3',[archive.event_record_id,archive.provider,archive.source_key]);
  const memoId=memo.rows[0]?.id;
  // Live memo is authoritative, including explicit unselection. Archive fallback only when no live memo exists.
  const decks=memoId?await db.query(`SELECT m.dmp_id,m.deck_id,d.name AS deck_name FROM deck_memos m LEFT JOIN decks d ON d.id=m.deck_id WHERE m.memo_event_id=$1`,[memoId]):await db.query(`SELECT p.dmp_id,p.deck_id,d.name AS deck_name FROM deck_memo_archive_players p JOIN deck_memo_archives a ON a.id=p.archive_id LEFT JOIN decks d ON d.id=p.deck_id WHERE a.event_record_id=$1 AND a.source=$2 AND a.admin_key=$3`,[archive.event_record_id,archive.provider,archive.source_key]);
  const byId=new Map(decks.rows.filter(p=>p.dmp_id).map(p=>[p.dmp_id,p]));const rounds=new Map();
  for(const record of records.rows){if(!rounds.has(record.round))rounds.set(record.round,{round:record.round,matches:[],participants:[]});const round=rounds.get(record.round);
    const sides=record.sides.map(p=>({...p,deckId:byId.get(p.dmpId)?.deck_id??null,deckName:byId.get(p.dmpId)?.deck_name??null}));
    const match={round:record.round,table:record.table_no,matchKey:record.match_key,sides,outcome:record.outcome,winnerKey:record.winner_key,reason:record.reason,rawResult:record.raw_result};round.matches.push(match);
    round.participants.push(...sides.map(p=>({...p,opponentName:sides.find(q=>q.participantKey!==p.participantKey)?.name||'相手なし',outcome:match.outcome,winnerKey:match.winnerKey})));
  }
  const allRounds=[...rounds.values()],latest=allRounds.at(-1);
  return {success:true,archiveId:archive.id,provider:archive.provider,adminKey:archive.source_key,sourceUrl:archive.source_url,memoEventId:memoId??null,
    event:{shopId:archive.shop_id,eventId:archive.event_id,held:archive.seq,eventName:archive.event_name,eventDate:archive.event_date,format:archive.format},
    rounds:allRounds,latestRound:latest?.round??null,participants:latest?.participants||[],participantCount:latest?.participants.length||0,saved:true};
}
function installMatchingArchiveRoutes(app,pool,fetchImpl=fetch){
  app.post('/api/matching-archives',async(req,res)=>{
    let client,active=false,releaseError;
    try{
      const key=keyOf(req.body),source=detectProvider(req.body?.url);
      if(source.provider!=='nojigiku')throw fail('全ラウンド保存は現在のじぎくCSに対応しています。');
      // Resolve all three DMP keys before fetching. admin alone never identifies a saved tournament.
      const linked=await pool.query(`SELECT e.id,m.id AS memo_id FROM events e JOIN deck_memo_events m ON m.event_record_id=e.id
        WHERE e.shop_id=$1 AND e.event_id=$2 AND e.seq=$3 AND m.source=$4 AND m.admin_key=$5`,[key.shopId,key.eventId,key.seq,source.provider,source.adminKey]);
      if(!linked.rows.length)throw fail('このDMP大会と対戦サイトを紐付けて対戦表を取得してください。',409);
      const matches=await fetchSource('get-cs-info',source.adminKey,fetchImpl);
      if(!matches.length){res.json({success:true,noData:true,message:'取得可能な対戦表がありません。保存済みデータは維持しました。'});return;}
      const users=await fetchSource('get-users',source.adminKey,fetchImpl).catch(()=>[]);
      const rounds=normalizeNojigikuMatches(matches,users);
      client=await pool.connect();await client.query('BEGIN');active=true;
      const event=await client.query(`SELECT e.id FROM events e JOIN deck_memo_events m ON m.event_record_id=e.id
        WHERE e.shop_id=$1 AND e.event_id=$2 AND e.seq=$3 AND m.source=$4 AND m.admin_key=$5 FOR UPDATE OF e,m`,[key.shopId,key.eventId,key.seq,source.provider,source.adminKey]);
      if(!event.rows.length)throw fail('大会の紐付けが変更されています。再取得してください。',409);
      const saved=await client.query(`INSERT INTO matching_archives(event_record_id,provider,source_key,source_url) VALUES($1,$2,$3,$4)
        ON CONFLICT(event_record_id,provider,source_key) DO UPDATE SET source_url=EXCLUDED.source_url,updated_at=CURRENT_TIMESTAMP RETURNING id`,[event.rows[0].id,source.provider,source.adminKey,source.sourceUrl]);
      const archiveId=saved.rows[0].id;
      for(const round of rounds){
        const previous=await client.query('SELECT match_key,sides FROM matching_archive_matches WHERE archive_id=$1 AND round=$2',[archiveId,round.round]);
        const receivedIds=new Set(round.participants.map(p=>p.participantKey));
        if(previous.rows.every(m=>m.sides.every(p=>receivedIds.has(p.participantKey)))){
          // A complete round may contain corrected pairings or fewer tables. Other rounds remain intact.
          await client.query('DELETE FROM matching_archive_matches WHERE archive_id=$1 AND round=$2',[archiveId,round.round]);
        }else{
          // Partial snapshots may add/update tables, but must never leave a player at two tables.
          const merged=new Map(previous.rows.map(m=>[m.match_key,m.sides]));
          const incomingKeys=new Set(round.matches.map(m=>m.matchKey));
          if(previous.rows.some(m=>incomingKeys.has(m.match_key)&&m.sides.some(p=>!receivedIds.has(p.participantKey))))throw fail('参加者が欠落した対戦表で保存済みデータは更新できません。全件を再取得してください。',409);
          for(const m of round.matches)merged.set(m.matchKey,m.sides);
          const seen=new Set();
          for(const sides of merged.values())for(const p of sides){if(seen.has(p.participantKey))throw fail('一部の対戦表と保存済みの組合せが競合しています。全件を再取得してください。',409);seen.add(p.participantKey);}
        }
      }
      const records=rounds.flatMap(r=>r.matches).map(m=>({round:m.round,match_key:m.matchKey,table_no:m.table,sides:m.sides,outcome:m.outcome,winner_key:m.winnerKey,reason:m.reason,raw_result:m.rawResult}));
      await client.query(`INSERT INTO matching_archive_matches(archive_id,round,match_key,table_no,sides,outcome,winner_key,reason,raw_result)
        SELECT $1::integer,x.round,x.match_key,x.table_no,x.sides,x.outcome,x.winner_key,x.reason,x.raw_result
        FROM jsonb_to_recordset($2::jsonb) AS x(round integer,match_key text,table_no integer,sides jsonb,outcome text,winner_key text,reason text,raw_result jsonb)
        ON CONFLICT(archive_id,round,match_key) DO UPDATE SET
        table_no=EXCLUDED.table_no,sides=EXCLUDED.sides,outcome=EXCLUDED.outcome,winner_key=EXCLUDED.winner_key,reason=EXCLUDED.reason,raw_result=EXCLUDED.raw_result,updated_at=CURRENT_TIMESTAMP`,[archiveId,JSON.stringify(records)]);
      await client.query('COMMIT');active=false;res.json({success:true,archiveId,roundCount:rounds.length,matchCount:rounds.reduce((n,r)=>n+r.matches.length,0)});
    }catch(error){if(active)try{await client.query('ROLLBACK');}catch(e){releaseError=e;}res.status(error.status||500).json({success:false,error:error.status?error.message:'対戦表の保存に失敗しました。保存済みデータは維持しています。'});}
    finally{client?.release(releaseError);}
  });
  app.get('/api/matching-archives',async(req,res)=>{
    try{const records=await pool.query(`SELECT a.id,a.provider,a.source_key,e.event_name,e.event_date::text AS event_date,e.shop_id,e.event_id,e.seq,
      COUNT(DISTINCT m.round)::int AS round_count,COUNT(m.match_key)::int AS match_count,a.updated_at
      FROM matching_archives a JOIN events e ON e.id=a.event_record_id LEFT JOIN matching_archive_matches m ON m.archive_id=a.id
      GROUP BY a.id,e.id ORDER BY e.event_date DESC NULLS LAST,a.id DESC`);res.json({success:true,archives:records.rows});}
    catch{res.status(500).json({success:false,error:'保存済み対戦表一覧を取得できませんでした。'});}
  });
  app.get('/api/matching-archives/:id',async(req,res)=>{
    let client,active=false,releaseError;
    try{if(!validId(req.params.id))throw fail('対戦表IDが不正です。');client=await pool.connect();await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');active=true;const data=await readMatchingArchive(client,Number(req.params.id));await client.query('COMMIT');active=false;res.json(data);}
    catch(error){if(active)try{await client.query('ROLLBACK');}catch(e){releaseError=e;}res.status(error.status||500).json({success:false,error:error.status?error.message:'保存済み対戦表を取得できませんでした。'});}
    finally{client?.release(releaseError);}
  });
  app.post('/api/matching-archives/:id/delete',async(req,res)=>{
    try{if(!validId(req.params.id)||req.body?.confirmed!==true)throw fail('対戦表の削除を確認してください。');const key=keyOf(req.body);
      const deleted=await pool.query(`DELETE FROM matching_archives a USING events e WHERE a.id=$1 AND e.id=a.event_record_id AND e.shop_id=$2 AND e.event_id=$3 AND e.seq=$4 RETURNING a.id`,[Number(req.params.id),key.shopId,key.eventId,key.seq]);
      if(!deleted.rows.length)throw fail('削除対象の対戦表・大会キーが一致しません。',409);
      res.json({success:true,deletedArchiveId:deleted.rows[0].id});
    }catch(error){res.status(error.status||500).json({success:false,error:error.status?error.message:'対戦表の削除に失敗しました。'});}
  });
}
module.exports={installMatchingArchiveRoutes,readMatchingArchive};
