const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture}=require('./matching-archives-postgres.integration');
async function call(f,method,route,{body={},query={},params={}}={}){const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;}};await f.routes.get(method+' '+route)({body,query,params},res);return res;}
test('RPS ordered ties: safe migration, legacy compatibility, final transitions, edit isolation and rollback',async()=>{
 const f=await fixture();try{const {db}=f;
 await db.exec("INSERT INTO rock_paper_scissors_records(player_id,hand) VALUES(1,'rock');");const original=(await db.query('SELECT * FROM rock_paper_scissors_records')).rows;
 const migration=fs.readFileSync(path.join(__dirname,'../migrations/014_rps_ties.sql'),'utf8');await db.exec(migration);await db.exec(migration);assert.deepEqual((await db.query('SELECT * FROM rock_paper_scissors_records')).rows,original);
 const protectedTables=['players','events','event_results','deck_history','deck_memos'];const snapshot=()=>Promise.all(protectedTables.map(t=>db.query('SELECT * FROM '+t+' ORDER BY 1').then(r=>r.rows)));const before=await snapshot();
 const input={playerName:'同名',dmpId:'000123',hand:'scissors'};const save=body=>call(f,'POST','/api/rps/records',{body:{...input,...body}});
 assert.equal((await save({})).code,201);
 const rows=[{hand:'paper',ties:['rock']},{hand:'scissors',ties:['rock','paper']},{hand:'rock',ties:['paper','scissors','paper']},{hand:'scissors',ties:['rock','paper','scissors','rock','paper']}];let ids=[];
 for(const row of rows){const saved=await save(row);assert.equal(saved.code,201,JSON.stringify(saved.body));assert.deepEqual(saved.body.record.ties,row.ties);ids.push(saved.body.record.id);}
 const detail=()=>call(f,'GET','/api/player-detail',{query:{dmpId:'000123'}});let result=(await detail()).body;
 assert.equal(result.rpsSummary.total,6);const stages=result.rpsTiePredictions.stages;assert.deepEqual(stages.map(s=>s.samples),[4,3,2]);assert.deepEqual(stages[0].hands.map(h=>h.count),[0,1,3]);assert.deepEqual(stages[1].hands.map(h=>h.count),[0,2,1]);assert.deepEqual(stages[2].hands.map(h=>h.count),[2,0,0]);assert.equal(stages[0].hands[2].percentage,75);
 const list=await call(f,'GET','/api/rps/records',{query:{dmpId:'000123'}});assert.equal(list.code,200);assert.equal(list.body.total,6);assert.deepEqual(list.body.records.find(r=>r.id===ids[3]).ties,rows[3].ties);
 const edit=body=>call(f,'PUT','/api/rps/records/:id',{params:{id:String(ids[1])},body:{...input,...body}});
 assert.equal((await edit({ties:['paper','rock','scissors'],hand:'paper'})).code,200);assert.deepEqual((await db.query('SELECT hand FROM rps_record_ties WHERE record_id=$1 ORDER BY position',[ids[1]])).rows.map(r=>r.hand),['paper','rock','scissors']);
 assert.equal((await edit({hand:'rock'})).code,200);assert.equal((await db.query('SELECT count(*)::int n FROM rps_record_ties WHERE record_id=$1',[ids[1]])).rows[0].n,3,'legacy edits preserve omitted ties');
 assert.equal((await edit({ties:[]})).code,200);assert.equal((await db.query('SELECT count(*)::int n FROM rps_record_ties WHERE record_id=$1',[ids[1]])).rows[0].n,0);
 assert.equal((await edit({dmpId:'456',ties:['rock']})).code,404);assert.equal((await edit({ties:['bad']})).code,400);
 assert.deepEqual((await db.query('SELECT * FROM rock_paper_scissors_records WHERE id=1')).rows,original);
 // Insert failure after updating hand/clearing ties rolls back the whole edit.
 const state=(await db.query('SELECT * FROM rock_paper_scissors_records WHERE id=$1',[ids[1]])).rows,query=f.pool.query;
 f.pool.query=(sql,args)=>sql.startsWith('INSERT INTO rps_record_ties')?Promise.reject(Error('private details')):query(sql,args);assert.equal((await edit({hand:'paper',ties:['rock']})).code,500);f.pool.query=query;assert.deepEqual((await db.query('SELECT * FROM rock_paper_scissors_records WHERE id=$1',[ids[1]])).rows,state);
 const guest=await call(f,'POST','/api/rps/records',{body:{playerName:'同名',createGuest:true,hand:'rock',ties:['paper']}});assert.equal(guest.code,201);const guestId=guest.body.player.guestId;
 const guestDetail=await call(f,'GET','/api/rps/guests/:id',{params:{id:String(guestId)}});assert.equal(guestDetail.body.rpsTiePredictions.stages[0].samples,1);assert.equal(guestDetail.body.rpsTiePredictions.stages[0].predictedHands[0],'rock');assert.equal(guestDetail.body.rpsTiePredictions.stages[1].samples,0);
 assert.equal((await call(f,'GET','/api/rps/records',{query:{guestId:String(guestId)}})).body.records.length,1);
 assert.equal((await call(f,'GET','/api/rps/records',{query:{dmpId:'000123',guestId:String(guestId)}})).code,400);
 assert.deepEqual(await snapshot(),before);
 for(const sql of ["INSERT INTO rps_record_ties VALUES(1,0,'rock')","INSERT INTO rps_record_ties VALUES(1,1,'bad')","INSERT INTO rps_record_ties VALUES(99999,1,'rock')"])await assert.rejects(db.exec(sql));
 }finally{await f.db.close();}
});
