const {test}=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const fs=require('node:fs');
const {chromium}=require('playwright');
const {installMemoSync}=require('../memo-sync');
test('two isolated browsers: author, duplicate rows, SSE, focus, reconnect, manual update and mobile',async()=>{
 const app=express();app.use(express.json());
 const streams=new Set();app.use((req,res,next)=>{if(req.path==='/api/deck-memo/events'){streams.add(res);res.on('close',()=>streams.delete(res));}next();});
 let deck=null;let reads=0;
 const pool={query:async(sql,args)=>{
  if(sql.includes('UNION ALL')){reads++;return {rows:args[0]===1&&deck?[{dmp_id:'3',participant_key:null,deck_id:deck,deck_name:'A'}]:[]};}
  return {rows:[{id:args[0],shop_id:'s',event_id:String(args[0]),seq:'1'}]};
 }};
 installMemoSync(app,pool);
 const people=[{dmpId:'1',name:'B',table:1,deckId:null},{dmpId:'2',name:'C',table:1,deckId:null},{dmpId:'3',name:'るな',table:2,deckId:null},{dmpId:'4',name:'D',table:2,deckId:null}];
 app.get('/api/decks',(req,res)=>res.json({success:true,decks:[{id:1,name:'A'}]}));
 app.get('/api/deck-memo/archives',(req,res)=>res.json({success:true,events:[]}));
 app.post('/api/deck-memo/matching',(req,res)=>res.json({success:true,memoEventId:1,provider:'nojigiku',sourceUrl:'https://nojigikucs.com/?admin=x',adminKey:'x',latestRound:1,rounds:[{round:1,participants:people.map(p=>({...p}))},{round:2,participants:people.map(p=>({...p,table:p.dmpId==='4'?3:p.table,name:['3','4'].includes(p.dmpId)?'るな':p.name}))}],participants:people.map(p=>({...p,deckId:p.dmpId==='3'?deck:null}))}));
 app.put('/api/deck-memo',(req,res)=>{deck=req.body.deckId;res.json({success:true,deckId:deck,deckName:deck?'A':null});});
 const html=fs.readFileSync('index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'');
 app.get('/',(req,res)=>res.type('html').send(html));app.use(express.static(process.cwd()));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 let browser;
 try{
  browser=await chromium.launch({headless:true,channel:'chrome'});
  const contexts=await Promise.all([browser.newContext(),browser.newContext({viewport:{width:390,height:844}})]);
  const pages=await Promise.all(contexts.map(c=>c.newPage()));const base='http://127.0.0.1:'+server.address().port;
  for(const page of pages){
   await page.goto(base);
   await page.evaluate(()=>{window.hideAllPages=()=>{};window.clearActiveMenus=()=>{};});
   for(const path of ['deck-select.js','saved-list-pager.js','deck-memo-ui.js'])await page.addScriptTag({url:base+'/'+path});
   await page.locator('#menu-deck-memo').click();
   await page.locator('#memo-url').fill('https://nojigikucs.com/?admin=x');
   await page.locator('#memo-refresh').click();await page.waitForFunction(()=>document.querySelector('#memo-list').children.length===4);
  }
  const [a,b]=pages;
  await b.locator('#memo-author').fill('るな');
  assert.equal(await b.locator('#memo-own-list tr').count(),2);
  assert.deepEqual(await b.locator('#memo-list tr td:first-child').allTextContents(),['1','1','2','2']);
  assert.equal(await b.evaluate(()=>localStorage.getItem('deck-memo-author')),'るな');
  assert.equal(await a.locator('#memo-author').inputValue(),'');
  await b.locator('#memo-url').fill('編集中');await b.locator('#memo-url').focus();
  await a.locator('#memo-list tr').nth(2).locator('select').selectOption('1');
  await b.waitForFunction(()=>document.querySelector('#memo-own-list select').value==='1');
  assert.equal(await b.locator('#memo-url').inputValue(),'編集中');assert.equal(await b.evaluate(()=>document.activeElement.id),'memo-url');
  assert.match(await b.locator('#memo-own-list small').first().textContent(),/✅ 登録済み/);
  await b.locator('#memo-own-list select').first().selectOption('');
  await a.locator('#memo-url').focus();
  await a.waitForFunction(()=>document.querySelectorAll('#memo-list select')[2].value==='');
  assert.match(await b.locator('#memo-own-list small').first().textContent(),/🟠 未登録/);
  await b.locator('#memo-url').focus();
  for(const response of streams)response.end();
  await a.locator('#memo-list tr').nth(2).locator('select').selectOption('1');
  await b.waitForFunction(()=>document.querySelector('#memo-own-list select').value==='1',{},{timeout:15000});
  deck=null;await b.locator('#memo-manual-refresh').click();
  await b.waitForFunction(()=>document.querySelector('#memo-own-list select').value==='');
  const label=b.locator('#memo-own-list small').first();assert.ok(await label.isVisible());
  assert.equal(await label.evaluate(el=>getComputedStyle(el).fontSize),'12px');
  const rect=await b.locator('#memo-manual-refresh').boundingBox();assert.ok(rect.width>=44&&rect.height>=44&&rect.x>=0);
  await b.locator('#memo-author').fill('不一致');assert.match(await b.locator('#memo-own-status').textContent(),/該当する卓番がありません/);
  await b.locator('#memo-author').fill('');assert.ok(await b.locator('#memo-own').isHidden());
  await b.locator('#memo-author').fill('るな');
  await b.locator('#memo-round').selectOption('2');
  assert.equal(await b.locator('#memo-own-list tr').count(),0);
  assert.match(await b.locator('#memo-own-status').textContent(),/候補/);
  await b.locator('#memo-own-choice select').selectOption('dmp:4');
  assert.equal(await b.locator('#memo-own-list tr td').first().textContent(),'3');
  assert.deepEqual(await b.locator('#memo-list tr td:first-child').allTextContents(),['1','1','2','3']);
  await b.locator('#memo-round').selectOption('1');
  assert.equal(await b.locator('#memo-own-list tr').count(),2);
  assert.ok(reads>0);
 }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
