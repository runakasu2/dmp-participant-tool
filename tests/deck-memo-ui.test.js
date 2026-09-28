const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
class Element {
  constructor(){this.children=[];this.handlers={};this.classList={add(){}};this.style={};this.value='';this.disabled=false;}
  addEventListener(name,fn){this.handlers[name]=fn;}
  setAttribute(){}
  append(...nodes){this.children.push(...nodes);}
  appendChild(node){this.children.push(node);}
  replaceChildren(...nodes){this.children=nodes;}
}
test('selection autosaves to loaded admin, summary updates; failed save restores selection; refresh loads saved memo',async()=>{
  const elements=new Map();
  let stored=null, fail=false, requests=0, savedBody;
  const context=vm.createContext({document:{getElementById(id){if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},createElement(){return new Element();}},hideAllPages(){},clearActiveMenus(){},fetch:async(url,options)=>{
    requests++;
    if(url==='/api/decks?sort=usage') return {ok:true,json:async()=>({success:true,decks:[{id:1,name:'A'}]})};
    if(url==='/api/deck-memo') {
      savedBody=JSON.parse(options.body);
      if(!fail)stored=savedBody.deckId;
      return {ok:!fail,json:async()=>fail?{success:false,error:'保存失敗'}:{success:true,deckId:stored,deckName:stored?'A':null}};
    }
    return {ok:true,json:async()=>({success:true,sourceUrl:'https://nojigikucs.com/?admin=first',adminKey:'first',latestRound:2,participants:[{dmpId:'101',name:'名前',table:1,deckId:stored,deckName:stored?'A':null}]})};
  }});
  vm.runInContext(fs.readFileSync('deck-select.js','utf8'),context);
  vm.runInContext(fs.readFileSync('deck-memo-ui.js','utf8'),context);
  const refresh=elements.get('memo-refresh');
  elements.get('memo-url').value='https://nojigikucs.com/?admin=first';
  await refresh.handlers.click();
  const cell=elements.get('memo-list').children[0].children[3];
  const select=cell.children[0];
  select.value='1';
  // Editing the URL without refreshing must not change where the visible row saves.
  elements.get('memo-url').value='https://nojigikucs.com/?admin=second';
  await select.handlers.change();
  assert.equal(savedBody.url,'https://nojigikucs.com/?admin=first');
  assert.match(elements.get('memo-summary').textContent,/デッキ登録：1 \/ 1/);
  fail=true;select.value='';await select.handlers.change();
  assert.equal(select.value,'1');assert.match(cell.children[1].textContent,/保存失敗/);
  assert.equal(refresh.disabled,false);
  fail=false;await refresh.handlers.click();
  assert.equal(elements.get('memo-list').children[0].children[3].children[0].value,'1');
  assert.equal(requests,6);
});

test('saved list and detail can be opened without either external API or current matching',async()=>{
  const elements=new Map(),paths=[];
  const context=vm.createContext({document:{getElementById(id){if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},createElement(){return new Element();}},hideAllPages(){},clearActiveMenus(){},fetch:async url=>{
    paths.push(url);
    assert.ok(url.startsWith('/api/deck-memo/archives'));
    return{ok:true,json:async()=>url.endsWith('/7')?{success:true,event:{eventName:'保存済みCS',eventDate:'2026-09-28',adminKey:'hattics'},participantCount:2,registeredCount:1,
      participants:[{dmpId:'101',name:'当時の名前',deckName:'A'},{dmpId:'102',name:'B',deckName:null}]}:
      {success:true,events:[{id:7,event_name:'保存済みCS',event_date:'2026-09-28',registered_count:1,participant_count:2}]}};
  }});
  vm.runInContext(fs.readFileSync('deck-select.js','utf8'),context);
  vm.runInContext(fs.readFileSync('deck-memo-ui.js','utf8'),context);
  await elements.get('memo-archives-reload').handlers.click();
  const link=elements.get('memo-archives-list').children[0].children[1].children[0];
  await link.handlers.click();
  assert.equal(elements.get('memo-archive-title').textContent,'保存済みCS');
  assert.equal(elements.get('memo-archive-players').children.length,2);
  assert.equal(elements.get('memo-archive-players').children[1].children[2].textContent,'未選択');
  assert.equal(paths.length,2);
});

test('reset sends deletion only after both confirmations',async()=>{
  for(const answers of [[false],[true,false],[true,true]]) {
    const elements=new Map();let prompts=0,deletions=0;
    const context=vm.createContext({document:{getElementById(id){if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},createElement(){return new Element();}},hideAllPages(){},clearActiveMenus(){},confirm:()=>answers[prompts++],fetch:async(url)=>{
      if(url.endsWith('/reset')){deletions++;return{ok:true,json:async()=>({success:true,memoEventIds:[]})};}
      return{ok:true,json:async()=>url.endsWith('/7')?{success:true,event:{id:7,eventName:'大会A',eventDate:'2026-09-28'},participants:[],participantCount:0,registeredCount:0}:
        {success:true,events:[{id:7,event_name:'大会A',event_date:'2026-09-28',registered_count:0,participant_count:0}]}};
    }});
    vm.runInContext(fs.readFileSync('deck-select.js','utf8'),context);
  vm.runInContext(fs.readFileSync('deck-memo-ui.js','utf8'),context);
    await elements.get('memo-archives-reload').handlers.click();
    await elements.get('memo-archives-list').children[0].children[1].children[0].handlers.click();
    await elements.get('memo-archive-reset').handlers.click();
    assert.equal(prompts,answers.length);
    assert.equal(deletions,answers.every(Boolean)?1:0);
  }
});

test('TCG memo UI has only table/name/deck, saves by provider key and preserves selection on refresh',async()=>{
  const elements=new Map(),calls=[];let deckId=null;
  const context=vm.createContext({document:{getElementById(id){if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},createElement(){return new Element();}},hideAllPages(){},clearActiveMenus(){},fetch:async(url,options)=>{
    const body=options?.body?JSON.parse(options.body):null;calls.push({url,body});
    if(url==='/api/decks?sort=usage')return {ok:true,json:async()=>({success:true,decks:[{id:1,name:'正式デッキ'}]})};
    if(url==='/api/deck-memo') {deckId=body.deckId;return {ok:true,json:async()=>({success:true,deckId,deckName:'正式デッキ'})};}
    return {ok:true,json:async()=>({success:true,provider:'tcg_meister',sourceUrl:'https://tcg.sfc-jpn.jp/loginnum.asp?tid=5482242',adminKey:'5482242',memoEventId:5,event:{eventName:'大会',eventDate:'2026-09-29'},latestRound:5,
      participants:[{participantKey:'id:42',internalParticipantId:'42',name:'旧HN',table:null,bye:true,deckId,deckName:deckId?'正式デッキ':null}]})};
  }});
  vm.runInContext(fs.readFileSync('deck-select.js','utf8'),context);
  vm.runInContext(fs.readFileSync('deck-memo-ui.js','utf8'),context);
  await elements.get('memo-refresh').handlers.click();
  let row=elements.get('memo-list').children[0];assert.equal(row.children.length,3);
  assert.deepEqual(elements.get('memo-table-head').children.map(c=>c.textContent),['卓','ハンドルネーム','使用デッキ']);
  assert.equal(row.children[0].textContent,'不戦勝');assert.equal(row.children[1].textContent,'旧HN');
  const deck=row.children[2].children[0];deck.value='1';await deck.handlers.change();
  assert.equal(calls.at(-1).body.participantKey,'id:42');assert.equal('dmpId' in calls.at(-1).body,false);
  await elements.get('memo-refresh').handlers.click();row=elements.get('memo-list').children[0];
  assert.equal(row.children[2].children[0].value,'1');
  assert.ok(calls.every(c=>!c.url.includes('mapping')));
  assert.match(elements.get('memo-summary').textContent,/デッキ登録：1 \/ 1/);
});
