// NODE_PATH=/tmp/dmp-tcg-validation/node_modules node --test tests/event-reset-postgres.integration.js
const {test}=require('node:test'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
test('PostgreSQL reset isolates full event keys/providers, keeps masters, and rolls back partial deletes',async()=>{
  const db=new PGlite();let failDeletes=false;
  const pool={query:async(sql,args)=>{
    if(failDeletes&&sql.startsWith('DELETE FROM event_results'))throw Error('injected failure after memo deletes');
    return args?db.query(sql,args):(await db.exec(sql)).at(-1);
  },connect:async()=>({query:pool.query,release(){}})};
  const routes=new Map(),app={use(){},listen(){}};
  for(const method of ['get','post','put'])app[method]=(url,handler)=>routes.set(method+' '+url,handler);
  const express=Object.assign(()=>app,{json(){},static(){}});
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../server.js'),'utf8'),{
    require(name){if(name==='express')return express;if(name==='pg')return{Pool:function(){return pool;}};return require(name);},
    __dirname:path.join(__dirname,'..'),process:{env:{}},URL,TextDecoder,console:{log(){},error(){}},AbortSignal
  });
  async function call(method,url,body){const res={code:200,status(n){this.code=n;return this;},json(b){this.body=b;}};await routes.get(method+' '+url)({body},res);return res;}
  const tables=['events','event_results','deck_history','event_deck_predictions','deck_memo_events','deck_memos','deck_memo_roster','deck_memo_external_players','deck_memo_dmp_candidates','deck_memo_archives','deck_memo_archive_players','players','decks','deck_aliases'];
  const snapshot=async()=>Object.fromEntries(await Promise.all(tables.map(async t=>[t,(await db.query('SELECT * FROM '+t+' ORDER BY 1,2')).rows])));
  try {
    assert.equal((await call('get','/api/setup-db')).code,200);
    await db.exec(`INSERT INTO players(dmp_id,handle_name) VALUES ('056075','共通プレイヤー');
      INSERT INTO decks(name,image_url) VALUES ('共通デッキ','https://example.com/global.png'); INSERT INTO deck_aliases(deck_id,alias) VALUES (1,'別名');
      INSERT INTO events(shop_id,event_id,seq,event_name,event_date) VALUES ('s1','same','1','A','2026-09-29'),('s2','same','1','B','2026-09-29'),('s1','same','2','C','2026-09-29'),('s3','other','1','D','2026-09-29');
      INSERT INTO event_results(event_record_id,player_id,rank) SELECT id,1,8 FROM events;
      INSERT INTO event_deck_predictions(event_record_id,player_id,manual_deck_id) SELECT id,1,1 FROM events;
      INSERT INTO deck_history(player_id,shop_id,event_id,seq,deck_name) SELECT 1,shop_id,event_id,seq,'共通デッキ' FROM events;
      INSERT INTO deck_memo_events(source,admin_key,source_url,event_record_id) SELECT 'nojigiku','shared-admin','https://nojigikucs.com/?admin=shared-admin',id FROM events;
      INSERT INTO deck_memo_events(source,admin_key,source_url,event_record_id) SELECT 'tcg_meister','5482242','https://tcg.sfc-jpn.jp/loginnum.asp?tid=5482242',id FROM events;
      INSERT INTO deck_memo_events(source,admin_key,source_url) VALUES ('nojigiku','shared-admin','https://nojigikucs.com/?admin=shared-admin');
      INSERT INTO deck_memos(memo_event_id,dmp_id,player_id,deck_id) SELECT id,'056075',1,1 FROM deck_memo_events;
      INSERT INTO deck_memo_roster(memo_event_id,dmp_id,handle_name) SELECT id,'056075','共通プレイヤー' FROM deck_memo_events;
      INSERT INTO deck_memo_external_players(memo_event_id,participant_key,handle_name,match_status,deck_id) SELECT id,'id:42','TCG名前','unmatched',1 FROM deck_memo_events;
      INSERT INTO deck_memo_dmp_candidates(memo_event_id,dmp_id,player_id,handle_name) SELECT id,'056075',1,'旧候補' FROM deck_memo_events;
      INSERT INTO deck_memo_archives(event_record_id,event_name,event_date,admin_key,source_url,source) SELECT id,event_name,event_date,'5482242','https://tcg.sfc-jpn.jp/loginnum.asp?tid=5482242','tcg_meister' FROM events;
      INSERT INTO deck_memo_archive_players(archive_id,participant_key,handle_name,deck_id) SELECT id,'id:42','保存時の名前',1 FROM deck_memo_archives;`);
    const original=await snapshot();
    const reset=eventIds=>call('post','/api/events/reset',{eventIds,confirmed:true});
    assert.equal((await reset([1,9999])).code,409);assert.deepEqual(await snapshot(),original);
    assert.equal((await reset([1,1])).code,400);assert.deepEqual(await snapshot(),original);
    failDeletes=true;assert.equal((await reset([1])).code,500);failDeletes=false;
    assert.deepEqual(await snapshot(),original); // Actual PostgreSQL rollback, after six child-table deletes.
    const single=await reset([1]);assert.equal(single.code,200);assert.equal(single.body.deletedEventCount,1);
    async function checkRemaining(eventIds) {
      const current=await snapshot(),set=new Set(eventIds);
      assert.deepEqual(current.events,original.events.filter(e=>set.has(e.id)));
      for(const t of ['event_results','event_deck_predictions','deck_memo_events','deck_memo_archives'])assert.deepEqual(current[t],original[t].filter(p=>p.event_record_id===null||set.has(p.event_record_id)),t);
      const memoIds=new Set(current.deck_memo_events.map(p=>p.id)),archiveIds=new Set(current.deck_memo_archives.map(p=>p.id));
      for(const t of ['deck_memos','deck_memo_roster','deck_memo_external_players','deck_memo_dmp_candidates'])assert.deepEqual(current[t],original[t].filter(p=>memoIds.has(p.memo_event_id)),t);
      assert.deepEqual(current.deck_memo_archive_players,original.deck_memo_archive_players.filter(p=>archiveIds.has(p.archive_id)));
      assert.deepEqual(current.deck_history,original.deck_history.filter(h=>current.events.some(e=>e.shop_id===h.shop_id&&e.event_id===h.event_id&&e.seq===h.seq)));
      for(const t of ['players','decks','deck_aliases'])assert.deepEqual(current[t],original[t],t);
      const list=await call('get','/api/events');assert.equal(list.body.count,eventIds.length);
    }
    await checkRemaining([2,3,4]);
    const multiple=await reset([4,2]);assert.equal(multiple.body.deletedEventCount,2);await checkRemaining([3]);
  } finally {await db.close();}
});
