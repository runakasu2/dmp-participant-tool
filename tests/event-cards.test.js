const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {parseImageUrl}=require('../event-catalog');
class Element {
 constructor(tag){this.tag=tag;this.children=[];this.handlers={};}
 appendChild(el){this.children.push(el);el.parent=this;return el;}
 setAttribute(){} addEventListener(n,f){this.handlers[n]=f;}
 querySelector(tag){return this.children.find(c=>c.tag===tag);}
 remove(){this.parent.children=this.parent.children.filter(c=>c!==this);}
}
function texts(el){return [el.textContent,...el.children.flatMap(texts)].filter(Boolean);}
test('cards show results, missing decks, placeholder and preserve click mode',()=>{
 const ctx=vm.createContext({attachCardArt(){},document:{createElement:tag=>new Element(tag)}});vm.runInContext(fs.readFileSync('event-cards.js','utf8'),ctx);
 let deleting=false,opened=0,toggled=0;
 const controls={rowClick(){if(deleting)toggled++;return deleting;},cell(){return new Element('div');}};
 const card=ctx.createEventCard({id:1,event_name:'大会',participant_count:58,best_four:[{rank:4,handleName:'A',deckName:null}]},controls,()=>opened++);
 assert.ok(texts(card).includes('未登録'));assert.ok(texts(card).includes('4位'));assert.ok(texts(card).includes('参加人数：58人'));
 card.handlers.click();assert.equal(opened,1);deleting=true;card.handlers.click();assert.equal(opened,1);assert.equal(toggled,1);
 const empty=ctx.createEventCard({id:2},controls,()=>{});assert.ok(texts(empty).includes('大会結果未取得'));
 const image=ctx.createEventCard({id:3,best_four:[{rank:1,deckImageUrl:'https://example.com/a.png'}]},controls,()=>{});
 const img=image.children[0].querySelector('img');img.handlers.error();assert.equal(image.children[0].querySelector('img'),undefined);
 assert.ok(image.children[0].children.length>0);
});
test('image URLs allow HTTPS or clearing only',()=>{
 assert.equal(parseImageUrl('https://example.com/a.png'),'https://example.com/a.png');assert.equal(parseImageUrl(''),null);
 for(const value of ['javascript:alert(1)','http://example.com/a','https://user:pass@example.com/a',undefined])assert.throws(()=>parseImageUrl(value));
});
