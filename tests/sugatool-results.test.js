const {test}=require('node:test'),assert=require('node:assert/strict');
const {normalizeSugatoolRound:parse,fetchSugatoolRounds:fetchAll}=require('../matching-providers/sugatool-results');
const eventId='dcb0aac1-ab7f-4261-b997-6614e93cc8d2',id=n=>'48380b24-dc2b-4fee-a063-'+String(n).padStart(12,'0');
const entries=[1,2,3].map(n=>({eventId,entryId:id(n),playerName:'　同名',duemaId:n===2?null:'000'+n,isReception:true,dropped:n===1}));
const match=(round=1)=>({matchId:'match-'+round,eventId,round,seatNumber:1,player1Id:id(1),player2Id:id(2),result:'player1',winnerId:id(1)});
const url='https://sugatool.nojigikucs.com/events/'+eventId+'/matches';
module.exports={eventId,id,entries,match,url};
test('Suga joins entryId, preserves missing DMP/dropped/same names, validates winner and deduplicates matchId',()=>{
 const r=parse(eventId,1,entries,[match(),match()]);assert.equal(r.matches.length,1);assert.equal(r.matches[0].outcome,'win_loss');assert.equal(r.matches[0].winnerKey,id(1));
 assert.equal(r.participants[0].dmpId,'0001');assert.equal(r.participants[0].dropped,true);assert.equal(r.participants[1].dmpId,null);assert.notEqual(r.participants[0].participantKey,r.participants[1].participantKey);
 assert.deepEqual(parse(eventId,1,entries,[match()]),r);
 for(const change of [{result:'player1',winnerId:id(2)},{result:'player2',winnerId:null},{result:'unknown'},{result:'double_loss'},{player2Id:null}]){const m=parse(eventId,1,entries,[{...match(),...change}]).matches[0];assert.equal(m.outcome,'unresolved');assert.equal(m.winnerKey,null);assert.ok(m.reason);}
 const bye=parse(eventId,1,entries,[{...match(),player2Id:null,result:'bye'}]).matches[0];assert.equal(bye.outcome,'bye');assert.equal(bye.winnerKey,null);
 assert.equal(parse(eventId,1,entries,[{...match(),result:'bye'}]).matches[0].outcome,'unresolved');
 assert.equal(parse(eventId,1,entries.slice(1),[match()]).matches[0].reason,'missing_entry');
});
test('Suga public currentRound controls all numbered requests; partial HTTP failure rejects entire snapshot',async()=>{
 const calls=[];let bad=false,empty=false;
 const fetchImpl=async(u,o)=>{calls.push(u);assert.equal(o.redirect,'error');if(bad&&u.endsWith('round=2'))return new Response('{}',{status:503});return new Response(JSON.stringify(u.endsWith('/entries')?entries:u.includes('/matches?')?empty?[]:[match(Number(new URL(u).searchParams.get('round')))]:{eventId,currentRound:3,maxRounds:99,published:true}));};
 const r=await fetchAll(url,fetchImpl);assert.deepEqual(r.map(r=>r.round),[1,2,3]);assert.equal(calls.length,5);assert.ok(!calls.some(u=>u.endsWith('round=4')));
 bad=true;await assert.rejects(fetchAll(url,fetchImpl),/取得/);bad=false;empty=true;assert.deepEqual(await fetchAll(url,fetchImpl),[]);
 await assert.rejects(fetchAll(url,async()=>new Response(JSON.stringify({eventId,currentRound:101}))),/回戦数/);
 await assert.rejects(fetchAll(url,async u=>new Response(JSON.stringify(u.endsWith('/entries')?{}:{eventId,currentRound:0}))),/参加者一覧/);
});
test('Suga malformed, conflicting and foreign records fail before persistence',()=>{
 for(const rows of [[{...match(),round:2}],[{...match(),eventId:id(8)}],[{...match(),matchId:null}],[match(),{...match(),winnerId:id(2)}],[match(),{...match(),matchId:'other'}]])assert.throws(()=>parse(eventId,1,entries,rows),e=>e.status===502);
 assert.throws(()=>parse(eventId,1,[],[match()]));assert.throws(()=>parse(eventId,1,[...entries,{...entries[0],entryId:id(7)}],[match()]));
});
