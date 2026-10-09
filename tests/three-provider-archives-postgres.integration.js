const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./matching-archives-postgres.integration');
const {installMemoRoutes}=require('../deck-memo');
const {installMatchingArchiveRoutes}=require('../matching-archives');
const {tcgUrl,sugaUrl,id,providerFetch}=require('./helpers/three-provider-fixtures');
test('PostgreSQL: TCG and Suga share archives, preserve inferred outcomes and provider-scoped decks without migrations',async()=>{
 const f=await fixture(),state={};const fetchImpl=providerFetch(state);
 installMemoRoutes(f.app,f.pool,fetchImpl,async()=>({...f.detail}));installMatchingArchiveRoutes(f.app,f.pool,fetchImpl);
 const call=f.call,key={shopId:'s',eventId:'e',seq:'2'};
 try{
  let live=await call('POST','/api/deck-memo/matching',{url:tcgUrl,detailUrl:'fixture'});assert.equal(live.code,200,JSON.stringify(live.body));const tcgMemo=live.body.memoEventId;
  assert.equal((await call('PUT','/api/deck-memo',{url:tcgUrl,memoEventId:tcgMemo,participantKey:'id:39',deckId:1})).code,200);
  const saveTcg=settings=>call('POST','/api/matching-archives',{...key,url:tcgUrl,tcgSettings:settings});
  const first=await saveTcg();assert.equal(first.code,200,JSON.stringify(first.body));const tcgId=first.body.archiveId;
  const read=id=>call('GET','/api/matching-archives/:id',{}, {id});
  let r=(await read(tcgId)).body;assert.equal(r.rounds.length,4);assert.ok(r.rounds[3].matches.filter(m=>m.sides.length===2).every(m=>m.outcome==='unresolved'));assert.equal(r.tcgSettings.finalRound,null);
  assert.ok(r.rounds.every(round=>round.participants.find(p=>p.participantKey==='id:39').deckName==='A'));
  assert.equal((await saveTcg({initialScore:0})).code,400);assert.equal((await saveTcg(null)).code,400);assert.equal((await saveTcg({finalRound:4,initialScore:3,confirmed:true})).code,400);
  const settings={finalRound:4,initialScore:0,zeroGainOutcome:'double_loss',confirmed:true};assert.equal((await saveTcg(settings)).body.archiveId,tcgId);
  r=(await read(tcgId)).body;const matches=r.rounds.flatMap(r=>r.matches);assert.equal(matches.length,117);assert.equal(matches.filter(m=>m.outcome==='double_loss').length,1);assert.equal(matches.filter(m=>m.outcome==='bye').length,18);assert.equal(matches.filter(m=>m.outcome==='win_loss').length,98);
  assert.equal((await saveTcg(settings)).body.archiveId,tcgId);assert.equal((await f.db.query('SELECT count(*)::int n FROM matching_archive_matches WHERE archive_id=$1',[tcgId])).rows[0].n,117);
  const snapshot=JSON.stringify((await f.db.query('SELECT * FROM matching_archive_matches WHERE archive_id=$1 ORDER BY round,match_key',[tcgId])).rows);
  for(const flag of ['badTcg','emptyTcg']){state[flag]=true;assert.equal((await saveTcg(settings)).code,502);state[flag]=false;assert.equal(JSON.stringify((await f.db.query('SELECT * FROM matching_archive_matches WHERE archive_id=$1 ORDER BY round,match_key',[tcgId])).rows),snapshot);}
  // Same DMP event, a second provider: deck lookup remains scoped to its source/memo.
  live=await call('POST','/api/deck-memo/matching',{url:sugaUrl,detailUrl:'fixture'});assert.equal(live.code,200,JSON.stringify(live.body));const sugaMemo=live.body.memoEventId;
  assert.notEqual(sugaMemo,tcgMemo);assert.equal(live.body.participants.find(p=>p.entryId===id(2)).dmpId,null);
  const put=(dmpId,participantKey,deckId)=>call('PUT','/api/deck-memo',{url:sugaUrl,memoEventId:sugaMemo,dmpId,participantKey,deckId});
  assert.equal((await put('0001',id(1),1)).code,200);assert.equal((await put(undefined,id(2),2)).code,200);
  const saveSuga=()=>call('POST','/api/matching-archives',{...key,url:sugaUrl});let saved=await saveSuga();assert.equal(saved.code,200,JSON.stringify(saved.body));const sugaId=saved.body.archiveId;assert.notEqual(sugaId,tcgId);
  r=(await read(sugaId)).body;assert.equal(r.rounds.length,3);assert.ok(r.rounds.every(round=>round.participants.find(p=>p.entryId===id(1)).deckId===1));assert.ok(r.rounds.every(round=>round.participants.find(p=>p.entryId===id(2)).deckId===2));
  assert.equal(r.rounds[0].participants[0].dropped,true);assert.equal(r.rounds[2].matches[1].outcome,'bye');
  state.result='player2';assert.equal((await saveSuga()).body.archiveId,sugaId);assert.equal((await read(sugaId)).body.rounds[0].matches[0].winnerKey,id(2));
  const goodSecond=JSON.stringify((await f.db.query('SELECT * FROM matching_archive_matches WHERE archive_id=$1 AND round=2',[sugaId])).rows);
  state.emptyRound=2;assert.equal((await saveSuga()).code,200);assert.equal(JSON.stringify((await f.db.query('SELECT * FROM matching_archive_matches WHERE archive_id=$1 AND round=2',[sugaId])).rows),goodSecond);delete state.emptyRound;
  state.emptySuga=true;assert.equal((await saveSuga()).body.noData,true);state.emptySuga=false;state.badSuga=true;assert.equal((await saveSuga()).code,502);state.badSuga=false;
  assert.equal((await put(undefined,id(2),null)).code,200);assert.ok((await read(sugaId)).body.rounds.every(round=>round.participants.find(p=>p.entryId===id(2)).deckId===null));
  // A different Seq, including identical provider entry IDs, cannot inherit this deck.
  f.detail.held='3';const other=await call('POST','/api/deck-memo/matching',{url:sugaUrl,detailUrl:'fixture'});assert.equal(other.code,200);assert.equal(other.body.participants.find(p=>p.entryId===id(1)).deckId,null);
  const before=await Promise.all(['deck_memos','deck_memo_external_players','players','deck_history','event_results'].map(t=>f.db.query('SELECT * FROM '+t+' ORDER BY 1').then(r=>r.rows)));
  assert.equal((await call('POST','/api/matching-archives/:id/delete',{...key,confirmed:false},{id:sugaId})).code,400);
  assert.equal((await call('POST','/api/matching-archives/:id/delete',{...key,confirmed:true},{id:sugaId})).code,200);
  assert.equal((await read(sugaId)).code,404);assert.equal((await read(tcgId)).code,200);
  assert.deepEqual(await Promise.all(['deck_memos','deck_memo_external_players','players','deck_history','event_results'].map(t=>f.db.query('SELECT * FROM '+t+' ORDER BY 1').then(r=>r.rows))),before);
 }finally{await f.db.close();}
});
