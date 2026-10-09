const {test}=require('node:test');
const assert=require('node:assert/strict');
const {normalizeNojigikuMatches:parse}=require('../matching-providers/nojigiku-results');
const row=(round=1,table=1)=>({round,table,user1id:'000123',user1:'　同名 (0点)',user1no:8,user2id:'456',user2:'同名 (0点)',user2no:42,winner:8});
test('Nojigiku all rounds preserve DMP identity, aggregate both sides once, and resolve winner by entry number',()=>{
 const rows=[row(2),row(1),row(1)];const result=parse(rows);
 assert.deepEqual(result.map(r=>r.round),[1,2]);assert.equal(result[0].matches.length,1);
 assert.equal(result[0].matches[0].winnerKey,'dmp:000123');assert.equal(result[0].participants.length,2);
 assert.equal(result[0].participants[0].dmpId,'000123');assert.equal(result[0].participants[1].name,'同名');
 assert.deepEqual(parse(rows),result);
});
test('Nojigiku special winners and missing/ambiguous internal numbers never fabricate victories',()=>{
 for(const winner of [-1,-2,null,0,999,'invalid']){const match=parse([{...row(),winner}])[0].matches[0];assert.equal(match.outcome,'unresolved');assert.equal(match.winnerKey,null);assert.ok(match.reason);}
 for(const update of [{user1no:null},{user2no:8}])assert.equal(parse([{...row(),...update}])[0].matches[0].outcome,'unresolved');
 const bye=parse([{...row(),user2id:-1,user2no:-1,user2:'Bye(不戦勝)',winner:-1}])[0].matches[0];assert.equal(bye.outcome,'bye');assert.equal(bye.winnerKey,null);
 const missing=parse([{...row(),user2id:0,user2:'',user2no:null}])[0].matches[0];assert.equal(missing.outcome,'unresolved');assert.equal(missing.reason,'missing_opponent');
});
test('Nojigiku rejects conflicting tables, repeated players, malformed data and safety limit violations',()=>{
 for(const rows of [[row(),{...row(),winner:42}],[row(),row(1,2)],[{...row(),round:0}],[{...row(),round:101}],[{...row(),table:'x'}],[{...row(),user1id:-2}],[{...row(),user1id:0,user2id:0,user1:'',user2:''}],Array(10001).fill(row())])assert.throws(()=>parse(rows),e=>e.status===502);
 assert.deepEqual(parse([]),[]);
});

test('players without DMP IDs retain provider entry identity and never merge by name',()=>{
 const match=parse([{...row(),user1id:0,user2id:0}])[0].matches[0];
 assert.deepEqual(match.sides.map(p=>p.participantKey),['entry:8','entry:42']);
 assert.equal(match.winnerKey,'entry:8');assert.ok(match.sides.every(p=>p.dmpId===null));
});
