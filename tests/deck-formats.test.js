const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
class Element{
 constructor(){this.children=[];this.value='';this.handlers={};}
 setAttribute(){} addEventListener(type,handler){this.handlers[type]=handler;}
 appendChild(child){child.parent=this;this.children.push(child);} append(...children){children.forEach(c=>this.appendChild(c));}
 replaceChildren(){this.children=[];} remove(){this.parent.children=this.parent.children.filter(c=>c!==this);}
}
function fixture(){const context=vm.createContext({document:{createElement:()=>new Element(),createTextNode:text=>({textContent:text})}});vm.runInContext(fs.readFileSync('deck-select.js','utf8'),context);return context;}
const decks=[{id:1,name:'A',aliases:['aliasA'],formats:['original','2block']},{id:2,name:'B',formats:['advance']},{id:3,name:'C',formats:['original']}];
test('common dropdown filters each format, retains ordering and placeholder; unknown format displays all',()=>{
 const c=fixture();
 for(const [format,names] of [['original',['未選択','A','C']],['advance',['未選択','B']],['2block',['未選択','A']],[null,['未選択','A','B','C']]])
  assert.deepEqual(Array.from(c.createDeckSelect(decks,{format}).children,o=>o.textContent),names);
});
test('saved out-of-format master resolves by ID or alias, remains selected and never duplicates on rerender',()=>{
 const c=fixture();
 for(const saved of [{deckId:2,deckName:'B'},{deckName:'B'}]){
  const select=c.createDeckSelect(decks,{format:'original',...saved});
  assert.equal(select.value,'2');assert.match(select.children.at(-1).textContent,/候補外/);
  select.setSavedDeck(2,'B');assert.equal(select.children.length,4);assert.equal(select.value,'2');
  select.setSavedDeck(1,'A');assert.equal(select.children.length,3);assert.equal(select.value,'1');
 }
 assert.equal(c.createDeckSelect(decks,{format:'advance',deckName:'aliasA'}).value,'1');
 assert.equal(decks.length,3);
});
test('membership editor permits multiple formats without changing master data',()=>{
 const c=fixture(),choices=c.createFormatChoices(['original','2block']);
 assert.deepEqual(Array.from(choices.selectedFormats()),['original','2block']);
});
test('predictions retain out-of-candidate automatic deck and shared master imagery',()=>{
 const c=fixture(),source=fs.readFileSync('script.js','utf8');
 vm.runInContext(source.slice(source.indexOf('function createPredictionCell'),source.indexOf('console.log(')),c);
 const participant={name:'P',prediction:{autoDeckName:'B',finalDeckName:'B',hasManualPrediction:false,source:'auto'}};
 const cell=c.createPredictionCell(participant,decks,{format:'original'});
 assert.equal(cell.children[1].value,'2');assert.match(cell.children[1].children.at(-1).textContent,/候補外/);
 assert.equal(participant.prediction.finalDeckName,'B');
});

test('management defaults to original, supports all masters and filters without changing shared catalog',async()=>{
 const elements=new Map();
 class UiElement extends Element {constructor(){super();this.style={};this.dataset={};} set innerHTML(value){this.children=[];} }
 const context=vm.createContext({document:{getElementById(id){if(!elements.has(id))elements.set(id,new UiElement());return elements.get(id);},createElement:()=>new UiElement(),createTextNode:text=>({textContent:text})},fetch:async()=>({ok:true,json:async()=>({decks:decks.map(d=>({...d,aliases:d.aliases||[]}))})}),createDeckImageEditor:()=>new UiElement(),alert:message=>assert.fail(message),console});
 vm.runInContext(fs.readFileSync('deck-select.js','utf8'),context);
 const source=fs.readFileSync('script.js','utf8');
 vm.runInContext(source.slice(source.indexOf("let deckManagementFormat"),source.indexOf('const deckNameInput')),context);
 await context.loadDecks();
 assert.equal(elements.get('deck-management-list').children.length,2);
 vm.runInContext("deckManagementFormat='advance'",context);await context.loadDecks();
 assert.equal(elements.get('deck-management-list').children.length,1);
 assert.equal(elements.get('deck-management-list').children[0].children[0].textContent,'B');
 vm.runInContext("deckManagementFormat='all'",context);await context.loadDecks();
 assert.equal(elements.get('deck-management-list').children.length,3);
});

test('compact management opens one editor, searches locally, refreshes rename/formats and returns to list',async()=>{
 const elements=new Map(),masters=decks.map(d=>({...d,aliases:d.aliases||[]}));let requests=0,editors=0;
 class UiElement extends Element {constructor(){super();this.style={};this.dataset={};}set innerHTML(value){this.children=[];}focus(){} }
 const context=vm.createContext({document:{getElementById(id){if(!elements.has(id))elements.set(id,new UiElement());return elements.get(id);},createElement:()=>new UiElement(),createTextNode:text=>({textContent:text})},fetch:async(url,options)=>{
  requests++;if(options){const body=JSON.parse(options.body),deck=masters.find(d=>d.id===Number(url.split('/')[3]));if(body.name)deck.name=body.name;if(body.formats)deck.formats=body.formats;}
  return {ok:true,json:async()=>({decks:masters.map(d=>({...d}))})};},createDeckImageEditor:()=>{editors++;return new UiElement();},alert:message=>assert.fail(message),console});
 vm.runInContext(fs.readFileSync('deck-select.js','utf8'),context);
 const source=fs.readFileSync('script.js','utf8');vm.runInContext(source.slice(source.indexOf('let deckManagementFormat'),source.indexOf('const deckNameInput')),context);
 await context.loadDecks();assert.equal(editors,0);assert.equal(elements.get('deck-back-to-list').hidden,true);
 const list=elements.get('deck-management-list');list.children[0].handlers.click();assert.equal(list.children.length,1);assert.equal(editors,1);assert.equal(requests,1);
 assert.equal(elements.get('deck-back-to-list').hidden,false);
 let editor=list.children[0],rename=editor.children[3];rename.children[0].value='Renamed';await rename.children[1].handlers.click();
 assert.equal(list.children[0].children[0].textContent,'Renamed');
 elements.get('deck-back-to-list').handlers.click();assert.equal(list.children[0].children[0].textContent,'Renamed');
 const before=requests;elements.get('deck-search').handlers.input({target:{value:'ｒｅＮＡＭＥＤ'}});assert.equal(list.children.length,1);assert.equal(requests,before);
 list.children[0].handlers.click();editor=list.children[0];const formats=editor.children[1];
 formats.children[1].children[0].checked=false;formats.children[3].children[0].checked=true;
 await editor.children[2].handlers.click();elements.get('deck-back-to-list').handlers.click();assert.equal(list.children.length,0);
 elements.get('deck-search').handlers.input({target:{value:''}});assert.equal(list.children.length,1);
 elements.get('deck-format-tabs').children[2].handlers.click();assert.equal(list.children[0].children[0].textContent,'Renamed');
 list.children[0].handlers.click();elements.get('deck-format-tabs').children[1].handlers.click();
 assert.equal(elements.get('deck-back-to-list').hidden,true);assert.equal(list.children[0].children[0].textContent,'B');
});
