const {test}=require('node:test'),assert=require('node:assert/strict');
const {fetchEventParticipants}=require('../dmp-participants');
const {aggregate}=require('../winrate-analysis');
test('public participant in-flight sharing is scoped to full key and fetch client; refresh/failure never cached',async()=>{
 let calls=0,release;const gate=new Promise(r=>release=r);
 const fetcher=async()=>{calls++;await gate;return {ok:true,json:async()=>({d:[{'会員ID':'00012','ハンドルネーム':'　名前'}]})};};
 const key={shopId:'1',eventId:'2',seq:'3'};
 const a=fetchEventParticipants(key,fetcher),b=fetchEventParticipants({...key},fetcher),other=fetchEventParticipants({...key,seq:'4'},fetcher);
 assert.equal(calls,2);release();const [x,y]=await Promise.all([a,b,other]);x[0].name='modified';assert.equal(y[0].name,'　名前');assert.equal(y[0].id,'00012');
 await fetchEventParticipants(key,fetcher);assert.equal(calls,3);
 let failures=0;const bad=async()=>{failures++;throw Error('upstream');};await assert.rejects(()=>fetchEventParticipants(key,bad));await assert.rejects(()=>fetchEventParticipants(key,bad));assert.equal(failures,2);
 let isolated=0;await fetchEventParticipants(key,async()=>{isolated++;return {ok:true,json:async()=>({d:[]})};});assert.equal(isolated,1);
});
test('summary-only and selected detail aggregation keep every count, direction and exclusion identical',()=>{
 const catalog=[{id:1,name:'A'},{id:2,name:'B'}],sides=[{participantKey:'id:1',deckId:1},{participantKey:'id:2',deckId:2}];
 const rows=[1,2].map(round=>({archiveId:1,provider:'tcg_meister',sourceKey:'one',event:{id:1},round,matchKey:'m'+round,sides,winnerKey:'id:'+round,outcome:'win_loss'}));
 const all=aggregate(rows,catalog),summary=aggregate(rows,catalog,{}, {includeDetails:false}),detail=aggregate(rows,catalog,{}, {detailKey:'2:1'});
 assert.equal(summary.detail.size,0);assert.deepEqual([...detail.detail.keys()],['2:1']);assert.deepEqual(detail.detail.get('2:1'),all.detail.get('2:1'));
 const omit=({detail,...rest})=>rest;assert.deepEqual(omit(summary),omit(all));assert.deepEqual(omit(detail),omit(all));
});
