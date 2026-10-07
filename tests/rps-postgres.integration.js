// Optional isolated PostgreSQL engine check; never connects to Neon.
// NODE_PATH=/tmp/dmp-rps-validation/node_modules node --test tests/rps-postgres.integration.js
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {PGlite} = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '..');

test('RPS migration, APIs, alias history and existing data on PostgreSQL', async () => {
  const db = new PGlite();
  try {
    const pool = {query:(sql,args)=>args ? db.query(sql,args) : db.exec(sql).then(rows=>rows.at(-1)),
      connect:async()=>({query:pool.query, release(){}})};
    const routes = new Map();
    const app = {use(){},listen(){}};
    for(const method of ['get','post','put'])app[method]=(route,handler)=>routes.set(method+' '+route,handler);
    const express = Object.assign(()=>app,{json(){},static(){}});
    vm.runInNewContext(fs.readFileSync(path.join(root,'server.js'),'utf8'), {
      require(name){if(name==='express')return express;if(name==='pg')return {Pool:function(){return pool;}};return require(name);},
      __dirname:root, process:{env:{}}, console:{log(){},error(){}}, URL, URLSearchParams, TextDecoder
    });
    const call = async (method,route,{body={},query={},params={}}={}) => {
      const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;}};
      await routes.get(method+' '+route)({body,query,params},res);
      return res;
    };
    const setup = await call('get','/api/setup-db');
    assert.equal(setup.code,200,JSON.stringify(setup.body));
    await db.exec(`INSERT INTO players(dmp_id,handle_name) VALUES ('000123','同名'),('000456','同名'),('000789','ゼロ');
      INSERT INTO decks(name) VALUES ('正式A'),('正式B'),('正式C'),('別名衝突');
      INSERT INTO deck_aliases(deck_id,alias) VALUES (1,'旧A'),(1,'another A'),(1,'別名衝突'),(2,'old b');
      INSERT INTO events(shop_id,event_id,seq,event_date,event_name) VALUES ('s','e','1','2026-10-07','既存大会');
      INSERT INTO event_results(event_record_id,player_id,rank) VALUES (1,1,1);
      INSERT INTO deck_history(player_id,shop_id,event_id,seq,event_date,deck_name,created_at) VALUES
      (1,'s','e','1','2020-01-01','旧A','2020-01-01'),
      (1,'s','2','1','2026-10-06','正式B','2026-10-01'),
      (1,'s','3','1','2026-10-05','旧A','2026-10-01'),
      (1,'s','4','1','2026-10-04','OLD B','2026-10-01'),
      (1,'s','5','1','2026-10-03','正式C','2026-10-01'),
      (1,'s','6','1','2026-10-02','正式C','2026-10-01'),
      (1,'s','7','1',NULL,'別名衝突','2026-10-01');`);
    const snapshot = async () => {
      const result={};
      for(const table of ['players','deck_history','events','event_results','decks','deck_aliases','deck_memos'])result[table]=(await db.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
      return result;
    };
    const before = await snapshot();
    const migration = fs.readFileSync(path.join(root,'migrations/011_rock_paper_scissors.sql'),'utf8');
    await db.exec(migration); await db.exec(migration);
    const detail = await call('get','/api/player-detail',{query:{dmpId:'000123'}});
    assert.equal(detail.code,200,JSON.stringify(detail.body));
    assert.equal(detail.body.recentDecks.length,5);
    assert.equal(detail.body.recentDecks[0].eventDate,'2026-10-07','event date preferred over stale history date');
    assert.deepEqual(Array.from(detail.body.recentDecks,h=>h.deckName),['正式A','正式B','正式A','正式B','正式C']);
    assert.deepEqual(detail.body.topDecks.map(d=>[d.deckName,d.count]),[['正式A',2],['正式B',2],['正式C',2]]);
    assert.equal(detail.body.historyCount,7); assert.equal(detail.body.history[6].deckName,'別名衝突','official name wins alias collision');
    assert.equal(detail.body.rpsSummary.total,0);
    const save = body => call('post','/api/rps/records',{body});
    for(const hand of ['rock','scissors','paper','rock']) {
      const saved = await save({playerName:'同名',dmpId:'000123',hand});
      assert.equal(saved.code,201,JSON.stringify(saved.body));
    }
    const summary = (await call('get','/api/player-detail',{query:{dmpId:'000123'}})).body.rpsSummary;
    assert.equal(summary.total,4);
    assert.deepEqual(summary.hands.map(h=>[h.count,h.percentage]),[[2,50],[1,25],[1,25]]);
    assert.equal((await call('get','/api/player-detail',{query:{dmpId:'000456'}})).body.rpsSummary.total,0);
    const guest = await save({playerName:'同名',createGuest:true,hand:'rock'});
    const guestId = guest.body.player.guestId;
    const other = await save({playerName:'同名',createGuest:true,hand:'paper'});
    assert.notEqual(guestId,other.body.player.guestId);
    await save({playerName:'同名',guestId,hand:'scissors'});
    const guestDetail = await call('get','/api/rps/guests/:id',{params:{id:String(guestId)}});
    assert.equal(guestDetail.body.rpsSummary.total,2);
    assert.equal(guestDetail.body.player.dmpId,null);
    assert.equal(guestDetail.body.history.length,0);
    const search = await call('get','/api/player-search',{query:{q:'同名'}});
    assert.equal(search.body.players.length,2,'old search default unchanged');
    const withGuests = await call('get','/api/player-search',{query:{q:'同名',includeRpsGuests:'1'}});
    assert.equal(withGuests.body.players.length,4);
    for(const body of [{playerName:'',dmpId:'000123',hand:'rock'}, {playerName:'同名',dmpId:'000123',hand:''},
      {playerName:'同名',dmpId:'000123',hand:'other'}, {playerName:'同名',dmpId:'absent',hand:'rock'},
      {playerName:'同名',guestId:9999,hand:'rock'}]) assert.equal((await save(body)).code,400);
    assert.equal((await call('get','/api/rps/guests/:id',{params:{id:'9999'}})).code,404);
    assert.equal((await call('get','/api/rps/guests/:id',{params:{id:'bad'}})).code,400);
    for(const sql of [
      "INSERT INTO rock_paper_scissors_records(player_id,hand) VALUES (1,'bad')",
      "INSERT INTO rock_paper_scissors_records(player_id,hand) VALUES (1,NULL)",
      "INSERT INTO rock_paper_scissors_records(hand) VALUES ('rock')",
      `INSERT INTO rock_paper_scissors_records(player_id,guest_id,hand) VALUES (1,${guestId},'rock')`,
      "INSERT INTO rock_paper_scissors_records(player_id,hand) VALUES (9999,'rock')",
      "INSERT INTO rps_guests(handle_name) VALUES ('   ')"
    ]) await assert.rejects(db.exec(sql));
    await db.exec(migration);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM rock_paper_scissors_records')).rows[0].n,7);
    assert.deepEqual(await snapshot(),before,'all existing data unchanged');
    await db.exec('DELETE FROM players WHERE id=2');
    await db.exec(`DELETE FROM rps_guests WHERE id=${guestId}`);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM rock_paper_scissors_records WHERE guest_id=$1',[guestId])).rows[0].n,0);
    await db.exec("INSERT INTO rock_paper_scissors_records(player_id,hand) VALUES (3,'rock'); DELETE FROM players WHERE id=3");
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM rock_paper_scissors_records WHERE player_id=3')).rows[0].n,0);
  } finally { await db.close(); }
});
