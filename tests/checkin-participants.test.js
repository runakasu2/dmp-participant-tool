const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {parseCheckinUrl,fetchCheckins,mergeCheckins,predictionTargets}=require('../checkin-participants');
const {buildPredictionSummary}=require('../prediction-summary');
const suga='https://sugatool.nojigikucs.com/events/73039efc-e0b5-46ee-9169-2bd4892faeef/entries';
const noji='https://nojigikucs.com/users-manage?admin=test';
const entry=(id='001',extra={})=>({entryId:'entry-'+id,duemaId:id,playerName:'選手'+id,isReception:true,entryStatus:'confirmed',...extra});
const response=data=>new Response(JSON.stringify(data));
test('Suga reads fixed API; reception, waitlist, drop and confirmation remain independent',async()=>{
 let request;
 const r=await fetchCheckins(suga,async(url,options)=>{request={url,options};return response([entry(),entry('2',{entryStatus:'waitlisted',dropped:true}),entry('3',{isReception:false})]);});
 assert.equal(r.participants.length,2);assert.equal(r.participants[0].id,'001');assert.equal(r.participants[1].confirmed,false);assert.equal(r.participants[1].dropped,true);
 assert.equal(request.url,parseCheckinUrl(suga).api);assert.equal(request.options.redirect,'error');assert.ok(request.options.signal);
});
test('Nojigiku internal id never becomes a DMP ID; checked-in unconfirmed is included',async()=>{
 const r=await fetchCheckins(noji,async()=>response({users:[{id:68151,name:'選手',checkedIn:true,confirmed:false,paid:false},{id:5,name:'未受付',checkedIn:false}]}));
 assert.equal(r.participants.length,1);assert.equal(r.participants[0].id,null);assert.equal(r.participants[0].confirmed,false);assert.match(r.participants[0].externalKey,/68151$/);
});
test('ID merge preserves manual predictions and name; repeat fetch is idempotent; names alone never merge',()=>{
 const prediction={finalDeckName:'A',source:'manual'};
 const base=[{id:1,name:'DMP名',prediction}];
 const external=[{id:'1',name:'別名',checkedIn:true,confirmed:false,dayOf:true},{id:'2',name:'同名',dayOf:true,checkedIn:true,confirmed:true},{id:null,externalKey:'nojigiku:test:1',name:'同名',dayOf:true,checkedIn:true,confirmed:false}];
 const merged=mergeCheckins(base,external);
 assert.equal(merged.length,3);assert.equal(merged[0].prediction,prediction);assert.equal(merged[0].name,'DMP名');assert.equal(merged[0].dayOf,undefined);assert.equal(base[0].confirmed,undefined);
 assert.equal(mergeCheckins(merged,external).length,3);
 assert.equal(buildPredictionSummary(predictionTargets(merged)).participantCount,3);
 assert.equal(buildPredictionSummary(predictionTargets(merged,true)).participantCount,1);
});
test('invalid URL, schemas, HTTP failures and oversized streams reject',async()=>{
 for(const url of ['http://nojigikucs.com/users-manage?admin=x','https://evil.test/','https://nojigikucs.com.evil.test/users-manage?admin=x','https://u:p@nojigikucs.com/users-manage?admin=x','https://nojigikucs.com/users-manage?admin=x&admin=y'])assert.throws(()=>parseCheckinUrl(url));
 for(const data of [{},[entry('1',{isReception:'true'})],[entry('1',{playerName:''})]])await assert.rejects(fetchCheckins(suga,async()=>response(data)));
 await assert.rejects(fetchCheckins(noji,async()=>new Response('',{status:403})),/HTTP 403/);
 await assert.rejects(fetchCheckins(noji,async()=>new Response('x'.repeat(2*1024*1024+1))),/大きすぎ/);
 await assert.rejects(fetchCheckins(noji,async()=>{throw Error('timeout');}));
});
function fixture(){
 const routes=new Map(),saved=new Map(),calls=[];
 const pool={async query(sql,params){calls.push({sql,params});
  if(sql.includes('INSERT INTO checkin_predictions')){saved.set(params[3],{external_key:params[3],deck_id:params[4],deck_name:'手動'});return {rows:[]};}
  if(sql.includes('DELETE FROM checkin_predictions')){saved.delete(params[3]);return {rows:[]};}
  if(sql.includes('FROM checkin_predictions'))return {rows:[...saved.values()]};
  if(sql.includes('SELECT name FROM decks'))return {rows:[{name:'手動'}]};
  if(sql.includes('SELECT event_date::text'))return {rows:[{event_date:'2026-11-07',format:'original'}]};
  if(sql.includes('WITH latest'))return {rows:[{dmp_id:'001',deck_name:'履歴デッキ',event_date:'2026-10-01'}]};
  if(sql.includes('FROM event_deck_predictions'))return {rows:[{dmp_id:'001',manual_deck_id:9,deck_name:'保存済み'}]};
  return {rows:[]};
 }};
 const app={use(){},listen(){}};for(const m of ['get','post','put'])app[m]=(url,fn)=>routes.set(m+url,fn);
 const express=Object.assign(()=>app,{json(){},static(){}});
 const ctx=vm.createContext({require:n=>n==='express'?express:n==='pg'?{Pool:function(){return pool;}}:require(n),__dirname:process.cwd(),process:{env:{}},console:{log(){},error(){}},URL,URLSearchParams,TextDecoder});
 vm.runInContext(fs.readFileSync('server.js','utf8'),ctx);
 ctx.fetch=async url=>{if(url.includes('execute-api'))return response(url.includes('get-users')?{users:[{id:5,name:'外部',checkedIn:true,confirmed:false}]}:[entry()]);throw Error('detail unavailable');};
 return {ctx,calls,async request(route,body){const res={code:200,status(n){this.code=n;return this;},json(b){this.body=b;}};await routes.get(route)({body},res);return res;}};
}
const event={shopId:'s',eventId:'e',seq:'1'};
test('day-of known DMP receives shared history, saved manual prediction and batch player registration',async()=>{
 const f=fixture(),r=await f.request('post/api/checkin-participants',{...event,sourceUrl:suga});
 assert.equal(r.code,200);assert.equal(r.body.participants[0].recentDecks[0].deckName,'履歴デッキ');assert.equal(r.body.participants[0].prediction.finalDeckName,'保存済み');
 assert.ok(f.calls.some(c=>c.sql.includes('INSERT INTO players')));
});
test('unknown identity manual prediction saves and reloads, including explicit unknown and reset',async()=>{
 const f=fixture();const externalKey='nojigiku:test:5';
 const save=async(mode,deckId)=>f.request('put/api/checkin-prediction',{...event,externalKey,mode,deckId});
 assert.equal((await save('manual',9)).code,200);
 let r=await f.request('post/api/checkin-participants',{...event,sourceUrl:noji});
 assert.equal(r.body.participants[0].prediction.finalDeckName,'手動');assert.ok(!f.calls.some(c=>c.sql.includes('INSERT INTO players')));
 await save('manual',null);await save('auto');
 r=await f.request('post/api/checkin-participants',{...event,sourceUrl:noji});assert.equal(r.body.participants[0].prediction.hasManualPrediction,false);
});
test('external fetch failure performs no database writes',async()=>{
 const f=fixture();f.ctx.fetch=async()=>{throw Error('offline');};
 assert.equal((await f.request('post/api/checkin-participants',{...event,sourceUrl:suga})).code,502);assert.equal(f.calls.length,0);
});
test('migration preserves unknown overrides, enforces deck references and permits merge and reset',async()=>{
 const {PGlite}=require('@electric-sql/pglite');const db=new PGlite();
 try{
  await db.exec('CREATE TABLE decks(id INTEGER PRIMARY KEY,name TEXT); INSERT INTO decks VALUES(1,\'A\'),(2,\'B\');');
  await db.exec(fs.readFileSync('migrations/016_checkin_predictions.sql','utf8'));
  await db.query("INSERT INTO checkin_predictions VALUES('s','e','1','nojigiku:test:5',1)");
  await db.query("UPDATE checkin_predictions SET deck_id=2 WHERE deck_id=1");await db.query('DELETE FROM decks WHERE id=1');
  assert.equal((await db.query('SELECT deck_id FROM checkin_predictions')).rows[0].deck_id,2);
  await assert.rejects(db.query("INSERT INTO checkin_predictions VALUES('s','e','1','nojigiku:test:6',999)"));
  await db.query('UPDATE checkin_predictions SET deck_id=NULL');assert.equal((await db.query('SELECT deck_id FROM checkin_predictions')).rows[0].deck_id,null);
  await db.query("DELETE FROM checkin_predictions WHERE shop_id='s' AND event_id='e' AND seq='1'");assert.equal((await db.query('SELECT * FROM checkin_predictions')).rows.length,0);
 }finally{await db.close();}
});
test('full external roster confirms non-checked-in DMP entrants, while only check-ins add day-of entrants',async()=>{
 const r=await fetchCheckins(suga,async()=>response([entry('1',{isReception:false}),entry('2',{isReception:false,entryStatus:'waitlisted'}),entry('4',{isReception:false}),entry('5',{entryStatus:'unknown'})]));
 assert.equal(r.participants.length,1);assert.equal(r.statusParticipants.length,4);
 const prediction={finalDeckName:'A',source:'manual'};
 const base=[{id:'1',prediction},{id:'2'},{id:'3'}];
 const merged=mergeCheckins(base,r.participants,r.statusParticipants);
 assert.deepEqual(merged.map(p=>p.id),['1','2','3','5']);
 assert.deepEqual(merged.map(p=>p.confirmed),[true,false,null,null]);
 assert.equal(merged[0].checkedIn,false);assert.equal(merged[0].prediction,prediction);
 assert.deepEqual(predictionTargets(merged,true).map(p=>p.id),['1']);
 assert.equal(predictionTargets(merged).length,4);assert.equal(base[0].confirmed,undefined);
});
test('Nojigiku confirmation is explicit and independent of check-in/payment; name matches never confirm DMP players',async()=>{
 const r=await fetchCheckins(noji,async()=>response({users:[{id:1,name:'同名',checkedIn:true,confirmed:false,paid:true},{id:2,name:'確定',checkedIn:true,confirmed:true,paid:false},{id:3,name:'不明',checkedIn:true,paid:true}]}));
 const merged=mergeCheckins([{id:'1',name:'同名'}],r.participants,r.statusParticipants);
 assert.equal(merged[0].confirmed,null);assert.deepEqual(predictionTargets(merged,true).map(p=>p.name),['確定']);
});
test('status refresh removes stale confirmation and filtering preserves predictions and histories',()=>{
 const prediction={finalDeckName:'B',source:'manual'},recentDecks=[{deckName:'A'}];
 const base=[{id:'1',prediction,recentDecks},{id:'2'}];
 const first=mergeCheckins(base,[{id:'1',confirmed:true,checkedIn:true},{id:'3',confirmed:true,checkedIn:true}]);
 assert.equal(predictionTargets(first,true).length,2);
 assert.equal(predictionTargets(first).length,3);
 assert.equal(predictionTargets(first)[0].prediction,prediction);assert.equal(first[0].recentDecks,recentDecks);
 const updated=mergeCheckins(base,[]);assert.equal(predictionTargets(updated,true).length,0);assert.equal(updated[0].prediction,prediction);
 const summary=buildPredictionSummary(predictionTargets(first,true));assert.equal(summary.participantCount,2);assert.equal(summary.unknownCount,1);assert.equal(summary.decks[0].percentage,'50.0');
});
