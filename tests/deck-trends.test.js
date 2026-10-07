const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {buildTrendSeries,trendPointDescription}=require('../deck-trend-ui');
const events=[{eventRecordId:1,eventDate:'2026-09-01',eventName:'First',participantCount:10,registeredDeckCount:6,unregisteredCount:4,decks:[{deckId:1,deckName:'A',count:6}]},
 {eventRecordId:2,eventDate:'2026-09-01',eventName:'Second',participantCount:8,registeredDeckCount:2,unregisteredCount:6,decks:[{deckId:2,deckName:'B',count:2}]}];
test('series zero fills every included event, sorts total usage, and keeps unregistered separate',()=>{
 const s=buildTrendSeries({events});assert.deepEqual(s.map(x=>x.deckName),['A','B','未登録']);
 assert.deepEqual(s[0].points.map(p=>[p.count,p.percentage]),[[6,60],[0,0]]);
 assert.deepEqual(s[2].points.map(p=>p.count),[4,6]);assert.match(trendPointDescription(s[0],s[0].points[0]),/First.*A.*6人.*60.0%.*10人.*6 \/ 10人/);
 assert.equal(buildTrendSeries({events:[]}).length,1);
});
class Element{
 constructor(){this.children=[];this.handlers={};this.style={};this.attrs={};}
 setAttribute(k,v){this.attrs[k]=v;}appendChild(n){this.children.push(n);}append(...nodes){this.children.push(...nodes);}replaceChildren(){this.children=[];}addEventListener(k,v){this.handlers[k]=v;}
}
test('trend UI top5, toggles and selections reuse data; stale responses cannot survive clear',async()=>{
 const elements=new Map();let calls=0,resolvePending;
 const document={getElementById(id){if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},createElement:()=>new Element(),createElementNS:()=>new Element(),createTextNode:text=>({textContent:text})};
 const many={...events[0],decks:Array.from({length:7},(_,i)=>({deckId:i,deckName:'D'+i,count:7-i}))};
 const c=vm.createContext({document,Set,Map,DECK_FORMAT_LABELS:{original:'オリジナル'},deckPieColor:()=> 'red',eventFilterQuery:()=> 'format=original',fetch:async()=>{calls++;if(calls===2)await new Promise(resolve=>resolvePending=resolve);return {ok:true,json:async()=>({success:true,format:'original',events:[many],excludedEvents:[]})};}});
 vm.runInContext(fs.readFileSync('deck-trend-ui.js','utf8'),c);
 const controls=c.createDeckTrendControls(()=>({format:'original'}));await controls.load();
 const choices=elements.get('deck-trend-choices').children;
 assert.equal(choices.filter(label=>label.children[0].checked).length,5);assert.equal(choices.at(-1).children[0].checked,false);
 const lines=()=>elements.get('deck-trend-chart').children[0].children.filter(n=>n.attrs.points).length;
 assert.equal(lines(),5);
 elements.get('trend-count').handlers.click();assert.equal(calls,1);assert.equal(elements.get('trend-count').attrs['aria-pressed'],'true');
 const input=choices[0].children[0];input.checked=false;input.handlers.change();assert.equal(lines(),4);
 input.checked=true;input.handlers.change();assert.equal(lines(),5);assert.equal(calls,1);
 const point=elements.get('deck-trend-chart').children[0].children.find(n=>n.attrs.role==='button');point.handlers.click();assert.match(elements.get('deck-trend-point').textContent,/First/);
 const pending=controls.load();await Promise.resolve();controls.clear();resolvePending();await pending;
 assert.equal(elements.get('deck-trends').hidden,true);assert.equal(elements.get('deck-trend-chart').children.length,0);
});

test('trend chart fits a narrow panel and thins date labels without dropping data points',()=>{
 const container=new Element();container.clientWidth=300;
 const c=vm.createContext({document:{createElementNS:()=>new Element()},deckPieColor:()=> 'red'});
 vm.runInContext(fs.readFileSync('deck-trend-ui.js','utf8'),c);
 const series=buildTrendSeries({events:Array.from({length:20},(_,i)=>({...events[0],eventRecordId:i+1,eventDate:'2026-09-'+String(i+1).padStart(2,'0')}))});
 c.renderDeckTrend(container,series,'percentage',()=>{});
 const svg=container.children[0];assert.equal(svg.attrs.viewBox,'0 0 300 340');
 assert.equal(svg.children.filter(n=>n.attrs.role==='button').length,40);
 const dates=svg.children.filter(n=>n.attrs.y==='315');assert.ok(dates.length<=4);
});
