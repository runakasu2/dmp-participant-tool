const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright');
test('event filters, button parity, mobile layout, empty states and existing period controls',async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const events=[{id:1,event_name:'大会A',event_date:'2026-10-01',format:'original',result_count:3,best_four:[{rank:1,dmpId:'1',deckId:1,deckName:'ゴルギーオージャー'},{rank:4,dmpId:'2',deckId:1,deckName:'ゴルギーオージャー'},{rank:4,dmpId:'3',deckName:null}]},
   {id:2,event_name:'大会B',event_date:'2026-10-02',format:'original',result_count:1,best_four:[{rank:2,dmpId:'1',deckId:2,deckName:'4Cペテンバーン'}]},
   {id:3,event_name:'未取得',event_date:'2026-10-03',format:'original',result_count:0,best_four:[]}];
  let periodQuery;
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname==='/api/events')return route.fulfill({json:{events:events.filter(e=>e.format===url.searchParams.get('format')&&(!url.searchParams.get('startDate')||e.event_date>=url.searchParams.get('startDate'))&&(!url.searchParams.get('endDate')||e.event_date<=url.searchParams.get('endDate')))}});
   if(url.pathname==='/api/deck-period-summary'){periodQuery=url.searchParams;return route.fulfill({json:{success:true,format:'original',totalEvents:1,includedEvents:1,missingEvents:0,totalParticipants:10,registeredDecks:2,unregistered:8,registrationPercentage:20,decks:[{deckName:'A',count:2,percentage:20}]}});}
   if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:fs.readFileSync('index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'')});
   if(url.pathname==='/style.css')return route.fulfill({contentType:'text/css',body:fs.readFileSync('style.css','utf8')});
   return route.fulfill({status:404,body:''});
  });
  await page.goto('http://best-four.test/');
  await page.evaluate(()=>{
   window.createDeckTrendControls=()=>({clear(){},load(){}});
   window.createEventResetControls=()=>({busy:false,beginLoad(){},endLoad(){},rowClick(){},cell(){return document.createElement('span');}});
   window.attachCardArt=()=>{};window.openEventDetail=()=>{};window.menuEvents=document.getElementById('menu-events');
   document.getElementById('page-events').style.display='block';
  });
  for(const file of ['deck-select.js','event-filters.js','deck-period-ui.js','best-four-ui.js','event-cards.js'])await page.addScriptTag({content:fs.readFileSync(file,'utf8')});
  const source=fs.readFileSync('script.js','utf8');await page.addScriptTag({content:source.slice(source.indexOf('const reloadEventsButton ='),source.indexOf('// 大会詳細・デッキ母数'))});
  await page.evaluate(()=>loadEvents());await page.locator('.event-analysis-tools summary').click();
  const original=await page.locator('#show-deck-period').boundingBox(),added=await page.locator('#show-best-four').boundingBox();assert.equal(original.height,added.height);
  await page.locator('#show-best-four').click();await page.waitForFunction(()=>document.querySelector('#best-four-status').textContent.includes('未登録：1件'));
  assert.equal(await page.locator('#best-four-rows tr').count(),3);assert.match(await page.locator('#best-four-rows').textContent(),/66.7%/);
  for(const width of [320,390,430]){
   await page.setViewportSize({width,height:844});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   const box=await page.locator('#best-four-summary table').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width);
  }
  await page.locator('#events-name-search').fill('大会A');await page.waitForFunction(()=>document.querySelector('#best-four-status').textContent.includes('対象大会：1'));
  assert.match(await page.locator('#best-four-rows').textContent(),/100.0%/);
  await page.locator('#show-deck-period').click();await page.waitForFunction(()=>document.querySelector('#deck-period-status').textContent.includes('合計参加人数'));
  assert.equal(periodQuery.get('eventIds'),'1');
  await page.locator('#events-name-search').fill('なし');await page.waitForFunction(()=>document.querySelector('#best-four-status').textContent.includes('条件に一致する大会がありません'));
  await page.locator('#events-name-search').fill('未取得');await page.waitForFunction(()=>document.querySelector('#best-four-status').textContent.includes('結果取得済みの大会がありません'));
  await page.locator('#events-name-search').fill('');await page.locator('#events-end-date').fill('2026-10-01');
  await page.waitForFunction(()=>document.querySelector('#best-four-status').textContent.includes('対象大会：1')&&document.querySelector('#best-four-status').textContent.includes('2026-10-01'));
  await page.locator('[data-format="advance"]').click();await page.waitForFunction(()=>document.querySelector('#best-four-status').textContent.includes('条件に一致する大会がありません'));
  await page.locator('#close-best-four').click();assert.ok(await page.locator('#best-four-summary').isHidden());
 }finally{await browser.close();}
});
