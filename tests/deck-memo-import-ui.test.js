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
