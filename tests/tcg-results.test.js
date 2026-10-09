const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {parseQualifyingRound:parse,parseQualifyingStandings:stand,restoreQualifyingResults:restore,fetchTcgQualifyingResults:fetchAll}=require('../matching-providers/tcg-results');
const tid='2703954';
const roundHtml=(scoreA,scoreB,names=['同名','同名'],ids=['1','2'])=>`<table><tr><th>卓番</th><th>あなたのお名前</th><th>累計<br>得点</th><th>対戦相手のお名前</th><th>累計得点</th></tr>${ids.map((id,i)=>`<tr><td>1</td><td onclick="VisitorLock('${id}','x')">${names[i]}</td><td>${[scoreA,scoreB][i]??''}</td><td>${names[1-i]}</td><td>${[scoreA,scoreB][1-i]??''}</td></tr>`).join('')}</table>`;
const standingsHtml=(a,b)=>`<table><tr><th>順位</th><th>あなたのお名前</th><th>累計得点</th><th>OMW％</th><th>平均OMW％</th></tr>${[a,b].map((p,i)=>`<tr><td>${i+1}</td><td onclick="VisitorLock('${i+1}','x')">同名</td><td>${p}</td><td>54</td><td>70.75</td></tr>`).join('')}</table>`;
function input(){return {tid,finalRound:2,rounds:[{round:1,rows:parse(roundHtml(0,0),tid,1)},{round:2,rows:parse(roundHtml(3,0),tid,2)}],standings:stand(standingsHtml(3,3),tid)};}
test('both rows become one match; same-name players are kept distinct; final round uses standings',()=>{
 const i=input(),before=JSON.stringify(i),r=restore(i);
 assert.equal(r.matches.length,2);assert.deepEqual(r.matches.map(m=>m.winnerKey),[tid+':1',tid+':2']);
 assert.deepEqual(r.matches.map(m=>m.deltas),[[3,0],[0,3]]);assert.equal(r.standings[0].averageOmw,70.75);
 assert.deepEqual(restore(i),r);assert.equal(JSON.stringify(i),before);
 assert.throws(()=>restore({...i,tid:'2'}),/一致/);
});
for(const [label,edit,reason] of [
 ['missing scores',i=>i.rounds[0].rows[0].startScore=null,'missing_score'],
 ['missing next round',i=>i.rounds.splice(1,1),'missing_next_round'],
 ['missing standings',i=>i.standings=[],'missing_standings'],
 ['duplicate row',i=>i.rounds[0].rows.push({...i.rounds[0].rows[0]}),'duplicate_row'],
 ['duplicate final score',i=>i.standings.push({...i.standings[0]}),'duplicate_end_score'],
 ['unknown opponent',i=>i.rounds[0].rows.pop(),'opponent_unknown'],
 ['wrong opponent name',i=>i.rounds[0].rows[0].opponentName='別人','opponent_mismatch'],
 ['wrong opponent number',i=>i.rounds[0].rows[0].opponentInternalId='99','internal_id_mismatch'],
 ['missing number',i=>{i.rounds[0].rows[0].internalParticipantId=null;i.rounds[0].rows[0].playerKey=null;},'missing_internal_id'],
 ['opponent score differs',i=>i.rounds[0].rows[0].opponentStartScore=9,'opponent_score_mismatch'],
 ['both gain 3',i=>{i.rounds[1].rows[1].startScore=3;i.rounds[1].rows[0].opponentStartScore=3;},'score_inconsistent'],
 ['negative delta',i=>i.standings[0].finalScore=0,'score_inconsistent'],
 ['draw-like delta',i=>{i.standings[0].finalScore=4;i.standings[1].finalScore=1;},'score_inconsistent']
])test(label+' remains unresolved with a reason',()=>{const i=input();edit(i);const r=restore(i),m=r.matches.find(m=>m.reasons.includes(reason));assert.ok(m,reason);assert.equal(m.status,'unresolved');assert.equal(m.winnerKey,null);});
test('three-column pages, Bye and malformed/unrecognized data',()=>{
 const html=fs.readFileSync(path.join(__dirname,'fixtures/tcg-meister/round-three-column-wave.html'),'utf8');
 const rows=parse(html,tid,1);assert.ok(rows.every(p=>p.startScore===null));
 assert.ok(restore({tid,finalRound:1,rounds:[{round:1,rows}],standings:[]}).matches.every(m=>m.status==='unresolved'));
 const bye=parse('<table><tr><td>卓番</td><td>あなたのお名前</td><td>対戦相手のお名前</td></tr><tr><td>不戦勝</td><td onclick="VisitorLock(\'9\',\'x\')">選手</td><td>Bye (不戦勝)</td></tr></table>',tid,1);
 assert.equal(restore({tid,finalRound:1,rounds:[{round:1,rows:bye}],standings:[]}).matches[0].status,'bye');
 assert.throws(()=>parse('<p>login required</p>',tid,1));assert.throws(()=>stand('<p>login required</p>',tid));
});
function mock({badPage=false,badHttp=false,empty=false,redirect=false}={}) {
 const calls=[];
 const fetchImpl=async(url,options)=>{
  const u=new URL(url);calls.push({url,options});
  if(badHttp)return new Response('error',{status:503});
  if(u.pathname==='/loginnum.asp')return new Response(`<form action="login_bin.asp"><input name="tid" value="${tid}"></form>`,{headers:{'Set-Cookie':'anon=1'}});
  assert.match(options.headers.Cookie,/anon=1/);
  if(u.pathname==='/login_bin.asp'){assert.equal(new URLSearchParams(options.body).get('pwd'),'');return new Response(null,{status:302,headers:{Location:redirect?'https://evil.invalid/':'/tour.asp?tid='+tid}});}
  if(u.pathname==='/tour.asp')return new Response(`<form action="tour.asp"><input name="tid" value="${tid}"></form><a href="tourround.asp?tid=${tid}&kno=1&znt=0">1</a><a href="tourround.asp?tid=${tid}&kno=2&znt=0">2</a><a href="tourround.asp?tid=${tid}&kno=9999999&znt=1">成績</a><a href="tourround.asp?tid=${tid}&kno=3&znt=2">決勝</a>`);
  const kno=u.searchParams.get('kno'),page=u.searchParams.get('Page');
  let html=kno==='9999999'?standingsHtml(3,3):roundHtml(kno==='1'?0:3,0);
  const $=require('cheerio').load(html);$('tr').eq(page==='1'?2:1).remove();if(empty)$('tr').slice(1).remove();
  html=$.html()+`<script>PageStr = PageStr + ${JSON.stringify(`<a href="tourround.asp?tid=${tid}&kno=${kno}&Page=${badPage?51:2}">last</a>`)};</script>`;
  return new Response(html);
 };
 return {calls,fetchImpl};
}
test('fetches every round and standings page in one anonymous session, excludes finals',async()=>{
 const m=mock(),r=await fetchAll('https://tcg.sfc-jpn.jp/loginnum.asp?tid='+tid,{fetchImpl:m.fetchImpl,finalRound:2});
 assert.equal(r.matches.length,2);assert.ok(r.matches.every(m=>m.status==='confirmed'));
 assert.equal(m.calls.filter(c=>new URL(c.url).pathname==='/tourround.asp').length,6);
 assert.ok(!m.calls.some(c=>new URL(c.url).searchParams.get('kno')==='3'));
});
test('failures, empty data, redirects, page limits, and timeout do not return successful empty results',async()=>{
 for(const options of [{badPage:true},{badHttp:true},{empty:true},{redirect:true}])await assert.rejects(fetchAll('https://tcg.sfc-jpn.jp/loginnum.asp?tid='+tid,{fetchImpl:mock(options).fetchImpl,finalRound:2}));
 await assert.rejects(fetchAll('https://tcg.sfc-jpn.jp/loginnum.asp?tid='+tid,{fetchImpl:mock().fetchImpl,finalRound:2,maxTotalPages:1}),/上限/);
 await assert.rejects(fetchAll('https://tcg.sfc-jpn.jp/loginnum.asp?tid='+tid,{finalRound:2,fetchImpl:async()=>{throw Object.assign(Error(),{name:'TimeoutError'});}}),{status:504});
 await assert.rejects(fetchAll('https://tcg.sfc-jpn.jp/loginnum.asp?tid='+tid,{finalRound:33}),{status:400});
});
test('anonymized 2703954: four full rounds and paginated standings preserve the observed score gap',async()=>{
 const session=mock();const actualFetch=async(url,options)=>{
  const u=new URL(url);
  if(u.pathname==='/tour.asp')return new Response(`<form action="tour.asp"><input name="tid" value="${tid}"></form>${[1,2,3,4,9999999].map(k=>`<a href="tourround.asp?tid=${tid}&kno=${k}&znt=${k===9999999?1:0}">round</a>`).join('')}`);
  if(u.pathname==='/tourround.asp')return new Response(fs.readFileSync(path.join(__dirname,'fixtures/tcg-meister/2703954',u.searchParams.get('kno')+'-'+u.searchParams.get('Page')+'.html'),'utf8'));
  return session.fetchImpl(url,options);
 };
 const result=await fetchAll('https://tcg.sfc-jpn.jp/loginnum.asp?tid='+tid,{finalRound:4,fetchImpl:actualFetch});
 assert.deepEqual(result.rounds.map(r=>r.rows.length),[54,54,54,54]);assert.equal(result.standings.length,54);
 assert.equal(result.matches.filter(m=>m.status==='confirmed').length,72);
 assert.equal(result.matches.filter(m=>m.status==='bye').length,18);
 assert.equal(result.matches.filter(m=>m.status==='unresolved').length,27);
 assert.ok(result.matches.filter(m=>m.round===1&&m.status!=='bye').every(m=>m.reasons.includes('missing_score')));
 assert.ok(result.standings.every(p=>p.omw!==null&&p.averageOmw!==null));
 assert.deepEqual(restore(result),result);
 const withZero=await fetchAll('https://tcg.sfc-jpn.jp/loginnum.asp?tid='+tid,{finalRound:4,initialScore:0,fetchImpl:actualFetch});
 assert.equal(withZero.matches.filter(m=>m.status==='confirmed').length,98);
 assert.equal(withZero.initialScore,0);
 const withRules=await fetchAll('https://tcg.sfc-jpn.jp/loginnum.asp?tid='+tid,{finalRound:4,initialScore:0,zeroGainOutcome:'double_loss',fetchImpl:actualFetch});
 assert.equal(withRules.matches.filter(m=>m.status==='confirmed').length,99);
 assert.equal(withRules.matches.filter(m=>m.outcome==='double_loss').length,1);
 assert.deepEqual(restore(withRules),withRules);
});
function firstRoundWithoutScores() {
 const i=input();
 i.rounds[0].rows=parse(`<table><tr><td>卓番</td><td>あなたのお名前</td><td>対戦相手のお名前</td></tr>${['1','2'].map(id=>`<tr><td>1</td><td onclick="VisitorLock('${id}','x')">同名</td><td>同名</td></tr>`).join('')}</table>`,tid,1);
 return i;
}
test('initial zero is explicit, provenance is retained, and input observations remain unchanged',()=>{
 const i=firstRoundWithoutScores(),before=JSON.stringify(i);
 assert.equal(restore(i).matches[0].status,'unresolved');
 const r=restore({...i,initialScore:0});
 assert.equal(r.matches[0].winnerKey,tid+':1');assert.deepEqual(r.matches[0].deltas,[3,0]);
 assert.deepEqual(r.matches[0].startScoreSources,['explicit_initial_zero','explicit_initial_zero']);
 assert.equal(JSON.stringify(i),before);assert.deepEqual(restore(r),r);
 assert.throws(()=>restore({...i,initialScore:3}),{status:400});
});
for(const [label,edit,reason] of [
 ['missing round 2',i=>i.rounds.pop(),'missing_next_round'],
 ['missing round 2 score',i=>i.rounds[1].rows[0].startScore=null,'missing_score'],
 ['unknown number',i=>{i.rounds[0].rows[0].internalParticipantId=null;i.rounds[0].rows[0].playerKey=null;},'missing_internal_id'],
 ['different opponent number',i=>i.rounds[0].rows[0].opponentInternalId='99','internal_id_mismatch'],
 ['duplicate player',i=>i.rounds[0].rows.push({...i.rounds[0].rows[0]}),'duplicate_row'],
 ['corrected/unexpected points',i=>i.rounds[1].rows[0].startScore=6,'score_inconsistent'],
 ['zero-zero',i=>i.rounds[1].rows[0].startScore=0,'zero_gain_ambiguous'],
 ['withdrawn player',i=>i.rounds[0].rows[0].withdrawn=true,'withdrawn'],
 ['score correction flagged',i=>i.rounds[1].rows[0].scoreCorrected=true,'score_correction'],
 ['opponent score contradicts zero',i=>i.rounds[0].rows[0].opponentStartScore=3,'opponent_score_mismatch'],
 ['contradictory initial points',i=>{i.rounds[0].rows[0].startScore=3;i.rounds[1].rows[0].startScore=6;},'initial_score_mismatch']
])test('initial zero never overrides '+label,()=>{const i=firstRoundWithoutScores();edit(i);const m=restore({...i,initialScore:0}).matches[0];assert.equal(m.status,'unresolved');assert.ok(m.reasons.includes(reason));});
test('initial zero does not fill an empty score cell, later rounds, or turn Bye into a victory',()=>{
 const i=input();i.rounds[0].rows[0].startScore=null;i.rounds[0].rows[0].startScoreSource='missing_value';
 assert.equal(restore({...i,initialScore:0}).matches[0].status,'unresolved');
 const j=firstRoundWithoutScores();j.rounds[1].rows[0].startScore=null;
 assert.equal(restore({...j,initialScore:0}).matches[1].status,'unresolved');
 const k=firstRoundWithoutScores();k.rounds[0].rows[0].bye=true;k.rounds[0].rows.splice(1,1);
 assert.equal(restore({...k,initialScore:0}).matches[0].status,'bye');
});
function realFixtureInput(){
 const root=path.join(__dirname,'fixtures/tcg-meister/2703954');
 const read=(k,p)=>fs.readFileSync(path.join(root,k+'-'+p+'.html'),'utf8');
 return {tid,finalRound:4,initialScore:0,zeroGainOutcome:'double_loss',rounds:[1,2,3,4].map(round=>({round,rows:[1,2].flatMap(p=>parse(read(round,p),tid,round))})),standings:[1,2].flatMap(p=>stand(read(9999999,p),tid))};
}
test('2703954 per-round conservation, unique matches, no missing players, and Bye observations',()=>{
 const r=restore(realFixtureInput());
 assert.deepEqual(r.roundSummaries.map(s=>[s.participantCount,s.normalMatchCount,s.byeCount,s.confirmedCount,s.unresolvedCount]),[[54,27,0,27,0],[54,27,0,27,0],[54,25,4,25,0],[54,20,14,20,0]]);
 for(const s of r.roundSummaries){assert.equal(s.participantCount,2*s.normalMatchCount+s.byeCount);assert.equal(s.duplicateRows,0);assert.equal(s.unidentifiedRows,0);assert.equal(s.invalidPairCount,0);assert.deepEqual(s.unresolvedReasons,{});}
 const allIds=r.rounds.map(round=>round.rows.map(p=>p.internalParticipantId).sort());assert.ok(allIds.every(ids=>JSON.stringify(ids)===JSON.stringify(allIds[0])));
 assert.equal(new Set(r.matches.map(m=>m.matchKey)).size,r.matches.length);
 const normal=r.matches.filter(m=>m.status!=='bye'),byes=r.matches.filter(m=>m.status==='bye');
 assert.equal(normal.length,99);assert.ok(normal.every(m=>m.sides.length===2));
 assert.equal(normal.filter(m=>m.status==='confirmed').length,99);
 const unresolved=normal.filter(m=>m.outcome==='double_loss');assert.equal(unresolved.length,1);assert.equal(unresolved[0].winnerKey,null);assert.deepEqual(unresolved[0].loserKeys,[tid+':38',tid+':48']);
 assert.equal(unresolved[0].table,17);assert.deepEqual(unresolved[0].sides.map(s=>s.internalParticipantId),['38','48']);assert.deepEqual(unresolved[0].deltas,[0,0]);assert.deepEqual(unresolved[0].reasons,[]);
 assert.equal(byes.length,18);assert.equal(new Set(byes.map(m=>m.sides[0].playerKey)).size,14);
 assert.ok(byes.every(m=>m.byeScoreDelta===0&&m.byeType==='no_score_gain'&&m.winnerKey===null));
 assert.equal(2*normal.length+byes.length,216);
 assert.deepEqual(restore(r),r);
});
test('2703954 player 39 outcomes in rounds 2/3/4 match the supplied examples',()=>{
 const r=restore(realFixtureInput());
 for(const [round,opponent,winner]of [[2,'53','39'],[3,'55','39'],[4,'34','34']]){
  const m=r.matches.find(m=>m.round===round&&m.sides.some(s=>s.internalParticipantId==='39'));
  assert.deepEqual(new Set(m.sides.map(s=>s.internalParticipantId)),new Set(['39',opponent]));
  assert.equal(m.winnerKey,tid+':'+winner);assert.equal(m.status,'confirmed');
  assert.equal(m.deltas[m.sides.findIndex(s=>s.internalParticipantId===winner)],3);
  assert.equal(m.deltas[m.sides.findIndex(s=>s.internalParticipantId!==winner)],0);
 }
});
test('explicit double-loss rule resolves valid 0/0 without fabricating a winner, but never overrides anomalies',()=>{
 const i=firstRoundWithoutScores();i.rounds[1].rows[0].startScore=0;
 assert.equal(restore({...i,initialScore:0}).matches[0].status,'unresolved');
 const options={...i,initialScore:0,zeroGainOutcome:'double_loss'};
 const m=restore(options).matches[0];assert.equal(m.status,'confirmed');assert.equal(m.outcome,'double_loss');assert.equal(m.winnerKey,null);assert.equal(m.loserKey,null);assert.deepEqual(m.loserKeys,[tid+':1',tid+':2']);
 i.rounds[0].rows[0].opponentInternalId='99';assert.equal(restore(options).matches[0].status,'unresolved');
 assert.throws(()=>restore({...i,zeroGainOutcome:'draw'}),{status:400});
});
test('archive fetch discovers published qualifying rounds, never assumes last round, initial zero or double loss',async()=>{
 const m=mock();const r=await fetchAll('https://tcg.sfc-jpn.jp/loginnum.asp?tid='+tid,{fetchImpl:m.fetchImpl,allowUnfinished:true});
 assert.deepEqual(r.publishedRounds,[1,2]);assert.equal(r.verifiedFinalRound,null);assert.equal(r.initialScore,null);assert.equal(r.zeroGainOutcome,null);
 assert.equal(r.matches[0].status,'confirmed');assert.equal(r.matches[1].status,'unresolved');assert.ok(r.matches[1].reasons.includes('missing_next_round'));
 assert.ok(!m.calls.some(c=>new URL(c.url).searchParams.get('kno')==='9999999'));
 await assert.rejects(fetchAll('https://tcg.sfc-jpn.jp/loginnum.asp?tid='+tid,{fetchImpl:mock().fetchImpl,finalRound:1,allowUnfinished:true}),/公開回戦/);
});
test('explicit archive conditions use standings while unpublished standings keep last round unresolved',async()=>{
 const m=mock();const fetchImpl=async(u,o)=>{const r=await m.fetchImpl(u,o);if(new URL(u).pathname==='/tour.asp')return new Response((await r.text()).replace(/<a[^>]*kno=9999999[^>]*>.*?<\/a>/,''));return r;};
 const r=await fetchAll('https://tcg.sfc-jpn.jp/loginnum.asp?tid='+tid,{fetchImpl,finalRound:2,allowUnfinished:true});assert.equal(r.matches.at(-1).status,'unresolved');assert.ok(r.matches.at(-1).reasons.includes('missing_standings'));
});

test('recognized empty unpublished TCG rounds return no observations in archive mode, while strict and malformed pages still fail',async()=>{const r=await fetchAll('https://tcg.sfc-jpn.jp/loginnum.asp?tid='+tid,{fetchImpl:mock({empty:true}).fetchImpl,allowUnfinished:true});assert.deepEqual(r.rounds,[]);assert.deepEqual(r.matches,[]);});
