const {test}=require('node:test');
const assert=require('node:assert/strict');
const {installArchiveRoutes}=require('../deck-memo-archives');
const {installMemoRoutes}=require('../deck-memo');

function fixture() {
  const routes=new Map(),archives=new Map(),members=new Map(),calls=[];
  const drafts=new Map([[1,{event_record_id:11,event_name:'大会A',event_date:'2026-09-28',admin_key:'karatachics',source_url:'https://nojigikucs.com/?admin=karatachics'}],
    [2,{event_record_id:12,event_name:'大会B',event_date:'2026-09-29',admin_key:'karatachics',source_url:'https://nojigikucs.com/?admin=karatachics'}],
    [3,{event_record_id:13,event_name:'大会C',event_date:'2026-09-30',admin_key:'hattics',source_url:'https://nojigikucs.com/?admin=hattics'}]]);
  let roster=[{dmp_id:'101',handle_name:'保存当時の名前',entry_no:'33',table_no:1,round:2,player_id:8,deck_id:4},
    {dmp_id:'102',handle_name:'未登録選手',entry_no:'20',table_no:1,round:2,player_id:null,deck_id:null}];
  let deckName='正式名',fail=false,snapshot;
  const query=async(sql,args=[])=>{
    calls.push(sql);
    if(sql.startsWith('BEGIN')) snapshot={archives:structuredClone(archives),members:structuredClone(members)};
    if(sql==='ROLLBACK') {archives.clear();members.clear();for(const [k,v] of snapshot.archives)archives.set(k,v);for(const[k,v]of snapshot.members)members.set(k,v);}
    if(sql.includes('FROM deck_memo_events m JOIN events'))return{rows:drafts.has(args[0])?[drafts.get(args[0])]:[]};
    if(sql.includes('FROM deck_memo_roster r'))return{rows:structuredClone(roster)};
    if(sql.includes('INSERT INTO deck_memo_archives')) {
      const old=Array.from(archives.values()).find(a=>a.event_record_id===args[0]);
      const id=old?.id||archives.size+1;
      archives.set(id,{id,event_record_id:args[0],event_name:args[1],event_date:args[2],admin_key:args[3],source_url:args[4]});return{rows:[{id}]};
    }
    if(sql.includes('INSERT INTO deck_memo_archive_players')) {
      if(fail)throw Error('write failure');
      for(const p of JSON.parse(args[1]))members.set(args[0]+':'+p.dmp_id,{...p,archive_id:args[0]});
    }
    if(sql.includes('COUNT(p.participant_key)'))return{rows:Array.from(archives.values()).sort((a,b)=>b.event_date.localeCompare(a.event_date)).map(a=>{
      const p=Array.from(members.values()).filter(p=>p.archive_id===a.id);return{...a,participant_count:p.length,registered_count:p.filter(p=>p.deck_id!==null).length};})};
    if(sql.includes('SELECT a.*, a.event_date')){
      const a=archives.get(args[0]);return{rows:a?Array.from(members.values()).filter(p=>p.archive_id===a.id).map(p=>({...a,...p,saved_date:a.event_date,shop_id:'3616',event_id:String(a.event_record_id),seq:'2',deck_name:p.deck_id===null?null:deckName})):[]};
    }
    return{rows:[]};
  };
  const pool={query,connect:async()=>({query,release(){}})};
  const app={get:(p,h)=>routes.set('GET '+p,h),post:(p,h)=>routes.set('POST '+p,h)};
  installArchiveRoutes(app,pool);
  async function call(method,path,body={},params={}){const res={code:200,status(c){this.code=c;return this;},json(b){this.body=b;}};await routes.get(method+' '+path)({body,params},res);return res;}
  return{archives,members,calls,setRoster(v){roster=v;},rename(){deckName='変更後の正式名';},fail(){fail=true;},
    save:id=>call('POST','/api/deck-memo/archives',{memoEventId:id}),list:()=>call('GET','/api/deck-memo/archives'),read:id=>call('GET','/api/deck-memo/archives/:id',{}, {id:String(id)})};
}

test('snapshot stores all players including unselected/unregistered, names and dates; rename uses deck reference',async()=>{
  const f=fixture();assert.equal((await f.save(1)).code,200);
  let data=(await f.read(1)).body;
  assert.equal(data.participantCount,2);assert.equal(data.registeredCount,1);
  assert.equal(data.participants[1].deckId,null);
  assert.equal(data.participants[0].name,'保存当時の名前');
  assert.equal(data.event.eventDate,'2026-09-28');
  f.rename();data=(await f.read(1)).body;assert.equal(data.participants[0].deckName,'変更後の正式名');
  assert.equal(data.participants[0].name,'保存当時の名前');
});

test('resave is unique by DMP event; same admin on another date and another admin remain separate',async()=>{
  const f=fixture();await f.save(1);await f.save(1);assert.equal(f.archives.size,1);assert.equal(f.members.size,2);
  await f.save(2);await f.save(3);assert.equal(f.archives.size,3);
  const list=(await f.list()).body.events;
  assert.equal(list[0].event_date,'2026-09-30');assert.equal(list[2].participant_count,2);
});

test('reset/empty roster cannot erase snapshot; list and detail have no external dependency',async()=>{
  const f=fixture();await f.save(1);f.setRoster([]);
  assert.equal((await f.save(1)).code,400);
  const offset=f.calls.length;
  assert.equal((await f.list()).body.events[0].participant_count,2);
  assert.equal((await f.read(1)).body.participants.length,2);
  assert.ok(f.calls.slice(offset).every(sql=>sql.includes('FROM deck_memo_archives')));
});

test('resave updates present players while retaining absent/dropped participants',async()=>{
  const f=fixture();await f.save(1);
  f.setRoster([{dmp_id:'101',handle_name:'保存し直した名前',entry_no:'33',table_no:2,round:3,player_id:8,deck_id:null}]);
  await f.save(1);const data=(await f.read(1)).body;
  assert.equal(data.participantCount,2);assert.equal(data.registeredCount,0);
});

test('write failure rolls back archive header and participants together',async()=>{
  const f=fixture();f.fail();assert.equal((await f.save(1)).code,500);
  assert.equal(f.archives.size,0);assert.equal(f.members.size,0);assert.equal(f.calls.at(-1),'ROLLBACK');
});

test('DMP-aware matching calls existing detail fetch, upserts same event key and scopes memo event',async()=>{
  const routes=new Map(),calls=[];let linkedArgs;
  const app={post:(p,h)=>routes.set(p,h),put(){}};
  const pool={query:async(sql,args)=>{calls.push(sql);
    if(sql.includes('INSERT INTO events')){linkedArgs=args;return{rows:[{id:42}]};}
    if(sql.includes('INSERT INTO deck_memo_events')){assert.equal(args[2],42);return{rows:[{id:17}]};}
    return{rows:[]};}};
  let dmpCalls=0;
  installMemoRoutes(app,pool,async url=>({ok:true,json:async()=>url.includes('get-users')?{users:[]}:{csInfo:[{round:1,table:1,user1id:101,user2id:102,user1:'A (0点)',user2:'B (0点)'}]}}),async url=>{
    dmpCalls++;assert.equal(url,'https://www.dmp-ranking.com/event.asp?ShopID=3616&EventID=336&Seq=2');
    return{shopId:'3616',eventId:'336',held:'2',eventName:'大会',eventDate:'2026-09-28'};
  });
  const res={status(){return this;},set(){},json(b){this.body=b;}};
  await routes.get('/api/deck-memo/matching')({body:{url:'https://nojigikucs.com/?admin=hattics',detailUrl:'https://www.dmp-ranking.com/event.asp?ShopID=3616&EventID=336&Seq=2'}},res);
  assert.equal(dmpCalls,1);assert.deepEqual(linkedArgs,['3616','336','2','大会','2026-09-28',null]);
  assert.equal(res.body.memoEventId,17);assert.equal(res.body.event.eventName,'大会');
  assert.ok(calls.some(sql=>sql.includes('INSERT INTO deck_memo_roster')));
  assert.ok(!calls.some(sql=>sql.includes('deck_memo_archive')));
});

for(const failure of ['dmp','matching'])test(failure+' failure never writes event/roster/archive',async()=>{
  const routes=new Map();let writes=0;
  installMemoRoutes({post:(p,h)=>routes.set(p,h),put(){}},{query:async()=>{writes++;}},async()=>{throw Error('offline');},async()=>{
    if(failure==='dmp')throw Error('offline');return{eventName:'A',eventDate:'2026-09-28'};
  });
  const res={status(c){this.code=c;return this;},json(){}};
  await routes.get('/api/deck-memo/matching')({body:{url:'https://nojigikucs.com/?admin=hattics',detailUrl:'https://www.dmp-ranking.com/event.asp?ShopID=1&EventID=1&Seq=1'}},res);
  assert.equal(res.code,502);assert.equal(writes,0);
});
