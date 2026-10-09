// Isolated in-memory PostgreSQL; no DATABASE_URL or external provider requests.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./matching-archives-postgres.integration');
async function seed(f){
 const {db}=f;
 await db.exec(`INSERT INTO decks(name) VALUES ('C'); INSERT INTO deck_aliases(deck_id,alias) VALUES(1,'別名A');
 INSERT INTO events(shop_id,event_id,seq,event_name,event_date,format) VALUES
 ('s','e','1','のじぎく大会','2026-10-01','original'),('s','e','2','TCG大会','2026-10-02','advance'),('s','e','3','スガ大会','2026-10-03',NULL);
 INSERT INTO matching_archives(event_record_id,provider,source_key,source_url) VALUES
 (1,'nojigiku','noji','https://nojigikucs.com/?admin=noji'),(2,'tcg_meister','2703954','https://tcg.sfc-jpn.jp/?tid=2703954'),(3,'sugatool','event-uuid','https://sugatool.nojigikucs.com/events/event-uuid/matches');
 INSERT INTO deck_memo_events(source,admin_key,source_url,event_record_id) SELECT provider,source_key,source_url,event_record_id FROM matching_archives;
 INSERT INTO deck_memos(memo_event_id,dmp_id,deck_id) VALUES(1,'000123',1),(1,'456',2),(3,'000123',1);
 INSERT INTO deck_memo_external_players(memo_event_id,participant_key,handle_name,match_status,deck_id,dmp_id) VALUES
 (2,'id:39','　同名','unmatched',1,'000123'),(2,'id:53','同名','unmatched',2,NULL),(3,'22222222-2222-2222-2222-222222222222','同名','unmatched',2,NULL);
 `);
 const sides=[[
 {participantKey:'dmp:000123',dmpId:'000123',name:'　同名'},{participantKey:'dmp:456',dmpId:'456',name:'同名'}
 ],[
 {participantKey:'id:39',dmpId:null,name:'　同名'},{participantKey:'id:53',dmpId:null,name:'同名'}
 ],[
 {participantKey:'11111111-1111-1111-1111-111111111111',dmpId:'000123',name:'　同名'},{participantKey:'22222222-2222-2222-2222-222222222222',dmpId:null,name:'同名',dropped:true}
 ]];
 for(let a=1;a<=3;a++)for(let round=1;round<=2;round++)await db.query(`INSERT INTO matching_archive_matches(archive_id,round,match_key,table_no,sides,outcome,winner_key) VALUES($1,$2,$3,1,$4,'win_loss',$5)`,[a,round,'match-'+round,JSON.stringify(sides[a-1]),sides[a-1][round===1?0:1].participantKey]);
 return sides;
}
async function request(f,path,query={}){const res={code:200,headers:{},set(k,v){this.headers[k]=v;},status(c){this.code=c;return this;},json(body){this.body=body;}};await f.routes.get('GET '+path)({query},res);return res;}
module.exports={seed,request};
if(require.main===module)test('read-only winrate PostgreSQL: three sources, full keys, filters, live memo, saved fallback, detail revision, data protection',async()=>{
 const f=await fixture();try{
  await seed(f);const {db}=f;
  const summary=(q={})=>request(f,'/api/winrate/summary',q);
  const tables=['events','players','decks','deck_aliases','matching_archives','matching_archive_matches','deck_memo_events','deck_memos','deck_memo_external_players','deck_memo_archives','deck_memo_archive_players','deck_history','event_results'];
  const snapshot=()=>Promise.all(tables.map(t=>db.query('SELECT * FROM '+t+' ORDER BY 1').then(r=>r.rows)));
  const before=await snapshot();
  const all=await summary();assert.equal(all.code,200,JSON.stringify(all.body));assert.equal(all.body.counts.matchupMatches,6);assert.equal(all.body.decks[0].matches,6);assert.equal(all.headers['Cache-Control'],'no-store');
  const events=await request(f,'/api/winrate/events');assert.equal(events.body.events.length,3);assert.deepEqual(events.body.events.map(e=>e.seq),['3','2','1']);
  for(const [provider,eventId] of [['nojigiku',1],['tcg_meister',2],['sugatool',3]]){const one=await summary({mode:'single',eventRecordId:String(eventId),provider});assert.equal(one.body.counts.matchupMatches,2);assert.equal(one.body.decks[0].wins,1);}
  assert.equal((await summary({startDate:'2026-10-02',endDate:'2026-10-02',format:'advance',provider:'tcg_meister'})).body.counts.matchupMatches,2);
  assert.equal((await summary({mode:'single',eventRecordId:'1',format:'advance'})).body.counts.savedRecords,0);
  assert.equal((await summary({format:'unknown'})).body.counts.matchupMatches,2);
  assert.equal((await summary({mode:'single',eventRecordId:'999'})).body.counts.matchupMatches,0);
  assert.equal((await summary({mode:'single',eventRecordId:'1 OR 1=1'})).code,400);
  const detail=await request(f,'/api/winrate/matchup',{deckId:'1',opponentDeckId:'2',revision:all.body.revision,pageSize:'2'});assert.equal(detail.code,200,JSON.stringify(detail.body));assert.deepEqual(detail.body.pair,all.body.pairs.find(p=>p.deckId===1&&p.opponentDeckId===2));assert.equal(detail.body.total,6);assert.equal(detail.body.matches.length,2);
  assert.equal((await request(f,'/api/winrate/matchup',{deckId:'1',opponentDeckId:'2',page:'4',pageSize:'2'})).body.matches.length,0);
  assert.equal((await request(f,'/api/winrate/matchup',{deckId:'1',opponentDeckId:'2',pageSize:'101'})).code,400);
  assert.deepEqual(await snapshot(),before);
  // Current source-scoped external key wins; legacy TCG DMP cache mapping is never an identity bridge.
  await db.exec("UPDATE deck_memo_external_players SET deck_id=3 WHERE memo_event_id=2 AND participant_key='id:39';");
  const changed=await summary();assert.equal(changed.body.decks.find(d=>d.deckId===3).matches,2);
  assert.equal((await request(f,'/api/winrate/matchup',{deckId:'1',opponentDeckId:'2',revision:all.body.revision})).code,409);
  await db.exec(`INSERT INTO deck_memo_archives(event_record_id,event_name,event_date,admin_key,source_url,source) VALUES(1,'保存メモ','2026-10-01','noji','fixture','nojigiku');
    INSERT INTO deck_memo_archive_players(archive_id,dmp_id,participant_key,handle_name,deck_id) VALUES(1,'000123','dmp:000123','　同名',1),(1,'456','dmp:456','同名',2);`);
  // Explicit clear must not revive old archived deck or use past deck history.
  await db.exec("DELETE FROM deck_memos WHERE memo_event_id=1 AND dmp_id='000123'; INSERT INTO deck_history(player_id,shop_id,event_id,seq,event_date,deck_name) VALUES(1,'s','e','1','2026-10-01','A');");
  assert.equal((await summary({mode:'single',eventRecordId:'1'})).body.exclusions.missingDeck,2);
  await db.exec('DELETE FROM deck_memos WHERE memo_event_id=1; DELETE FROM deck_memo_events WHERE id=1;');
  assert.equal((await summary({mode:'single',eventRecordId:'1'})).body.counts.matchupMatches,2);
  await db.exec("UPDATE deck_memo_archives SET admin_key='other';");
  assert.equal((await summary({mode:'single',eventRecordId:'1'})).body.counts.matchupMatches,0);
  // DB failures are errors, never a successful empty result; client released and transaction rolled back.
  const original=f.pool.query;let rolledBack=false;
  f.pool.query=(sql,args)=>{if(sql==='ROLLBACK')rolledBack=true;if(sql.startsWith('SELECT * FROM matching_archive_matches'))throw Error('private credentials');return original(sql,args);};
  const failed=await summary();assert.equal(failed.code,500);assert.ok(!failed.body.error.includes('credentials'));assert.ok(rolledBack);f.pool.query=original;
 }finally{await f.db.close();}
});
