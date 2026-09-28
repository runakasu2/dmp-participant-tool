const {test}=require('node:test');
const assert=require('node:assert/strict');
const {installArchiveRoutes}=require('../deck-memo-archives');
function fixture(failAt) {
  let handler; const calls=[];
  installArchiveRoutes({get(){},post(path,fn){if(path.endsWith('/reset'))handler=fn;}}, {
    connect:async()=>({release(){},query:async(sql,args)=>{
      calls.push({sql,args}); if(calls.length===failAt)throw Error('failure');
      if(sql.includes('FROM deck_memo_archives WHERE'))return{rows:[{id:7,event_record_id:12,event_name:'大会A'}]};
      if(sql.startsWith('SELECT id FROM deck_memo_events'))return{rows:[{id:3},{id:4}]};
      return{rows:[]};
    }})
  });
  return {calls,async request(body){const res={code:200,status(n){this.code=n;return this;},json(b){this.body=b;}};await handler({params:{id:'7'},body},res);return res;}};
}
test('reset requires confirmation and matching name, and deletes only selected event memo tables',async()=>{
  const f=fixture();assert.equal((await f.request({})).code,400);assert.equal(f.calls.length,0);
  assert.equal((await f.request({confirmed:true,eventName:'別大会'})).code,409);
  assert.equal(f.calls.at(-1).sql,'ROLLBACK');
  const g=fixture();assert.equal((await g.request({confirmed:true,eventName:'大会A'})).code,200);
  assert.deepEqual(g.calls[2].args,[12]);
  const deletes=g.calls.filter(c=>c.sql.startsWith('DELETE'));
  assert.equal(deletes.length,5);
  assert.deepEqual(deletes.map(c=>c.args),[[7],[7],[[3,4]],[[3,4]],[[3,4]]]);
  assert.ok(deletes.every(c=>/DELETE FROM deck_memo/.test(c.sql)));
  assert.equal(g.calls.at(-1).sql,'COMMIT');
});
test('mid-reset failure rolls back instead of committing partial deletion',async()=>{
  const f=fixture(6);assert.equal((await f.request({confirmed:true,eventName:'大会A'})).code,500);
  assert.equal(f.calls.at(-1).sql,'ROLLBACK');assert.ok(!f.calls.some(c=>c.sql==='COMMIT'));
});
