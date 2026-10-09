// Read-only analysis of archived pairings. Never fetches providers or writes memo data.
const {createHash}=require('node:crypto');
const PROVIDERS=['nojigiku','tcg_meister','sugatool'];
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
function integer(value,label,max=2147483647){if(typeof value!=='string'||!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)<1||Number(value)>max)throw fail(label+'が不正です。');return Number(value);}
function filters(query={}){
  for(const value of Object.values(query))if(typeof value!=='string')throw fail('条件は文字列で指定してください。');
  const mode=query.mode||'all';if(!['all','single'].includes(mode))throw fail('集計範囲が不正です。');
  const eventRecordId=query.eventRecordId?integer(query.eventRecordId,'大会ID'):null;
  if(mode==='single'&&!eventRecordId)throw fail('大会を選択してください。');
  if(mode==='all'&&eventRecordId)throw fail('全大会集計では大会IDを指定できません。');
  for(const name of ['startDate','endDate'])if(query[name]&&(!/^\d{4}-\d{2}-\d{2}$/.test(query[name])||query[name].startsWith('0000')||!Number.isFinite(Date.parse(query[name]))||new Date(query[name]).toISOString().slice(0,10)!==query[name]))throw fail('開催期間が不正です。');
  if(query.startDate&&query.endDate&&query.startDate>query.endDate)throw fail('開始日は終了日以前にしてください。');
  if(query.format&&!['original','advance','2block','unknown'].includes(query.format))throw fail('フォーマットが不正です。');
  if(query.provider&&!PROVIDERS.includes(query.provider))throw fail('提供サイトが不正です。');
  return {mode,eventRecordId,startDate:query.startDate||null,endDate:query.endDate||null,format:query.format||null,provider:query.provider||null};
}
function catalogNames(catalog){
  const map=new Map();
  // Same exact case-insensitive priority as deck-catalog: official names, then aliases, then ID.
  for(const row of [...catalog].sort((a,b)=>a.id-b.id))if(!map.has(row.name.toLowerCase()))map.set(row.name.toLowerCase(),row.id);
  for(const row of [...catalog].sort((a,b)=>a.id-b.id))for(const alias of row.aliases||[])if(!map.has(alias.toLowerCase()))map.set(alias.toLowerCase(),row.id);
  return map;
}
const validDmp=p=>typeof p.dmpId==='string'&&/^\d+$/.test(p.dmpId)&&!/^0+$/.test(p.dmpId);
const stableLocal=p=>typeof p.participantKey==='string'&&/^(id:\d+|entry:\d+|dmp:\d+|[0-9a-f]{8}-[0-9a-f-]{27,})$/i.test(p.participantKey);
function matchIdentity(m){
  const pair=m.sides||[];
  if(pair.length>=1&&pair.length<=2&&pair.every(validDmp)&&new Set(pair.map(p=>p.dmpId)).size===pair.length)return JSON.stringify([m.event.id,m.round,'dmp',...pair.map(p=>p.dmpId).sort()]);
  if(pair.length&&pair.every(stableLocal)&&new Set(pair.map(p=>p.participantKey)).size===pair.length)return JSON.stringify([m.event.id,m.round,m.provider,m.sourceKey,...pair.map(p=>p.participantKey).sort()]);
  return JSON.stringify([m.archiveId,m.round,m.matchKey]);
}
function classification(m){
  if(!PROVIDERS.includes(m.provider))return 'other';
  if(m.outcome==='bye')return 'bye';
  if(m.outcome==='double_loss')return 'doubleLoss';
  if(m.outcome==='unresolved')return 'unresolved';
  if(m.outcome!=='win_loss'||m.sides.length!==2||m.sides.some(p=>!p.participantKey)||m.sides[0].participantKey===m.sides[1].participantKey||!m.sides.some(p=>p.participantKey===m.winnerKey)||(m.sides.every(validDmp)&&m.sides[0].dmpId===m.sides[1].dmpId))return 'other';
  return 'normal';
}
function aggregate(matches,catalog){
  const names=catalogNames(catalog),masters=new Map(catalog.map(d=>[d.id,d]));
  const groups=new Map();
  for(const match of matches){
    const m={...match,sides:(Array.isArray(match.sides)?match.sides:[]).map(p=>({...p,deckId:masters.has(p.deckId)?p.deckId:(!p.deckId&&p.deckName?names.get(p.deckName.toLowerCase())??null:null)}))};
    const identity=matchIdentity(m);if(!groups.has(identity))groups.set(identity,[]);groups.get(identity).push(m);
  }
  const decks=new Map(),pairs=new Map(),detail=new Map();
  const exclusions={bye:0,doubleLoss:0,unresolved:0,missingDeck:0,other:0};let conflicts=0,normalMatches=0,deckAnalysisMatches=0,matchupMatches=0;
  const ensure=id=>{if(id&&!decks.has(id))decks.set(id,{deckId:id,name:masters.get(id).name,matches:0,wins:0,losses:0,physicalMatches:0,rate:null});return decks.get(id);};
  for(const group of groups.values()){
    group.sort((a,b)=>(classification(b)==='normal')-(classification(a)==='normal')||b.sides.filter(p=>p.deckId).length-a.sides.filter(p=>p.deckId).length||a.archiveId-b.archiveId||a.matchKey.localeCompare(b.matchKey));
    const m=group[0];for(const copy of group)for(const p of copy.sides)ensure(p.deckId);
    // Compare confirmed results using DMP identities only when both sides have real DMP IDs.
    const definitive=new Set(),known=new Map();let conflict=false;
    for(const copy of group){const type=classification(copy);if(type==='normal'){const winner=copy.sides.find(p=>p.participantKey===copy.winnerKey);definitive.add('win:'+ (copy.sides.every(validDmp)?'dmp:'+winner.dmpId:winner.participantKey));}else if(['bye','doubleLoss'].includes(type))definitive.add(type);
      for(const p of copy.sides)if(p.deckId){const id=copy.sides.every(validDmp)?'dmp:'+p.dmpId:p.participantKey;if(known.has(id)&&known.get(id)!==p.deckId)conflict=true;known.set(id,p.deckId);}}
    conflict||=definitive.size>1;
    if(conflict){conflicts++;exclusions.other++;continue;}
    const type=classification(m);if(type!=='normal'){exclusions[type]++;continue;}
    normalMatches++;const [a,b]=m.sides;
    if(a.deckId||b.deckId)deckAnalysisMatches++;
    for(const id of new Set(m.sides.map(p=>p.deckId).filter(Boolean)))ensure(id).physicalMatches++;
    for(const p of m.sides){const d=ensure(p.deckId);if(d){d.matches++;d[p.participantKey===m.winnerKey?'wins':'losses']++;}}
    if(!a.deckId||!b.deckId){exclusions.missingDeck++;continue;}
    matchupMatches++;
    const add=(id,opp,mirror)=>{const key=id+':'+opp;if(!pairs.has(key)){pairs.set(key,{deckId:id,opponentDeckId:opp,matches:0,wins:0,losses:0,rate:null});detail.set(key,[]);}const pair=pairs.get(key);pair.matches++;if(mirror){pair.wins++;pair.losses++;}else pair[m.sides.find(p=>p.deckId===id).participantKey===m.winnerKey?'wins':'losses']++;
      detail.get(key).push({archiveId:m.archiveId,provider:m.provider,event:m.event,round:m.round,table:m.table,matchKey:m.matchKey,sides:m.sides.map(p=>({...p,deckName:masters.get(p.deckId)?.name??null})),winnerKey:m.winnerKey,mirror,result:mirror?'mirror':m.sides.find(p=>p.deckId===id).participantKey===m.winnerKey?'win':'loss',sources:group.map(c=>({archiveId:c.archiveId,provider:c.provider}))});};
    add(a.deckId,b.deckId,a.deckId===b.deckId);if(a.deckId!==b.deckId)add(b.deckId,a.deckId,false);
  }
  for(const d of decks.values())d.rate=d.matches?d.wins/d.matches*100:null;
  for(const p of pairs.values())p.rate=p.wins/(p.wins+p.losses)*100;
  for(const rows of detail.values())rows.sort((a,b)=>(b.event.date||'').localeCompare(a.event.date||'')||a.event.id-b.event.id||a.round-b.round||a.archiveId-b.archiveId||a.matchKey.localeCompare(b.matchKey));
  return {decks:[...decks.values()].sort((a,b)=>a.deckId-b.deckId),pairs:[...pairs.values()].sort((a,b)=>a.deckId-b.deckId||a.opponentDeckId-b.opponentDeckId),exclusions,counts:{savedRecords:matches.length,uniqueMatches:groups.size,duplicatesRemoved:matches.length-groups.size,dedupConflicts:conflicts,normalMatches,deckAnalysisMatches,matchupMatches,excludedMatches:Object.values(exclusions).reduce((a,b)=>a+b,0),deckPlayerObservations:[...decks.values()].reduce((n,d)=>n+d.matches,0)},detail};
}
async function loadAnalysis(db,scope){
  const archiveRows=await db.query(`SELECT a.id,a.event_record_id,a.provider,a.source_key,e.shop_id,e.event_id,e.seq,e.event_name,e.event_date::text AS event_date,e.format
    FROM matching_archives a JOIN events e ON e.id=a.event_record_id
    WHERE ($1::int IS NULL OR e.id=$1) AND ($2::date IS NULL OR e.event_date >= $2) AND ($3::date IS NULL OR e.event_date <= $3)
      AND ($4::text IS NULL OR CASE WHEN $4='unknown' THEN e.format IS NULL ELSE e.format=$4 END)
      AND ($5::text IS NULL OR a.provider=$5) ORDER BY a.id`,[scope.eventRecordId,scope.startDate,scope.endDate,scope.format,scope.provider]);
  const ids=archiveRows.rows.map(a=>a.id);
  const records=await db.query('SELECT * FROM matching_archive_matches WHERE archive_id=ANY($1::int[]) ORDER BY archive_id,round,match_key',[ids]);
  // One bulk query; live memo (even empty) blocks fallback. Same provider/source AND full event FK only.
  const memoRows=await db.query(`WITH bindings AS (
    SELECT a.id,a.event_record_id,a.provider,a.source_key,m.id AS memo_id FROM matching_archives a
    LEFT JOIN deck_memo_events m ON m.event_record_id=a.event_record_id AND m.source=a.provider AND m.admin_key=a.source_key WHERE a.id=ANY($1::int[])
  ) SELECT b.id AS archive_id,m.dmp_id,NULL::text AS participant_key,m.deck_id FROM bindings b JOIN deck_memos m ON m.memo_event_id=b.memo_id
  UNION ALL SELECT b.id,NULL::text,p.participant_key,p.deck_id FROM bindings b JOIN deck_memo_external_players p ON p.memo_event_id=b.memo_id
  UNION ALL SELECT b.id,p.dmp_id,p.participant_key,p.deck_id FROM bindings b JOIN deck_memo_archives a
    ON a.event_record_id=b.event_record_id AND a.source=b.provider AND a.admin_key=b.source_key
    JOIN deck_memo_archive_players p ON p.archive_id=a.id WHERE b.memo_id IS NULL`,[ids]);
  const catalog=await db.query(`SELECT d.id,d.name,COALESCE(array_agg(a.alias ORDER BY a.alias) FILTER (WHERE a.alias IS NOT NULL),'{}') AS aliases
    FROM decks d LEFT JOIN deck_aliases a ON a.deck_id=d.id GROUP BY d.id ORDER BY d.id`);
  const archives=new Map(archiveRows.rows.map(a=>[a.id,a])),memo=new Map();
  for(const p of memoRows.rows){if(p.dmp_id)memo.set(JSON.stringify([p.archive_id,'dmp',p.dmp_id]),p.deck_id);if(p.participant_key)memo.set(JSON.stringify([p.archive_id,'key',p.participant_key]),p.deck_id);}
  const matches=records.rows.map(m=>{const a=archives.get(m.archive_id);return {archiveId:a.id,provider:a.provider,sourceKey:a.source_key,event:{id:a.event_record_id,shopId:a.shop_id,eventId:a.event_id,seq:a.seq,name:a.event_name,date:a.event_date,format:a.format},round:m.round,table:m.table_no,matchKey:m.match_key,outcome:m.outcome,winnerKey:m.winner_key,sides:m.sides.map(p=>({...p,deckName:null,deckId:memo.get(JSON.stringify([a.id,p.dmpId?'dmp':'key',p.dmpId||p.participantKey]))??null}))};});
  const result=aggregate(matches,catalog.rows);
  result.revision=createHash('sha256').update(JSON.stringify([scope,matches,catalog.rows])).digest('hex');
  result.events=[...new Map(archiveRows.rows.map(a=>[a.event_record_id,{id:a.event_record_id,shopId:a.shop_id,eventId:a.event_id,seq:a.seq,name:a.event_name,date:a.event_date,format:a.format}])).values()];
  return result;
}
function installWinrateRoutes(app,pool){
  const read=(handler)=>async(req,res)=>{let client,active=false,releaseError;try{client=await pool.connect();await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');active=true;const data=await handler(req,client);await client.query('COMMIT');active=false;res.set?.('Cache-Control','no-store');res.json({success:true,...data});}catch(e){if(active)try{await client.query('ROLLBACK');}catch(error){releaseError=error;}res.status(e.status||500).json({success:false,error:e.status?e.message:'勝率分析を取得できませんでした。再読み込みしてください。'});}finally{client?.release(releaseError);}};
  app.get('/api/winrate/events',read(async(req,db)=>{const events=await db.query(`SELECT e.id,e.shop_id AS "shopId",e.event_id AS "eventId",e.seq,e.event_name AS name,e.event_date::text AS date,e.format,
    array_agg(DISTINCT a.provider ORDER BY a.provider) AS providers,COUNT(a.id)::int AS "archiveCount"
    FROM events e JOIN matching_archives a ON a.event_record_id=e.id GROUP BY e.id ORDER BY e.event_date DESC NULLS LAST,e.id DESC`);return {events:events.rows};}));
  app.get('/api/winrate/summary',read(async(req,db)=>{const scope=filters(req.query),{detail,...result}=await loadAnalysis(db,scope);return {scope,...result};}));
  app.get('/api/winrate/matchup',read(async(req,db)=>{const scope=filters(req.query),deckId=integer(req.query.deckId,'デッキID'),opponentDeckId=integer(req.query.opponentDeckId,'対面デッキID'),page=integer(req.query.page||'1','ページ'),pageSize=integer(req.query.pageSize||'50','表示件数',100);
    if(req.query.revision&&!/^[a-f0-9]{64}$/.test(req.query.revision))throw fail('集計識別子が不正です。');
    const result=await loadAnalysis(db,scope);if(req.query.revision&&req.query.revision!==result.revision)throw fail('データが更新されています。集計を再読み込みしてから詳細を開いてください。',409);
    const pair=result.pairs.find(p=>p.deckId===deckId&&p.opponentDeckId===opponentDeckId)||{deckId,opponentDeckId,matches:0,wins:0,losses:0,rate:null};
    const rows=result.detail.get(deckId+':'+opponentDeckId)||[];return {revision:result.revision,pair,deck:result.decks.find(d=>d.deckId===deckId)??null,opponent:result.decks.find(d=>d.deckId===opponentDeckId)??null,page,pageSize,total:rows.length,matches:rows.slice((page-1)*pageSize,page*pageSize)};}));
}
module.exports={aggregate,filters,matchIdentity,loadAnalysis,installWinrateRoutes};
