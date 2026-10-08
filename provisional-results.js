const fail=(message,status=400)=>Object.assign(new Error(message),{status});
function snapshotPlayers(rows) {
  const players=new Map();
  for(const row of rows) {
    if(!row.dmp_id&&!row.participant_key)throw fail('識別キーのないプレイヤーは反映できません。');
    const key=row.dmp_id?'dmp:'+row.dmp_id:'external:'+row.participant_key;
    const next={key,id:row.dmp_id||null,name:row.handle_name,deckId:row.deck_id,deckName:row.deck_name||null,rank:null};
    const previous=players.get(key);
    if(previous?.deckId!=null && next.deckId!=null && previous.deckId!==next.deckId) throw fail('同一プレイヤーのデッキが競合しています。メモを確認してください。',409);
    if(!previous || next.deckId!=null)players.set(key,next);
  }
  return [...players.values()];
}
function mergeResults(official, provisional, history) {
  const drafts=new Map(provisional.filter(p=>p.id).map(p=>[p.id,p]));
  const saved=new Map();
  for(const h of history)if(!saved.has(h.dmp_id))saved.set(h.dmp_id,h.deck_name);
  const isOfficial=official.length>0;
  const participants=(isOfficial?official:provisional).map(p=>{
    const draft=isOfficial?drafts.get(p.id):p;
    const stored=p.id?saved.get(p.id):null;
    const deckName=stored||draft?.deckName||null;
    return {...p,rank:isOfficial?p.rank:null,deckName,
      deckSource:stored?'history':draft?.deckName?'provisional':'unknown',
      provisionalDeckName:draft?.deckName||null,
      deckConflict:Boolean(stored&&draft?.deckName&&stored!==draft.deckName)};
  });
  const total=participants.length,groups=new Map();
  for(const p of participants){const name=p.deckName||'不明';groups.set(name,(groups.get(name)||0)+1);}
  const decks=[...groups].map(([deckName,count])=>({deckName,count,percentage:total?(count/total*100).toFixed(1):'0.0',unknown:deckName==='不明'})).sort((a,b)=>b.count-a.count);
  return {resultKind:isOfficial?'official':'provisional',participants,count:total,
    knownCount:participants.filter(p=>p.deckName).length,unknownCount:participants.filter(p=>!p.deckName).length,decks};
}
function installProvisionalRoutes(app,pool) {
  app.post('/api/deck-memo/provisional-results',async(req,res)=>{
    let client,active=false,releaseError;
    try {
      const {archiveId,shopId,eventId,seq,confirmed}=req.body||{};
      if(!Number.isInteger(archiveId)||archiveId<1||confirmed!==true||![shopId,eventId,seq].every(v=>typeof v==='string'&&v.trim()))throw fail('大会名とShopID・EventID・Seqを確認してください。');
      client=await pool.connect();await client.query('BEGIN');active=true;
      const found=await client.query(`SELECT a.*,e.shop_id,e.event_id,e.seq FROM deck_memo_archives a JOIN events e ON e.id=a.event_record_id WHERE a.id=$1 FOR UPDATE OF e,a`,[archiveId]);
      const archive=found.rows[0];
      if(!archive)throw fail('保存済みメモが見つかりません。',404);
      if(archive.shop_id!==shopId||archive.event_id!==eventId||archive.seq!==seq)throw fail('メモの大会キーと一致しません。URLを確認してください。',409);
      const roster=await client.query(`SELECT p.*,d.name AS deck_name FROM deck_memo_archive_players p LEFT JOIN decks d ON d.id=p.deck_id WHERE p.archive_id=$1 ORDER BY p.participant_key FOR SHARE OF p`,[archiveId]);
      const players=snapshotPlayers(roster.rows);
      if(!players.length)throw fail('仮反映できる保存済みプレイヤーがいません。');
      await client.query(`INSERT INTO provisional_event_results(event_record_id,source_archive_id,source_name,source_key,players)
        VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(event_record_id) DO UPDATE SET
        source_archive_id=EXCLUDED.source_archive_id,source_name=EXCLUDED.source_name,source_key=EXCLUDED.source_key,players=EXCLUDED.players,updated_at=CURRENT_TIMESTAMP`,
      [archive.event_record_id,archiveId,archive.source,archive.admin_key,JSON.stringify(players)]);
      await client.query('COMMIT');active=false;
      res.json({success:true,count:players.length});
    }catch(error){if(active)try{await client.query('ROLLBACK');}catch(e){releaseError=e;}
      res.status(error.status||500).json({success:false,error:error.status?error.message:'仮反映に失敗しました。'});
    }finally{client?.release(releaseError);}
  });
  app.get('/api/event-results-view',async(req,res)=>{
    let client,active=false,releaseError;
    try {
      const {shopId,eventId,seq}=req.query;
      if(![shopId,eventId,seq].every(v=>typeof v==='string'&&v.trim()))throw fail('ShopID・EventID・Seqが必要です。');
      client=await pool.connect();await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');active=true;
      const event=await client.query('SELECT *,event_date::text AS event_date FROM events WHERE shop_id=$1 AND event_id=$2 AND seq=$3',[shopId,eventId,seq]);
      const info=event.rows[0];if(!info)throw fail('保存済み大会がありません。',404);
      const draft=await client.query('SELECT * FROM provisional_event_results WHERE event_record_id=$1',[info.id]);
      const official=await client.query(`SELECT p.dmp_id AS id,p.handle_name AS name,r.rank FROM event_results r JOIN players p ON p.id=r.player_id WHERE r.event_record_id=$1 ORDER BY r.rank NULLS LAST,p.dmp_id`,[info.id]);
      if(!official.rows.length&&!draft.rows.length)throw fail('公式結果・仮登録がありません。',404);
      const history=await client.query(`SELECT p.dmp_id,COALESCE(d.name,h.deck_name) AS deck_name FROM deck_history h JOIN players p ON p.id=h.player_id
        LEFT JOIN deck_aliases a ON a.alias=h.deck_name LEFT JOIN decks d ON d.name=h.deck_name OR d.id=a.deck_id
        WHERE h.shop_id=$1 AND h.event_id=$2 AND h.seq=$3 ORDER BY h.created_at DESC,h.id DESC`,[shopId,eventId,seq]);
      const provisional=draft.rows[0]?.players||[];
      // Resolve current master names without modifying the saved snapshot.
      const masters=await client.query('SELECT id,name FROM decks');const names=new Map(masters.rows.map(d=>[d.id,d.name]));
      for(const p of provisional)if(names.has(p.deckId))p.deckName=names.get(p.deckId);
      await client.query('COMMIT');active=false;
      res.json({success:true,eventName:info.event_name,eventDate:info.event_date,format:info.format,
        year:String(info.event_date||'').slice(0,4),shopId,eventId,held:seq,hasProvisional:Boolean(draft.rows.length),
        ...mergeResults(official.rows,provisional,history.rows)});
    }catch(error){if(active)try{await client.query('ROLLBACK');}catch(e){releaseError=e;}res.status(error.status||500).json({success:false,error:error.status?error.message:'結果の読み込みに失敗しました。'});}
    finally{client?.release(releaseError);}
  });
}
module.exports={snapshotPlayers,mergeResults,installProvisionalRoutes};
