const {test}=require('node:test'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
test('deck formats: migration once, filtered catalog, create/edit validation, rename and merge preserve shared data',async()=>{
 const db=new PGlite();
 const pool={query:async(sql,args)=>args?db.query(sql,args):(await db.exec(sql)).at(-1),connect:async()=>({query:pool.query,release(){}})};
 const routes=new Map(),app={use(){},listen(){}};
 for(const method of ['get','post','put'])app[method]=(url,handler)=>routes.set(method+' '+url,handler);
 const express=Object.assign(()=>app,{json(){},static(){}});
 vm.runInNewContext(fs.readFileSync('server.js','utf8'),{require(n){if(n==='express')return express;if(n==='pg')return {Pool:function(){return pool;}};return require(n);},__dirname:path.resolve('.'),process:{env:{}},URL,TextDecoder,console:{log(){},error(){}},AbortSignal});
 async function call(method,url,body={},params={},query={},code=200){const res={code:200,status(n){this.code=n;return this;},json(body){this.body=body;}};await routes.get(method+' '+url)({body,params,query},res);assert.equal(res.code,code,JSON.stringify(res.body));return res.body;}
 const formats=async id=>(await db.query('SELECT format FROM deck_formats WHERE deck_id=$1 ORDER BY format',[id])).rows.map(r=>r.format);
 try{
  await call('get','/api/setup-db');
  // Simulate pre-migration masters; migration must initialize them exactly once.
  await db.exec("DROP TABLE deck_formats; INSERT INTO decks(name,image_url) VALUES ('A','https://example.com/a.png'),('B',NULL); INSERT INTO deck_aliases(deck_id,alias) VALUES(1,'aliasA'); INSERT INTO players(dmp_id,handle_name) VALUES ('1','P'); INSERT INTO deck_history(player_id,event_id,deck_name) VALUES (1,'e','A'),(1,'e','A'),(1,'e','aliasA'),(1,'e','B')");
  await db.exec(fs.readFileSync('migrations/010_deck_formats.sql','utf8'));
  assert.deepEqual(await formats(1),['original']);assert.deepEqual(await formats(2),['original']);
  await call('put','/api/decks/:id/formats',{formats:['advance','2block','2block']},{id:'1'});
  await call('get','/api/setup-db');
  assert.deepEqual(await formats(1),['2block','advance']);
  for(const bad of [[],['bad'],null,'original'])await call('put','/api/decks/:id/formats',{formats:bad},{id:'1'},{},400);
  await call('post','/api/decks',{name:'C',formats:['original','2block']});
  await call('post','/api/decks',{name:'Invalid',formats:[]},{},{},400);
  for(const [format,names] of [['original',['B','C']],['advance',['A']],['2block',['A','C']]]){
   const data=await call('get','/api/decks',{}, {},{format,sort:'usage'});assert.deepEqual(data.decks.map(d=>d.name),names);
  }
  const all=await call('get','/api/decks',{}, {},{sort:'usage'});assert.deepEqual(all.decks.map(d=>d.usage_count),[3,1,0]);
  await call('get','/api/decks',{}, {},{format:'invalid'},400);
  await call('put','/api/decks/:id',{name:'B'},{id:'1'},{},400);
  assert.equal((await db.query('SELECT name FROM decks WHERE id=1')).rows[0].name,'A');
  await db.exec(`CREATE FUNCTION fail_history_rename() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.deck_name='UnusedName' THEN RAISE EXCEPTION 'test conflict' USING ERRCODE='23505',TABLE='deck_history',CONSTRAINT='test_history_unique'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER test_rename_failure BEFORE UPDATE ON deck_history FOR EACH ROW EXECUTE FUNCTION fail_history_rename();`);
  const failed=await call('put','/api/decks/:id',{name:'UnusedName'},{id:'1'},{},500);
  assert.ok(!failed.error.includes('すでに登録'));
  assert.equal((await db.query('SELECT name FROM decks WHERE id=1')).rows[0].name,'A');
  assert.equal((await db.query("SELECT count(*)::int AS n FROM deck_history WHERE deck_name='A'")).rows[0].n,2);
  await db.exec('DROP TRIGGER test_rename_failure ON deck_history; DROP FUNCTION fail_history_rename();');
  await call('put','/api/decks/:id',{name:'Renamed'},{id:'1'});
  assert.deepEqual(await formats(1),['2block','advance']);
  await call('post','/api/decks/:id/merge',{targetDeckId:2},{id:'1'});
  assert.deepEqual(await formats(2),['2block','advance','original']);
  assert.equal((await db.query('SELECT image_url FROM decks WHERE id=2')).rows[0].image_url,'https://example.com/a.png');
  assert.equal((await db.query("SELECT deck_id FROM deck_aliases WHERE alias='aliasA'")).rows[0].deck_id,2);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM deck_history')).rows[0].n,4);
  const merged=await call('get','/api/decks',{}, {},{format:'advance',sort:'usage'});assert.equal(merged.decks[0].usage_count,4);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM decks')).rows[0].n,2);
 }finally{await db.close();}
});
