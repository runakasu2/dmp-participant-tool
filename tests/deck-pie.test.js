global.Image=class {set src(value){this.naturalWidth=600;this.naturalHeight=840;this.onload();}};
const {test}=require('node:test'),assert=require('node:assert/strict');
const {buildPieChartItems,eventSummaryItems,deckPieColor,renderDeckPieChart,setDeckSummaryView}=require('../deck-pie');
class Element{
 constructor(tag){this.tag=tag;this.children=[];this.style={};this.attrs={};this.classList={add(){}};this.handlers={};}
 addEventListener(n,h){this.handlers[n]=h;}remove(){this.removed=true;}cloneNode(){const e=new Element(this.tag);e.attrs={...this.attrs};return e;}
 replaceChildren(){this.children=[];}appendChild(c){this.children.push(c);}prepend(c){this.children.unshift(c);}setAttribute(k,v){this.attrs[k]=v;}
}
const elements=new Map();global.document={createElement:t=>new Element(t),createElementNS:(ns,t)=>new Element(t),getElementById:id=>{if(!elements.has(id))elements.set(id,new Element('div'));return elements.get(id);}};
test('list and pie share registered objects and percentage; unknown completes total',()=>{
 const data={participantCount:10,unregisteredCount:2,decks:[{deckName:'A',count:8,percentage:'80.0'}]};const items=eventSummaryItems(data);
 assert.equal(items[0],data.decks[0]);assert.equal(items[1].percentage,'20.0');assert.equal(items.reduce((n,i)=>n+i.count,0),10);
 const c=new Element();renderDeckPieChart(c,items,{total:10});assert.equal(c.children[1].children.length,2);assert.match(c.children[1].children[0].textContent,/80.0%/);
});
test('one deck, all unknown, zero unknown, many decks and empty data render safely',()=>{
 for(const data of [
 {participantCount:1,decks:[{deckName:'A',count:1,percentage:'100.0'}],unregisteredCount:0},
 {participantCount:5,decks:[],unregisteredCount:5},
 {participantCount:80,decks:Array.from({length:80},(_,i)=>({deckName:'deck'+i,count:1,percentage:'1.3'})),unregisteredCount:0},
 {participantCount:0,decks:[],unregisteredCount:0}]){
 const c=new Element();const items=eventSummaryItems(data);renderDeckPieChart(c,items,{total:data.participantCount});
 if(!data.participantCount)assert.match(c.children[0].textContent,/表示できる/);
 else{assert.equal(c.children[1].children.length,buildPieChartItems(items).length);assert.ok(!JSON.stringify(c).includes('NaN'));if(data.decks.length<=1)assert.equal(c.children[0].children[0].tag,'circle');}
 }
});
test('switching visibility preserves existing list and expanded rows without requests',()=>{
 const table=document.getElementById('deck-summary-table');const expanded=new Element('tr');table.appendChild(expanded);
 setDeckSummaryView('pie');assert.equal(table.hidden,true);assert.equal(document.getElementById('deck-summary-pie').hidden,false);
 setDeckSummaryView('list');assert.equal(table.hidden,false);assert.equal(table.children[0],expanded);assert.equal(document.getElementById('deck-view-list').attrs['aria-pressed'],'true');
});
test('stable colors, neutral unknown and inconsistent totals are handled explicitly',()=>{
 assert.equal(deckPieColor({deckName:'A'}),deckPieColor({deckName:'A'}));assert.equal(deckPieColor({unknown:true}),'#9299a3');
 const c=new Element();renderDeckPieChart(c,[{deckName:'A',count:2,percentage:'200'}],{total:1});assert.match(c.children[0].textContent,/一致しない/);
});

test('prediction and actual chart modes are independent',()=>{
 setDeckSummaryView('pie');setDeckSummaryView('list','prediction');
 assert.equal(document.getElementById('deck-summary-pie').hidden,false);
 assert.equal(document.getElementById('prediction-summary-pie').hidden,true);
 setDeckSummaryView('pie','prediction');setDeckSummaryView('list');
 assert.equal(document.getElementById('prediction-summary-pie').hidden,false);
 assert.equal(document.getElementById('deck-summary-pie').hidden,true);
});
test('prediction renderer uses the same summary for list and chart on every update',()=>{
 const fs=require('node:fs'),vm=require('node:vm');
 const {buildPredictionSummary}=require('../prediction-summary');
 const source=fs.readFileSync('script.js','utf8');let captured;
 const context=vm.createContext({document,buildPredictionSummary,renderDeckPieChart:(container,items,options)=>{captured={items,options};renderDeckPieChart(container,items,options);}});
 vm.runInContext(source.slice(0,source.indexOf('function createPredictionCell')),context);
 for(const names of [[],[null,null],['A','A'],['A','B',null],['B','B',null],['A','B',null]]){
 context.people=names.map(finalDeckName=>({prediction:{finalDeckName}}));
 vm.runInContext('predictionParticipants=people;renderPredictionSummary();',context);
 assert.equal(captured.items.reduce((n,i)=>n+i.count,0),names.length);
 assert.equal(captured.options.total,names.length);
 assert.equal(captured.items.at(-1).deckName,'予想不明');
 const rows=document.getElementById('prediction-summary-list').children;
 captured.items.forEach((item,i)=>{assert.equal(rows[i].children[1].textContent,item.count+'人');assert.equal(rows[i].children[2].textContent,item.percentage+'%');});
 }
});

test('images are clipped without distortion, neutral slices ignore images and errors preserve base',()=>{
 const c=new Element();renderDeckPieChart(c,[{deckName:'A',count:9,percentage:'90',image_url:'https://example.com/a'},{deckName:'unknown',unknown:true,count:1,percentage:'10',image_url:'https://example.com/no'}]);
 const svg=c.children[0],images=svg.children.filter(e=>e.tag==='image');assert.equal(images.length,1);
 assert.equal(images[0].attrs.preserveAspectRatio,'xMidYMid slice');assert.match(images[0].attrs['clip-path'],/url/);
 images[0].handlers.error();assert.equal(images[0].removed,true);assert.ok(svg.children.some(e=>e.tag==='path'&&e.attrs.fill));
 const c2=new Element();renderDeckPieChart(c2,[{deckName:'A',count:2,percentage:'100',image_url:'https://example.com/a'}]);
 assert.notEqual(c2.children[0].children.find(e=>e.tag==='image').attrs['clip-path'],images[0].attrs['clip-path']);
});

test('pie-only grouping preserves original data, totals and unknown categories',()=>{
 for(const label of ['未登録','予想不明'])for(const smallCount of [0,1,5]){
  const items=[{deckName:'main',count:2,percentage:'unused',image_url:'https://example.com/main'},
   ...Array.from({length:smallCount},(_,i)=>({deckName:'small'+i,count:1,percentage:'3.3',image_url:'https://example.com/small'})),
   {deckName:label,count:1,unknown:true}];
  const original=JSON.stringify(items),total=3+smallCount;
  const result=buildPieChartItems(items,{total});
  assert.equal(JSON.stringify(items),original);
  assert.equal(result.reduce((sum,i)=>sum+i.count,0),total);
  assert.equal(result[0].count,2);assert.equal(result.at(-1).deckName,label);assert.equal(result.at(-1).count,1);
  const other=result.find(i=>i.other);
  if(smallCount){assert.equal(other.count,smallCount);assert.equal(other.percentage,(smallCount/total*100).toFixed(1));assert.equal(other.image_url,undefined);assert.equal(deckPieColor(other),'#747b85');}
  else assert.equal(other,undefined);
 }
 const items=Array.from({length:3},(_,i)=>({deckName:String(i),count:1,percentage:'3.3'}));
 assert.equal(buildPieChartItems(items,{total:30})[0].percentage,'10.0');
 assert.deepEqual(buildPieChartItems([{deckName:'zero',count:0}]),[]);
});
test('grouped singleton images are never rendered and legend shows other total',()=>{
 const c=new Element();renderDeckPieChart(c,[{deckName:'single',count:1,percentage:'50.0',image_url:'https://example.com/single'},
 {deckName:'未登録',count:1,percentage:'50.0',unknown:true}],{total:2});
 assert.equal(c.children[0].children.filter(e=>e.tag==='image').length,0);
 assert.match(c.children[1].children[0].textContent,/その他　1人　50.0%/);
 assert.match(c.children[1].children[1].textContent,/未登録　1人/);
});
