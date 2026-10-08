const {test}=require('node:test'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs');
const {snapshotPlayers,mergeResults,installProvisionalRoutes}=require('../provisional-results');
test('identity uses DMP IDs or external keys, never names; conflicting duplicates are rejected',()=>{
 const rows=[{dmp_id:'1',handle_name:' 同名',deck_id:1,deck_name:'A'},{dmp_id:'1',handle_name:' 同名',deck_id:1,deck_name:'A'},
 {dmp_id:'2',handle_name:' 同名',deck_id:null},{participant_key:'id:3',handle_name:' 同名',deck_id:null}];
 assert.equal(snapshotPlayers(rows).length,3);
 assert.equal(snapshotPlayers([...rows,{...rows[0],deck_id:null}])[0].deckId,1);
 assert.throws(()=>snapshotPlayers([{handle_name:'名前だけ'}]),{status:400});
 assert.throws(()=>snapshotPlayers([...rows,{...rows[0],deck_id:2}]),{status:409});
});
test('official roster/rank wins; history wins conflicts, draft fills missing decks without double counting',()=>{
 const drafts=[{id:'1',name:' 仮名',deckName:'A'},{id:'2',name:'同名',deckName:'B'},{id:null,key:'external:3',name:'同名',deckName:'C'}];
 const result=mergeResults([{id:'1',name:'正式名',rank:1},{id:'2',name:'同名',rank:2}],drafts,[{dmp_id:'1',deck_name:'C'}]);
 assert.equal(result.count,2);assert.equal(result.participants[0].deckName,'C');assert.equal(result.participants[0].deckConflict,true);
 assert.equal(result.participants[0].rank,1);assert.equal(result.participants[1].deckName,'B');
});
test('PostgreSQL snapshot updates are atomic, isolated by all three event keys, and preserve official/history/archive rows',async()=>{
 const db=new PGlite();
 try{
 await db.exec(`CREATE TABLE events(id SERIAL PRIMARY KEY,shop_id TEXT,event_id TEXT,seq TEXT,event_name TEXT,event_date DATE,format TEXT);
 CREATE TABLE decks(id SERIAL PRIMARY KEY,name TEXT);CREATE TABLE deck_aliases(deck_id INT,alias TEXT);
 CREATE TABLE players(id SERIAL PRIMARY KEY,dmp_id TEXT,handle_name TEXT);
 CREATE TABLE event_results(event_record_id INT,player_id INT,rank INT);
 CREATE TABLE deck_history(id SERIAL PRIMARY KEY,player_id INT,shop_id TEXT,event_id TEXT,seq TEXT,deck_name TEXT,created_at TIMESTAMPTZ DEFAULT NOW());
 CREATE TABLE deck_memo_archives(id SERIAL PRIMARY KEY,event_record_id INT,source TEXT,admin_key TEXT);
 CREATE TABLE deck_memo_archive_players(archive_id INT,participant_key TEXT,dmp_id TEXT,handle_name TEXT,deck_id INT);
 INSERT INTO events(shop_id,event_id,seq,event_name,event_date) VALUES('s','e','1','A','2026-10-08'),('s','e','2','B','2026-10-08'),('other','e','1','C','2026-10-08');
 INSERT INTO decks(name) VALUES('A'),('B');INSERT INTO players(dmp_id,handle_name) VALUES('68160','　オガワ'),('2','　オガワ');
 INSERT INTO deck_memo_archives(event_record_id,source,admin_key) VALUES(1,'tcg_meister','t');
 INSERT INTO deck_memo_archive_players VALUES(1,'a','68160','　オガワ',1),(1,'a-repeat','68160','　オガワ',1),(1,'b','2','　オガワ',NULL),(1,'c',NULL,'　オガワ',NULL);`);
 await db.exec(fs.readFileSync('migrations/012_provisional_event_results.sql','utf8'));
 await db.exec(fs.readFileSync('migrations/012_provisional_event_results.sql','utf8'));
 const pool={query:(sql,args)=>db.query(sql,args),connect:async()=>({query:(sql,args)=>db.query(sql,args),release(){}})};
 const routes=new Map();installProvisionalRoutes({post:(p,h)=>routes.set('POST '+p,h),get:(p,h)=>routes.set('GET '+p,h)},pool);
 async function call(method,url,values){const res={code:200,status(n){this.code=n;return this;},json(body){this.body=body;}};await routes.get(method+' '+url)({body:values,query:values},res);return res;}
 const key={shopId:'s',eventId:'e',seq:'1'},apply={...key,archiveId:1,confirmed:true};
 assert.equal((await call('POST','/api/deck-memo/provisional-results',{...apply,seq:'2'})).code,409);
 assert.equal((await call('GET','/api/event-results-view',{shopId:'s',eventId:'e'})).code,400);
 for(let i=0;i<2;i++)assert.equal((await call('POST','/api/deck-memo/provisional-results',apply)).code,200);
 let result=(await call('GET','/api/event-results-view',key)).body;
 assert.equal(result.resultKind,'provisional');assert.equal(result.count,3);assert.equal(result.knownCount,1);assert.equal(result.unknownCount,2);
 assert.ok(result.participants.every(p=>p.rank===null));assert.equal(result.decks[0].percentage,'66.7');
 assert.equal((await call('GET','/api/event-results-view',{...key,seq:'2'})).code,404);
 assert.equal((await call('GET','/api/event-results-view',{...key,shopId:'other'})).code,404);
 assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM provisional_event_results')).rows[0].n,1);
 await db.exec("UPDATE deck_memo_archive_players SET deck_id=2 WHERE participant_key='b';");
 await call('POST','/api/deck-memo/provisional-results',apply);
 result=(await call('GET','/api/event-results-view',key)).body;assert.equal(result.knownCount,2);
 await db.exec("INSERT INTO event_results VALUES(1,1,1),(1,2,2);INSERT INTO deck_history(player_id,shop_id,event_id,seq,deck_name) VALUES(1,'s','e','1','B');");
 const before=(await db.query('SELECT * FROM deck_history')).rows;
 await call('POST','/api/deck-memo/provisional-results',apply);
 result=(await call('GET','/api/event-results-view',key)).body;
 assert.equal(result.resultKind,'official');assert.equal(result.count,2);assert.equal(result.participants[0].rank,1);
 assert.equal(result.participants[0].deckConflict,true);assert.equal(result.participants[0].deckName,'B');assert.equal(result.participants[1].deckName,'B');
 assert.deepEqual((await db.query('SELECT * FROM deck_history')).rows,before);
 assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM event_results')).rows[0].n,2);
 assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM deck_memo_archive_players')).rows[0].n,4);
 }finally{await db.close();}
});
test('result URL retains supported aliases, requires Seq, and failed official fetch is visibly distinguished',async()=>{
 const vm=require('node:vm');const calls=[];
 const context=vm.createContext({URL,URLSearchParams,fetch:async(url)=>{
  calls.push(url);
  return url==='/api/event-result-from-detail'?{ok:false,json:async()=>({error:'external unavailable'})}:{ok:true,json:async()=>({participants:[{id:'1'}],resultKind:'provisional'})};
 }});
 vm.runInContext(fs.readFileSync('provisional-results-ui.js','utf8'),context);
 assert.equal(context.resultEventKey('http://dmp-ranking.com/event.asp?shop=s&event=e&held=2').seq,'2');
 assert.throws(()=>context.resultEventKey('https://www.dmp-ranking.com/event.asp?ShopID=s&EventID=e'));
 const result=await context.fetchResultsView('https://www.dmp-ranking.com/event.asp?ShopID=s&EventID=e&Seq=2');
 assert.match(result.officialFetchWarning,/公開状況は未確認/);assert.match(calls[1],/seq=2/);
});
