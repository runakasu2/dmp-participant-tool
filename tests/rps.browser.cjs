// Full API + isolated PostgreSQL + browser; no external or production DB access.
// NODE_PATH=/tmp/dmp-ui-validation/node_modules:/tmp/dmp-rps-validation/node_modules node tests/rps.browser.cjs
const {chromium} = require('playwright');
const {PGlite} = require('@electric-sql/pglite');
const express = require('express');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname,'..');
const output = '/tmp/dmp-rps-screenshots';
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
    await db.exec(`INSERT INTO players(dmp_id,handle_name) VALUES ('000123','同名プレイヤー・長いハンドルネーム'),('000456','同名プレイヤー・長いハンドルネーム');
      INSERT INTO decks(name) VALUES ('クローシスモウジャキングダム'),('白緑ドギラゴン逆'),('ジョーカーズ');
      INSERT INTO deck_aliases(deck_id,alias) VALUES (1,'旧名');`);
    for(let i=1;i<=7;i++)await db.query(`INSERT INTO deck_history(player_id,shop_id,event_id,seq,event_date,deck_name) VALUES (1,'s',$1,'1',$2,$3)`,[String(i),`2026-10-0${i}`,i%2?'旧名':i%3?'白緑ドギラゴン逆':'ジョーカーズ']);
    const whitespaceNames = [' オガワ', '　オガワ', 'オガワ ', ' 　オガワ　 ', 'オガワ'];
    for (const [i,name] of whitespaceNames.entries()) await db.query(
      'INSERT INTO players(dmp_id,handle_name) VALUES ($1,$2)', [String(68160+i),name]);
    const originalPlayers = (await db.query('SELECT * FROM players ORDER BY id')).rows;
    const originalHistory = (await db.query('SELECT * FROM deck_history ORDER BY id')).rows;
    fs.mkdirSync(output,{recursive:true});
    browser = await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
    const page = await browser.newPage();
    const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>new URL(route.request().url()).origin===origin ? route.continue() : route.abort());
    async function go(key) {
      if(['players','rps','decks'].includes(key) && page.viewportSize().width<=720)await page.locator('#menu-more').click();
      await page.locator('#menu-'+key).click();
      await page.locator('#page-'+key).waitFor({state:'visible'});
    }
    async function screenshot(name,width) {
      await page.evaluate(()=>window.scrollTo(0,0));
      await page.waitForTimeout(50);
      const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,
        pages:[...document.querySelectorAll('.page')].filter(p=>p.style.display!=='none').length}));
      assert.ok(layout.scroll<=width,JSON.stringify(layout)); assert.equal(layout.pages,1);
      if(width<=720) {
        assert.equal(await page.locator('.menu > button:visible').count(),5);
        assert.ok(await page.evaluate(()=>parseFloat(getComputedStyle(document.querySelector('main')).paddingBottom)>=document.querySelector('.header').getBoundingClientRect().height));
      }
      await page.screenshot({path:path.join(output,`${width}-${name}.png`),fullPage:true});
    }
    for(const width of [375,390,430,768,1440]) {
      await page.setViewportSize({width,height:900}); await page.goto(origin);
      await go('rps');
      await screenshot('form',width);
      for (const [i,rawName] of whitespaceNames.entries()) {
        const dmpId=String(68160+i);
        const beforeRecords=(await db.query('SELECT COUNT(*)::int AS n FROM rock_paper_scissors_records')).rows[0].n;
        const beforeGuests=(await db.query('SELECT COUNT(*)::int AS n FROM rps_guests')).rows[0].n;
        await page.locator('#rps-player-name').fill('　オガワ ');
        await page.locator('#rps-search').click();
        await page.locator('#rps-candidates button').filter({hasText:'DMP ID：'+dmpId}).waitFor();
        assert.equal(await page.locator('#rps-candidates button').count(),6);
        await page.locator('#rps-hand').selectOption('rock');
        await page.locator('#rps-save').click();
        assert.match(await page.locator('#rps-status').textContent(),/候補の表示だけでは/);
        assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM rock_paper_scissors_records')).rows[0].n,beforeRecords);
        await page.locator('#rps-candidates button').filter({hasText:'DMP ID：'+dmpId}).click();
        assert.equal(await page.locator('#rps-player-name').inputValue(),rawName);
        assert.equal(await page.locator('#rps-selected').getAttribute('data-selected'),'true');
        assert.match(await page.locator('#rps-selected').textContent(),new RegExp('選択済み.*'+dmpId));
        await page.locator('#rps-player-name').fill('別の名前');
        assert.equal(await page.locator('#rps-selected').getAttribute('data-selected'),null);
        await page.locator('#rps-save').click();
        assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM rock_paper_scissors_records')).rows[0].n,beforeRecords);
        await page.locator('#rps-player-name').fill('オガワ');
        await page.locator('#rps-search').click();
        await page.locator('#rps-candidates button').filter({hasText:'DMP ID：'+dmpId}).click();
        const [response]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/rps/records')),page.locator('#rps-save').click()]);
        assert.equal(response.status(),201);
        assert.equal(response.request().postDataJSON().dmpId,dmpId);
        await page.waitForFunction(()=>!document.getElementById('rps-form').hasAttribute('aria-busy'));
        const records=(await db.query('SELECT r.*,p.dmp_id FROM rock_paper_scissors_records r JOIN players p ON p.id=r.player_id ORDER BY r.id DESC LIMIT 1')).rows;
        assert.equal(records[0].dmp_id,dmpId); assert.equal(records[0].guest_id,null);
        assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM rps_guests')).rows[0].n,beforeGuests);
        await screenshot('selected-'+dmpId,width);
        await go('players');
        await page.locator('#player-search-input').fill(dmpId);
        await page.locator('#player-search-button').click();
        await page.locator('#player-search-list tr').filter({hasText:dmpId}).click();
        await page.waitForFunction(n=>document.getElementById('player-rps-total').textContent===n+'回記録', [375,390,430,768,1440].indexOf(width)+1);
        assert.deepEqual(await page.locator('#player-rps-stats strong').allTextContents(),['100%','0%','0%']);
        await go('rps');
      }
      const saves=()=>db.query('SELECT COUNT(*)::int AS n FROM rock_paper_scissors_records').then(r=>r.rows[0].n);
      const before=await saves();
      await page.locator('#rps-save').click(); assert.equal(await saves(),before);
      await page.locator('#rps-player-name').fill('同名'); await page.locator('#rps-search').click();
      await page.locator('#rps-candidates button').filter({hasText:'000123'}).waitFor();
      assert.equal(await page.locator('#rps-candidates button').count(),3);
      await screenshot('candidates',width);
      await page.locator('#rps-candidates button').filter({hasText:'000123'}).click();
      await page.locator('#rps-save').click(); assert.equal(await saves(),before,'hand required');
      for(const hand of ['rock','scissors','paper']) {
        await page.locator('#rps-hand').selectOption(hand);
        await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/rps/records')),page.locator('#rps-save').click()]);
        await page.waitForFunction(()=>document.getElementById('rps-status').textContent.includes('記録しました'));
        assert.equal(await page.locator('#rps-hand').inputValue(),'');
        assert.match(await page.locator('#rps-selected').textContent(),/000123/);
      }
      assert.equal(await saves(),before+3);
      await screenshot('saved',width);
      await page.locator('#rps-view-player').click(); await page.locator('#page-player-detail').waitFor({state:'visible'});
      assert.equal(await page.locator('#player-recent-decks li').count(),5);
      assert.equal(await page.locator('#player-deck-summary li').count(),3);
      assert.match(await page.locator('#player-recent-decks li').first().textContent(),/クローシスモウジャキングダム.*2026-10-07/);
      assert.match(await page.locator('#player-deck-summary li').first().textContent(),/4回/);
      assert.deepEqual(await page.locator('#player-rps-stats strong').allTextContents(),['33.3%','33.3%','33.3%']);
      const stats=await page.locator('#player-rps-stats > div').evaluateAll(nodes=>nodes.map(n=>({x:n.getBoundingClientRect().x,y:n.getBoundingClientRect().y,w:n.getBoundingClientRect().width})));
      assert.ok(stats.every(s=>s.y===stats[0].y)); assert.ok(stats[0].x+stats[0].w<=stats[1].x);
      if(width<=720)assert.ok(await page.locator('#player-recent-decks').evaluate(el=>el.getBoundingClientRect().height)<280);
      await screenshot('insights',width);
      await go('players');
      await page.locator('#player-search-input').fill('000456');await page.locator('#player-search-button').click();
      await page.locator('#player-search-list tr').filter({hasText:'000456'}).click();
      await page.locator('#player-rps-empty').waitFor({state:'visible'});
      assert.match(await page.locator('#player-recent-decks').textContent(),/記録がありません/);
      await screenshot('empty-insights',width);
      await go('rps');
      await page.locator('#rps-player-name').fill('未登録'+width);await page.locator('#rps-search').click();
      await page.locator('#rps-candidates button').filter({hasText:'新しい記録先'}).click();
      await page.locator('#rps-hand').selectOption('rock');
      await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/rps/records')),page.locator('#rps-save').click()]);
      await page.waitForFunction(()=>document.getElementById('rps-selected').textContent.includes('記録先 #'));
      await page.locator('#rps-hand').selectOption('rock');
      await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/rps/records')),page.locator('#rps-save').click()]);
      await page.waitForFunction(()=>!document.getElementById('rps-form').hasAttribute('aria-busy'));
      await page.locator('#rps-view-player').click(); await page.locator('#page-player-detail').waitFor({state:'visible'});
      assert.equal(await page.locator('#player-rps-total').textContent(),'2回記録');
      assert.match(await page.locator('#player-detail-id').textContent(),/DMP ID未登録/);
      await go('players');await page.locator('#player-search-input').fill('未登録'+width);await page.locator('#player-search-button').click();
      await page.locator('#player-search-list tr').filter({hasText:'DMP ID未登録'}).click();
      await page.locator('#page-player-detail').waitFor({state:'visible'});
      assert.equal(await page.locator('#player-rps-total').textContent(),'2回記録');
      await screenshot('guest-insights',width);
      console.log('RPS full stack verified',width);
    }
    // Changed input must invalidate identity, failed saves must preserve the selected hand.
    await go('rps'); await page.locator('#rps-player-name').fill('000123'); await page.locator('#rps-search').click();
    await page.locator('#rps-candidates button').filter({hasText:'DMP ID：000123'}).click();
    await page.locator('#rps-player-name').fill('他人');await page.locator('#rps-hand').selectOption('paper');await page.locator('#rps-save').click();
    assert.match(await page.locator('#rps-status').textContent(),/候補から/);
    await page.locator('#rps-player-name').fill('000123');await page.locator('#rps-search').click();
    await page.locator('#rps-candidates button').filter({hasText:'DMP ID：000123'}).click();
    await page.route('**/api/rps/records',route=>route.fulfill({status:503,json:{error:'テスト用の保存エラー'}}));
    await page.locator('#rps-save').click(); await page.waitForFunction(()=>document.getElementById('rps-status').textContent.includes('保存エラー'));
    assert.equal(await page.locator('#rps-hand').inputValue(),'paper');assert.equal(await page.locator('#rps-save').isEnabled(),true);
    assert.deepEqual(errors,[]);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM players')).rows[0].n,7);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM rps_guests')).rows[0].n,5);
    assert.deepEqual((await db.query('SELECT * FROM players ORDER BY id')).rows,originalPlayers);
    assert.deepEqual((await db.query('SELECT * FROM deck_history ORDER BY id')).rows,originalHistory);
    console.log('RPS browser checks passed; screenshots:',output);
  } finally {
    if(browser)await browser.close();
    if(server)await new Promise(resolve=>server.close(resolve));
    await db.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
