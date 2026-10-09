const {createHash}=require('node:crypto');
const {fetchSource}=require('../deck-memo');
const {normalizeNojigikuMatches}=require('./nojigiku-results');
const {fetchSugatoolRounds}=require('./sugatool-results');
const {fetchTcgQualifyingResults}=require('./tcg-results');
const fail=message=>Object.assign(new Error(message),{status:400});
function tcgSettings(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input))throw fail('TCG予選の設定形式が不正です。');
 const {finalRound=null,initialScore=null,zeroGainOutcome=null,confirmed=false}=input;
 if((finalRound!==null&&(!Number.isInteger(finalRound)||finalRound<1||finalRound>32))||(initialScore!==null&&initialScore!==0)||(zeroGainOutcome!==null&&zeroGainOutcome!=='double_loss'))throw fail('TCG予選の設定が不正です。');
 if((finalRound!==null||initialScore!==null||zeroGainOutcome!==null)&&confirmed!==true)throw fail('この大会の予選回戦数・初期得点・両者敗北ルールを確認してください。');
 return {finalRound,initialScore,zeroGainOutcome};
}
function normalizeTcgArchive(result){
 const rounds=new Map();
 for(const m of result.matches){
  if(!rounds.has(m.round))rounds.set(m.round,{round:m.round,matches:[],participants:[]});
  const sides=m.sides.map((p,i)=>({...p,participantKey:p.internalParticipantId?'id:'+p.internalParticipantId:p.rawNo?'raw:'+createHash('sha256').update(JSON.stringify([p.rawNo,p.name])).digest('hex'):'seat:'+m.round+':'+(m.table??m.matchKey)+':'+i,dmpId:null,entryNo:p.rawNo,bye:m.status==='bye',memoExternal:Boolean(p.internalParticipantId||p.rawNo)}));
  const winnerKey=m.winnerKey?('id:'+m.winnerKey.slice(result.tid.length+1)):null;
  const match={round:m.round,table:m.table,matchKey:m.sides.some(p=>!p.internalParticipantId)?m.matchKey+':table:'+m.table:m.matchKey,sides,outcome:m.status==='bye'?'bye':m.status==='confirmed'?m.outcome:'unresolved',winnerKey,reason:m.reasons.join(',')||null,
   rawResult:{deltas:m.deltas,byeType:m.byeType??null,startScoreSources:m.startScoreSources??null,settings:{finalRound:result.verifiedFinalRound??null,initialScore:result.initialScore,zeroGainOutcome:result.zeroGainOutcome},reasons:m.reasons}};
  const round=rounds.get(m.round);round.matches.push(match);round.participants.push(...sides.map(p=>({...p,opponentName:sides.find(q=>q.participantKey!==p.participantKey)?.name||'相手なし',outcome:match.outcome,winnerKey})));
 }
 return [...rounds.values()].sort((a,b)=>a.round-b.round);
}
async function fetchArchiveRounds(source,body,fetchImpl){
 if(source.provider==='sugatool')return fetchSugatoolRounds(source,fetchImpl);
 if(source.provider==='tcg_meister')return normalizeTcgArchive(await fetchTcgQualifyingResults(source,{...tcgSettings(body.tcgSettings),fetchImpl,allowUnfinished:true}));
 const matches=await fetchSource('get-cs-info',source.adminKey,fetchImpl);if(!matches.length)return[];
 return normalizeNojigikuMatches(matches,await fetchSource('get-users',source.adminKey,fetchImpl).catch(()=>[]));
}
module.exports={fetchArchiveRounds,normalizeTcgArchive,tcgSettings};
