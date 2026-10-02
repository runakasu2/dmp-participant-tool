const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {buildPredictionSummary} = require('../prediction-summary');
const participant = name => ({prediction:{finalDeckName:name,autoDeckName:name,source:name?'auto':'unknown',autoStatus:'ok',hasManualPrediction:false}});

test('all known, some unknown, all unknown and empty retain correct totals and denominator',()=>{
  for(const names of [['A','A','B'],['A',null,null],[null,null],[]]){
    const s=buildPredictionSummary(names.map(participant));
    assert.equal(s.participantCount,names.length);
    assert.equal(s.decks.reduce((sum,d)=>sum+d.count,0),names.length);
    assert.equal(s.decks.at(-1).unknown,true);
    assert.equal(s.predictedCount+s.unknownCount,names.length);
    for(const d of s.decks) assert.equal(d.percentage,names.length?(d.count/names.length*100).toFixed(1):'0.0');
  }
  const s=buildPredictionSummary(['A',null,null,null].map(participant));
  assert.equal(s.coverage,'25.0');
  assert.equal(s.decks[0].percentage,'25.0');
  assert.equal(s.decks.at(-1).count,3);
});

test('uses final prediction and canonical names; sorts counts then names',()=>{
  const people=['白緑','白緑ザゼゼーン','白緑ドギラゴン逆','B','A'].map(participant);
  people.push({prediction:{autoDeckName:'B',finalDeckName:null,source:'manual'}});
  const s=buildPredictionSummary(people,[{name:'白緑ドギラゴン逆',aliases:['白緑','白緑ザゼゼーン']}]);
  assert.equal(s.decks[0].deckName,'白緑ドギラゴン逆');
  assert.equal(s.decks[0].count,3);
  assert.equal(s.decks[1].deckName,'A');
  assert.equal(s.decks[2].deckName,'B');
  assert.equal(s.unknownCount,1);
});

class Element {
  constructor(){this.children=[];this.handlers={};this.value='';}
  addEventListener(type,handler){this.handlers[type]=handler;}
  setAttribute(){}
  replaceChildren(){this.children=[];}
  append(...nodes){this.children.push(...nodes);}
  appendChild(node){this.children.push(node);}
}

test('successful manual save and reset immediately update aggregation without extra fetches; failure leaves totals unchanged',async()=>{
  const people=['A','A',null].map(participant);
  let updates=0, requests=0, fail=false;
  let summary=buildPredictionSummary(people);
  const source=fs.readFileSync('script.js','utf8');
  const context=vm.createContext({document:{createElement:()=>new Element()},fetch:async(url,options)=>{
    requests++;
    const body=JSON.parse(options.body);
    return {ok:!fail,json:async()=>fail?{error:'failed'}:{hasManualPrediction:body.mode==='manual',manualDeckId:body.mode==='manual'?2:null,manualDeckName:body.mode==='manual'?'B':null}};
  }});
  vm.runInContext(fs.readFileSync('deck-select.js','utf8'),context);
  vm.runInContext(source.slice(source.indexOf('function createPredictionCell'),source.indexOf('console.log(')),context);
  const cell=context.createPredictionCell(people[0],[{id:1,name:'A'},{id:2,name:'B'}],{shopId:'s',eventId:'e',seq:'1'},()=>{updates++;summary=buildPredictionSummary(people);});
  cell.children[1].value='2';
  await cell.children[2].handlers.click();
  assert.equal(summary.decks.find(d=>d.deckName==='B').count,1);
  assert.equal(summary.decks.find(d=>d.deckName==='A').percentage,'33.3');
  assert.equal(updates,1);
  await cell.children[3].handlers.click();
  assert.equal(summary.decks[0].deckName,'A');
  assert.equal(summary.decks[0].count,2);
  assert.equal(summary.decks[0].percentage,'66.7');
  assert.equal(updates,2);
  fail=true;
  await cell.children[2].handlers.click();
  assert.equal(updates,2);
  assert.equal(requests,3);
});
