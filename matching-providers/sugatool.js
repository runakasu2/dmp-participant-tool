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
 const seats=new Map();
 for(const match of matches){
  if(!match||match.eventId&&match.eventId!==event.eventId)throw fail('スガツールのmatchesの形式が想定外です。');
  if(Number(match.round)!==round)continue;
  if(!Number.isInteger(Number(match.seatNumber))||Number(match.seatNumber)<1)throw fail('スガツールの卓番号が不正です。');
  for(const side of [1,2]){
   const id=match['player'+side+'Id'];if(id==null)continue;
   if(!UUID.test(id)||seats.has(id))throw fail('スガツールのmatches参加者が不正または重複しています。');
   seats.set(id,{table:Number(match.seatNumber),side,bye:match.result==='bye'});
  }
 }
 const participants=[],seen=new Set(),dmpIds=new Set();
 for(const entry of entries){
  if(!entry||typeof entry!=='object')throw fail('スガツールのentries形式が想定外です。');
  if(entry.isReception!==true)continue;
  if(!UUID.test(entry.entryId)||entry.eventId&&entry.eventId!==event.eventId||typeof entry.playerName!=='string'||!entry.playerName.trim())throw fail('スガツールの受付済み参加者データが不正です。');
  if(seen.has(entry.entryId))continue;seen.add(entry.entryId);
  const dmpId=String(entry.duemaId??'');
  if(!/^\d{1,50}$/.test(dmpId)||/^0+$/.test(dmpId))throw fail('スガツールの受付済み参加者に有効なduemaIdがありません。参加者情報を確認してください。');
  if(dmpIds.has(dmpId))throw fail('スガツールの受付済み参加者でDMP IDが重複しています。');dmpIds.add(dmpId);
  const seat=seats.get(entry.entryId);
  participants.push({participantKey:entry.entryId,entryId:entry.entryId,dmpId,name:entry.playerName.trim(),entryNo:entry.entryNo??null,
   table:seat?.table??null,side:seat?.side??null,bye:seat?.bye??false,dropped:entry.dropped===true,round});
 }
 participants.sort((a,b)=>(a.table??Infinity)-(b.table??Infinity)||(a.side??0)-(b.side??0)||String(a.entryNo??'').localeCompare(String(b.entryNo??''),'en',{numeric:true})||a.entryId.localeCompare(b.entryId));
 const formats=Array.isArray(event.gameFormat)?[...new Set(event.gameFormat)]:[];
 const format=formats.length===1&&['original','advance','2block'].includes(formats[0])?formats[0]:null;
 return {format,latestRound:round,participants,warning:!participants.length?'受付済み参加者が0人です。':round===null?'currentRoundがまだ設定されていません。受付済み参加者を卓なしで表示します。':null};
}
async function fetchSugatool(source,fetchImpl=fetch){
 async function get(suffix,label){
  try{
   const response=await fetchImpl(API_BASE+'/events/'+source.eventId+suffix,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000),headers:{Accept:'application/json'}});
   if(response.status===404&&!suffix)throw fail('スガツールのイベントが存在しません。',404);
   if(!response.ok)throw fail('スガツールの'+label+'取得失敗（HTTP '+response.status+'）。');
   try{return await response.json();}catch{throw fail('スガツールの'+label+' APIレスポンス形式が想定外です。');}
  }catch(error){if(error.status)throw error;throw fail('スガツールの'+label+'取得失敗：接続・タイムアウトを確認してください。');}
 }
 const event=await get('','イベント情報');
 if(!event||event.eventId!==source.eventId)throw fail('スガツールのイベント情報APIレスポンス形式が想定外です。');
 if(event.published===false)throw fail('スガツールのイベントは未公開です。',403);
 const round=event.currentRound;
 if(round!=null&&round!==0&&(!Number.isInteger(Number(round))||Number(round)<1))throw fail('スガツールのcurrentRoundの形式が想定外です。');
 const [entries,matches]=await Promise.all([get('/entries','entries'),round?get('/matches?round='+Number(round),'matches'):Promise.resolve([])]);
 return normalizeSugatool(event,entries,matches);
}
module.exports={parseSugatoolUrl,normalizeSugatool,fetchSugatool,API_BASE};
