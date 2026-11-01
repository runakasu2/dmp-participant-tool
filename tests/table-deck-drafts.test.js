const {test}=require('node:test');const assert=require('node:assert/strict');const {PGlite}=require('@electric-sql/pglite');const express=require('express');const fs=require('node:fs');
const {pairFor,choices,identity,installDraftRoutes}=require('../table-deck-drafts');
test('provider identities and pair eligibility',()=>{for(const provider of ['nojigiku','sugatool','tcg_meister']){const a={dmpId:'12',participantKey:'entry:a',table:1},b={dmpId:'13',participantKey:'entry:b',table:1};assert.equal(pairFor([a,b],a,provider).length,2);assert.equal(pairFor([a],a,provider),null);assert.equal(pairFor([a,{...b,bye:true}],a,provider),null);assert.equal(pairFor([a,a],a,provider),null);assert.equal(identity(a,provider),provider==='tcg_meister'?'key:entry:a':'dmp:12');}});
test('remaining candidate is explicit and duplicate decks retain one slot',()=>{assert.deepEqual(choices({pair:['a','b'],decks:[1,2],resolved:{a:1}},'b'),[2]);assert.deepEqual(choices({pair:['a','b'],decks:[1,1],resolved:{a:1}},'b'),[1]);});
test('DB create, reload, independent confirmation, cancellation and provider isolation',async()=>{
 const db=new PGlite();await db.exec(`CREATE TABLE deck_memo_events(id integer primary key,source text,admin_key text);CREATE TABLE players(id integer,dmp_id text);CREATE TABLE decks(id integer primary key,name text);CREATE TABLE deck_memo_roster(memo_event_id integer,dmp_id text);CREATE TABLE deck_memos(memo_event_id integer,dmp_id text,player_id integer,deck_id integer,updated_at timestamptz,UNIQUE(memo_event_id,dmp_id));CREATE TABLE deck_memo_external_players(memo_event_id integer,participant_key text,deck_id integer,updated_at timestamptz);INSERT INTO decks VALUES(1,'A'),(2,'B');`);await db.exec(fs.readFileSync('migrations/015_table_deck_drafts.sql','utf8'));
 const pool={query:(...args)=>db.query(...args),connect:async()=>({query:(...args)=>db.query(...args),release(){}})};const app=express();app.use(express.json());installDraftRoutes(app,pool);const server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});const base='http://127.0.0.1:'+server.address().port;
 try{for(const [i,source,url] of [[1,'nojigiku','https://nojigikucs.com/?admin=test'],[2,'sugatool','https://sugatool.nojigikucs.com/events/12345678-1234-1234-1234-123456789abc/matches'],[3,'tcg_meister','https://tcg.sfc-jpn.jp/loginnum.asp?tid=123'],[4,'sugatool','https://sugatool.nojigikucs.com/events/12345678-1234-1234-1234-123456789abc/matches']]){
 // Provider parsing is independently regression-tested; derive its canonical key.
 const parsed=require('../deck-memo').detectProvider(url);
 await db.query('INSERT INTO deck_memo_events VALUES($1,$2,$3)',[i,source,parsed.adminKey||parsed.tid]);
 const external=source==='tcg_meister'||i===4;const players=[{dmpId:i===4?null:'11',participantKey:'a',table:1},{dmpId:i===4?null:'22',participantKey:'b',table:1}];
 if(external)await db.exec(`INSERT INTO deck_memo_external_players VALUES(${i},'a',NULL,NULL),(${i},'b',NULL,NULL)`);else await db.exec(`INSERT INTO deck_memo_roster VALUES(${i},'11'),(${i},'22')`);
 const send=async body=>{const r=await fetch(base+'/api/deck-memo/table-drafts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url,memoEventId:i,...body})});return r.json();};
 const created=await send({action:'create',round:2,table:1,players,decks:[1,2]});assert.equal(created.success,true,JSON.stringify(created));const d=created.draft;
 assert.equal((await db.query('SELECT * FROM deck_memos')).rows.filter(x=>x.memo_event_id===i).length,0);
 assert.equal((await (await fetch(base+'/api/deck-memo/table-drafts?memoEventId='+i)).json()).drafts.length,1);
 assert.equal((await send({action:'confirm',id:d.id,key:identity(players[0],source),deckId:1})).success,true);
 const saved=(await db.query('SELECT * FROM deck_memo_table_drafts WHERE id=$1',[d.id])).rows[0];assert.equal(Object.keys(saved.resolved).length,1);
 assert.equal((await send({action:'confirm',id:d.id,key:identity(players[1],source),deckId:1})).success,false);
 assert.equal((await send({action:'confirm',id:d.id,key:identity(players[1],source),deckId:2})).success,true);
 const later=await send({action:'create',round:3,table:1,players,decks:[1,1]});assert.equal(later.success,true);
 const all=(await (await fetch(base+'/api/deck-memo/table-drafts?memoEventId='+i)).json()).drafts;assert.equal(all.length,2);assert.deepEqual(all.map(x=>x.round),[2,3]);
 assert.equal((await send({action:'confirm',id:later.draft.id,key:identity(players[0],source),deckId:1})).success,true);
 assert.equal((await send({action:'confirm',id:later.draft.id,key:identity(players[1],source),deckId:1})).success,true);
 if(!external){await require('../memo-write').writeDmpMemo(db,i,'11',null);assert.equal((await db.query('SELECT * FROM deck_memos WHERE memo_event_id=$1 AND dmp_id=$2',[i,'11'])).rows.length,0);}
 assert.equal((await send({action:'cancel',id:d.id})).success,true);
 assert.equal((await send({action:'cancel',id:later.draft.id})).success,true);
 }}finally{await new Promise(r=>server.close(r));await db.close();}
});
