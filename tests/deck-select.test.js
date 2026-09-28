const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
class Element {
  constructor(){this.children=[];this.value='';}
  setAttribute(){}
  appendChild(child){this.children.push(child);}
  replaceChildren(){this.children=[];}
}
function ui(){const c=vm.createContext({document:{createElement:()=>new Element()}});vm.runInContext(fs.readFileSync('deck-select.js','utf8'),c);return c;}
const decks=[{id:1,name:'正式A',aliases:['別名A']},{id:2,name:'正式B',aliases:[]}];
test('only official options plus unselected; canonical and alias history are restored',()=>{
  const c=ui();
  for(const name of ['正式A','別名A']){
    const select=c.createDeckSelect(decks,{deckName:name});
    assert.equal(select.value,'1');
    assert.deepEqual(Array.from(select.children,o=>o.textContent),['未選択','正式A','正式B']);
  }
});
test('unknown historical name is retained as metadata, not a selectable obsolete deck',()=>{
  const select=ui().createDeckSelect(decks,{deckName:'旧未登録名'});
  assert.equal(select.value,'');assert.equal(select.unmatchedDeckName,'旧未登録名');assert.equal(select.children.length,3);
});
test('independent selects, imported ID, renamed deck, and merged option removal',()=>{
  const c=ui();const a=c.createDeckSelect(decks,{deckId:1});const b=c.createDeckSelect(decks,{deckId:2});
  a.setSavedDeck(2,'正式B');assert.equal(a.value,'2');assert.equal(b.value,'2');
  a.setDeckOptions([{id:2,name:'変更後の正式B'}]);a.setSavedDeck(2,'変更後の正式B');
  assert.deepEqual(Array.from(a.children,o=>o.value),['','2']);
  assert.equal(a.children[1].textContent,'変更後の正式B');
});

function api() {
  const routes=new Map(),writes=[];
  const app={use(){},listen(){}};for(const method of ['get','post','put'])app[method]=(path,fn)=>routes.set(method+path,fn);
  const express=Object.assign(()=>app,{json(){},static(){}});
  const client={release(){},async query(sql,args){
    if(sql==='SELECT name FROM decks WHERE id = $1')return{rows:args[0]===1?[{name:'現在の正式名'}]:[]};
    if(sql.includes('SELECT id FROM players'))return{rows:[{id:5}]};
    if(sql.includes('SELECT id FROM deck_history'))return{rows:[]};
    if(sql.includes('INSERT INTO deck_history')){writes.push(args);return{rows:[{id:10,deck_name:args[5]}]};}
    return{rows:[]};
  }};
  const c=vm.createContext({require(name){if(name==='express')return express;if(name==='pg')return{Pool:function(){return{connect:async()=>client};}};return require(name);},__dirname:process.cwd(),process:{env:{}},console:{log(){},error(){}},URL,TextDecoder});
  vm.runInContext(fs.readFileSync('server.js','utf8'),c);
  return{writes,async save(deckId){const res={code:200,status(n){this.code=n;return this;},json(body){this.body=body;}};await routes.get('post/api/deck-history')({body:{dmpId:'101',shopId:'s',eventId:'e',seq:'2',eventDate:'2026-09-28',deckId,deckName:'信用しない古い名前'}},res);return res;}};
}
test('history API resolves selected ID to current master name and preserves event/player keys',async()=>{
  const f=api();const result=await f.save(1);
  assert.equal(result.code,200);assert.equal(result.body.normalizedDeckName,'現在の正式名');
  assert.deepEqual(f.writes[0],[5,'s','e','2','2026-09-28','現在の正式名']);
});
test('unselected, invalid and merged-away IDs cannot write empty or stale names',async()=>{
  for(const [id,status] of [[null,400],['',400],[-1,400],[999,404]]){const f=api();assert.equal((await f.save(id)).code,status);assert.equal(f.writes.length,0);}
});
