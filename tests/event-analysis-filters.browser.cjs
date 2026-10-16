// All writes are limited to the isolated PostgreSQL fixture.
const {chromium}=require('playwright'),express=require('express'),assert=require('node:assert/strict'),path=require('node:path');
const {fixture}=require('./matching-archives-postgres.integration');
(async()=>{const f=await fixture();let browser,server;
 try{
 for(let i=1;i<=13;i++){
  await f.db.query(`INSERT INTO events(shop_id,event_id,seq,event_name,event_date,format,participant_count) VALUES('scope',$1,'1',$2,$3,$4,10)`,[String(i),(i%2?'対象ＣＳ':'別大会')+i,i<=6?'2026-10-01':'2026-09-01',i===13?'advance':'original']);
  await f.db.query(`INSERT INTO deck_history(player_id,shop_id,event_id,seq,event_date,deck_name) VALUES(1,'scope',$1,'1',$2,$3)`,[String(i),i<=6?'2026-10-01':'2026-09-01',i%2?'A':'B']);
 }
 const snapshot=JSON.stringify((await f.db.query('SELECT * FROM events ORDER BY id')).rows);
 const app=express();app.use(express.json());for(const [key,h]of f.routes){const [m,...p]=key.split(' ');app[m.toLowerCase()](p.join(' '),h);}app.use(express.static(path.resolve(__dirname,'..')));
 server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});
 browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('#menu-events').click();await page.waitForFunction(()=>document.querySelector('#event-count').textContent.includes('12件'));
 await page.locator('.event-analysis-tools summary').click();await page.locator('#show-deck-period').click();await page.locator('#show-deck-trends').click();
 const check=async(n,participants)=>{await page.waitForFunction(({n,participants})=>document.querySelector('#deck-period-status').textContent.includes(`期間内大会：${n} ／`)&&document.querySelector('#deck-period-status').textContent.includes(`合計参加人数：${participants}人`)&&document.querySelector('#deck-trend-status').textContent.includes(`／ ${n}大会 ／`),{n,participants},{timeout:15000});};
 await check(12,120);assert.ok((await page.locator('#deck-period-rows').textContent()).includes('5.0%'));
 await page.locator('#events-name-search').fill('対象cs');await check(6,60);assert.ok((await page.locator('#deck-period-rows').textContent()).includes('10.0%'));assert.ok(!(await page.locator('#deck-period-rows').textContent()).includes('B'));
 await page.locator('#events-start-date').fill('2026-10-01');await check(3,30);
 await page.locator('[data-format="advance"]').click();await check(0,0); // Matching name, but excluded by date.
 await page.locator('#event-period-reset').click();await check(1,10); // Keeps current format, clears date/name.
 await page.locator('[data-format="original"]').click();await check(12,120);
 await page.locator('#events-name-search').fill('存在しない大会');await check(0,0);assert.equal(await page.locator('#deck-period-rows tr').count(),0);assert.equal(await page.locator('#deck-trend-chart').textContent(),'条件に一致する母数データがありません。');
 await page.locator('#events-name-search').fill('');await check(12,120);
 for(const width of [375,390,430,768,1440]){await page.setViewportSize({width,height:900});await check(12,120);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`/tmp/event-analysis-${width}.png`,fullPage:true});}
 assert.equal(JSON.stringify((await f.db.query('SELECT * FROM events ORDER BY id')).rows),snapshot);assert.deepEqual(errors,[]);
 console.log('PASS exact shared scope (>10 events), normalized name, date + format, auto refresh, reset, zero, filtered percentages, responsive layout and unchanged event data');
 }finally{await browser?.close();if(server)await new Promise(r=>server.close(r));await f.db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
