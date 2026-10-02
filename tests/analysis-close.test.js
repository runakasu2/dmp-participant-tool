const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('analysis close buttons independently hide panels without touching data, filters or fetching',()=>{
 const elements=new Map();
 const context=vm.createContext({document:{getElementById(id){if(!elements.has(id))elements.set(id,{hidden:false,content:'unchanged',addEventListener(type,fn){this[type]=fn;},focus(){this.focused=true;}});return elements.get(id);}},fetch:()=>assert.fail('close must not fetch')});
 const source=fs.readFileSync('script.js','utf8');
 vm.runInContext(source.slice(source.indexOf('function initializeAnalysisCloseButtons'),source.indexOf('let eventFilters=')),context);
 const get=id=>context.document.getElementById(id);
 for(const id of ['deck-period-summary','deck-trends','events-start-date','events-end-date','event-list'])get(id);
 get('close-deck-period').click();assert.equal(get('deck-period-summary').hidden,true);assert.equal(get('deck-trends').hidden,false);assert.equal(get('show-deck-period').focused,true);
 get('deck-period-summary').hidden=false;
 get('close-deck-trends').click();assert.equal(get('deck-trends').hidden,true);assert.equal(get('deck-period-summary').hidden,false);
 for(const id of ['events-start-date','events-end-date','event-list']){assert.equal(get(id).content,'unchanged');assert.equal(get(id).hidden,false);}
});
