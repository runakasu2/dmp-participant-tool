const {test}=require('node:test'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {installMemoRoutes}=require('../deck-memo');
test('Sugatool saves by provider/event UUID/DMP ID, reloads decks and archives all received entries',async()=>{
 const db=new PGlite();const pool={query:async(sql,args)=>args?db.query(sql,args):(await db.exec(sql)).at(-1),connect:async()=>({query:pool.query,release(){}})};
 const routes=new Map(),app={use(){},listen(){}};for(const method of ['get','post','put'])app[method]=(url,handler)=>routes.set(method+' '+url,handler);
 const express=Object.assign(()=>app,{json(){},static(){}});
 vm.runInNewContext(fs.readFileSync('server.js','utf8'),{require(n){if(n==='express')return express;if(n==='pg')return {Pool:function(){return pool;}};return require(n);},__dirname:path.resolve('.'),process:{env:{}},URL,TextDecoder,console:{log(){},error(){}},AbortSignal});
 async function call(method,url,body,params){const res={code:200,set(){},status(n){this.code=n;return this;},json(body){this.body=body;}};await routes.get(method+' '+url)({body,params},res);assert.equal(res.code,200,JSON.stringify(res.body));return res.body;}
 try{
 await call('get','/api/setup-db');await db.exec("INSERT INTO decks(name) VALUES ('代表デッキ')");
 const id='dcb0aac1-ab7f-4261-b997-6614e93cc8d2',entry='48380b24-dc2b-4fee-a063-87acd19bc8b1';
 const entries=[{entryId:entry,playerName:'未登録player',duemaId:7496,isReception:true,dropped:true}];
 const historicalMatches=[];
 installMemoRoutes(app,pool,async url=>({ok:true,json:async()=>url.endsWith('/entries')?entries:url.includes('/matches?')?historicalMatches.filter(m=>m.round===Number(new URL(url).searchParams.get('round'))):{eventId:id,currentRound:5,gameFormat:['2block']}}),async()=>({shopId:'s',eventId:'e',held:'1',eventName:'大会',eventDate:'2026-10-01'}));
 require('../memo-sync').installMemoSync(app,pool);
 const body={url:'https://sugatool.nojigikucs.com/events/'+id+'/matches',detailUrl:'test'};
 let data=await call('post','/api/deck-memo/matching',body);assert.equal(data.format,'2block');assert.equal(data.participantCount,1);assert.equal(data.participants[0].table,null);
 await db.exec("UPDATE events SET format='advance' WHERE shop_id='s'");
 await call('put','/api/deck-memo',{url:body.url,memoEventId:data.memoEventId,dmpId:'7496',deckId:1});
 data=await call('post','/api/deck-memo/matching',body);assert.equal(data.participants[0].deckId,1);assert.equal(data.format,'advance');assert.equal(data.event.format,'advance');
 // Exercise the real snapshot SQL: a NULL external row must not shadow a DMP memo.
 const state=async id=>{const res={set(){},json(body){this.body=body;},status(){return this;}};await routes.get('get /api/deck-memo/state')({query:{memoEventId:id}},res);assert.equal(res.body.success,true);return res.body.players;};
 const originalMemo=data.memoEventId;
 assert.equal((await db.query('SELECT deck_id FROM deck_memo_external_players WHERE memo_event_id=$1',[originalMemo])).rows[0].deck_id,null);
 assert.deepEqual((await state(originalMemo)).map(p=>[p.dmp_id,p.deck_id]),[['7496',1]]);
 // Linking state is deliberately isolated: drafts and other DMP events do not inherit decks.
 let draft=await call('post','/api/deck-memo/matching',{url:body.url});assert.notEqual(draft.memoEventId,originalMemo);assert.equal(draft.participants[0].deckId,null);
 await call('put','/api/deck-memo',{url:body.url,memoEventId:draft.memoEventId,dmpId:'7496',deckId:1});
 data=await call('post','/api/deck-memo/matching',body);assert.equal(data.memoEventId,originalMemo);assert.equal(data.participants[0].deckId,1);
 // Even a stale non-NULL external deck must not undo explicit DMP unselection.
 await db.query('UPDATE deck_memo_external_players SET deck_id=1 WHERE memo_event_id=$1',[originalMemo]);
 await call('put','/api/deck-memo',{url:body.url,memoEventId:originalMemo,dmpId:'7496',deckId:null});assert.deepEqual(await state(originalMemo),[]);
 assert.equal((await state(draft.memoEventId))[0].deck_id,1);
 await call('put','/api/deck-memo',{url:body.url,memoEventId:originalMemo,dmpId:'7496',deckId:1});
 const archive=await call('post','/api/deck-memo/archives',{memoEventId:data.memoEventId});
 const rows=(await db.query('SELECT a.source,p.dmp_id,p.deck_id,p.handle_name FROM deck_memo_archives a JOIN deck_memo_archive_players p ON a.id=p.archive_id')).rows;
 assert.deepEqual(rows,[{source:'sugatool',dmp_id:'7496',deck_id:1,handle_name:'未登録player'}]);
 const unknown='48380b24-dc2b-4fee-a063-87acd19bc8b2';
 entries.push({entryId:unknown,playerName:'DMPなし',duemaId:null,isReception:true});
 data=await call('post','/api/deck-memo/matching',body);
 await call('put','/api/deck-memo',{url:body.url,memoEventId:originalMemo,participantKey:unknown,deckId:1});
 data=await call('post','/api/deck-memo/matching',body);assert.equal(data.participants.find(p=>p.entryId===unknown).deckId,1);
 assert.equal((await state(originalMemo)).find(p=>p.participant_key===unknown).deck_id,1);
 await call('put','/api/deck-memo',{url:body.url,memoEventId:originalMemo,participantKey:unknown,deckId:null});
 assert.equal((await state(originalMemo)).find(p=>p.participant_key===unknown).deck_id,null);
 // TCG uses the external row even with a legacy DMP mapping.
 const tcg=(await db.query("INSERT INTO deck_memo_events(source,admin_key,source_url) VALUES('tcg_meister','123','https://tcg.sfc-jpn.jp/?tid=123') RETURNING id")).rows[0].id;
 await db.query("INSERT INTO deck_memo_external_players(memo_event_id,participant_key,handle_name,match_status,dmp_id,deck_id) VALUES($1,'id:1','TCG','manual','7496',1)",[tcg]);
 assert.equal((await state(tcg))[0].deck_id,1);
 const walkIn='48380b24-dc2b-4fee-a063-87acd19bc8b3';
 entries.push({entryId:walkIn,playerName:'当日参加ドロップ',duemaId:'7497',isReception:false,dropped:true});
 historicalMatches.push({eventId:id,round:1,seatNumber:1,player1Id:entry,player2Id:walkIn});
 data=await call('post','/api/deck-memo/matching',body);
 let dropped=data.participants.find(p=>p.entryId===walkIn);assert.ok(dropped);assert.equal(dropped.table,null);assert.equal(dropped.side,null);assert.equal(dropped.dropped,true);
 await call('put','/api/deck-memo',{url:body.url,memoEventId:originalMemo,dmpId:'7497',deckId:1});
 data=await call('post','/api/deck-memo/matching',body);dropped=data.participants.find(p=>p.entryId===walkIn);assert.equal(dropped.deckId,1);assert.equal(dropped.table,null);
 assert.equal((await state(originalMemo)).find(p=>p.dmp_id==='7497').deck_id,1);
 await call('put','/api/deck-memo',{url:body.url,memoEventId:originalMemo,dmpId:'7497',deckId:null});
 data=await call('post','/api/deck-memo/matching',body);assert.equal(data.participants.find(p=>p.entryId===walkIn).deckId,null);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM deck_history')).rows[0].n,0);
 assert.equal((await db.query('SELECT source,admin_key FROM deck_memo_events')).rows[0].admin_key,id);
 }finally{await db.close();}
});
