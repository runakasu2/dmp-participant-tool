const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
class Element {constructor(){this.children=[];this.handlers={};this.checked=false;this.disabled=false;}addEventListener(n,h){this.handlers[n]=h;}appendChild(e){this.children.push(e);}setAttribute(){}}
function fixture(answers,fail=false) {
  const elements=new Map(),requests=[];let prompts=0,reloads=0;
  const context=vm.createContext({document:{getElementById(id){if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},createElement(){return new Element();}},
    confirm:()=>answers[prompts++],fetch:async(url,opts)=>{requests.push({url,body:JSON.parse(opts.body)});return {ok:!fail,json:async()=>fail?{success:false,error:'リセット失敗'}:{success:true,deletedEventCount:2}};}});
  vm.runInContext(fs.readFileSync('event-reset-ui.js','utf8'),context);
  const controller=context.createEventResetControls(async flag=>{assert.equal(flag,true);reloads++;controller.beginLoad();controller.endLoad();});
  controller.beginLoad();const cells=[1,2].map(id=>controller.cell({id,event_name:'大会'+id,shop_id:'s',event_id:'e',seq:String(id)}));controller.endLoad();
  return {elements,requests,cells,controller,get prompts(){return prompts;},get reloads(){return reloads;}};
}
test('no selection disables reset; select all/clear and checkbox never opens event detail',()=>{
  const f=fixture([]);assert.equal(f.elements.get('reset-selected-events').disabled,true);
  f.elements.get('enter-event-delete').handlers.click();f.elements.get('select-all-events').handlers.click();assert.equal(f.elements.get('reset-selected-events').disabled,false);
  let stopped=false;f.cells[0].handlers.click({stopPropagation(){stopped=true;}});assert.equal(stopped,true);
  f.elements.get('clear-event-selection').handlers.click();assert.equal(f.elements.get('reset-selected-events').disabled,true);
});
test('request is sent only after both confirmations; success clears and reloads list',async()=>{
  for(const answers of [[false],[true,false],[true,true]]) {
    const f=fixture(answers);f.elements.get('enter-event-delete').handlers.click();f.elements.get('select-all-events').handlers.click();await f.elements.get('reset-selected-events').handlers.click();
    assert.equal(f.prompts,answers.length);assert.equal(f.requests.length,answers.every(Boolean)?1:0);
    if(f.requests.length){assert.deepEqual(f.requests[0].body,{eventIds:[1,2],confirmed:true});assert.equal(f.reloads,1);assert.equal(f.elements.get('reset-selected-events').disabled,true);assert.match(f.elements.get('event-reset-status').textContent,/2大会を削除/);}
  }
});
test('failure retains selection and restores controls for retry',async()=>{
  const f=fixture([true,true],true);f.elements.get('enter-event-delete').handlers.click();f.elements.get('select-all-events').handlers.click();await f.elements.get('reset-selected-events').handlers.click();
  assert.equal(f.reloads,0);assert.equal(f.cells[0].children[0].checked,true);assert.equal(f.elements.get('reset-selected-events').disabled,false);assert.match(f.elements.get('event-reset-status').textContent,/失敗/);
});

test('normal mode hides every selection cell; entering mode neither confirms nor requests deletion',()=>{
  const f=fixture([]);
  assert.ok(f.cells.every(c=>c.hidden));assert.equal(f.elements.get('event-selection-heading').hidden,true);
  assert.equal(f.elements.get('event-delete-selection').hidden,true);assert.equal(f.controller.rowClick(1),false);
  f.elements.get('enter-event-delete').handlers.click();
  assert.equal(f.prompts,0);assert.equal(f.requests.length,0);assert.ok(f.cells.every(c=>!c.hidden));
  assert.equal(f.elements.get('event-selection-heading').hidden,false);
  assert.equal(f.elements.get('reset-selected-events').disabled,true);
  assert.equal(f.controller.rowClick(1),true);assert.equal(f.cells[0].children[0].checked,true);
  assert.equal(f.elements.get('event-selection-count').textContent,'選択中：1件');
  assert.equal(f.controller.rowClick(1),true);assert.equal(f.cells[0].children[0].checked,false);
  const checkbox=f.cells[1].children[0];checkbox.checked=true;checkbox.handlers.change();
  assert.equal(f.elements.get('event-selection-count').textContent,'選択中：1件');
  f.elements.get('cancel-event-delete').handlers.click();
  assert.ok(f.cells.every(c=>c.hidden&&!c.children[0].checked));assert.equal(f.controller.rowClick(1),false);
  assert.equal(f.elements.get('event-delete-selection').hidden,true);assert.equal(f.requests.length,0);assert.equal(f.prompts,0);
  f.elements.get('enter-event-delete').handlers.click();assert.equal(f.elements.get('event-selection-count').textContent,'選択中：0件');
});
test('successful deletion exits selection mode and ordinary clicks navigate again',async()=>{
  const f=fixture([true,true]);f.elements.get('enter-event-delete').handlers.click();f.controller.rowClick(1);
  await f.elements.get('reset-selected-events').handlers.click();
  assert.equal(f.elements.get('event-delete-selection').hidden,true);assert.equal(f.elements.get('event-selection-heading').hidden,true);
  assert.equal(f.elements.get('enter-event-delete').hidden,false);assert.equal(f.controller.rowClick(1),false);
  assert.ok(f.cells.every(c=>c.hidden&&!c.children[0].checked));
});
