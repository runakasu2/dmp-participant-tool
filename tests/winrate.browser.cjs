// End-to-end UI against isolated PostgreSQL. No production DB or provider access.
const {chromium}=require('playwright'),express=require('express'),assert=require('node:assert/strict'),path=require('node:path');
const {fixture}=require('./matching-archives-postgres.integration'),{seed}=require('./winrate-postgres.integration');
(async()=>{
 const f=await fixture();await seed(f);const app=express();app.use(express.json());for(const [key,handler]of f.routes){const [method,...parts]=key.split(' ');app[method.toLowerCase()](parts.join(' '),handler);}app.use(express.static(path.resolve(__dirname,'..')));
 const server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  await page.goto('http://127.0.0.1:'+server.address().port);
  async function ready(){await page.waitForFunction(()=>!document.querySelector('#wr-results').hidden&&document.querySelector('#wr-status').textContent.includes('集計しました'));}
  async function open(width){if(width<=720)await page.locator('#menu-more').click();await page.locator('#menu-winrate').click();await ready();}
  for(const width of [375,390,430,768,1440]){
   await page.setViewportSize({width,height:900});await open(width);
   assert.equal(await page.locator('#current-page-label').textContent(),'勝率分析');assert.equal(await page.locator('#wr-decks tr').count(),2);assert.equal(await page.locator('#wr-counts strong').nth(1).textContent(),'6');
   await page.locator('#wr-sort').selectOption('name');assert.equal(await page.locator('#wr-decks tr').first().locator('th').textContent(),'A');await page.locator('#wr-sort').selectOption('rate');await page.locator('#wr-sort').selectOption('matches');
   await page.locator('#wr-matrix-body button[data-deck-id="1"][data-opponent-id="2"]').click();await page.waitForFunction(()=>document.querySelector('#wr-detail-status').textContent.includes('6試合'));assert.equal(await page.locator('#wr-detail-matches article').count(),6);
   await page.locator('#wr-detail-close').click();
   await page.locator('#wr-mode').selectOption('single');if(width===375)await page.waitForFunction(()=>document.querySelector('#wr-status').textContent==='大会を選択してください。');await page.locator('#wr-event').selectOption('2');await ready();assert.equal(await page.locator('#wr-counts strong').nth(1).textContent(),'2');
   await page.locator('#wr-format').selectOption('advance');await ready();
   await page.locator('#wr-start').fill('2026-10-02');await page.locator('#wr-end').fill('2026-10-02');await ready();
   await page.screenshot({path:'/tmp/winrate-'+width+'.png',fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'page overflow '+width);
   await page.locator('#wr-format').selectOption('original');await page.waitForFunction(()=>document.querySelector('#wr-status').textContent.includes('ありません'));assert.equal(await page.locator('#wr-decks').textContent(),'デッキが登録された記録はありません。');
   await page.locator('#wr-format').selectOption('');await page.locator('#wr-start').fill('');await page.locator('#wr-end').fill('');await page.locator('#wr-mode').selectOption('all');await ready();
   await page.locator('#menu-deck-memo').click();assert.equal(await page.locator('#page-winrate').isVisible(),false);console.log('PASS '+width+'px: navigation, filters, sort, matrix/detail, empty, no page overflow');
  }
  // Fresh memo updates through the existing API are reflected at page re-entry.
  await page.evaluate(async()=>{const response=await fetch('/api/deck-memo',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:'https://nojigikucs.com/?admin=noji',memoEventId:1,dmpId:'000123',deckId:2})});if(!response.ok)throw Error('memo update failed');});
  await open(1440);const mirror=page.locator('#wr-matrix-body button[data-deck-id="2"][data-opponent-id="2"]');assert.ok((await mirror.textContent()).includes('50.0%2試合'));await mirror.click();await page.waitForFunction(()=>document.querySelector('#wr-detail-status').textContent.includes('2試合 ／ 2勝 2敗'));assert.equal(await page.locator('#wr-detail-matches article').count(),2);
  await page.locator('#wr-detail-matches article button').first().click();await page.waitForFunction(()=>document.querySelector('#memo-status').textContent.includes('保存済み対戦表'));assert.equal(await page.locator('#page-winrate').isVisible(),false);assert.equal(await page.locator('#memo-round option').count(),2);
  await open(1440);await page.locator('#wr-matrix-body button[data-deck-id="1"][data-opponent-id="2"]').click();await page.waitForFunction(()=>document.querySelector('#wr-detail-status').textContent.includes('4試合'));
  await f.db.exec("UPDATE deck_memo_external_players SET deck_id=3 WHERE memo_event_id=2 AND participant_key='id:39';");
  await page.locator('#wr-detail-close').click();await page.locator('#wr-matrix-body button[data-deck-id="1"][data-opponent-id="2"]').click();await page.waitForFunction(()=>document.querySelector('#wr-status').textContent.includes('データ更新を検出'));assert.equal(await page.locator('#wr-decks tr').count(),3);
  await f.db.exec("UPDATE decks SET name='Z' WHERE id=1; UPDATE matching_archive_matches SET winner_key='11111111-1111-1111-1111-111111111111' WHERE archive_id=3 AND round=2;");
  await page.locator('#wr-reload').click();await ready();await page.locator('#wr-sort').selectOption('name');assert.equal(await page.locator('#wr-decks tr').first().locator('th').textContent(),'B');await page.locator('#wr-sort').selectOption('rate');assert.equal(await page.locator('#wr-decks tr').first().locator('th').textContent(),'Z');await page.locator('#wr-sort').selectOption('matches');assert.equal(await page.locator('#wr-decks tr').first().locator('th').textContent(),'B');
  await page.locator('.wr-exclusions summary').click();assert.ok((await page.locator('#wr-exclusions').textContent()).includes('対面対象'));
  await page.screenshot({path:'/tmp/winrate-detail-1440.png',fullPage:true});
  // Matrix axes are paged; long names must stay inside its scroll container.
  await f.db.exec("INSERT INTO decks(name) SELECT '長いデッキ名テスト' || n FROM generate_series(4,28) n;");
  for(let id=4;id<=28;id++)await f.db.query(`INSERT INTO matching_archive_matches(archive_id,round,match_key,table_no,sides,outcome) VALUES(1,$1,$2,1,$3,'unresolved')`,[id,'unknown-'+id,JSON.stringify([{participantKey:'entry:'+id,dmpId:String(id),name:'プレイヤー'}])]);
  for(let id=4;id<=28;id++)await f.db.query('INSERT INTO deck_memos(memo_event_id,dmp_id,deck_id) VALUES(1,$1,$2)',[String(id),id]);
  await page.setViewportSize({width:375,height:900});await page.locator('#wr-reload').click();await ready();assert.equal(await page.locator('#wr-row-range option').count(),2);assert.equal(await page.locator('#wr-matrix-body tr').count(),20);await page.locator('#wr-row-range').selectOption('1');assert.equal(await page.locator('#wr-matrix-body tr').count(),8);await page.locator('#wr-col-range').selectOption('1');assert.equal(await page.locator('#wr-matrix-head th').count(),9);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  assert.deepEqual(errors,[]);console.log('PASS memo freshness, mirror totals, archive navigation, revision conflict, matrix paging, no page errors');
 }finally{await browser?.close();await new Promise(r=>server.close(r));await f.db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
