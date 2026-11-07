// Public check-in readers. Never fetch a user supplied URL.
const fail=(message,status=502)=>Object.assign(new Error(message),{status});
function parseCheckinUrl(value){
 let u;try{u=new URL(value);}catch{throw fail('外部URLが不正です。',400);}
 if(u.protocol!=='https:'||u.username||u.password||u.port)throw fail('許可されたHTTPS URLを指定してください。',400);
 if(u.hostname==='sugatool.nojigikucs.com'){
  const m=/^\/events\/([a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12})\/(?:entries|matches)\/?$/i.exec(u.pathname);
  if(m){const key=m[1].toLowerCase();return {provider:'sugatool',key,api:'https://boi0m28318.execute-api.ap-northeast-1.amazonaws.com/v1/prod/events/'+key+'/entries'};}
 }
 if(u.hostname==='nojigikucs.com'&&u.pathname==='/users-manage'&&u.searchParams.getAll('admin').length===1){
  const key=u.searchParams.get('admin');
  if(/^[a-zA-Z0-9_-]{1,100}$/.test(key))return {provider:'nojigiku',key,api:'https://axirq5jhn9.execute-api.ap-northeast-1.amazonaws.com/v1/get-users?'+new URLSearchParams({admin:key,detail:'true'})};
 }
 throw fail('スガツールのentries URL、またはのじぎくのusers-manage URLを指定してください。',400);
}
async function fetchCheckins(value,fetchImpl=fetch){
 const source=parseCheckinUrl(value);
 const response=await fetchImpl(source.api,{redirect:'error',signal:AbortSignal.timeout(15000),headers:{Accept:'application/json'}});
 if(!response.ok)throw fail('チェックイン取得失敗（HTTP '+response.status+'）。認証が必要な場合は取得できません。');
 const limit=2*1024*1024;
 if(Number(response.headers?.get('content-length'))>limit)throw fail('外部レスポンスが大きすぎます。');
 const reader=response.body?.getReader();
 if(!reader)throw fail('外部レスポンスを読み取れません。');
 const chunks=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)throw fail('外部レスポンスが大きすぎます。');chunks.push(Buffer.from(value));}}
 finally{await reader.cancel();}
 let json;try{json=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw fail('外部レスポンスがJSONではありません。');}
 const rows=source.provider==='sugatool'?json:json?.users;
 if(!Array.isArray(rows)||rows.length>10000)throw fail('外部参加者一覧の形式が不正です。');
 const participants=[],statusParticipants=[],seen=new Map();
 for(const r of rows){
  if(!r||typeof r!=='object'||Array.isArray(r))throw fail('外部参加者の形式が不正です。');
  const checked=source.provider==='sugatool'?r.isReception:r.checkedIn;
  if(typeof checked!=='boolean')throw fail('チェックイン状態が不正です。');
  const name=source.provider==='sugatool'?r.playerName:r.name;
  const rawId=source.provider==='sugatool'?r.duemaId:null;
  const id=typeof rawId==='string'?rawId.trim():Number.isSafeInteger(rawId)?String(rawId):'';
  const dmpId=/^\d{1,50}$/.test(id)&&!/^0+$/.test(id)?id:null;
  const providerId=source.provider==='sugatool'?r.entryId??r.entryNo??dmpId:r.id??r.no;
  if(typeof name!=='string'||!name.trim()||name.trim().length>100||providerId==null||!/^[\w-]{1,100}$/.test(String(providerId)))throw fail('外部参加者の名前・識別子が不正です。');
  if(r.confirmed!=null&&typeof r.confirmed!=='boolean'||r.dropped!=null&&typeof r.dropped!=='boolean')throw fail('外部参加者の状態が不正です。');
  const confirmed=source.provider==='sugatool'?(r.entryStatus==='confirmed'?true:r.entryStatus==='waitlisted'?false:null):r.confirmed??null;
  const participant={id:dmpId,name:name.trim(),externalKey:source.provider+':'+source.key+':'+providerId,provider:source.provider,checkedIn:checked,confirmed,entryStatus:r.entryStatus??null,dropped:r.dropped===true,checkInAt:r.checkInAt??null,entryNo:r.entryNo??r.no??null,paid:r.paid??null,dayOf:true};
  const key=dmpId?'dmp:'+dmpId:participant.externalKey;
  if(seen.has(key)){if(JSON.stringify(seen.get(key))!==JSON.stringify(participant))throw fail('外部参加者のID・状態が競合しています。');continue;}
  seen.set(key,participant);statusParticipants.push(participant);if(checked)participants.push(participant);
 }
 return {provider:source.provider,sourceKey:source.key,participants,statusParticipants};
}
// Only checked-in external entrants are added; the full roster supplies statuses for DMP entrants.
function mergeCheckins(base,external,statusParticipants=external){
 const result=base.map(p=>({...p,id:p.id==null?null:String(p.id),confirmed:null,checkedIn:null,entryStatus:null}));
 const ids=new Map(result.filter(p=>p.id!=null).map(p=>[p.id,p]));
 const keys=new Map(result.filter(p=>p.externalKey).map(p=>[p.externalKey,p]));
 for(const p of external){
  const old=p.id!=null?ids.get(String(p.id)):keys.get(p.externalKey);
  if(old)continue;
  const added={...p};result.push(added);if(p.id!=null)ids.set(String(p.id),added);keys.set(p.externalKey,added);
 }
 const statuses=new Map();
 for(const p of statusParticipants){
  const old=p.id!=null?ids.get(String(p.id)):keys.get(p.externalKey);
  if(!old)continue;
  const prior=statuses.get(old);
  // Conflicting sources cannot establish confirmation; never infer it from check-in/payment.
  statuses.set(old,prior ? {...p,confirmed:prior.confirmed===p.confirmed?p.confirmed:null} : p);
 }
 for(const [old,p] of statuses)Object.assign(old,{checkedIn:p.checkedIn,confirmed:p.confirmed,entryStatus:p.entryStatus,paid:p.paid,dropped:p.dropped});
 return result;
}
function predictionTargets(participants,confirmedOnly=false){return participants.filter(p=>!confirmedOnly||p.confirmed===true);}
if(typeof module!=='undefined')module.exports={parseCheckinUrl,fetchCheckins,mergeCheckins,predictionTargets};
