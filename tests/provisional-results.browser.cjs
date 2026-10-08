// Full API + isolated PostgreSQL + browser; no external or production DB access.
// NODE_PATH=/tmp/dmp-ui-validation/node_modules:/tmp/dmp-rps-validation/node_modules node tests/provisional-results.browser.cjs
const {chromium} = require('playwright');
const {PGlite} = require('@electric-sql/pglite');
const express = require('express');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname,'..');
const output = '/tmp/dmp-provisional-screenshots';
(async () => {
  const db = new PGlite();
  let browser, server;
  try {
    const pool = {query:(sql,args)=>args ? db.query(sql,args) : db.exec(sql).then(rows=>rows.at(-1)),connect:async()=>({query:pool.query,release(){}})};
    const app = express();
    const listen = app.listen.bind(app); app.listen = () => {};
    const localExpress = Object.assign(()=>app,express);
    vm.runInNewContext(fs.readFileSync(path.join(root,'server.js'),'utf8'),{
      require(name){if(name==='express')return localExpress;if(name==='pg')return {Pool:function(){return pool;}};return require(name);},
      __dirname:root,process:{env:{}},console,URL,URLSearchParams,TextDecoder
    });
    server = await new Promise(resolve=>{const s=listen(0,'127.0.0.1',()=>resolve(s));});
    const origin = `http://127.0.0.1:${server.address().port}`;
    const setup = await fetch(origin+'/api/setup-db');
    assert.equal(setup.status,200,await setup.text());
    await db.exec(`INSERT INTO players(dmp_id,handle_name) VALUES('68160','　オガワ'),('2','　オガワ');
      INSERT INTO decks(name,image_url) VALUES('白緑ドギラゴン逆','https://card-fixture.invalid/card.png'),('ゴルギーオージャー',NULL);
      INSERT INTO events(shop_id,event_id,seq,event_name,event_date,participant_count) VALUES('s','e','1','仮登録テスト大会','2026-10-08',64),('s','e','2','別Seq','2026-10-08',64);
      INSERT INTO deck_memo_archives(event_record_id,event_name,event_date,admin_key,source_url,source) VALUES(1,'仮登録テスト大会','2026-10-08','key','https://tcg.sfc-jpn.jp/loginnum.asp?tid=key','tcg_meister');
      INSERT INTO deck_memo_archive_players(archive_id,participant_key,dmp_id,player_id,handle_name,deck_id) VALUES(1,'a','68160',1,'　オガワ',1),(1,'b','2',2,'　オガワ',NULL),(1,'c',NULL,NULL,'　同名の別人・長いハンドルネーム',NULL);`);
    fs.mkdirSync(output,{recursive:true});
    browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
    const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
    await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
    // Only external official fetch is mocked; provisional, archive and save APIs use the isolated DB.
    await page.route('**/api/event-result-from-detail',route=>route.fulfill({json:{success:true,count:0,participants:[],shopId:'s',eventId:'e',held:'1',eventName:'仮登録テスト大会',eventDate:'2026-10-08'}}));
    await page.route('https://card-fixture.invalid/**',route=>route.fulfill({contentType:'image/png',body:fs.readFileSync(path.join(root,'favicon.png'))}));
    async function go(key){if(['players','rps','decks'].includes(key)&&page.viewportSize().width<=720)await page.locator('#menu-more').click();await page.locator('#menu-'+key).click();await page.locator('#page-'+key).waitFor({state:'visible'});}
    async function check(name,width){await page.evaluate(()=>window.scrollTo(0,0));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(output,width+'-'+name+'.png'),fullPage:true});}
    async function fetchResults(){await go('results');await page.locator('#result-url').fill('https://www.dmp-ranking.com/event.asp?ShopID=s&EventID=e&Seq=1');await page.locator('#get-result').click();await page.waitForFunction(()=>document.getElementById('get-result').disabled===false);}
    for(const width of [375,390,430,768,1440]){
      await db.exec("DELETE FROM event_results; DELETE FROM deck_history; UPDATE deck_memo_archive_players SET deck_id=NULL WHERE participant_key='b';");
      await page.setViewportSize({width,height:900});await page.goto(origin);await go('deck-memo');
      await page.locator('#memo-archives-list button').first().click();await page.locator('#memo-archive-players tr').first().waitFor();
      const apply=async()=>{await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/deck-memo/provisional-results')),page.locator('#memo-archive-provisional').click()]);await page.locator('#memo-provisional-status').filter({hasText:'仮反映しました'}).waitFor();};
      await apply();await check('apply',width);await fetchResults();
      assert.match(await page.locator('#result-kind').textContent(),/仮登録/);
      assert.equal(await page.locator('#result-list tr').count(),3);
      assert.match(await page.locator('#results-distribution-count').textContent(),/判明：1人.*不明：2人/);
      assert.ok(await page.locator('#results-distribution-pie svg').count());
      const pie=page.locator('#results-distribution-pie');
      await pie.locator('svg image').waitFor({state:'attached'});
      assert.equal(await pie.locator('svg image').count(),1);
      assert.equal(await pie.locator('svg image').getAttribute('href'),'https://card-fixture.invalid/card.png');
      await page.waitForFunction(()=>document.querySelector('#results-distribution-pie .deck-pie-legend img')?.naturalWidth>0);
      assert.equal(await pie.locator('.deck-pie-legend img').count(),1);
      assert.ok((await page.locator('#result-list .compact-action button').allTextContents()).every(t=>t==='仮登録'));
      assert.equal(await page.locator('#result-list .compact-name-text').first().textContent(),'　オガワ');
      assert.ok((await page.locator('#result-list .compact-rank').allTextContents()).every(t=>t.trim()==='-'));
      await page.locator('#result-list .compact-toggle').first().click();await check('provisional-expanded',width);
      await page.locator('#result-list .compact-toggle').first().click();await check('provisional',width);
      await db.exec("UPDATE deck_memo_archive_players SET deck_id=2 WHERE participant_key='b';");
      await go('deck-memo');await apply();await apply();await fetchResults();
      assert.match(await page.locator('#results-distribution-count').textContent(),/判明：2人.*不明：1人/);
      assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM provisional_event_results')).rows[0].n,1);
      await db.exec("INSERT INTO event_results(event_record_id,player_id,rank) VALUES(1,1,1),(1,2,2); INSERT INTO deck_history(player_id,shop_id,event_id,seq,event_date,deck_name) VALUES(1,'s','e','1','2026-10-08','ゴルギーオージャー');");
      await fetchResults();assert.match(await page.locator('#result-kind').textContent(),/公式結果/);
      assert.equal(await page.locator('#result-list tr').count(),2);
      assert.deepEqual(await page.locator('#result-list .compact-rank').allTextContents(),['1','2']);
      assert.equal(await page.locator('#result-list tr[data-deck-conflict=true]').count(),1);
      assert.match(await page.locator('#result-list tr').first().textContent(),/差異あり/);
      assert.equal(await pie.locator('svg image').count(),0,'unregistered artwork stays absent in official mode');
      await check('official-conflict',width);
      await page.locator('#result-list select').nth(1).selectOption('1');
      await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/deck-history')&&r.request().method()==='POST'),page.locator('#result-list .compact-action button').nth(1).click()]);
      await page.locator('#result-list .compact-action button').nth(1).filter({hasText:'保存済み'}).waitFor();
      assert.match(await page.locator('#results-distribution-count').textContent(),/公式結果：2人.*判明：2人/);
      await pie.locator('svg image').waitFor({state:'attached'});
      assert.equal(await pie.locator('svg image').count(),1,'official manual save also uses registered artwork');
      console.log('Provisional + official full stack verified',width);
    }
    assert.deepEqual(errors,[]);console.log('Screenshots:',output);
  }finally{if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
