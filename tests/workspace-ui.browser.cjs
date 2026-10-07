// Optional UI smoke test: NODE_PATH=/tmp/dmp-ui-validation/node_modules node tests/workspace-ui.browser.cjs
// Serves only local static files; every API is stubbed, so no production data is read or written.
const {chromium}=require('playwright');
const express=require('express');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const output=process.env.UI_SCREENSHOT_DIR || '/tmp/dmp-ui-screenshots';
const decks=[{id:1,name:'青黒COMPLEX',formats:['original','advance'],aliases:[]},{id:2,name:'赤白アーマード・長いデッキ名の表示確認',formats:['original'],aliases:[]}];
const players=[{id:'000123',name:'テストプレイヤー／長いハンドルネーム',rank:1},{id:'000456',name:'プレイヤーB',rank:2}];
const event={id:1,shop_id:'shop123',event_id:'event456',seq:'1',event_name:'第123回 デュエル・マスターズCS【オリジナル】',event_date:'2026-10-07',participant_count:64,result_count:2,best_four:players.map(p=>({rank:p.rank,dmpId:p.id,handleName:p.name,deckName:decks[0].name}))};
const memoPlayers=['「ッジ」','るなかす','りょけん','光月おでんじん','ペリュ','希亜','長いハンドルネームの折り返し確認'].map((name,i)=>({name,participantKey:'id:'+i,internalParticipantId:String(i),table:Math.floor(i/2)+1,deckId:1,deckName:decks[0].name}));
const bodies=[];
let failParticipants=false;
let memoProvider='tcg_meister';
function responseFor(url,request){
  const body=request.postDataJSON(); if(body)bodies.push({path:url.pathname,body});
  if(url.pathname==='/api/participants')return {count:2,format:'original',decks,participants:players.map(p=>({...p,recentDecks:[{deckName:decks[0].name,eventDate:'2026-10-01',eventName:'過去の大会'}],prediction:{finalDeckName:decks[0].name,autoDeckName:decks[0].name,source:'auto',autoStatus:'ok',hasManualPrediction:false}}))};
  if(url.pathname==='/api/event-deck-prediction')return {hasManualPrediction:true,manualDeckId:2,manualDeckName:decks[1].name};
  if(url.pathname==='/api/event-result-from-detail')return {year:2026,shopId:'shop123',eventId:'event456',held:'1',eventName:event.event_name,eventDate:'2026-10-07',count:2,format:'original',participants:players};
  if(url.pathname==='/api/deck-history')return request.method()==='GET'?{decks:[{dmp_id:'000123',deck_name:decks[0].name}]}:{normalizedDeckName:decks[1].name};
  if(url.pathname==='/api/decks')return {decks};
  if(url.pathname==='/api/events')return {count:1,events:[event]};
  if(url.pathname==='/api/event-results')return {count:2,participants:players.map(p=>({...p,deckName:decks[0].name}))};
  if(url.pathname==='/api/event-deck-summary')return {participantCount:64,registeredCount:2,unregisteredCount:62,registeredDeckCount:2,decks:[{deckName:decks[0].name,count:2,percentage:'3.1',players:players.map(p=>({dmpId:p.id,handleName:p.name}))}],unregisteredPlayers:[]};
  if(url.pathname==='/api/player-search')return {count:1,players:[{dmp_id:'000123',handle_name:players[0].name}]};
  if(url.pathname==='/api/player-detail')return {player:{dmpId:'000123',handleName:players[0].name},deckSummary:[{deckName:decks[0].name,count:3}],historyCount:1,history:[{eventDate:'2026-10-01',eventName:event.event_name,deckName:decks[0].name}]};
  if(url.pathname==='/api/deck-memo/matching')return {provider:memoProvider,sourceUrl:body.url,adminKey:'5856470',latestRound:1,event:{eventName:event.event_name,eventDate:'2026-10-07'},participants:memoPlayers.map((p,i)=>({...p,...(memoProvider==='tcg_meister'?{}:{dmpId:String(i+123).padStart(6,'0')})}))};
  if(url.pathname==='/api/deck-memo')return {deckId:2,deckName:decks[1].name};
  if(url.pathname==='/api/deck-memo/archives')return {events:[{...event,registered_count:2}]};
  if(url.pathname==='/api/deck-memo/archives/1')return {event:{id:1,eventName:event.event_name,eventDate:'2026-10-07',provider:'tcg_meister',adminKey:'5856470'},participantCount:2,registeredCount:2,participants:players.map(p=>({name:p.name,deckName:decks[0].name}))};
  if(url.pathname==='/api/deck-memo/import-preview')return {archive:null};
  if(url.pathname==='/api/deck-trends')return {format:'original',excludedEvents:[],events:[1,2,3].map(i=>({eventRecordId:i,eventName:event.event_name,eventDate:'2026-10-0'+i,participantCount:64,registeredDeckCount:2,unregisteredCount:62,decks:[{deckId:1,deckName:decks[0].name,count:i}]}))};
  if(url.pathname==='/api/deck-period-summary')return {format:'original',totalEvents:1,includedEvents:1,missingEvents:0,totalParticipants:64,registeredDecks:2,unregistered:62,registrationPercentage:3.125,decks:[{deckName:decks[0].name,count:2,percentage:3.125}]};
  throw Error('Unexpected API: '+url.pathname);
}
(async()=>{
  fs.mkdirSync(output,{recursive:true});
  const app=express();app.use(express.static(root));
  const server=await new Promise((resolve,reject)=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));s.on('error',reject);});
  let browser;
  try {
    browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
    const context=await browser.newContext();
    const errors=[];
    const page=await context.newPage();
    page.on('pageerror',e=>errors.push(e.message));
    page.on('dialog',dialog=>dialog.accept());
    await page.route('**/api/**',async route=>{
      if(failParticipants && new URL(route.request().url()).pathname==='/api/participants'){await route.fulfill({status:503,json:{error:'テスト用の取得失敗'}});return;}
      try {await route.fulfill({json:{success:true,...responseFor(new URL(route.request().url()),route.request())}});}
      catch(error){errors.push(error.message);await route.fulfill({status:500,json:{error:error.message}});}
    });
    const go=async key=>{
      if(['players','decks'].includes(key)&&page.viewportSize().width<=720)await page.locator('#menu-more').click();
      await page.locator('#menu-'+key).click();
      await page.locator('#page-'+key).waitFor({state:'visible'});
    };
    async function check(name,width){
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('main *')].filter(el=>{
        const r=el.getBoundingClientRect();const cs=getComputedStyle(el);
        return r.width>0&&r.height>0&&cs.position!=='absolute'&& (r.right>innerWidth+2 || r.left < -2) && !el.closest('svg') && !(innerWidth<=1000 && el.closest('.responsive-cards > thead'));
      }).map(el=>el.tagName+'#'+el.id+'.'+el.className).slice(0,10)}));
      assert.ok(layout.scroll<=width+1,name+' page overflow '+JSON.stringify(layout));
      assert.deepEqual(layout.overflow,[],name+' element overflow');
      if(width<=720){
        const clearance=await page.evaluate(()=>{const main=document.querySelector('main');return parseFloat(getComputedStyle(main).paddingBottom)>=document.querySelector('.header').getBoundingClientRect().height;});
        assert.ok(clearance,'bottom nav clearance');
      }
      await page.evaluate(()=>window.scrollTo(0,0));
      await page.screenshot({path:path.join(output,`${width}-${name}.png`),fullPage:true});
    }
    for(const width of [375,390,430,768,1440]){
      await page.setViewportSize({width,height:900});
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await check('empty',width);
      await page.locator('#event-url').fill('https://www.dmp-ranking.com/event.asp?ShopID=shop123&EventID=event456&Seq=1');
      await page.locator('#get-event').click();
      await page.locator('#participant-list tr').first().waitFor();
      await page.locator('#participant-list select').first().selectOption('2');
      await page.locator('#participant-list button').filter({hasText:'手動で保存'}).first().click();
      await page.locator('#participant-list [role="status"]').first().filter({hasText:'保存しました'}).waitFor();
      await check('participants',width);
      await page.locator('#prediction-view-pie').click();await check('prediction-pie',width);await page.locator('#prediction-view-list').click();
      await page.locator('#participant-list .player-detail-link').first().click();
      await page.locator('#page-player-detail').waitFor({state:'visible'});
      await check('player-detail',width);
      await go('results');
      await page.locator('#result-url').fill('https://www.dmp-ranking.com/event.asp?ShopID=shop123&EventID=event456&Seq=1');
      await page.locator('#get-result').click();
      await page.locator('#result-list select').first().waitFor();
      await page.locator('#result-list select').first().selectOption('2');
      await page.locator('#result-list button').first().click();
      await page.locator('#result-list button').first().filter({hasText:'保存済み'}).waitFor();
      await check('results',width);
      await go('events');await page.locator('.event-card').waitFor();await check('events',width);
      await page.locator('#show-deck-period').click();await page.locator('#deck-period-rows tr').first().waitFor();await check('period',width);
      await page.locator('#show-deck-trends').click();await page.locator('#deck-trend-chart svg').waitFor();await check('trends',width);
      await page.locator('.event-card').click();await page.locator('#event-results-list tr').first().waitFor();await check('event-detail',width);
      await go('players');await page.locator('#player-search-input').fill('000123');await page.locator('#player-search-button').click();await page.locator('#player-search-list tr').waitFor();await check('players',width);
      await page.locator('#player-search-list tr').focus();await page.keyboard.press('Enter');await page.locator('#page-player-detail').waitFor({state:'visible'});
      await go('decks');await page.locator('.deck-management-row').first().waitFor();await check('decks',width);
      await page.locator('.deck-management-row').first().click();await check('deck-edit',width);
      await go('deck-memo');await page.locator('#memo-url').fill('https://tcg.sfc-jpn.jp/loginnum.asp?tid=5856470');await page.locator('#memo-dmp-url').fill('https://www.dmp-ranking.com/event.asp?ShopID=shop123&EventID=event456&Seq=1');await page.locator('#memo-refresh').click();await page.locator('#memo-list select').first().waitFor();
      await page.locator('#memo-list select').first().selectOption('2');await page.locator('#memo-list [role="status"]').first().filter({hasText:'保存'}).waitFor();await check('memo',width);
      if(width<=720){
        const roster=await page.locator('.memo-live-table').evaluate(table=>({
          display:getComputedStyle(table).display,header:table.tHead.getBoundingClientRect().height,
          rows:[...table.tBodies[0].rows].map(row=>row.getBoundingClientRect().height),
          badge:getComputedStyle(table.querySelector('small[data-save-state="saved"]'),'::after').content,
          statesInline:[...table.querySelectorAll('small[data-save-state="saved"]')].every(status=>{
            const s=status.getBoundingClientRect(),select=status.previousElementSibling.getBoundingClientRect();
            return s.top>=select.top && s.bottom<=select.bottom;
          })
        }));
        assert.equal(roster.display,'table');assert.ok(roster.header>20);
        assert.ok(roster.rows.slice(0,6).every(height=>height<=60),JSON.stringify(roster));
        assert.ok(roster.rows[6]<=85,'long name remains readable without a large card');
        assert.ok(roster.statesInline);assert.ok(roster.badge.includes('✓'));
        await page.locator('.memo-live-table').screenshot({path:path.join(output,`${width}-compact-roster.png`)});
      }

      await page.locator('#memo-archives-list button').click();await page.locator('#memo-archive-players tr').first().waitFor();await check('archive',width);
      assert.equal(await page.locator('#memo-table-head th').count(),3,'TCG live stays three columns');
      assert.equal(await page.locator('#memo-archive-head th').count(),2,'TCG archive has no inferred DMP ID');
      if(width<=720){await page.locator('#menu-more').click();await page.keyboard.press('Escape');assert.equal(await page.locator('#menu-more').getAttribute('aria-expanded'),'false');assert.equal(await page.evaluate(()=>document.activeElement.id),'menu-more');}
      console.log(`${width}px: 14 screens, navigation, prediction, result save, player search and memo autosave passed`);
    }
    await go('participants');failParticipants=true;
    await page.locator('#get-event').click();
    await page.locator('#participant-load-status[data-tone=error]').waitFor();
    assert.equal(await page.locator('#get-event').isEnabled(),true);
    await page.locator('#reset').click();
    assert.equal(await page.locator('#participant-list tr').count(),0);
    failParticipants=false;
    assert.ok(bodies.some(r=>r.path==='/api/deck-history'&&r.body.deckId===2&&r.body.dmpId==='000123'));
    assert.ok(bodies.some(r=>r.path==='/api/deck-memo'&&r.body.deckId===2));
    memoProvider='nojigiku';
    for(const width of [375,390,430]){
      await page.setViewportSize({width,height:900});await go('deck-memo');
      await page.locator('#memo-url').fill('https://nojigikucs.com/?admin=compact');
      await page.locator('#memo-refresh').click();
      await page.locator('#memo-table-head th').filter({hasText:'DMP ID'}).waitFor();
      await check('memo-four-columns',width);
      assert.equal(await page.locator('#memo-list tr').first().locator('td').count(),4);
      await page.locator('.memo-live-table').screenshot({path:path.join(output,`${width}-compact-four-columns.png`)});
    }
    assert.deepEqual(errors,[]);
    console.log('No page errors; API payloads preserved. Screenshots: '+output);
  } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
