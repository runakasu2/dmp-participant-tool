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
 installMemoRoutes(app,pool,async url=>({ok:true,json:async()=>url.endsWith('/entries')?entries:url.includes('/matches?')?[]:{eventId:id,currentRound:5}}),async()=>({shopId:'s',eventId:'e',held:'1',eventName:'大会',eventDate:'2026-10-01'}));
 const body={url:'https://sugatool.nojigikucs.com/events/'+id+'/matches',detailUrl:'test'};
 let data=await call('post','/api/deck-memo/matching',body);assert.equal(data.participantCount,1);assert.equal(data.participants[0].table,null);
 await call('put','/api/deck-memo',{url:body.url,memoEventId:data.memoEventId,dmpId:'7496',deckId:1});
 data=await call('post','/api/deck-memo/matching',body);assert.equal(data.participants[0].deckId,1);
 const archive=await call('post','/api/deck-memo/archives',{memoEventId:data.memoEventId});
 const rows=(await db.query('SELECT a.source,p.dmp_id,p.deck_id,p.handle_name FROM deck_memo_archives a JOIN deck_memo_archive_players p ON a.id=p.archive_id')).rows;
 assert.deepEqual(rows,[{source:'sugatool',dmp_id:'7496',deck_id:1,handle_name:'未登録player'}]);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM deck_history')).rows[0].n,0);
 assert.equal((await db.query('SELECT source,admin_key FROM deck_memo_events')).rows[0].admin_key,id);
 }finally{await db.close();}
});
