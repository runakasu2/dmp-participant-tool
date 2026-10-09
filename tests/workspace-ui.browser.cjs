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
const players=[{id:'000123',name:'　テストプレイヤー／長いハンドルネーム',rank:1},{id:'000456',name:'プレイヤーB',rank:2}];
const event={id:1,shop_id:'shop123',event_id:'event456',seq:'1',event_name:'第123回 デュエル・マスターズCS【オリジナル】',event_date:'2026-10-07',participant_count:64,result_count:2,best_four:players.map(p=>({rank:p.rank,dmpId:p.id,handleName:p.name,deckName:decks[0].name}))};
const memoPlayers=['「ッジ」','るなかす','りょけん','光月おでんじん','ペリュ','希亜','長いハンドルネームの折り返し確認'].map((name,i)=>({name,participantKey:'id:'+i,internalParticipantId:String(i),table:Math.floor(i/2)+1,deckId:1,deckName:decks[0].name}));
const bodies=[];
let failParticipants=false;
let memoProvider='tcg_meister';
let catalogSearchFixture=false,eventRequests=0;
const catalogEvents=[['ドラスタ十月CS','2026-10-01'],['ドラスタ三ノ宮CS','2026-09-21'],['九月の別大会','2026-09-14'],['ドラスタ八月CS','2026-08-31']].map(([event_name,event_date],i)=>({...event,id:i+1,event_name,event_date}));
function responseFor(url,request){
  const body=request.postDataJSON(); if(body)bodies.push({path:url.pathname,body});
  if(url.pathname==='/api/participants')return {count:2,format:'original',decks,participants:players.map(p=>({...p,recentDecks:[1,2,3].map(i=>({deckName:decks[0].name,eventDate:'2026-09-'+(30-i),eventName:'過去の大会'})),prediction:{finalDeckName:decks[0].name,autoDeckName:decks[0].name,source:'auto',autoStatus:'ok',hasManualPrediction:false}}))};
  if(url.pathname==='/api/event-deck-prediction')return {hasManualPrediction:body.mode!=='auto',manualDeckId:body.mode==='auto'?null:2,manualDeckName:body.mode==='auto'?null:decks[1].name};
  if(url.pathname==='/api/event-results-view')return {error:'No stored result fixture'};
  if(url.pathname==='/api/event-result-from-detail')return {year:2026,shopId:'shop123',eventId:'event456',held:'1',eventName:event.event_name,eventDate:'2026-10-07',count:2,format:'original',participants:players};
  if(url.pathname==='/api/deck-history')return request.method()==='GET'?{decks:[{dmp_id:'000123',deck_name:decks[0].name}]}:{normalizedDeckName:decks[1].name};
  if(url.pathname==='/api/decks')return {decks};
  if(url.pathname==='/api/events'){
    eventRequests++;
    const events=(catalogSearchFixture?catalogEvents:[event]).filter(e=>(!url.searchParams.get('startDate')||e.event_date>=url.searchParams.get('startDate'))&&(!url.searchParams.get('endDate')||e.event_date<=url.searchParams.get('endDate')));
    return {count:events.length,events};
  }
  if(url.pathname==='/api/event-results')return {count:2,participants:players.map(p=>({...p,deckName:decks[0].name}))};
  if(url.pathname==='/api/event-deck-summary')return {participantCount:64,registeredCount:2,unregisteredCount:62,registeredDeckCount:2,decks:[{deckName:decks[0].name,count:2,percentage:'3.1',players:players.map(p=>({dmpId:p.id,handleName:p.name}))}],unregisteredPlayers:[]};
  if(url.pathname==='/api/player-search')return {count:1,players:[{dmp_id:'000123',handle_name:players[0].name}]};
  if(url.pathname==='/api/player-detail')return {player:{dmpId:'000123',handleName:players[0].name},deckSummary:[{deckName:decks[0].name,count:3}],historyCount:1,history:[{eventDate:'2026-10-01',eventName:event.event_name,deckName:decks[0].name}]};
  if(url.pathname==='/api/deck-memo/matching')return {provider:memoProvider,sourceUrl:body.url,adminKey:'5856470',latestRound:1,event:{eventName:event.event_name,eventDate:'2026-10-07'},participants:memoPlayers.map((p,i)=>({...p,...(memoProvider==='tcg_meister'?{}:{dmpId:String(i+123).padStart(6,'0')})}))};
  if(url.pathname==='/api/deck-memo')return {deckId:2,deckName:decks[1].name};
  if(url.pathname==='/api/matching-archives')return {archives:[]};
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
      if(key==='players')assert.equal(await page.locator('#menu-players').innerText(),'プレイヤー検索');
      await page.locator('#menu-'+key).click();
      await page.locator('#page-'+key).waitFor({state:'visible'});
      if(key==='players')assert.equal((await page.locator('#page-players h2').innerText()).trim(),'プレイヤー検索');
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
    async function checkPie(selector,width){
      const plot=page.locator(selector);
      const layout=await plot.evaluate(node=>{
        const svg=node.querySelector('svg'),legend=node.querySelector('ul');
        const left=svg.getBoundingClientRect(),right=legend.getBoundingClientRect();
        return {left:left.x,right:right.x,plotRight:left.right,plotWidth:left.width,plotHeight:left.height,legendWidth:right.width,legendScroll:legend.scrollWidth,legendRight:right.right,topDiff:Math.abs(left.top-right.top),viewBox:svg.getAttribute('viewBox')};
      });
      if(width<=720){assert.ok(layout.plotRight<=layout.right);assert.ok(layout.legendRight<=width);assert.ok(layout.topDiff<2);assert.equal(layout.viewBox,'0 0 240 240');assert.ok(Math.abs(layout.plotWidth/layout.legendWidth-1.5)<.02);assert.ok(Math.abs(layout.plotWidth-layout.plotHeight)<1);assert.ok(layout.legendScroll<=layout.legendWidth+1);assert.ok(layout.plotWidth>=165);console.log('pie widths',width,selector,Math.round(layout.plotWidth),Math.round(layout.legendWidth));}
      else assert.equal(layout.viewBox,'-140 -20 520 280');
      await plot.screenshot({path:path.join(output,`${width}-${selector.slice(1)}-horizontal.png`)});
    }
    for(const width of [375,390,430,768,1440]){
      await page.setViewportSize({width,height:900});
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await check('empty',width);
      assert.equal(await page.locator('#event-info').isVisible(),width>720);
      assert.equal(await page.locator('#shop-id').count(),1);
      await page.locator('#event-url').fill('https://www.dmp-ranking.com/event.asp?ShopID=shop123&EventID=event456&Seq=1');
      await page.locator('#get-event').click();
      await page.locator('#participant-list tr').first().waitFor();
      assert.equal(await page.locator('#participant-list tr').count(),2);
      const collapsed=await page.locator('#participant-list tr').first().boundingBox();
      assert.ok(collapsed.height<=64,JSON.stringify(collapsed));
      await page.locator('#participant-list .compact-toggle').first().click();
      assert.equal(await page.locator('#participant-list .compact-toggle').first().getAttribute('aria-expanded'),'true');
      await page.locator('#participant-list select').first().selectOption('2');
      await page.locator('#participant-list button').filter({hasText:'手動で保存'}).first().click();
      await page.locator('#participant-list [role="status"]').first().filter({hasText:'保存しました'}).waitFor();
      console.log('participant row heights',width,await page.locator('#participant-list tr').evaluateAll(rows=>rows.map(row=>Math.round(row.getBoundingClientRect().height))));
      await check('participants',width);
      if(width<=720){
        const density=await page.locator('#participant-list tr').first().evaluate(row=>{
          const select=row.querySelector('select').getBoundingClientRect(),buttons=[...row.querySelectorAll('.prediction-cell button')].map(b=>b.getBoundingClientRect());
          return {height:row.getBoundingClientRect().height,selectHeight:select.height,buttons:buttons.map(b=>b.height),sameLine:Math.abs(buttons[0].top-select.top)<2};
        });
        assert.ok(density.height<450,JSON.stringify(density));assert.ok(density.sameLine);
        assert.ok(density.selectHeight>=44 && density.buttons.every(h=>h>=44));
        await page.locator('#participant-list tr').first().screenshot({path:path.join(output,`${width}-compact-participant.png`)});
      }

      await page.locator('#prediction-view-pie').click();await check('prediction-pie',width);await checkPie('#prediction-summary-pie',width);await page.locator('#prediction-view-list').click();
      await page.locator('#participant-list button').filter({hasText:'自動予想に戻す'}).first().click();
      await page.locator('#participant-list [role="status"]').first().filter({hasText:'自動予想に戻しました'}).waitFor();
      await page.locator('#participant-list .compact-toggle').first().click();
      assert.equal(await page.locator('#participant-list .compact-toggle').first().getAttribute('aria-expanded'),'false');
      await check('participants-collapsed',width);
      await page.locator('#participant-list .player-detail-link').first().click();
      await page.locator('#page-player-detail').waitFor({state:'visible'});
      await check('player-detail',width);
      await go('results');
      await page.locator('#result-url').fill('https://www.dmp-ranking.com/event.asp?ShopID=shop123&EventID=event456&Seq=1');
      await page.locator('#get-result').click();
      await page.locator('#result-list select').first().waitFor();
      await page.locator('#result-list select').first().selectOption('2');
      await page.locator('#result-list .compact-action button').first().click();
      await page.locator('#result-list .compact-action button').first().filter({hasText:'保存済み'}).waitFor();
      assert.equal(await page.locator('#result-list tr').count(),2);
      assert.ok((await page.locator('#result-list .compact-name-text').first().boundingBox()).width>20);
      assert.equal(await page.locator('#result-list .compact-name-text').first().textContent(),players[0].name);
      assert.equal((await page.locator('#result-list tr').first().locator('td').first().textContent()).trim(),'1');
      assert.ok((await page.locator('#result-list tr').first().boundingBox()).height<=64);
      await page.locator('#result-list .compact-toggle').first().click();
      await check('results-expanded',width);
      await page.locator('#result-list .compact-toggle').first().click();
      await check('results',width);
      await go('events');await page.locator('.event-card').waitFor();await check('events',width);
      await page.locator('.event-analysis-tools summary').click();
      await page.locator('#show-deck-period').click();await page.locator('#deck-period-rows tr').first().waitFor();await check('period',width);await page.locator('#period-pie').click();await checkPie('#deck-period-pie',width);await page.locator('#period-list').click();
      await page.locator('#show-deck-trends').click();await page.locator('#deck-trend-chart svg').waitFor();await check('trends',width);
      await page.locator('.event-card').click();await page.locator('#event-results-list tr').first().waitFor();await check('event-detail',width);await page.locator('#deck-view-pie').click();await checkPie('#deck-summary-pie',width);await page.locator('#deck-view-list').click();
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
    catalogSearchFixture=true;
    for(const width of [375,390,430,768,1440]){
      await page.setViewportSize({width,height:900});await go('events');
      const names=()=>page.locator('.event-card-name').allTextContents();
      const expectNames=async expected=>{await page.waitForFunction(expected=>JSON.stringify([...document.querySelectorAll('.event-card-name')].map(e=>e.textContent))===JSON.stringify(expected),expected);assert.deepEqual(await names(),expected);};
      const allNames=catalogEvents.map(e=>e.event_name);
      await expectNames(allNames);
      assert.equal(await page.locator('#reload-events').isVisible(),false);
      let calls=eventRequests;
      await page.locator('#events-name-search').fill('ドラスタ');await expectNames([allNames[0],allNames[1],allNames[3]]);
      await page.locator('#enter-event-delete').click();await page.locator('#select-all-events').click();
      assert.match(await page.locator('#event-selection-count').textContent(),/3件/);
      await page.locator('#events-name-search').fill('九月');await expectNames([allNames[2]]);
      assert.match(await page.locator('#event-selection-count').textContent(),/0件/);
      await page.locator('#events-name-search').fill('該当なし');await expectNames([]);
      await page.locator('#events-name-search').fill('');await expectNames(allNames);
      assert.equal(eventRequests,calls,'typing must not fetch');
      const apply=async(start,end,expected)=>{
        await page.locator('#events-start-date').fill(start);await page.locator('#events-end-date').fill(end);
        await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/api/events'),page.locator('#event-filter-form button[type=submit]').click()]);
        await expectNames(expected);
      };
      await apply('2026-09-01','',allNames.slice(0,3));
      await apply('','2026-09-30',allNames.slice(1));
      await apply('2026-09-01','2026-09-30',allNames.slice(1,3));
      calls=eventRequests;
      await page.locator('#events-name-search').fill('ドラスタ');await expectNames([allNames[1]]);assert.equal(eventRequests,calls);
      await check('event-search',width);
      if(width<=720){
        const layout=await page.locator('#event-filter-form').evaluate(form=>{const start=form.querySelector('#events-start-date').getBoundingClientRect(),end=form.querySelector('#events-end-date').getBoundingClientRect();return {height:form.getBoundingClientRect().height,startWidth:start.width,endWidth:end.width,sameRow:Math.abs(start.top-end.top)<1};});
        assert.ok(layout.height<260,JSON.stringify(layout));assert.ok(layout.sameRow&&layout.startWidth>120&&layout.endWidth>120);
        console.log('filter layout',width,layout);
      }
      await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/api/events'),page.locator('#event-period-reset').click()]);
      await expectNames(allNames);
      for(const id of ['events-name-search','events-start-date','events-end-date'])assert.equal(await page.locator('#'+id).inputValue(),'');
    }
    // Long legends and artwork exercise the shared component rather than a page-specific copy.
    await page.route('https://ui-fixture.invalid/**',route=>route.fulfill({contentType:'image/png',body:fs.readFileSync(path.join(root,'favicon.png'))}));
    await page.setViewportSize({width:375,height:900});await go('participants');
    await page.locator('#prediction-view-pie').click();
    await page.evaluate(()=>{
      const items=Array.from({length:8},(_,i)=>({deckName:i===0?'クローシスモウジャキングダム':'デッキ'+(i+1),count:2,percentage:'10.0',image_url:'https://ui-fixture.invalid/card.png'}));
      items.push({deckName:'予想不明',count:4,percentage:'20.0',unknown:true});
      renderDeckPieChart(document.getElementById('prediction-summary-pie'),items,{total:20});
    });
    await checkPie('#prediction-summary-pie',375);
    await page.setViewportSize({width:430,height:900});await checkPie('#prediction-summary-pie',430);
    const beforeResize=await page.locator('#prediction-summary-pie ul').textContent();
    await page.setViewportSize({width:1440,height:900});
    await page.waitForFunction(()=>document.querySelector('#prediction-summary-pie > svg').getAttribute('viewBox')==='-140 -20 520 280');
    await page.setViewportSize({width:390,height:900});
    await page.waitForFunction(()=>document.querySelector('#prediction-summary-pie > svg').getAttribute('viewBox')==='0 0 240 240');
    await checkPie('#prediction-summary-pie',390);
    assert.equal(await page.locator('#prediction-summary-pie ul').textContent(),beforeResize);
    assert.deepEqual(errors,[]);
    console.log('No page errors; API payloads preserved. Screenshots: '+output);
  } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
