// Endpoints verified in the public application bundles; no auth or private API calls.
const API_BASE='https://boi0m28318.execute-api.ap-northeast-1.amazonaws.com/v1/prod';
const ORIGIN='https://sugatool.nojigikucs.com';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail=(message,status=502)=>Object.assign(new Error(message),{status});
function parseSugatoolUrl(value){
 let url;try{url=new URL(value);}catch{throw fail('スガツールのURL形式が不正です。',400);}
 const match=/^\/events\/([^/]+)\/matches\/?$/.exec(url.pathname);
 if(url.origin!==ORIGIN||url.username||url.password||!match||!UUID.test(match[1]))throw fail('スガツールのURL形式が不正です。events/{UUID}/matchesを指定してください。',400);
 const eventId=match[1].toLowerCase();
 return {provider:'sugatool',eventId,adminKey:eventId,sourceUrl:ORIGIN+'/events/'+eventId+'/matches'};
}
function normalizeSugatool(event,entries,matches){
 if(!event||!UUID.test(event.eventId)||!Array.isArray(entries)||!Array.isArray(matches))throw fail('スガツールのAPIレスポンス形式が想定外です。');
 const round=event.currentRound==null||event.currentRound===0?null:Number(event.currentRound);
 if(round!==null&&(!Number.isInteger(round)||round<1))throw fail('スガツールのcurrentRoundの形式が想定外です。');
 const seats=new Map(),history=new Map(),seenRounds=new Map();
 for(const match of matches){
  if(!match||match.eventId&&match.eventId!==event.eventId)throw fail('スガツールのmatchesの形式が想定外です。');
  const matchRound=Number(match.round);
  if(!Number.isInteger(matchRound)||matchRound<1||round===null||matchRound>round)continue;
  if(!seenRounds.has(matchRound))seenRounds.set(matchRound,new Set());
  const roundPlayers=seenRounds.get(matchRound);
  if(!Number.isInteger(Number(match.seatNumber))||Number(match.seatNumber)<1)throw fail('スガツールの卓番号が不正です。');
  for(const side of [1,2]){
   const id=match['player'+side+'Id'];if(id==null)continue;
   if(!UUID.test(id)||roundPlayers.has(id))throw fail('スガツールのmatches参加者が不正または重複しています。');
   roundPlayers.add(id);
   const info={table:Number(match.seatNumber),side,bye:match.result==='bye',name:match['player'+side+'Name']};
   if(!history.has(id)||info.name)history.set(id,info);
   if(matchRound===round)seats.set(id,info);
  }
 }
 const participants=[],seen=new Set(),dmpIds=new Set();
 for(const entry of entries){
  if(!entry||typeof entry!=='object')throw fail('スガツールのentries形式が想定外です。');
  if(entry.isReception!==true&&!history.has(entry.entryId))continue;
  if(!UUID.test(entry.entryId)||entry.eventId&&entry.eventId!==event.eventId||typeof entry.playerName!=='string'||!entry.playerName.trim())throw fail('スガツールの受付済み参加者データが不正です。');
  if(seen.has(entry.entryId))continue;seen.add(entry.entryId);
  const dmpId=String(entry.duemaId??'');
  const validDmp=/^\d{1,50}$/.test(dmpId)&&!/^0+$/.test(dmpId);
  if(validDmp&&dmpIds.has(dmpId))throw fail('スガツールの受付済み参加者でDMP IDが重複しています。');if(validDmp)dmpIds.add(dmpId);
  const seat=seats.get(entry.entryId);
  participants.push({participantKey:entry.entryId,entryId:entry.entryId,dmpId:validDmp?dmpId:null,name:entry.playerName.trim(),entryNo:entry.entryNo??null,
   table:seat?.table??null,side:seat?.side??null,bye:seat?.bye??false,dropped:entry.dropped===true,round});
 }
 // Match IDs remain authoritative when the entries endpoint omits a player.
 for(const [id,info] of history){
  const seat=seats.get(id);
  if(seen.has(id))continue;
  seen.add(id);
  participants.push({participantKey:id,entryId:id,dmpId:null,
   name:typeof info.name==='string'&&info.name.trim()?info.name.trim():'名前未取得',entryNo:null,
   table:seat?.table??null,side:seat?.side??null,bye:seat?.bye??false,dropped:false,round});
 }
 participants.sort((a,b)=>(a.table??Infinity)-(b.table??Infinity)||(a.side??0)-(b.side??0)||String(a.entryNo??'').localeCompare(String(b.entryNo??''),'en',{numeric:true})||a.entryId.localeCompare(b.entryId));
 const formats=Array.isArray(event.gameFormat)?[...new Set(event.gameFormat)]:[];
 const format=formats.length===1&&['original','advance','2block'].includes(formats[0])?formats[0]:null;
 return {format,latestRound:round,participants,warning:!participants.length?'受付済み参加者が0人です。':round===null?'currentRoundがまだ設定されていません。受付済み参加者を卓なしで表示します。':null};
}
async function fetchSugatool(source,fetchImpl=fetch){
 const deadline=Date.now()+60000;
 async function get(suffix,label){
  const remaining=deadline-Date.now();
  if(remaining<=0)throw fail('スガツール全回戦の取得がタイムアウトしました。',504);
  try{
   const response=await fetchImpl(API_BASE+'/events/'+source.eventId+suffix,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(Math.min(remaining,15000)),headers:{Accept:'application/json'}});
   if(response.status===404&&!suffix)throw fail('スガツールのイベントが存在しません。',404);
   if(!response.ok)throw fail('スガツールの'+label+'取得失敗（HTTP '+response.status+'）。');
   try{return await response.json();}catch{throw fail('スガツールの'+label+' APIレスポンス形式が想定外です。');}
  }catch(error){if(error.status)throw error;throw fail('スガツールの'+label+'取得失敗：接続・タイムアウトを確認してください。');}
 }
 const event=await get('','イベント情報');
 if(!event||event.eventId!==source.eventId)throw fail('スガツールのイベント情報APIレスポンス形式が想定外です。');
 if(event.published===false)throw fail('スガツールのイベントは未公開です。',403);
 const round=event.currentRound;
 if(round!=null&&round!==0&&(!Number.isInteger(Number(round))||Number(round)<1||Number(round)>100))throw fail('スガツールのcurrentRoundの形式が想定外です。');
 const entries=await get('/entries','entries');
 if(!Array.isArray(entries)||entries.length>10000)throw fail('スガツールの参加者一覧形式が不正です。');
 const matches=[];
 // Fetch every public numbered round, at most three requests at a time.
 // Keep archive persistence/validation separate from this live roster snapshot.
 for(let start=1;start<=Number(round||0);start+=3){
  const batch=await Promise.all(Array.from({length:Math.min(3,Number(round)-start+1)},(_,i)=>
   get('/matches?round='+(start+i),'matches').then(rows=>{
    if(!Array.isArray(rows)||rows.some(m=>!m||Number(m.round)!==start+i))throw fail('スガツールの対戦表の回戦・形式が不正です。');
    return rows;
   })));
  for(const rows of batch){if(matches.length+rows.length>10000)throw fail('スガツールの全対戦数が上限を超えました。');matches.push(...rows);}
 }
 return normalizeSugatool(event,entries,matches);
}
module.exports={parseSugatoolUrl,normalizeSugatool,fetchSugatool,API_BASE};
