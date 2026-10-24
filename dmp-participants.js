// Shared participant-list reader. IDs remain strings (including leading zeroes).
async function readEventParticipants({shopId,eventId,seq}, fetchImpl = fetch) {
  const participants=[];
  const signal=AbortSignal.timeout(30000);
  for(let offset=0;offset<32000;offset+=32) {
    const response=await fetchImpl('https://www.dmp-ranking.com/Deckbuild/Event/EventParticipantsList.aspx/GetResultRanking',{
      method:'POST',headers:{'Content-Type':'application/json; charset=UTF-8'},
      signal,
      body:JSON.stringify({shopID:String(shopId),eventID:String(eventId),heldID:String(seq),offset})});
    if(!response.ok) throw new Error('DMPランキング取得エラー: HTTP '+response.status);
    const result=await response.json();
    const data=typeof result.d==='string'?JSON.parse(result.d):result.d;
    if(!Array.isArray(data)) throw new Error('DMP参加者のデータ形式が不正です。');
    for(const p of data) participants.push({id:p['会員ID'],name:p['ハンドルネーム']});
    if(data.length<32) return participants;
  }
  throw new Error('DMP参加者の取得件数が上限を超えました。');
}
// Share only currently executing public reads; no settled response is cached.
const flights=new WeakMap();
async function fetchEventParticipants(event,fetchImpl=fetch){
 let pending=flights.get(fetchImpl);if(!pending){pending=new Map();flights.set(fetchImpl,pending);}
 const key=JSON.stringify([String(event.shopId),String(event.eventId),String(event.seq)]);
 let request=pending.get(key);
 if(!request){request=readEventParticipants(event,fetchImpl);pending.set(key,request);request.finally(()=>{if(pending.get(key)===request)pending.delete(key);}).catch(()=>{});}
 // Callers may modify their list without changing another caller's data.
 return (await request).map(row=>({...row}));
}
module.exports={fetchEventParticipants};
