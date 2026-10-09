// Full-stack local UI validation against isolated PGlite, with external fetching replaced by fixtures.
const {chromium}=require('playwright');
const express=require('express');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {fixture,row}=require('./matching-archives-postgres.integration.js');
(async()=>{
 const f=await fixture();const app=express();app.use(express.json());
 for(const [key,handler]of f.routes){const space=key.indexOf(' ');app[key.slice(0,space).toLowerCase()](key.slice(space+1),handler);}
 app.use(express.static(path.resolve(__dirname,'..')));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  let accept=true;page.on('dialog',d=>accept?d.accept():d.dismiss());
  await page.goto('http://127.0.0.1:'+server.address().port);
  for(const width of [375,390,430,768,1440]){
   await page.setViewportSize({width,height:900});await page.locator('#menu-deck-memo').click();
   await page.locator('#memo-url').fill(f.source);await page.locator('#memo-dmp-url').fill('https://www.dmp-ranking.com/event.asp?ShopID=s&EventID=e&Seq=2');
   await page.locator('#memo-refresh').click();await page.waitForFunction(()=>document.querySelector('#memo-status').textContent.includes('最新の対戦表を取得しました'));
   assert.equal(await page.locator('#memo-list tr').count(),4);assert.equal(await page.locator('#memo-round option').count(),2);
   await page.locator('#memo-round').selectOption('1');assert.equal(await page.locator('#memo-list tr').count(),4);
   const first=page.locator('#memo-list tr').first();assert.equal((await first.locator('td').nth(1).innerText()).trim(),'000123');
   await first.locator('select').selectOption('1');await page.waitForFunction(()=>document.querySelector('#memo-list small').textContent==='保存しました');
   await page.locator('#memo-round').selectOption('2');assert.equal(await page.locator('#memo-list tr').first().locator('select').inputValue(),'1');
   await page.locator('#memo-round').selectOption('1');assert.equal(await page.locator('#memo-list tr').first().locator('select').inputValue(),'1');
   await page.locator('#memo-list details').first().locator('summary').click();assert.match(await page.locator('#memo-list details').first().innerText(),/対戦相手：同名.*勝ち/);
   await page.locator('#memo-list details').first().locator('summary').click();
   await page.locator('#matching-save').click();await page.waitForFunction(()=>document.querySelector('#matching-status').textContent.includes('対戦表を保存しました'));
   assert.equal(await page.locator('.matching-archive-row').count(),1);
   assert.equal((await f.db.query('SELECT COUNT(*)::int n FROM matching_archive_matches')).rows[0].n,4);
   assert.equal(await page.locator('#memo-round').isEnabled(),true);assert.equal(await page.locator('#memo-refresh').isEnabled(),true);
   const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,rowHeight:document.querySelector('#memo-list tr').getBoundingClientRect().height}));
   assert.ok(layout.scroll<=width+1,JSON.stringify(layout));assert.ok(layout.rowHeight<=65,JSON.stringify(layout));
   fs.mkdirSync('/tmp/dmp-matching-screenshots',{recursive:true});await page.screenshot({path:'/tmp/dmp-matching-screenshots/round-'+width+'.png',fullPage:true});
   console.log('PASS layout and round/memo/save lifecycle '+width+'px');
  }
  // Offline source still allows repeatable local reads after a page reload.
  f.state.offline=true;await page.reload();await page.locator('#menu-deck-memo').click();
  await page.locator('.matching-archive-row button').first().click();await page.waitForFunction(()=>document.querySelector('#memo-status').textContent.includes('保存済み対戦表'));
  await page.locator('#memo-round').selectOption('1');assert.equal(await page.locator('#memo-list tr').first().locator('select').inputValue(),'1');
  await page.locator('#memo-list tr').first().locator('select').selectOption('2');await page.waitForFunction(()=>document.querySelector('#memo-list small').textContent==='保存しました');
  await page.locator('#memo-round').selectOption('2');assert.equal(await page.locator('#memo-list tr').first().locator('select').inputValue(),'2');
  await page.locator('#matching-save').click();await page.waitForFunction(()=>document.querySelector('#matching-status').textContent.includes('対戦サイトに接続できません'));
  assert.equal(await page.locator('#memo-refresh').isEnabled(),true);
  f.state.offline=false;f.state.rows=[];await page.locator('#matching-save').click();await page.waitForFunction(()=>document.querySelector('#matching-status').textContent.includes('保存済みデータは維持'));
  assert.equal((await f.db.query('SELECT COUNT(*)::int n FROM matching_archive_matches')).rows[0].n,4);
  f.state.rows=[row(1,1),row(1,2,'789','987'),row(2,1),row(2,2,'789','987'),row(3,1),row(3,2,'789','987')];
  await page.locator('#matching-save').click();await page.waitForFunction(()=>document.querySelector('#matching-status').textContent.includes('3回戦'));
  await page.locator('.matching-archive-row button').first().click();await page.waitForFunction(()=>document.querySelectorAll('#memo-round option').length===3);
  const before=(await f.db.query('SELECT * FROM deck_memos ORDER BY id')).rows;
  accept=false;await page.locator('.matching-archive-row .danger-button').click();assert.equal(await page.locator('.matching-archive-row').count(),1);
  accept=true;await page.locator('.matching-archive-row .danger-button').click();await page.waitForFunction(()=>document.querySelector('#matching-archive-list').textContent==='保存済み対戦表はありません。');
  assert.equal((await f.db.query('SELECT COUNT(*)::int n FROM matching_archive_matches')).rows[0].n,0);
  assert.deepEqual((await f.db.query('SELECT * FROM deck_memos ORDER BY id')).rows,before);
  assert.equal((await f.db.query('SELECT COUNT(*)::int n FROM deck_memo_roster')).rows[0].n,4);
  assert.deepEqual(errors,[]);console.log('PASS offline source, empty snapshot, updated rounds, confirmed/cancelled deletion, memo preservation');
 }finally{await browser?.close();await new Promise(r=>server.close(r));await f.db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
