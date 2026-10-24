// Reproducible synthetic data in PGlite. No Neon or external HTTP access.
const {performance}=require('node:perf_hooks'),fs=require('node:fs');
if(process.argv.includes('--baseline')){
 const Module=require('node:module'),path=require('node:path'),{execFileSync}=require('node:child_process');
 for(const file of ['event-deck-summary.js','event-catalog.js','deck-trends.js','winrate-analysis.js']){
  const filename=path.resolve(__dirname,'../..',file),mod=new Module(filename,module);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));require.cache[filename]=mod;mod._compile(execFileSync('git',['show','HEAD:'+file],{encoding:'utf8',cwd:path.dirname(filename)}),filename);
 }
}
const {fixture}=require('../matching-archives-postgres.integration');
const {filteredEventCatalog}=require('../../event-catalog'),{getDeckTrends}=require('../../deck-trends');
const {request}=require('../winrate-postgres.integration');
(async()=>{const f=await fixture();try{
 await f.db.exec(`INSERT INTO decks(name) SELECT 'Deck '||i FROM generate_series(3,50) i;
 INSERT INTO deck_aliases(deck_id,alias) SELECT id,'alias '||id FROM decks;
 INSERT INTO players(dmp_id,handle_name) SELECT (1000+i)::text,'Player '||i FROM generate_series(1,128) i;
 INSERT INTO events(shop_id,event_id,seq,event_name,event_date,format,participant_count) SELECT 'bench',i::text,'1','Event '||i,'2026-09-01'::date+(i%30),'original',64 FROM generate_series(1,120) i;
 INSERT INTO deck_history(player_id,shop_id,event_id,seq,event_date,deck_name) SELECT p.id,'bench',e.event_id,'1',e.event_date,CASE WHEN p.id%2=0 THEN 'alias '||((p.id%50)+1) ELSE d.name END FROM events e CROSS JOIN players p JOIN decks d ON d.id=(p.id%50)+1 WHERE p.id<=64;
 INSERT INTO event_results(event_record_id,player_id,rank) SELECT e.id,p.id,p.id FROM events e CROSS JOIN players p WHERE p.id<=4;
 INSERT INTO matching_archives(event_record_id,provider,source_key,source_url) SELECT id,'nojigiku',event_id,'fixture' FROM events;
 INSERT INTO deck_memo_events(source,admin_key,source_url,event_record_id) SELECT provider,source_key,source_url,event_record_id FROM matching_archives;
 INSERT INTO deck_memos(memo_event_id,dmp_id,deck_id) SELECT e.id,p.dmp_id,(p.id%50)+1 FROM deck_memo_events e CROSS JOIN players p WHERE p.id<=64;
 INSERT INTO matching_archive_matches(archive_id,round,match_key,table_no,sides,outcome,winner_key)
 SELECT a.id,r,'match-'||p.id,p.id,jsonb_build_array(jsonb_build_object('participantKey','dmp:'||p.dmp_id,'dmpId',p.dmp_id,'name',p.handle_name),jsonb_build_object('participantKey','dmp:'||q.dmp_id,'dmpId',q.dmp_id,'name',q.handle_name)),'win_loss','dmp:'||p.dmp_id FROM matching_archives a CROSS JOIN generate_series(1,4) r JOIN players p ON p.id<=64 AND p.id%2=1 JOIN players q ON q.id=p.id+1;
 UPDATE events SET created_at='2026-01-01',updated_at='2026-01-01';
 ANALYZE;`);
 if(process.argv.includes('--indexes'))await f.db.exec(fs.readFileSync(require('node:path').resolve(__dirname,'../../migrations/015_performance_indexes.sql'),'utf8').replace(/\bCONCURRENTLY\b/g,''));
 let queries=0;const query=f.pool.query;f.pool.query=async(...args)=>{queries++;return query(...args);};
 const vm=require('node:vm'),path=require('node:path');
 const app={use(){},listen(){},get(){},post(){},put(){}};
 const context={require(name){if(name==='express')return Object.assign(()=>app,{json(){},static(){}});if(name==='pg')return {Pool:function(){return f.pool;}};return require(name);},__dirname:path.resolve(__dirname,'../..'),process:{env:{}},console:{log(){},error(){}},URL,TextDecoder,AbortSignal};
 const serverFile=path.resolve(context.__dirname,'server.js');
 const serverCode=process.argv.includes('--baseline')?require('node:child_process').execFileSync('git',['show','HEAD:server.js'],{encoding:'utf8',cwd:context.__dirname}):fs.readFileSync(serverFile,'utf8');
 vm.runInNewContext(serverCode,context);
 const resultPlayers=Array.from({length:128},(_,i)=>({id:String(10001+i),name:'Saved '+i,rank:i+1}));
 const tasks={catalog:async()=>{const q=filteredEventCatalog({format:'original',startDate:'2026-09-25'});return (await f.pool.query(q.sql,q.params)).rows;},trends:()=>getDeckTrends(f.pool,{format:'original'}),winrate:async()=>{const r=await request(f,'/api/winrate/summary',{});if(r.code!==200)throw Error(JSON.stringify(r.body));const {revision,...rest}=r.body;return rest;},playerSearch:async()=>{const r=await request(f,'/api/player-search',{q:'Player 12'});if(r.code!==200)throw Error(JSON.stringify(r.body));return r.body;},saveResults:async()=>{await context.saveEventResults({shopId:'save',eventId:'one',held:'1',eventDate:'2026-09-01',eventName:'Save'},resultPlayers);return resultPlayers.length;}};
 const report={dataset:{events:120,history:7680,matches:15360},metrics:{},checks:{}};
 for(const [name,task]of Object.entries(tasks)){await task();const times=[],counts=[];let data;for(let i=0;i<5;i++){queries=0;const start=performance.now();data=await task();times.push(performance.now()-start);counts.push(queries);}times.sort((a,b)=>a-b);report.metrics[name]={medianMs:Number(times[2].toFixed(2)),queries:counts[0]};report.checks[name]=require('node:crypto').createHash('sha256').update(JSON.stringify(data)).digest('hex');}
 const out=process.argv.slice(2).find(arg=>!arg.startsWith('--'));if(out)fs.writeFileSync(out,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }finally{await f.db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
