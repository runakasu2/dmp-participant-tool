const {test} = require('node:test');
const assert = require('node:assert/strict');
const {parseMemoUrl, fetchSource, latestMatching, installMemoRoutes} = require('../deck-memo');

const match = (round=1, table=1, user1id=101, user2id=102) => ({round, table, user1id, user2id,
  user1:'名前 (仮) (0点)',user2:'相手 (12点)',user1no:33,user2no:20});

test('URL supports arbitrary admin keys and canonicalizes the source URL',()=>{
  for(const admin of ['karatachics','hattics','another_CS-2026']) {
    const parsed=parseMemoUrl('https://nojigikucs.com/?admin='+admin+'&unused=1');
    assert.equal(parsed.adminKey,admin);
    assert.equal(parsed.sourceUrl,'https://nojigikucs.com/?admin='+admin);
  }
});

test('rejects missing, empty, duplicate, malformed admin and non-HTTPS or foreign hosts',()=>{
  for(const url of ['https://nojigikucs.com/','https://nojigikucs.com/?admin=',
    'https://nojigikucs.com/?admin=a&admin=b','https://nojigikucs.com/?admin=../x',
    'http://nojigikucs.com/?admin=a','https://evil.test/?admin=a',
    'https://nojigikucs.com.evil.test/?admin=a','https://user@nojigikucs.com/?admin=a',
    'https://nojigikucs.com:8443/?admin=a','garbage']) assert.throws(()=>parseMemoUrl(url));
});

test('unpublished, round 1, latest round, table order, user order, ID/name matching and fallback',()=>{
  assert.deepEqual(latestMatching([]),{latestRound:null,participants:[]});
  assert.equal(latestMatching([match()]).latestRound,1);
  const result=latestMatching([match(2,2,103,104),match(1,1),match('2','1')],[{id:101,name:'正式な名前'}]);
  assert.equal(result.latestRound,2);
  assert.deepEqual(result.participants.map(p=>p.dmpId),['101','102','103','104']);
  assert.deepEqual(result.participants.map(p=>p.table),[1,1,2,2]);
  assert.equal(result.participants[0].name,'正式な名前');
  assert.equal(result.participants[2].name,'名前 (仮)');
  assert.equal(result.participants[1].entryNo,20);
  assert.equal(latestMatching([match(1,1,101,0)]).participants.length,1);
  assert.throws(()=>latestMatching([match(),match(1,2)]));
});

test('fixed external host, selected admin on both endpoints, timeout signal and no redirects/cache',async()=>{
  for(const endpoint of ['get-cs-info','get-users']) {
    await fetchSource(endpoint,'other-admin',async(url,options)=>{
      const parsed=new URL(url);
      assert.equal(parsed.hostname,'axirq5jhn9.execute-api.ap-northeast-1.amazonaws.com');
      assert.equal(parsed.searchParams.get('admin'),'other-admin');
      assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');assert.ok(options.signal);
      if(endpoint==='get-users') assert.equal(parsed.searchParams.get('detail'),'true');
      return {ok:true,json:async()=>JSON.stringify(endpoint==='get-users'?{users:[]}:{csInfo:[]})};
    });
  }
});

for(const [label,fetcher,code] of [
  ['HTTP',async()=>({ok:false,status:503}),502],
  ['JSON',async()=>({ok:true,json:async()=>{throw Error('invalid');}}),502],
  ['shape',async()=>({ok:true,json:async()=>({bad:[]})}),502],
  ['timeout',async()=>{throw Object.assign(Error(),{name:'TimeoutError'});},504],
  ['network',async()=>{throw Error('DNS');},502]
]) test('source '+label+' error is sanitized',async()=>{
  await assert.rejects(fetchSource('get-cs-info','a',fetcher),e=>e.status===code && !e.message.includes('DNS'));
});

// Persistent in-memory query double: verifies route wiring and identity boundaries,
// not PostgreSQL constraint/transaction implementation.
function harness() {
  const events=new Map(), memos=new Map(), decks=new Map([[1,'A'],[2,'B']]);
  const routes=new Map(), calls=[];
  let round=1, usersFail=false, writeFail=false, released=false;
  async function query(sql,args=[]) {
    calls.push(sql);
    if(sql.includes('INSERT INTO deck_memo_events')) {
      if(!events.has(args[0])) events.set(args[0],events.size+1);
      return {rows:[{id:events.get(args[0])}]};
    }
    if(sql.includes('SELECT id FROM deck_memo_events')) return {rows:events.has(args[0])?[{id:events.get(args[0])}]:[]};
    if(sql.includes('SELECT id, name FROM decks')) return {rows:decks.has(args[0])?[{id:args[0],name:decks.get(args[0])}]:[]};
    if(sql.includes('INSERT INTO deck_memos')) {
      if(writeFail) throw Error('write failed');
      assert.match(sql,/SELECT id FROM players WHERE dmp_id = \$2::varchar\(50\)/);
      assert.match(sql,/VALUES \(\$1::integer, \$2::varchar\(50\)/);
      memos.set(args[0]+':'+args[1],args[2]);return {rows:[]};
    }
    if(sql.includes('DELETE FROM deck_memos')) {memos.delete(args[0]+':'+args[1]);return {rows:[]};}
    if(sql.includes('FROM deck_memos m')) return {rows:Array.from(memos).filter(([k])=>k.startsWith(args[0]+':')).map(([k,id])=>({dmp_id:k.split(':')[1],deck_id:id,deck_name:decks.get(id)}))};
    return {rows:[]};
  }
  const pool={query,connect:async()=>({query,release(){released=true;}})};
  const app={post:(p,h)=>routes.set('POST '+p,h),put:(p,h)=>routes.set('PUT '+p,h)};
  installMemoRoutes(app,pool,async url=>{
    if(url.includes('get-users')&&usersFail) throw Error('offline');
    return {ok:true,json:async()=>url.includes('get-users')?{users:[{id:101,name:'正式名'}]}:{csInfo:round===0?[]:[match(1),...(round>1?[match(round,3)]:[])]}};
  });
  async function request(method,path,body) {
    const res={code:200,status(code){this.code=code;return this;},set(){},json(body){this.body=body;}};
    await routes.get(method+' '+path)({body},res);return res;
  }
  return {calls,decks,memos,get released(){return released;},setRound(n){round=n;},setUsersFail(){usersFail=true;},setWriteFail(){writeFail=true;},
    load:admin=>request('POST','/api/deck-memo/matching',{url:'https://nojigikucs.com/?admin='+admin}),
    save:(admin,deckId)=>request('PUT','/api/deck-memo',{url:'https://nojigikucs.com/?admin='+admin,dmpId:'101',deckId})};
}

test('memo persists across refresh/round, separates admins, supports unregistered player, rename and clearing',async()=>{
  const h=harness();
  await h.load('karatachics');await h.load('hattics');
  assert.equal((await h.save('karatachics',1)).code,200);
  assert.equal((await h.save('hattics',2)).code,200);
  assert.equal((await h.load('karatachics')).body.participants[0].deckId,1);
  h.setRound(2);
  const next=(await h.load('karatachics')).body;
  assert.equal(next.latestRound,2);assert.equal(next.participants[0].deckId,1);
  assert.equal(next.registeredCount,1);
  assert.equal((await h.load('hattics')).body.participants[0].deckId,2);
  h.decks.set(1,'renamed');
  assert.equal((await h.load('karatachics')).body.participants[0].deckName,'renamed');
  await h.save('karatachics',null);
  assert.equal((await h.load('karatachics')).body.registeredCount,0);
  assert.equal((await h.load('hattics')).body.registeredCount,1);
});

test('unpublished and user lookup fallback are successful responses',async()=>{
  const h=harness();h.setUsersFail();
  const fallback=(await h.load('other')).body;
  assert.ok(fallback.warning);assert.equal(fallback.participants[0].name,'名前 (仮)');
  h.setRound(0);const empty=await h.load('other');
  assert.equal(empty.code,200);assert.equal(empty.body.latestRound,null);
});

test('missing deck and write failure roll back and release',async()=>{
  const h=harness();await h.load('other');
  assert.equal((await h.save('other',999)).code,404);
  assert.equal(h.calls.at(-1),'ROLLBACK');
  h.setWriteFail();assert.equal((await h.save('other',1)).code,500);
  assert.equal(h.calls.at(-1),'ROLLBACK');assert.equal(h.released,true);
});
