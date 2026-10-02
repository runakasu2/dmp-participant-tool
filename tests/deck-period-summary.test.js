const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {buildPeriodSummary}=require('../deck-period-summary');
const data={format:'original',startDate:'2026-09-01',endDate:'2026-09-30',events:[
 {participantCount:100,registeredDeckCount:20,unregisteredCount:80,decks:[{deckId:1,deckName:'A',count:20,image_url:'https://example.com/a',percentage:20}]},
 {participantCount:20,registeredDeckCount:2,unregisteredCount:18,decks:[{deckId:1,deckName:'A',count:2,image_url:'https://example.com/a',percentage:10}]}],excludedEvents:[{reason:'unentered'}]};
test('period aggregates counts before percentages; excludes empty events and retains images and unknown totals',()=>{
 const s=buildPeriodSummary(data);
 assert.equal(s.totalParticipants,120);assert.equal(s.registeredDecks,22);assert.equal(s.unregistered,98);
 assert.equal(s.decks[0].percentage,22/120*100);assert.notEqual(s.decks[0].percentage,15);
 assert.equal(s.totalEvents,3);assert.equal(s.includedEvents,2);assert.equal(s.missingEvents,1);
 assert.equal(s.decks[0].image_url,'https://example.com/a');assert.equal(s.decks[0].count+s.unregistered,s.totalParticipants);
 assert.equal(buildPeriodSummary({...data,events:[],excludedEvents:[]}).totalEvents,0);
 const missing=buildPeriodSummary({...data,events:[]});assert.equal(missing.totalEvents,1);assert.equal(missing.includedEvents,0);assert.equal(missing.registrationPercentage,0);
});
class Element{
 constructor(){this.children=[];this.attrs={};this.handlers={};}setAttribute(k,v){this.attrs[k]=v;}replaceChildren(){this.children=[];}appendChild(n){this.children.push(n);}addEventListener(k,v){this.handlers[k]=v;}
}
test('period UI shares pie renderer and data, shows unknown, clears stale requests and distinguishes empty states',async()=>{
 const elements=new Map();let requests=0,draws=0,pending,waiting=false,result=buildPeriodSummary(data);
 const c=vm.createContext({document:{getElementById(id){if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},createElement:()=>new Element()},eventFilterQuery:()=>'',DECK_FORMAT_LABELS:{original:'オリジナル'},renderDeckPieChart:(el,items,options)=>{
  draws++;assert.equal(items[0].image_url,'https://example.com/a');assert.equal(items.at(-1).unknown,true);assert.equal(options.total,120);
 },fetch:async()=>{requests++;if(waiting)await new Promise(resolve=>pending=resolve);return {ok:true,json:async()=>({success:true,...result})};}});
 vm.runInContext(fs.readFileSync('deck-period-ui.js','utf8'),c);const controls=c.createDeckPeriodControls(()=>({}));
 await controls.load();assert.equal(elements.get('deck-period-rows').children.length,2);
 elements.get('period-pie').handlers.click();assert.equal(draws,1);assert.equal(elements.get('deck-period-list').hidden,true);
 elements.get('period-list').handlers.click();elements.get('period-pie').handlers.click();assert.equal(requests,1);assert.equal(draws,1);
 waiting=true;const request=controls.load();await Promise.resolve();controls.clear();pending();await request;
 assert.equal(elements.get('deck-period-summary').hidden,true);assert.equal(elements.get('deck-period-rows').children.length,0);
 waiting=false;result=buildPeriodSummary({...data,events:[],excludedEvents:[]});await controls.load();assert.match(elements.get('deck-period-status').textContent,/条件に一致する大会がありません/);
 result=buildPeriodSummary({...data,events:[]});await controls.load();assert.match(elements.get('deck-period-status').textContent,/母数集計済みの大会がありません/);
});
