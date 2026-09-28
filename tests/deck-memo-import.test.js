const {test}=require('node:test');
const assert=require('node:assert/strict');
const {classify,installImportRoutes}=require('../deck-memo-import');
const {normalizeDeckName,saveDeckHistory}=require('../deck-history-store');

function fixture() {
  const routes=new Map(),calls=[];
  const history=new Map([[2,{id:22,name:'Aの別名'}],[3,{id:23,name:'A'}],[6,{id:26,name:'A'}]]);
  let snapshot,failAt=0,writes=0,revision=0,missing=false,badDeck=false;
  function rows(){
    if(missing)return[];
    return [1,2,3,4,5,6].map(n=>({archive_id:7,archive_updated_at:revision,event_name:'CS',event_record_id:9,event_date:'2026-09-28',
      dmp_id:String(100+n),memo_name:'保存時の名前'+n,deck_id:n===4?null:n===3||n===6?2:1,
      memo_updated_at:0,memo_deck_name:n===4?null:badDeck?null:n===3||n===6?'B':'A',player_id:n,handle_name:'現在の名前'+n,
      result_player_id:n===5?null:n,history_id:history.get(n)?.id||null,
      current_deck_name:history.get(n)?.name||null,history_updated_at:0,
      canonical_deck_name:history.get(n)?.name==='Aの別名'?'A':history.get(n)?.name||null}));
  }
  const query=async(sql,args=[])=>{
    calls.push({sql,args});
    if(sql.startsWith('BEGIN'))snapshot=structuredClone(history);
    if(sql==='ROLLBACK'){history.clear();for(const [k,v] of snapshot)history.set(k,v);}
    if(sql.includes('a.id AS archive_id')) {
      assert.deepEqual(args,['s','e','2']);
      assert.match(sql,/p.dmp_id = m.dmp_id/);assert.match(sql,/r.event_record_id = e.id AND r.player_id = p.id/);
      assert.ok(!sql.includes('deck_memos '));return{rows:rows()};
    }
    if(sql.includes('SELECT id FROM deck_history'))return{rows:history.has(args[0])?[{id:history.get(args[0]).id}]:[]};
    if(sql.includes('INSERT INTO deck_history')) {
      writes++;if(writes===failAt)throw Error('write failure');
      assert.deepEqual(args.slice(1,5),['s','e','2','2026-09-28']);
      const value={id:1000+args[0],name:args[5]};history.set(args[0],value);return{rows:[value]};
    }
    if(sql.includes('UPDATE deck_history')){
      writes++;if(writes===failAt)throw Error('write failure');
      const pair=[...history].find(([,h])=>h.id===args[2]);pair[1].name=args[1];return{rows:[pair[1]]};
    }
    return{rows:[]};
  };
  installImportRoutes({post:(p,h)=>routes.set(p,h)},{query,connect:async()=>({query,release(){}})});
  async function call(path,body){const res={code:200,status(c){this.code=c;return this;},json(b){this.body=b;}};await routes.get(path)({body:{shopId:'s',eventId:'e',seq:'2',...body}},res);return res;}
  return{history,calls,change(){revision++;},missing(){missing=true;},bad(){badDeck=true;},fail(n){failAt=n;},
    preview:()=>call('/api/deck-memo/import-preview',{}),
    apply:(preview,overwriteDmpIds=[],extra={})=>call('/api/deck-memo/import',{archiveId:7,token:preview.token,overwriteDmpIds,...extra})};
}

test('classifies by result membership, null deck and canonical current deck; rejects invalid master ID',()=>{
  assert.equal(classify({deck_id:1,memo_deck_name:'A',result_player_id:1,history_id:null}),'new');
  assert.equal(classify({deck_id:1,memo_deck_name:'A',result_player_id:1,history_id:2,canonical_deck_name:'A'}),'same');
  assert.equal(classify({deck_id:1,memo_deck_name:'B',result_player_id:1,history_id:2,canonical_deck_name:'A'}),'conflict');
  assert.equal(classify({deck_id:null,result_player_id:1}),'unselected');
  assert.equal(classify({deck_id:1,memo_deck_name:'A',result_player_id:null}),'absent');
  assert.throws(()=>classify({deck_id:999,memo_deck_name:null}),/デッキID/);
});

test('preview counts all categories and uses current player name without using name for identity',async()=>{
  const f=fixture();const p=(await f.preview()).body;
  assert.deepEqual(p.counts,{new:1,same:1,conflict:2,unselected:1,absent:1});
  assert.equal(p.players[0].dmpId,'101');assert.equal(p.players[0].name,'現在の名前1');
  assert.equal(f.history.size,3);
});

test('default keeps conflicts; repeated import is a no-op and never writes ranks',async()=>{
  const f=fixture();const p=(await f.preview()).body;
  const result=await f.apply(p);assert.equal(result.code,200);assert.equal(result.body.insertedCount,1);assert.equal(result.body.updatedCount,0);
  assert.equal(f.history.get(3).name,'A');assert.equal(f.history.has(4),false);assert.equal(f.history.has(5),false);
  const next=(await f.preview()).body;assert.equal(next.counts.new,0);assert.equal(next.counts.same,2);
  assert.equal((await f.apply(next)).body.changes.length,0);assert.equal(f.history.size,4);
  assert.ok(!f.calls.some(c=>/(INSERT INTO|UPDATE|DELETE FROM) event_results/.test(c.sql)));
});

test('only explicitly selected conflicts are overwritten using current master name',async()=>{
  const f=fixture();const result=await f.apply((await f.preview()).body,['103']);
  assert.equal(result.body.updatedCount,1);assert.equal(f.history.get(3).name,'B');assert.equal(f.history.get(6).name,'A');
});

test('rejects stale preview, wrong archive and fabricated conflict selection',async()=>{
  const f=fixture();const p=(await f.preview()).body;f.change();
  assert.equal((await f.apply(p,['103'])).code,409);assert.equal(f.history.size,3);
  const next=(await f.preview()).body;
  assert.equal((await f.apply(next,[],{archiveId:999})).code,409);
  assert.equal((await f.apply(next,['105'])).code,409);
});

test('missing archive and invalid deck cannot write history',async()=>{
  const f=fixture();f.missing();assert.equal((await f.preview()).body.archive,null);
  const g=fixture();g.bad();assert.equal((await g.preview()).code,409);assert.equal(g.history.size,3);
});

test('second write failure rolls back first insert and all changes',async()=>{
  const f=fixture();f.fail(2);const result=await f.apply((await f.preview()).body,['103']);
  assert.equal(result.code,500);assert.equal(f.history.has(1),false);assert.equal(f.history.get(3).name,'A');
  assert.equal(f.calls.at(-1).sql,'ROLLBACK');
});

test('shared normalizer retains aliases and unregistered names; writer updates existing row',async()=>{
  const normalized=await normalizeDeckName({query:async()=>({rows:[{name:'正式名'}]})},'別名');
  assert.equal(normalized,'正式名');
  assert.equal(await normalizeDeckName({query:async()=>({rows:[]})},' 未登録名 '),'未登録名');
  const calls=[];
  await saveDeckHistory({query:async(sql,args)=>{calls.push({sql,args});return{rows:[{id:12}]};}},
    {playerId:1,shopId:'s',eventId:'e',seq:'2',eventDate:'2026-09-28',deckName:'正式名'});
  assert.match(calls[1].sql,/UPDATE deck_history/);assert.equal(calls[1].args[2],12);
});
