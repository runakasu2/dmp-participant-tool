// Isolated PostgreSQL engine; never connects to Neon or any configured DATABASE_URL.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {PGlite}=require('@electric-sql/pglite');
const {installMemoRoutes}=require('../deck-memo');
const {installMatchingArchiveRoutes}=require('../matching-archives');
const root=path.resolve(__dirname,'..');
const row=(round,table,a='000123',b='456',winner=8)=>({round,table,user1id:a,user1:'　同名 (0点)',user1no:8,user2id:b,user2:'同名 (0点)',user2no:42,winner});
async function fixture(){
 const db=new PGlite(),routes=new Map();
 const pool={query:(s,a)=>a?db.query(s,a):db.exec(s).then(r=>r.at(-1)),connect:async()=>({query:pool.query,release(){}})};
 const app={get:(p,h)=>routes.set('GET '+p,h),post:(p,h)=>routes.set('POST '+p,h),put:(p,h)=>routes.set('PUT '+p,h),use(){},listen(){}};
 vm.runInNewContext(fs.readFileSync(path.join(root,'server.js'),'utf8'),{require(n){if(n==='express')return Object.assign(()=>app,{json(){},static(){}});if(n==='pg')return{Pool:function(){return pool;}};return require(n);},__dirname:root,process:{env:{}},console:{log(){},error(){}},URL,TextDecoder,AbortSignal});
 async function call(method,url,body={},params={}){const res={code:200,set(){},status(c){this.code=c;return this;},json(b){this.body=b;}};await routes.get(method+' '+url)({body,params},res);return res;}
 const setup=await call('GET','/api/setup-db');assert.equal(setup.code,200,JSON.stringify(setup.body));
 await db.exec(fs.readFileSync(path.join(root,'migrations/013_matching_archives.sql'),'utf8'));
 await db.exec("INSERT INTO decks(name) VALUES ('A'),('B');INSERT INTO deck_formats(deck_id,format) SELECT id,'original' FROM decks;INSERT INTO players(dmp_id,handle_name) VALUES ('000123','　同名'),('456','同名');");
 const state={rows:[row(1,1),row(1,2,'789','987',42),row(2,1),row(2,2,'789','987',-1)],offline:false};
 const fetchImpl=async url=>{if(state.offline)throw Error('offline');return new Response(JSON.stringify(url.includes('get-cs-info')?{csInfo:state.rows}:{users:[]}));};
 const detail={shopId:'s',eventId:'e',held:'2',eventName:'大会',eventDate:'2026-10-10',format:'original'};
 installMemoRoutes(app,pool,fetchImpl,async()=>({...detail}));installMatchingArchiveRoutes(app,pool,fetchImpl);
 const source='https://nojigikucs.com/?admin=fixture';const key={shopId:'s',eventId:'e',seq:'2',url:source};
 return{db,pool,app,routes,call,state,key,source,detail,fetchImpl};
}
module.exports={fixture,row};
if(require.main===module)test('PostgreSQL pairing lifecycle: complete keys, dedup/update, empty/offline preservation, memo sharing, scoped deletion',async()=>{
 const f=await fixture();const {db,call,state,key,source}=f;
 try{
  const live=await call('POST','/api/deck-memo/matching',{url:source,detailUrl:'fixture'});assert.equal(live.code,200,JSON.stringify(live.body));assert.equal(live.body.rounds.length,2);
  const memoId=live.body.memoEventId;
  const deck=()=>call('PUT','/api/deck-memo',{url:source,memoEventId:memoId,dmpId:'000123',deckId:1});assert.equal((await deck()).code,200);
  const memoArchive=await call('POST','/api/deck-memo/archives',{memoEventId:memoId});assert.equal(memoArchive.code,200,JSON.stringify(memoArchive.body));
  await db.exec("INSERT INTO event_results(event_record_id,player_id,rank) VALUES (1,1,1);INSERT INTO deck_history(player_id,shop_id,event_id,seq,event_date,deck_name) VALUES (1,'s','e','2','2026-10-10','A');");
  const save=(body=key)=>call('POST','/api/matching-archives',body);
  assert.equal((await save({...key,seq:'3'})).code,409);assert.equal((await save({...key,seq:undefined})).code,400);
  let saved=await save();assert.equal(saved.code,200,JSON.stringify(saved.body));const id=saved.body.archiveId;
  const read=()=>call('GET','/api/matching-archives/:id',{}, {id});
  assert.equal((await save()).body.archiveId,id);assert.equal((await db.query('SELECT COUNT(*)::int n FROM matching_archive_matches')).rows[0].n,4);
  let result=(await read()).body;assert.equal(result.rounds.length,2);assert.ok(result.rounds.every(r=>r.participants.find(p=>p.dmpId==='000123').deckName==='A'));
  // In-round corrected pairings and table numbers replace only that complete round.
  state.rows=[row(1,3,'000123','789'),row(1,4,'456','987')];assert.equal((await save()).code,200);result=(await read()).body;assert.deepEqual(result.rounds[0].matches.map(m=>m.table),[3,4]);assert.equal(result.rounds[1].matches.length,2);
  // Partial non-conflicting responses retain omitted tables/rounds. Conflicts fail atomically.
  state.rows=[row(1,3,'000123','789',42)];assert.equal((await save()).code,200);assert.equal((await read()).body.rounds[0].matches.length,2);
  const snapshot=JSON.stringify((await db.query('SELECT * FROM matching_archive_matches ORDER BY round,table_no')).rows);
  state.rows=[row(1,4)];assert.equal((await save()).code,409);assert.equal(JSON.stringify((await db.query('SELECT * FROM matching_archive_matches ORDER BY round,table_no')).rows),snapshot);
  // A database failure after deleting a complete old round must roll back the entire snapshot.
  const originalQuery=f.pool.query;
  f.pool.query=(sql,args)=>sql.startsWith('INSERT INTO matching_archive_matches')?Promise.reject(Error('private database detail')):originalQuery(sql,args);
  state.rows=[row(1,3,'000123','789'),row(1,4,'456','987')];const failed=await save();assert.equal(failed.code,500);assert.ok(!failed.body.error.includes('private'));
  f.pool.query=originalQuery;assert.equal(JSON.stringify((await db.query('SELECT * FROM matching_archive_matches ORDER BY round,table_no')).rows),snapshot);
  state.rows=[row(1,3),{...row(1,3),winner:42}];assert.equal((await save()).code,502);assert.equal(JSON.stringify((await db.query('SELECT * FROM matching_archive_matches ORDER BY round,table_no')).rows),snapshot);
  state.rows=[];assert.equal((await save()).body.noData,true);state.offline=true;assert.equal((await save()).code,502);assert.equal(JSON.stringify((await db.query('SELECT * FROM matching_archive_matches ORDER BY round,table_no')).rows),snapshot);
  result=(await read()).body;assert.equal(result.rounds.length,2);assert.equal((await call('GET','/api/matching-archives')).body.archives.length,1);
  // Deck edits on saved rounds are shared, and explicit clearing cannot revive old memo data.
  assert.equal((await call('PUT','/api/deck-memo',{url:source,memoEventId:memoId,dmpId:'000123',deckId:2})).code,200);
  assert.ok((await read()).body.rounds.every(r=>r.participants.find(p=>p.dmpId==='000123').deckName==='B'));
  assert.equal((await call('PUT','/api/deck-memo',{url:source,memoEventId:memoId,dmpId:'000123',deckId:null})).code,200);
  assert.ok((await read()).body.rounds.every(r=>r.participants.find(p=>p.dmpId==='000123').deckId===null));
  // Reused admin with different Seq has separate memo, archive, and deck scope.
  state.offline=false;state.rows=[row(1,1)];f.detail.held='3';const other=await call('POST','/api/deck-memo/matching',{url:source,detailUrl:'fixture'});assert.equal(other.code,200);assert.notEqual(other.body.memoEventId,memoId);
  const second=await save({...key,seq:'3'});assert.equal(second.code,200);assert.notEqual(second.body.archiveId,id);
  assert.equal((await call('GET','/api/matching-archives/:id',{}, {id:second.body.archiveId})).body.participants[0].deckId,null);
  const tables=['events','players','deck_memo_events','deck_memos','deck_history','event_results','deck_memo_roster','deck_memo_archives','deck_memo_archive_players'];
  const before=await Promise.all(tables.map(t=>db.query('SELECT * FROM '+t+' ORDER BY 1').then(r=>r.rows)));
  const remove=body=>call('POST','/api/matching-archives/:id/delete',body,{id});
  assert.equal((await remove({...key,confirmed:false})).code,400);assert.equal((await remove({...key,seq:'3',confirmed:true})).code,409);
  assert.equal((await remove({...key,confirmed:true})).code,200);assert.equal((await read()).code,404);
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM matching_archive_matches WHERE archive_id=$1',[id])).rows[0].n,0);
  assert.equal((await call('GET','/api/matching-archives')).body.archives.length,1);
  assert.deepEqual(await Promise.all(tables.map(t=>db.query('SELECT * FROM '+t+' ORDER BY 1').then(r=>r.rows))),before);
 }finally{await db.close();}
});
