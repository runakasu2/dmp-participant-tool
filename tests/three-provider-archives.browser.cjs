// Local Chrome + isolated PostgreSQL. All external providers are fixture-backed.
const {chromium}=require('playwright'),express=require('express'),assert=require('node:assert/strict'),path=require('node:path');
const {fixture}=require('./matching-archives-postgres.integration');
const {installMemoRoutes}=require('../deck-memo'),{installMatchingArchiveRoutes}=require('../matching-archives');
const {tcgUrl,sugaUrl,providerFetch}=require('./helpers/three-provider-fixtures');
(async()=>{
 const f=await fixture(),state={},fetchImpl=providerFetch(state);
 installMemoRoutes(f.app,f.pool,fetchImpl,async()=>({...f.detail}));installMatchingArchiveRoutes(f.app,f.pool,fetchImpl);
 const app=express();app.use(express.json());for(const [key,h]of f.routes){const [method,...parts]=key.split(' ');app[method.toLowerCase()](parts.join(' '),h);}app.use(express.static(path.resolve(__dirname,'..')));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  await page.goto('http://127.0.0.1:'+server.address().port);
  for(const width of [375,390,430,768,1440])for(const provider of ['tcg_meister','sugatool']){
   await page.setViewportSize({width,height:900});await page.locator('#menu-deck-memo').click();
   await page.locator('#memo-url').fill(provider==='tcg_meister'?tcgUrl:sugaUrl);await page.locator('#memo-dmp-url').fill('https://www.dmp-ranking.com/event.asp?ShopID=s&EventID=e&Seq=2');
   await page.locator('#memo-refresh').click();await page.waitForFunction(()=>document.querySelector('#memo-status').textContent.includes('最新の対戦表を取得しました'));
   assert.equal(await page.locator('#matching-save').isEnabled(),true);
   if(provider==='tcg_meister'){if(!await page.locator('#matching-tcg-settings').evaluate(n=>n.open))await page.locator('#matching-tcg-settings summary').click();await page.locator('#matching-tcg-rounds').fill('4');await page.locator('#matching-tcg-zero').check();await page.locator('#matching-tcg-double-loss').check();}
   await page.locator('#matching-save').click();await page.waitForFunction(()=>document.querySelector('#memo-status').textContent.includes('保存済み対戦表'));
   assert.equal(await page.locator('#memo-round option').count(),provider==='tcg_meister'?4:3);
   const first=page.locator('#memo-list tr').first(),name=await first.locator('summary').innerText();
   await first.locator('select').selectOption('1');await page.waitForFunction(()=>document.querySelector('#memo-list small').textContent==='保存しました');
   if(provider==='sugatool'){const unknown=page.locator('#memo-list tr').filter({has:page.locator('td').filter({hasText:/^未取得$/})});await unknown.locator('select').selectOption('2');await page.waitForFunction(()=>[...document.querySelectorAll('#memo-list small')].filter(el=>el.textContent==='保存しました').length===2);}
   await page.locator('#memo-round').selectOption('1');
   if(provider==='tcg_meister')assert.equal(await page.getByRole('combobox',{name:name+'の使用デッキ',exact:true}).inputValue(),'1');
   else{assert.equal(await page.locator('#memo-list tr').first().locator('select').inputValue(),'1');assert.equal(await page.locator('#memo-list tr').nth(1).locator('select').inputValue(),'2');}
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   console.log('PASS '+provider+' '+width+'px: save, full rounds, memo edit and round switching');
  }
  state.offline=true;await page.reload();await page.locator('#menu-deck-memo').click();
  await page.locator('.matching-archive-row').filter({has:page.locator('button[title^="sugatool"]')}).locator('button').first().click();await page.waitForFunction(()=>document.querySelector('#memo-status').textContent.includes('保存済み対戦表'));
  await page.locator('#memo-round').selectOption('1');assert.equal(await page.locator('#memo-list tr').nth(1).locator('select').inputValue(),'2');
  await page.locator('#matching-save').click();await page.waitForFunction(()=>document.querySelector('#matching-status').textContent.includes('取得に失敗'));assert.equal(await page.locator('#memo-round option').count(),3);
  await page.evaluate(async()=>{const list=await(await fetch('/api/matching-archives')).json();const a=list.archives.find(a=>a.provider==='tcg_meister');const matching=await(await fetch('/api/matching-archives/'+a.id)).json();const decks=await(await fetch('/api/decks?sort=usage')).json();const r=matching.rounds.at(-1);r.participants=[{...r.participants[0],participantKey:'seat:unknown',internalParticipantId:null,dmpId:null,memoExternal:false,deckId:null,deckName:null}];matching.participants=r.participants;document.dispatchEvent(new CustomEvent('memo-open-matching-archive',{detail:{matching,decks:decks.decks}}));});
  assert.equal(await page.locator('#memo-list select').first().isEnabled(),false);
  const memoSnapshot=(await f.db.query('SELECT * FROM deck_memo_external_players ORDER BY memo_event_id,participant_key')).rows;
  await page.locator('#matching-delete-open').click();await page.locator('#matching-delete-events button').first().click();await page.locator('#matching-delete-archives label').filter({hasText:'スガツール'}).locator('input').check();await page.locator('#matching-delete-execute').click();await page.waitForFunction(()=>document.querySelectorAll('.matching-archive-row').length===1);
  assert.deepEqual((await f.db.query('SELECT * FROM deck_memo_external_players ORDER BY memo_event_id,participant_key')).rows,memoSnapshot);
  assert.deepEqual(errors,[]);console.log('PASS offline saved reads, scoped deletion, external memo preservation, no page errors');
 }finally{await browser?.close();await new Promise(r=>server.close(r));await f.db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
