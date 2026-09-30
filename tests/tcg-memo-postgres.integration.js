// Optional real PostgreSQL-engine checks (PGlite). No production connection is used.
// npm install --prefix /tmp/dmp-tcg-validation --no-audit --no-fund @electric-sql/pglite
// NODE_PATH=/tmp/dmp-tcg-validation/node_modules node --test tests/tcg-memo-postgres.integration.js
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {PGlite}=require('@electric-sql/pglite');
const {installMemoRoutes}=require('../deck-memo');
const {installArchiveRoutes}=require('../deck-memo-archives');
const {installImportRoutes}=require('../deck-memo-import');
const fixture=name=>fs.readFileSync(path.join(__dirname,'fixtures/tcg-meister',name+'.html'),'utf8');
const migration=n=>fs.readFileSync(path.join(__dirname,'../migrations',n),'utf8');

test('PostgreSQL: migrate legacy data twice, memo first, match/import after results and preserve nojigiku',async()=>{
  const db=new PGlite();
  try {
    await db.exec(`CREATE TABLE players (id SERIAL PRIMARY KEY,dmp_id VARCHAR(50) UNIQUE NOT NULL,handle_name VARCHAR(100),created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE events (id SERIAL PRIMARY KEY,shop_id VARCHAR(100) NOT NULL,event_id VARCHAR(100) NOT NULL,seq VARCHAR(100) NOT NULL,event_name VARCHAR(255),event_date DATE,participant_count INTEGER DEFAULT 0,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,UNIQUE(shop_id,event_id,seq));
      CREATE TABLE decks (id SERIAL PRIMARY KEY,name VARCHAR(100) UNIQUE NOT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE deck_aliases (id SERIAL PRIMARY KEY,deck_id INTEGER REFERENCES decks(id) ON DELETE CASCADE,alias VARCHAR(100) UNIQUE);
      CREATE TABLE deck_history (id SERIAL PRIMARY KEY,player_id INTEGER REFERENCES players(id),shop_id VARCHAR(100),event_id VARCHAR(100),seq VARCHAR(100),event_date DATE,deck_name VARCHAR(100),created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`);
    for(const file of ['001_event_results.sql','002_event_deck_predictions.sql','003_deck_memos.sql','004_deck_memo_archives.sql']) await db.exec(migration(file));
    await db.exec(`INSERT INTO events(shop_id,event_id,seq,event_name,event_date) VALUES ('legacy','1','1','保存済み','2026-09-01');
      INSERT INTO decks(name) VALUES ('デッキA'),('デッキB');
      INSERT INTO deck_memo_archives(event_record_id,event_name,event_date,admin_key,source_url) VALUES (1,'保存済み','2026-09-01','legacy','https://nojigikucs.com/?admin=legacy');
      INSERT INTO deck_memo_archive_players(archive_id,dmp_id,handle_name,deck_id) VALUES (1,'000123','当時の名前',1);`);
    await db.exec(migration('005_tcg_meister_memos.sql'));
    await db.exec(migration('007_deck_images.sql'));
    for(const file of ['003_deck_memos.sql','004_deck_memo_archives.sql','005_tcg_meister_memos.sql']) await db.exec(migration(file));
    const old=(await db.query('SELECT * FROM deck_memo_archive_players WHERE archive_id=1')).rows[0];
    assert.equal(old.dmp_id,'000123');assert.equal(old.participant_key,'dmp:000123');assert.equal(old.handle_name,'当時の名前');
    const queries=[];
    const pool={query:(sql,args)=>{queries.push(sql);return args?db.query(sql,args):db.exec(sql).then(results=>results.at(-1));},
      connect:async()=>({query:pool.query,release(){}})};
    const routes=new Map();const app={get:(p,h)=>routes.set('GET '+p,h),post:(p,h)=>routes.set('POST '+p,h),put:(p,h)=>routes.set('PUT '+p,h),use(){},listen(){}};
    let empty=false,round=5,offline=false;
    const fetchImpl=async url=>{
      if(offline)throw Error('offline');
      if(url.includes('dmp-ranking.com'))throw Error('TCG memo must not fetch DMP players/results');
      if(url.includes('get-cs-info'))return new Response(JSON.stringify({csInfo:[{round:1,table:1,user1id:123,user1:'のじぎく選手 (0点)',user2id:0}]}));
      if(url.includes('get-users'))return new Response(JSON.stringify({users:[{id:123,name:'のじぎく選手'}]}));
      const u=new URL(url);
      if(u.pathname==='/loginnum.asp')return new Response(fixture('login'));
      if(u.pathname==='/login_bin.asp')return new Response(null,{status:302,headers:{Location:'/tour.asp?tid=5482242'}});
      if(u.pathname==='/tour.asp')return new Response(empty?'<form action="tour.asp"><input name="tid" value="5482242"></form>':fixture('tour').replaceAll('kno=5','kno='+round));
      return new Response(fixture(u.searchParams.get('Page')==='2'?'round-name-page2':'round-name-page1').replaceAll('kno=5','kno='+round));
    };
    const detail={shopId:'s',eventId:'e',held:'2',eventName:'TCG大会',eventDate:'2026-09-29',year:2026};
    installMemoRoutes(app,pool,fetchImpl,async()=>detail);
    installArchiveRoutes(app,pool);installImportRoutes(app,pool);
    async function call(method,url,body={},params={}) {
      const res={code:200,set(){},status(code){this.code=code;return this;},json(body){this.body=body;}};
      await routes.get(method+' '+url)({body,params},res);return res;
    }
    const url='https://tcg.sfc-jpn.jp/loginnum.asp?tid=5482242';
    const load=()=>call('POST','/api/deck-memo/matching',{url,detailUrl:'https://www.dmp-ranking.com/event.asp?ShopID=s&EventID=e&Seq=2'});
    let loaded=await load();assert.equal(loaded.code,200,JSON.stringify(loaded.body));
    const memoEventId=loaded.body.memoEventId;
    assert.equal(loaded.body.participants.length,4);
    assert.ok(loaded.body.participants.every(p=>p.dmpId==null&&p.playerId==null));
    assert.equal(loaded.body.dmpCandidates,undefined);
    assert.ok(!queries.some(sql=>/FROM players|JOIN players|INSERT INTO players|event_results|deck_memo_dmp_candidates/.test(sql)));
    const save=(key,deckId)=>call('PUT','/api/deck-memo',{url,memoEventId,participantKey:key,deckId});
    assert.equal((await save('id:42',1)).code,200);
    assert.equal((await save('id:10',2)).code,200);
    assert.equal((await save('id:17',1)).code,200);
    assert.equal((await save('id:11',null)).code,200);
    assert.equal((await call('PUT','/api/deck-memo/player-mapping',{url,memoEventId,participantKey:'id:42',dmpId:'056075'})).code,410);
    round=6;loaded=await load();assert.equal(loaded.code,200,JSON.stringify(loaded.body));
    assert.equal(loaded.body.memoEventId,memoEventId);assert.equal(loaded.body.latestRound,6);
    assert.equal(loaded.body.participants.find(p=>p.participantKey==='id:10').deckId,2);
    assert.ok(loaded.body.participants.every(p=>p.dmpId==null));
    const saved=await call('POST','/api/deck-memo/archives',{memoEventId});assert.equal(saved.code,200,JSON.stringify(saved.body));
    const archiveId=saved.body.archiveId;
    assert.equal((await call('POST','/api/deck-memo/archives',{memoEventId})).body.archiveId,archiveId);
    const read=()=>call('GET','/api/deck-memo/archives/:id',{}, {id:archiveId});
    let archived=(await read()).body;assert.equal(archived.participantCount,4);assert.equal(archived.registeredCount,3);
    assert.equal(archived.event.provider,'tcg_meister');assert.equal(archived.event.tid,'5482242');
    assert.ok(archived.participants.every(p=>p.dmpId===null&&p.playerId===null));
    const key={shopId:'s',eventId:'e',seq:'2'};
    const preview=(manualMappings=[])=>call('POST','/api/deck-memo/import-preview',{...key,manualMappings});
    const unpublished=(await preview()).body;assert.equal(unpublished.counts.new,0);assert.equal(unpublished.counts.unmatched,3);
    empty=true;loaded=await load();assert.equal(loaded.code,200);assert.equal(loaded.body.participantCount,0);
    offline=true;assert.equal((await load()).code,502);assert.equal((await read()).body.participantCount,4);
    offline=false;empty=false;
    const eventId=(await db.query("SELECT id FROM events WHERE shop_id='s' AND event_id='e' AND seq='2'")).rows[0].id;
    await db.exec(`INSERT INTO players(dmp_id,handle_name) VALUES ('056075','ガブロジー'),('090001','別名の選手'),('000111','あーる@'),('000222','あーる@'),('000333','A&B'),('999999','大会外');`);
    await db.query(`INSERT INTO event_results(event_record_id,player_id,rank) SELECT $1,id,8 FROM players WHERE dmp_id<>'999999'`,[eventId]);
    await db.exec(`INSERT INTO deck_history(player_id,shop_id,event_id,seq,event_date,deck_name)
      SELECT id,'s','e','2','2026-09-29','デッキA' FROM players WHERE dmp_id='090001';`);
    // Simulate mappings stored by the superseded version. Reading never uses them.
    await db.exec(`UPDATE deck_memo_external_players SET dmp_id='999999',player_id=(SELECT id FROM players WHERE dmp_id='999999'),match_status='manual' WHERE participant_key='id:42';
      UPDATE deck_memo_archive_players SET dmp_id='999999',player_id=(SELECT id FROM players WHERE dmp_id='999999') WHERE archive_id=${archiveId} AND participant_key='id:42';`);
    let p=(await preview()).body;assert.equal(p.counts.new,1);assert.equal(p.counts.unmatched,2);assert.equal(p.counts.unselected,1);
    assert.equal(p.players.find(p=>p.participantKey==='id:42').dmpId,'056075');
    assert.equal(p.players.find(p=>p.participantKey==='id:17').matchStatus,'ambiguous');
    assert.ok(!p.dmpCandidates.some(p=>p.dmpId==='999999'));
    const mappings=[{participantKey:'id:10',dmpId:'090001'},{participantKey:'id:17',dmpId:'000111'}];
    const manualPreview=await preview(mappings);assert.equal(manualPreview.code,200,JSON.stringify(manualPreview.body));p=manualPreview.body;
    assert.equal(p.counts.new,2);assert.equal(p.counts.conflict,1);assert.equal(p.players.find(p=>p.participantKey==='id:10').matchStatus,'manual');
    assert.equal((await preview([{participantKey:'id:10',dmpId:'999999'}])).code,409);
    assert.equal((await preview([{participantKey:'id:10',dmpId:'056075'}])).code,409);
    const apply=(p,overwriteDmpIds=[])=>call('POST','/api/deck-memo/import',{...key,archiveId,token:p.token,manualMappings:p.manualMappings,overwriteDmpIds});
    let applied=await apply(p);assert.equal(applied.code,200,JSON.stringify(applied.body));assert.equal(applied.body.insertedCount,2);assert.equal(applied.body.updatedCount,0);
    assert.equal((await apply((await preview(mappings)).body)).body.changes.length,0);
    applied=await apply((await preview(mappings)).body,['090001']);assert.equal(applied.body.updatedCount,1);
    assert.equal((await apply((await preview(mappings)).body)).body.changes.length,0);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM deck_history')).rows[0].n,3);
    assert.ok((await db.query('SELECT rank FROM event_results')).rows.every(p=>p.rank===8));
    // Refresh and re-save require no player queries, even after results exist; old draft mapping is ignored.
    queries.length=0;loaded=await load();assert.equal(loaded.code,200);
    assert.ok(loaded.body.participants.every(p=>p.dmpId==null));
    assert.ok(!queries.some(sql=>/FROM players|JOIN players|INSERT INTO players|event_results|deck_memo_dmp_candidates/.test(sql)));
    assert.equal((await call('POST','/api/deck-memo/archives',{memoEventId})).code,200);
    archived=(await read()).body;assert.ok(archived.participants.every(p=>p.dmpId===null));
    await db.exec("UPDATE decks SET name='正式名変更' WHERE id=1;");
    assert.equal((await read()).body.participants.find(p=>p.participantKey==='id:42').deckName,'正式名変更');
    // Same tid and internal IDs in a different DMP event remain separate.
    installMemoRoutes(app,pool,fetchImpl,async()=>({...detail,eventId:'other'}));
    const other=await load();assert.equal(other.code,200);assert.notEqual(other.body.memoEventId,memoEventId);
    assert.equal(other.body.participants.find(p=>p.participantKey==='id:10').deckId,null);
    // Drive the real merge endpoint, setup-db and noji routes from server.js with the isolated pool.
    const express=Object.assign(()=>app,{json(){},static(){}});
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../server.js'),'utf8'),{
      require(name){if(name==='express')return express;if(name==='pg')return {Pool:function(){return pool;}};return require(name);},
      __dirname:path.join(__dirname,'..'),process:{env:{}},console:{log(){},error:console.error},URL,TextDecoder,fetch:fetchImpl,AbortSignal
    });
    const merged=await call('POST','/api/decks/:id/merge',{targetDeckId:1},{id:'2'});
    assert.equal(merged.code,200,JSON.stringify(merged.body));
    assert.equal((await db.query("SELECT deck_id FROM deck_memo_external_players WHERE participant_key='id:10' AND deck_id IS NOT NULL")).rows[0].deck_id,1);
    assert.equal((await read()).body.participants.find(p=>p.participantKey==='id:10').deckId,1);
    assert.equal((await call('GET','/api/setup-db')).code,200);
    const noji=await call('POST','/api/deck-memo/matching',{url:'https://nojigikucs.com/?admin=hattics'});
    assert.equal(noji.code,200);assert.equal(noji.body.participants[0].name,'のじぎく選手');
    assert.equal((await call('PUT','/api/deck-memo',{url:'https://nojigikucs.com/?admin=hattics',memoEventId:noji.body.memoEventId,dmpId:'123',deckId:1})).code,200);
    // Linked noji snapshots still insert/update under the generalized archive primary key.
    installMemoRoutes(app,pool,fetchImpl,async()=>({...detail,eventId:'noji',eventName:'のじぎく大会'}));
    const linkedNoji=await call('POST','/api/deck-memo/matching',{url:'https://nojigikucs.com/?admin=hattics',detailUrl:'dmp'});
    assert.equal(linkedNoji.code,200);
    await call('PUT','/api/deck-memo',{url:'https://nojigikucs.com/?admin=hattics',memoEventId:linkedNoji.body.memoEventId,dmpId:'123',deckId:1});
    const nojiArchive=await call('POST','/api/deck-memo/archives',{memoEventId:linkedNoji.body.memoEventId});
    assert.equal(nojiArchive.code,200,JSON.stringify(nojiArchive.body));
    assert.equal((await call('POST','/api/deck-memo/archives',{memoEventId:linkedNoji.body.memoEventId})).body.archiveId,nojiArchive.body.archiveId);
    const nojiRead=await call('GET','/api/deck-memo/archives/:id',{}, {id:nojiArchive.body.archiveId});
    assert.equal(nojiRead.body.participants[0].dmpId,'123');assert.equal(nojiRead.body.participants[0].deckId,1);
    const reset=await call('POST','/api/deck-memo/archives/:id/reset',{confirmed:true,eventName:'TCG大会'},{id:archiveId});
    assert.equal(reset.code,200,JSON.stringify(reset.body));
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM deck_memo_external_players WHERE memo_event_id=' + memoEventId)).rows[0].n,0);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM deck_memo_dmp_candidates WHERE memo_event_id=' + memoEventId)).rows[0].n,0);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM deck_history')).rows[0].n,3);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM event_results')).rows[0].n,5);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM deck_memo_archives WHERE id=1')).rows[0].n,1);
  } finally {await db.close();}
});
