const {test}=require('node:test'),assert=require('node:assert/strict');
const {parseSugatoolUrl,normalizeSugatool,fetchSugatool,API_BASE}=require('../matching-providers/sugatool');
const {detectProvider}=require('../deck-memo');
const id='dcb0aac1-ab7f-4261-b997-6614e93cc8d2';
const uuid=n=>'48380b24-dc2b-4fee-a063-'+String(n).padStart(12,'0');
const event={eventId:id,currentRound:5,maxRounds:9,published:true};
const entries=Array.from({length:30},(_,i)=>({entryId:uuid(i),eventId:id,playerName:'P'+i,duemaId:100+i,entryNo:i+1,isReception:true,dropped:i>=25}));
const matches=Array.from({length:13},(_,i)=>({eventId:id,round:5,seatNumber:i+1,player1Id:uuid(i*2),player2Id:i===12?null:uuid(i*2+1),result:i===12?'bye':null}));
module.exports={id,event,entries,matches};
test('provider recognition accepts query and rejects malformed URLs without changing old providers',()=>{
 const url='https://sugatool.nojigikucs.com/events/'+id+'/matches';
 assert.equal(detectProvider(url+'?x=1').provider,'sugatool');assert.equal(parseSugatoolUrl(url).eventId,id);
 for(const bad of [url.replace('https:','http:'),url.replace(id,'bad'),url.replace('sugatool.nojigikucs.com','evil.test'),url.replace('/matches','/entries')])assert.throws(()=>parseSugatoolUrl(bad));
 assert.equal(detectProvider('https://nojigikucs.com/?admin=hattics').provider,'nojigiku');assert.equal(detectProvider('https://tcg.sfc-jpn.jp/loginnum.asp?tid=7413902').provider,'tcg_meister');
});
test('received entries form roster; latest seats, sides, bye and dropped participants are preserved',()=>{
 const r=normalizeSugatool(event,[...entries,{...entries[0],entryId:uuid(99),isReception:false}],matches);
 assert.equal(r.participants.length,30);assert.equal(r.participants.filter(p=>p.table!==null).length,25);
 assert.equal(r.participants[0].dmpId,'100');assert.equal(r.participants[1].dmpId,'101');assert.equal(r.participants[24].bye,true);
 assert.equal(r.participants[25].table,null);assert.equal(r.participants[25].dropped,true);
 assert.equal(normalizeSugatool({...event,currentRound:null},entries,[]).participants.length,30);
 assert.match(normalizeSugatool(event,[],[]).warning,/0人/);
 assert.throws(()=>normalizeSugatool(event,[{...entries[0],duemaId:null}],[]),/duemaId/);
});
test('uses currentRound with fixed public endpoints and distinguishes failures',async()=>{
 const source=parseSugatoolUrl('https://sugatool.nojigikucs.com/events/'+id+'/matches');const calls=[];
 const r=await fetchSugatool(source,async(url,options)=>{calls.push(url);assert.equal(options.redirect,'error');return {ok:true,json:async()=>url.endsWith('/entries')?entries:url.includes('/matches?')?matches:event};});
 assert.equal(r.participants.length,30);assert.ok(calls.includes(API_BASE+'/events/'+id+'/matches?round=5'));assert.equal(calls.length,3);
 await assert.rejects(fetchSugatool(source,async()=>({status:404,ok:false})),/存在しません/);
 for(const part of ['entries','matches'])await assert.rejects(fetchSugatool(source,async url=>({ok:!url.includes('/'+part),status:503,json:async()=>event})),new RegExp(part+'取得失敗'));
 await assert.rejects(fetchSugatool(source,async()=>({ok:true,json:async()=>null})),/レスポンス形式/);
});
