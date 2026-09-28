const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
class Element {
  constructor(){this.children=[];this.handlers={};this.value='';this.disabled=false;this.hidden=false;}
  addEventListener(name,fn){this.handlers[name]=fn;}
  appendChild(node){this.children.push(node);}
  replaceChildren(){this.children=[];}
  setAttribute(){}
}
function fixture(){
  const elements=new Map(),requests=[];
  const preview={success:true,archive:{id:7,participantCount:2,registeredCount:2},token:'a'.repeat(64),counts:{new:1,same:0,conflict:1,unselected:0,absent:0},players:[
    {dmpId:'1',name:'新規',category:'new',currentDeckName:null,memoDeckName:'A'},
    {dmpId:'2',name:'競合',category:'conflict',currentDeckName:'B',memoDeckName:'C'}]};
  const input1=new Element(),input2=new Element();input2.value='B';
  const context=vm.createContext({Map,document:{getElementById(id){if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},createElement(){return new Element();},querySelectorAll(){return[input1,input2];}},fetch:async(path,options)=>{
    const body=JSON.parse(options.body);requests.push({path,body});
    return{ok:true,json:async()=>path.endsWith('import-preview')?preview:{success:true,insertedCount:1,updatedCount:body.overwriteDmpIds.length,
      changes:[{dmpId:'1',deckName:'A'},...(body.overwriteDmpIds.length?[{dmpId:'2',deckName:'C'}]:[])]}};
  }});
  vm.runInContext(fs.readFileSync('deck-memo-import-ui.js','utf8'),context);
  return{elements,requests,context,input1,input2,async open(){await context.setMemoImportTarget({shopId:'s',eventId:'e',seq:'2'},new Map([['1',input1],['2',input2]]));await elements.get('memo-import-open').handlers.click();}};
}
test('opening/cancelling preview does not write; conflicts default to keeping existing',async()=>{
  const f=fixture();await f.open();
  assert.equal(f.requests.every(r=>r.path.endsWith('import-preview')),true);
  assert.equal(f.elements.get('memo-import-rows').children[1].children[5].children[0].value,'keep');
  f.elements.get('memo-import-cancel').handlers.click();
  assert.equal(f.elements.get('memo-import-details').hidden,true);
  assert.equal(f.requests.length,2);
});
test('apply sends only explicitly selected DMP IDs and updates inputs without external reload',async()=>{
  const f=fixture();await f.open();
  f.elements.get('memo-import-rows').children[1].children[5].children[0].value='overwrite';
  await f.elements.get('memo-import-apply').handlers.click();
  assert.deepEqual(f.requests.at(-1).body.overwriteDmpIds,['2']);
  assert.equal(f.input1.value,'A');assert.equal(f.input2.value,'C');
  assert.equal(f.requests.length,3);assert.equal(f.input1.disabled,false);
});

test('TCG mapping appears only in import preview, recalculates conflicts and sends selected mapping on apply',async()=>{
  const elements=new Map(),requests=[];
  let reject=false;
  function data(body) {
    const dmpId=body.manualMappings?.[0]?.dmpId || null;
    return {success:true,archive:{id:7,provider:'tcg_meister',participantCount:2,registeredCount:2},token:(dmpId?'b':'a').repeat(64),
      manualMappings:body.manualMappings || [],dmpCandidates:[{dmpId:'056075',playerId:1,name:'ガブロジー'},{dmpId:'090001',playerId:2,name:'新HN'}],
      counts:{new:1,conflict:dmpId?1:0,unmatched:dmpId?0:1},players:[
        {participantKey:'id:42',memoName:'ガブロジー',name:'ガブロジー',dmpId:'056075',category:'new',matchStatus:'matched',canMap:false,memoDeckName:'A'},
        {participantKey:'id:10',memoName:'旧HN',name:dmpId?'新HN':'旧HN',dmpId,category:dmpId?'conflict':'unmatched',matchStatus:dmpId?'manual':'unmatched',canMap:true,memoDeckName:'B',currentDeckName:dmpId?'A':null}]};
  }
  const context=vm.createContext({Map,document:{getElementById(id){if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},createElement(){return new Element();},querySelectorAll(){return[];}},fetch:async(path,options)=>{
    const body=JSON.parse(options.body);requests.push({path,body});
    return {ok:!reject,json:async()=>reject?{error:'重複対応'}:path.endsWith('import-preview')?data(body):{success:true,changes:[],insertedCount:1,updatedCount:0}};
  }});
  vm.runInContext(fs.readFileSync('deck-memo-import-ui.js','utf8'),context);
  await context.setMemoImportTarget({shopId:'s',eventId:'e',seq:'2'});
  await elements.get('memo-import-open').handlers.click();
  let rows=elements.get('memo-import-rows').children;
  assert.equal(rows[0].children[1].children.length,0); // automatic HN match has no selector
  let select=rows[1].children[1].children[0];assert.equal(select.children[0].textContent,'未選択');assert.equal(select.children.length,3);
  select.value='090001';await select.handlers.change();
  assert.equal(requests.at(-1).path,'/api/deck-memo/import-preview');
  assert.deepEqual(requests.at(-1).body.manualMappings,[{participantKey:'id:10',dmpId:'090001'}]);
  rows=elements.get('memo-import-rows').children;
  assert.equal(rows[1].children[0].children[0].textContent,' ／ 手動対応');
  assert.equal(rows[1].children[5].children[0].value,'keep');assert.equal(elements.get('memo-import-apply').disabled,false);
  // Failed replacement retains the last successfully previewed mapping and restores controls.
  reject=true;select=rows[1].children[1].children[0];select.value='056075';await select.handlers.change();
  assert.equal(select.value,'090001');assert.equal(select.disabled,false);
  reject=false;await elements.get('memo-import-apply').handlers.click();
  assert.deepEqual(requests.at(-1).body.manualMappings,[{participantKey:'id:10',dmpId:'090001'}]);
  assert.deepEqual(requests.at(-1).body.overwriteDmpIds,[]);assert.equal(requests.at(-1).body.token,'b'.repeat(64));
  assert.ok(requests.every(r=>r.path==='/api/deck-memo/import-preview'||r.path==='/api/deck-memo/import'));
});
