const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const {fixture}=require('./matching-archives-postgres.integration');
test('bulk official results use constant round trips, preserve absent ranks and rollback entire failed update; additive index repeats safely',async()=>{
 const f=await fixture();try{
 const migration=fs.readFileSync('migrations/015_performance_indexes.sql','utf8');assert.match(migration,/CREATE INDEX CONCURRENTLY IF NOT EXISTS/);
 // PGlite does not model production concurrent-index locking.
 await f.db.exec(migration.replace(/\bCONCURRENTLY\b/g,''));await f.db.exec(migration.replace(/\bCONCURRENTLY\b/g,''));
 let statements=0,fail=false;const pool={...f.pool,connect:async()=>({query:async(sql,args)=>{statements++;if(fail&&sql.includes('INSERT INTO event_results'))throw Error('injected');return f.pool.query(sql,args);},release(){}})};
 const app={use(){},listen(){},get(){},post(){},put(){}};
 const c={require(n){if(n==='express')return Object.assign(()=>app,{json(){},static(){}});if(n==='pg')return {Pool:function(){return pool;}};return require(n);},__dirname:path.resolve(__dirname,'..'),process:{env:{}},console:{log(){},error(){}},URL,TextDecoder,AbortSignal};vm.runInNewContext(fs.readFileSync('server.js','utf8'),c);
 const event={shopId:'bulk',eventId:'one',held:'2',eventName:'Original',eventDate:'2026-10-24'},players=Array.from({length:128},(_,i)=>({id:String(10000+i),name:'　Name '+i,rank:i===127?'不明':i+1}));
 await c.saveEventResults(event,players);assert.equal(statements,5);assert.equal((await f.db.query('SELECT COUNT(*)::int n FROM event_results')).rows[0].n,128);
 const id=(await f.db.query("SELECT id FROM events WHERE shop_id='bulk'")).rows[0].id;
 const last=await f.db.query('SELECT rank,rank_raw FROM event_results WHERE event_record_id=$1 ORDER BY id DESC LIMIT 1',[id]);assert.deepEqual(last.rows[0],{rank:null,rank_raw:'不明'});
 await c.saveEventResults(event,[{...players[0],rank:9}]);assert.equal((await f.db.query('SELECT COUNT(*)::int n FROM event_results')).rows[0].n,128);
 const before=JSON.stringify((await f.db.query('SELECT * FROM event_results ORDER BY id')).rows);fail=true;
 await assert.rejects(()=>c.saveEventResults({...event,eventName:'Bad'},[{...players[0],name:'Bad',rank:1}]));assert.equal(JSON.stringify((await f.db.query('SELECT * FROM event_results ORDER BY id')).rows),before);
 assert.equal((await f.db.query('SELECT event_name FROM events WHERE id=$1',[id])).rows[0].event_name,'Original');assert.equal((await f.db.query('SELECT handle_name FROM players WHERE dmp_id=$1',[players[0].id])).rows[0].handle_name,players[0].name.trim());
 }finally{await f.db.close();}
});
