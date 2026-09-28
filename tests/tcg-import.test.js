const {test}=require('node:test');
const assert=require('node:assert/strict');
const {buildImportPreview,installImportRoutes}=require('../deck-memo-import');
function fixture() {
  const candidates=[{dmp_id:'056075',player_id:1,handle_name:'ガブロジー',history_id:null},
    {dmp_id:'090001',player_id:2,handle_name:'新HN',history_id:20,current_deck_name:'A',canonical_deck_name:'A'},
    {dmp_id:'000111',player_id:3,handle_name:'同名',history_id:null},{dmp_id:'000222',player_id:4,handle_name:'同名',history_id:null}];
  const rows=['ガブロジー','旧HN','同名','未登録'].map((name,i)=>({archive_id:7,source:'tcg_meister',archive_updated_at:1,event_name:'大会',event_date:'2026-09-29',
    participant_key:'id:'+i,memo_name:name,dmp_id:'legacy-wrong-id',player_id:999,deck_id:i===3?null:1,memo_deck_name:i===3?null:'B'}));
  const calls=[];
  const db={query:async(sql,args)=>{calls.push({sql,args});if(sql.includes('a.id AS archive_id'))return {rows};if(sql.includes('r.rank'))return {rows:candidates};return {rows:[]};}};
  return {db,rows,candidates,calls};
}
const key={shopId:'s',eventId:'e',seq:'2'};
test('TCG preview alone matches HN to event results, ignores legacy mappings and exposes only result candidates',async()=>{
  const f=fixture(),p=await buildImportPreview(f.db,key);
  assert.equal(p.players[0].dmpId,'056075');assert.equal(p.players[0].playerId,1);assert.equal(p.players[0].matchStatus,'matched');
  assert.equal(p.players[1].dmpId,null);assert.equal(p.players[1].matchStatus,'unmatched');
  assert.equal(p.players[2].matchStatus,'ambiguous');assert.equal(p.players[2].dmpId,null);
  assert.equal(p.players[3].category,'unselected');assert.equal(f.calls.length,2);
  assert.match(f.calls[1].sql,/JOIN event_results r ON r.event_record_id=e.id/);
  assert.deepEqual(f.calls[1].args,['s','e','2']);
  assert.equal(p.dmpCandidates.length,4);assert.ok(!f.calls.some(c=>/INSERT|UPDATE|DELETE/.test(c.sql)));
});
test('manual choices create preview conflicts and are checked again by token on apply',async()=>{
  const f=fixture(),choices=[{participantKey:'id:1',dmpId:'090001'},{participantKey:'id:2',dmpId:'000111'}];
  const p=await buildImportPreview(f.db,key,choices);
  assert.equal(p.players[1].category,'conflict');assert.equal(p.players[1].matchStatus,'manual');assert.equal(p.players[1].playerId,2);
  assert.equal(p.players[2].category,'new');assert.equal(p.players[2].playerId,3);
  assert.equal(p.players[0].canMap,false);assert.equal(p.players[1].canMap,true);
  const changed=await buildImportPreview(f.db,key,[{participantKey:'id:1',dmpId:'000111'}]);assert.notEqual(changed.token,p.token);
  const routes=new Map();installImportRoutes({post:(url,fn)=>routes.set(url,fn)},{connect:async()=>({...f.db,release(){}})});
  const res={status(n){this.code=n;return this;},json(b){this.body=b;}};
  await routes.get('/api/deck-memo/import')({body:{...key,archiveId:7,token:p.token,manualMappings:[],overwriteDmpIds:[]}},res);
  assert.equal(res.code,409);assert.ok(!f.calls.some(c=>/INSERT INTO deck_history|UPDATE deck_history/.test(c.sql)));
});
test('manual mapping rejects outsiders, unknown memo keys, duplicate choices and targets already assigned automatically',async()=>{
  for(const choices of [
    [{participantKey:'id:1',dmpId:'42'}], [{participantKey:'nope',dmpId:'090001'}],
    [{participantKey:'id:1',dmpId:'056075'}],
    [{participantKey:'id:1',dmpId:'090001'},{participantKey:'id:2',dmpId:'090001'}],
    [{participantKey:'id:1',dmpId:'090001'},{participantKey:'id:1',dmpId:'000111'}]
  ]) await assert.rejects(buildImportPreview(fixture().db,key,choices));
});
test('no published results means unmatched preview; memo persistence does not require results',async()=>{
  const f=fixture();f.candidates.length=0;
  const p=await buildImportPreview(f.db,key);assert.equal(p.counts.new,0);assert.equal(p.counts.unmatched,3);
  assert.equal(p.counts.unselected,1);assert.deepEqual(p.dmpCandidates,[]);
});
