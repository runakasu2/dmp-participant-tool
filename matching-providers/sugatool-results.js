// Public numbered rounds only. No elimination/bracket endpoints or private APIs.
const {API_BASE,parseSugatoolUrl}=require('./sugatool');
const fail=(message,status=502)=>Object.assign(new Error(message),{status});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function normalizeSugatoolRound(eventId,round,entries,matches){
 if(!Array.isArray(entries)||!Array.isArray(matches)||entries.length>10000||matches.length>10000)throw fail('スガツールの参加者・対戦表形式が不正です。');
 if(matches.length&&!entries.length)throw fail('スガツールの参加者一覧が空のため対戦表を更新できません。');
 const people=new Map(),dmpIds=new Set();
 for(const e of entries){
  if(!e||!uuid.test(e.entryId)||e.eventId&&e.eventId!==eventId)throw fail('スガツールの参加者番号・大会が不正です。');
  if(people.has(e.entryId)){if(JSON.stringify(people.get(e.entryId))!==JSON.stringify(e))throw fail('スガツールの参加者情報が競合しています。');continue;}
  const id=String(e.duemaId??'');if(/^\d{1,50}$/.test(id)&&!/^0+$/.test(id)){if(dmpIds.has(id))throw fail('スガツールのDMP IDが重複しています。');dmpIds.add(id);}
  people.set(e.entryId,e);
 }
 const unique=new Map();
 for(const m of matches){
  if(!m||typeof m.matchId!=='string'||!m.matchId||m.matchId.length>200||Number(m.round)!==round||m.eventId&&m.eventId!==eventId)throw fail('スガツールの試合番号・回戦・大会が不正です。');
  if(m.seatNumber!=null&&(!Number.isSafeInteger(Number(m.seatNumber))||Number(m.seatNumber)<1))throw fail('スガツールの卓番号が不正です。');
  if(unique.has(m.matchId)&&JSON.stringify(unique.get(m.matchId))!==JSON.stringify(m))throw fail('スガツールの同じ試合が競合しています。');unique.set(m.matchId,m);
 }
 const rows=[],seen=new Set();
 for(const m of unique.values()){
  const reasons=[],sides=[];
  for(const side of [1,2]){
   const id=m['player'+side+'Id'];if(id==null)continue;if(!uuid.test(id)||seen.has(id))throw fail('スガツールの同一回戦に不正・重複参加者があります。');seen.add(id);
   const e=people.get(id);if(!e)reasons.push('missing_entry');const dmp=String(e?.duemaId??'');
   sides.push({participantKey:id,entryId:id,internalParticipantId:id,dmpId:/^\d{1,50}$/.test(dmp)&&!/^0+$/.test(dmp)?dmp:null,
    name:e?.playerName||m['player'+side+'Name']||'名前未取得',entryNo:e?.entryNo??null,table:m.seatNumber==null?null:Number(m.seatNumber),round,side,dropped:e?.dropped===true,memoExternal:Boolean(e)});
  }
  if(!sides.length)throw fail('スガツールの選手のいない試合は保存できません。');
  let outcome='unresolved',winnerKey=null;
  if(m.result==='player1'||m.result==='player2'){
   const win=sides.find(p=>p.side===(m.result==='player1'?1:2));
   if(sides.length!==2)reasons.push('missing_opponent');
   if(!win||m.winnerId!==win.entryId)reasons.push('winner_mismatch');
   if(!reasons.length){outcome='win_loss';winnerKey=win.participantKey;}
  }else if(m.result==='bye'){
   if(sides.length!==1)reasons.push('invalid_bye');
   if(m.winnerId!==sides[0].entryId)reasons.push('winner_mismatch');
   if(!reasons.length){outcome='bye';sides[0].bye=true;}
  }else reasons.push('unknown_result');
  rows.push({round,table:m.seatNumber==null?null:Number(m.seatNumber),matchKey:m.matchId,sides,outcome,winnerKey,reason:reasons.join(',')||null,rawResult:{result:m.result??null,winnerId:m.winnerId??null,status:m.status??null}});
 }
 rows.sort((a,b)=>(a.table??Infinity)-(b.table??Infinity)||a.matchKey.localeCompare(b.matchKey));
 return{round,matches:rows,participants:rows.flatMap(m=>m.sides.map(p=>({...p,opponentName:m.sides.find(q=>q.participantKey!==p.participantKey)?.name||'相手なし',outcome:m.outcome,winnerKey:m.winnerKey})))};
}
async function fetchSugatoolRounds(value,fetchImpl=fetch){
 const source=parseSugatoolUrl(typeof value==='string'?value:value.sourceUrl),deadline=Date.now()+60000;
 async function get(suffix){
  const left=deadline-Date.now();if(left<=0)throw fail('スガツール全回戦の取得がタイムアウトしました。',504);
  try{const r=await fetchImpl(API_BASE+'/events/'+source.eventId+suffix,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(Math.min(left,15000)),headers:{Accept:'application/json'}});if(!r.ok)throw fail('スガツールの公開API取得に失敗しました（HTTP '+r.status+'）。');return await r.json();}catch(e){if(e.status)throw e;throw fail('スガツール全回戦の取得に失敗しました。');}
 }
 const event=await get('');if(!event||event.eventId!==source.eventId)throw fail('スガツールの大会情報が一致しません。');if(event.published===false||event.visibility==='private')throw fail('スガツールの大会は未公開です。',403);
 const last=Number(event.currentRound??0);if(!Number.isInteger(last)||last<0||last>100)throw fail('スガツールの公開回戦数が不正です。');
 const entries=await get('/entries'),rounds=[];if(!Array.isArray(entries)||entries.length>10000)throw fail('スガツールの参加者一覧形式が不正です。');let total=0;
 for(let round=1;round<=last;round++){const parsed=normalizeSugatoolRound(source.eventId,round,entries,await get('/matches?round='+round));total+=parsed.matches.length;if(total>10000)throw fail('スガツールの全対戦数が上限を超えました。');if(parsed.matches.length)rounds.push(parsed);}
 return rounds;
}
module.exports={normalizeSugatoolRound,fetchSugatoolRounds};
