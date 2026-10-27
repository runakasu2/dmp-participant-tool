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
 const missing=normalizeSugatool(event,[{...entries[0],duemaId:null}],[]).participants[0];assert.equal(missing.dmpId,null);assert.equal(missing.participantKey,entries[0].entryId);
});
test('uses currentRound with fixed public endpoints and distinguishes failures',async()=>{
 const source=parseSugatoolUrl('https://sugatool.nojigikucs.com/events/'+id+'/matches');const calls=[];
 const r=await fetchSugatool(source,async(url,options)=>{calls.push(url);assert.equal(options.redirect,'error');return {ok:true,json:async()=>url.endsWith('/entries')?entries:url.includes('/matches?')?matches.map(m=>({...m,round:Number(new URL(url).searchParams.get('round'))})):event};});
 assert.equal(r.participants.length,30);assert.ok(calls.includes(API_BASE+'/events/'+id+'/matches?round=5'));assert.equal(calls.length,7);
 await assert.rejects(fetchSugatool(source,async()=>({status:404,ok:false})),/存在しません/);
 for(const part of ['entries','matches'])await assert.rejects(fetchSugatool(source,async url=>({ok:!url.includes('/'+part),status:503,json:async()=>url.endsWith('/entries')?entries:event})),new RegExp(part+'取得失敗'));
 await assert.rejects(fetchSugatool(source,async()=>({ok:true,json:async()=>null})),/レスポンス形式/);
});

test('latest match roster includes walk-ins, missing entries, deduplicates entries and retains received unseated players',()=>{
 const {normalizeSugatoolRound}=require('../matching-providers/sugatool-results');
 const roster=Array.from({length:64},(_,i)=>({entryId:uuid(i+1),eventId:id,playerName:'P'+i,duemaId:String(i+1),isReception:i<59}));
 for(const [i,value] of [false,undefined,null,'true',0].entries())roster[59+i].isReception=value;
 const games=Array.from({length:32},(_,i)=>({matchId:'m'+i,eventId:id,round:5,seatNumber:i+1,player1Id:uuid(i*2+1),player2Id:uuid(i*2+2),player2Name:'試合側の名前',result:null}));
 const r=normalizeSugatool(event,roster,games);
 assert.equal(r.participants.length,64);
 assert.equal(new Set(r.participants.map(p=>p.entryId)).size,64);
 assert.deepEqual(r.participants.slice(-2).map(p=>[p.table,p.side]),[[32,1],[32,2]]);
 const extra=[{entryId:uuid(90),playerName:'受付のみ',isReception:true},{entryId:uuid(91),playerName:'未受付',isReception:false}];
 const missing=normalizeSugatool(event,[...roster.slice(0,63),roster[0],...extra],games);
 assert.equal(missing.participants.length,65);
 assert.equal(missing.participants.find(p=>p.entryId===uuid(64)).name,'試合側の名前');
 assert.equal(missing.participants.find(p=>p.entryId===uuid(64)).dmpId,null);
 assert.equal(missing.participants.find(p=>p.entryId===uuid(90)).table,null);
 assert.ok(!missing.participants.some(p=>p.entryId===uuid(91)));
 const fallbackBye=normalizeSugatool(event,[],[{...games[0],player2Id:null,result:'bye',player1Name:null}]).participants[0];
 assert.equal(fallbackBye.name,'名前未取得');assert.equal(fallbackBye.bye,true);assert.equal(fallbackBye.table,1);
 assert.equal(normalizeSugatoolRound(id,5,roster,games).participants.length,64);
 assert.equal(normalizeSugatool(event,roster,[...games,{...games[0],round:4}]).participants.length,64);
 assert.throws(()=>normalizeSugatool(event,roster,[...games,games[0]]),/重複/);
});

test('all-round roster retains unreceived dropouts and missing historical entries without assigning stale seats',async()=>{
 const roster=Array.from({length:64},(_,i)=>({entryId:uuid(i+1),eventId:id,playerName:'P'+i,duemaId:String(i+1),isReception:i<59,dropped:i>=60}));
 const games=Array.from({length:32},(_,i)=>({eventId:id,round:1,seatNumber:i+1,player1Id:uuid(i*2+1),player2Id:uuid(i*2+2),player2Name:'履歴の名前'}));
 const latest=games.slice(0,30).map(m=>({...m,round:5,seatNumber:m.seatNumber+1}));
 const call=async omitted=>{
  const source=parseSugatoolUrl('https://sugatool.nojigikucs.com/events/'+id+'/matches');
  let active=0,peak=0;const calls=[];
  const result=await fetchSugatool(source,async url=>{
   calls.push(url);active++;peak=Math.max(peak,active);await new Promise(setImmediate);active--;
   const r=Number(new URL(url).searchParams.get('round'));
   return {ok:true,json:async()=>url.endsWith('/entries')?[...roster.filter(p=>p.entryId!==omitted),{entryId:uuid(90),playerName:'未受付',isReception:false}]:url.includes('/matches?')?r===1?games:r===5?latest:[]:event};
  });
  assert.equal(calls.length,7);assert.ok(peak<=3);assert.equal(peak,3);
  assert.equal(result.participants.length,64);assert.equal(new Set(result.participants.map(p=>p.entryId)).size,64);
  assert.equal(result.participants.filter(p=>p.table!==null).length,60);assert.equal(result.latestRound,5);
  assert.equal(result.participants.find(p=>p.entryId===uuid(1)).table,2);
  for(const p of result.participants.filter(p=>Number(p.entryId.slice(-12))>60)){assert.equal(p.table,null);assert.equal(p.side,null);assert.equal(p.bye,false);}
  return result;
 };
 const full=await call();assert.equal(full.participants.find(p=>p.entryId===uuid(64)).dropped,true);
 const missing=await call(uuid(64));assert.equal(missing.participants.find(p=>p.entryId===uuid(64)).name,'履歴の名前');
});

test('all-round fetch rejects partial failures, foreign rounds and excessive round counts; round zero keeps received entries',async()=>{
 const source=parseSugatoolUrl('https://sugatool.nojigikucs.com/events/'+id+'/matches');
 for(const failure of ['http','round'])await assert.rejects(fetchSugatool(source,async url=>{
  const r=Number(new URL(url).searchParams.get('round'));
  return {ok:!(failure==='http'&&r===2),status:503,json:async()=>url.endsWith('/entries')?entries:url.includes('/matches?')?failure==='round'&&r===2?[{...matches[0],round:1}]:[]:event};
 }),failure==='http'?/matches取得失敗/:/回戦・形式/);
 await assert.rejects(fetchSugatool(source,async()=>({ok:true,json:async()=>({...event,currentRound:101})})),/currentRound/);
 let calls=0;const empty=await fetchSugatool(source,async url=>{calls++;return {ok:true,json:async()=>url.endsWith('/entries')?entries:{...event,currentRound:0}};});
 assert.equal(calls,2);assert.equal(empty.participants.length,30);assert.ok(empty.participants.every(p=>p.table===null));
});
