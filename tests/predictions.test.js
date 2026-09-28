const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture({missingDeck=false,failWrite=false}={}) {
  const calls=[], routes=new Map();
  let released=false;
  const client={async query(sql,args){
    calls.push({sql,args});
    if(sql.includes('FROM decks WHERE')) return {rows:missingDeck?[]:[{id:4,name:'正式名'}]};
    if(sql.includes('SELECT id FROM players')) return {rows:[{id:9}]};
    if(sql.includes('SELECT id FROM events')) return {rows:[{id:7}]};
    if(failWrite && sql.includes('INSERT INTO event_deck_predictions')) throw Error('failure');
    return {rows:[]};
  },release(){released=true;}};
  const pool={connect:async()=>client,query:async(sql,args)=>{
    calls.push({sql,args});
    if(sql.includes('SELECT id FROM events')) return {rows:[{id:7}]};
    if(sql.includes('FROM event_deck_predictions')) return {rows:[{dmp_id:'123',manual_deck_id:null,deck_name:null}]};
    return {rows:[{id:4,name:'正式名'}]};
  }};
  const app={use(){},listen(){}};
  for(const method of ['get','post','put']) app[method]=(route,handler)=>routes.set(method+route,handler);
  const express=Object.assign(()=>app,{json(){},static(){}});
  const context=vm.createContext({require(name){if(name==='express')return express;if(name==='pg')return {Pool:function(){return pool;}};return require(name);},__dirname:process.cwd(),process:{env:{}},console:{log(){},error(){}},URL,URLSearchParams,TextDecoder});
  vm.runInContext(fs.readFileSync('server.js','utf8'),context);
  return {context,calls,get released(){return released;},async save(overrides={}){
    const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;}};
    await routes.get('put/api/event-deck-prediction')({body:{shopId:'s',eventId:'e',seq:'1',dmpId:'123',mode:'manual',deckId:4,...overrides}},res);
    return res;
  }};
}

test('automatic prediction rules: zero, one, two and three histories',()=>{
  const {context}=fixture();
  const cases=[[[],null],[['A'],'A'],[['A','A'],'A'],[['A','B'],'A'],[['A','A','A'],'A'],[['A','B','B'],'B'],[['A','B','A'],'A'],[['B','B','A'],'B'],[['A','B','C'],'A']];
  for(const [names,expected] of cases){
    const p=context.predictDeck(names.map(deckName=>({deckName})));
    assert.equal(p.finalDeckName,expected);
    assert.equal(p.source,expected?'auto':'unknown');
  }
});

test('manual value and explicit unknown override automatic predictions',()=>{
  const {context}=fixture();
  for(const deck_name of ['B',null]){
    const p=context.predictDeck([{deckName:'A'}],{manual_deck_id:deck_name?4:null,deck_name});
    assert.equal(p.autoDeckName,'A');
    assert.equal(p.finalDeckName,deck_name);
    assert.equal(p.source,'manual');
    assert.equal(p.hasManualPrediction,true);
  }
  assert.equal(context.predictDeck([{deckName:'A'}],undefined,true).autoStatus,'unavailable');
});

test('batch lookup preserves explicit unknown and uses only two queries',async()=>{
  const f=fixture();
  const data=await f.context.loadPredictionData('s','e','1');
  assert.equal(f.calls.length,2);
  assert.ok(data.manual.has('123'));
  assert.equal(data.manual.get('123').manual_deck_id,null);
});

test('manual save upserts event/player/deck references and commits',async()=>{
  const f=fixture();const res=await f.save();
  assert.equal(res.code,200);
  assert.equal(res.body.manualDeckName,'正式名');
  assert.equal(res.body.hasManualPrediction,true);
  const write=f.calls.find(c=>c.sql.includes('INSERT INTO event_deck_predictions'));
  assert.deepEqual(Array.from(write.args),[7,9,4]);
  assert.match(write.sql,/ON CONFLICT \(event_record_id, player_id\)/);
  assert.equal(f.calls.at(-1).sql,'COMMIT');
  assert.equal(f.released,true);
});

test('manual unknown is stored as null, resetting deletes only the event/player override',async()=>{
  const f=fixture();const res=await f.save({deckId:null});
  assert.equal(res.body.hasManualPrediction,true);
  assert.equal(res.body.manualDeckName,null);
  assert.equal(f.calls.find(c=>c.sql.includes('INSERT INTO event_deck_predictions')).args[2],null);
  const reset=fixture();const result=await reset.save({mode:'auto'});
  assert.equal(result.body.hasManualPrediction,false);
  const deletion=reset.calls.find(c=>c.sql.startsWith('DELETE FROM event_deck_predictions'));
  assert.deepEqual(Array.from(deletion.args),[7,9]);
  assert.ok(!reset.calls.some(c=>c.sql.includes('INSERT INTO events')));
});

test('invalid input is rejected before DB access',async()=>{
  for(const body of [{deckId:'4'},{deckId:-1},{deckId:undefined},{mode:'bad'},{seq:''},{dmpId:[]}]){
    const f=fixture();assert.equal((await f.save(body)).code,400);assert.equal(f.calls.length,0);
  }
});

for(const options of [{missingDeck:true},{failWrite:true}]){
  test('failed save rolls back and releases '+JSON.stringify(options),async()=>{
    const f=fixture(options);const res=await f.save();
    assert.equal(res.code,options.missingDeck?404:500);
    assert.equal(f.calls.at(-1).sql,'ROLLBACK');
    assert.equal(f.released,true);
  });
}
