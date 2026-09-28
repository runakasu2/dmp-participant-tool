const {test}=require('node:test');
const assert=require('node:assert/strict');
const {installEventResetRoutes}=require('../event-reset');
function fixture(failAt=null) {
  const routes=new Map(),calls=[];let connects=0;
  const pool={connect:async()=>{connects++;return {release(){},query:async(sql,args)=>{
    calls.push({sql,args});if(failAt&&sql.includes(failAt))throw Error('private SQL detail');
    return {rows:sql.startsWith('SELECT id FROM events')||sql.startsWith('DELETE FROM events')?args[0].map(id=>({id})):[]};
  }};}};
  installEventResetRoutes({post:(url,handler)=>routes.set(url,handler)},pool);
  return {calls,get connects(){return connects;},async call(body){const res={code:200,status(n){this.code=n;return this;},json(b){this.body=b;}};await routes.get('/api/events/reset')({body},res);return res;}};
}
test('invalid/duplicate IDs and missing confirmation never connect',async()=>{
  for(const eventIds of [[],[1,1],[0],[-1],['1'],[1.2],[2147483648],Array(1001).fill(1),null]) {
    const f=fixture();assert.equal((await f.call({eventIds,confirmed:true})).code,400);assert.equal(f.connects,0);
  }
  const f=fixture();assert.equal((await f.call({eventIds:[1]})).code,400);assert.equal(f.connects,0);
});
test('bulk deletion uses event IDs and full history key, excludes global tables and commits',async()=>{
  const f=fixture(),res=await f.call({eventIds:[3,1],confirmed:true});assert.equal(res.code,200);assert.equal(res.body.deletedEventCount,2);
  assert.equal(f.calls.at(-1).sql,'COMMIT');
  const history=f.calls.find(c=>c.sql.startsWith('DELETE FROM deck_history'));
  assert.match(history.sql,/h.shop_id=e.shop_id AND h.event_id=e.event_id AND h.seq=e.seq/);
  assert.deepEqual(history.args,[[1,3]]);
  assert.ok(!f.calls.some(c=>/DELETE FROM (players|decks|deck_aliases)\b/.test(c.sql)));
  assert.ok(f.calls.filter(c=>c.sql.startsWith('DELETE')).every(c=>c.args[0].join(',')==='1,3'));
});
test('DB failure rolls back and never exposes database details',async()=>{
  const f=fixture('DELETE FROM event_results'),res=await f.call({eventIds:[1],confirmed:true});
  assert.equal(res.code,500);assert.equal(f.calls.at(-1).sql,'ROLLBACK');assert.doesNotMatch(JSON.stringify(res.body),/private SQL/);
  assert.ok(!f.calls.some(c=>c.sql==='COMMIT'||c.sql.startsWith('DELETE FROM events')));
});
