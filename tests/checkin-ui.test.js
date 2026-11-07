const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright');
test('check-in UI merges, re-fetches, saves unknown predictions, filters totals, protects failures and works on mobile',async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.setDefaultTimeout(10000);page.setDefaultNavigationTimeout(10000);
  page.on('dialog',async d=>{console.error('UI dialog:',d.message());await d.dismiss();});
  const decks=[{id:1,name:'A',formats:['original'],aliases:[]}];
  const prediction={autoDeckName:'A',finalDeckName:'A',source:'auto',autoStatus:'ok',hasManualPrediction:false};
  let failure=false,manual=null;
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url()),p=u.pathname;
   if(p==='/api/participants')return route.fulfill({json:{success:true,count:3,format:'original',recentDecksStatus:'ok',decks,participants:[{id:'1',name:'DMP選手',recentDecks:[],prediction},{id:'2',name:'未チェックイン確定',recentDecks:[],prediction:{...prediction,finalDeckName:'B'}},{id:'3',name:'未確認DMP',recentDecks:[],prediction}]}});
   if(p==='/api/checkin-participants')return route.fulfill(failure?{status:502,json:{error:'offline'}}:{json:{success:true,provider:'sugatool',sourceKey:'test',format:'original',decks,statusParticipants:[{id:'1',checkedIn:true,confirmed:true},{id:'2',checkedIn:false,confirmed:true},{id:null,externalKey:'sugatool:test:5',checkedIn:true,confirmed:false}],participants:[{id:'1',name:'別名',checkedIn:true,confirmed:true,dayOf:true,prediction},{id:null,name:'当日選手',externalKey:'sugatool:test:5',checkedIn:true,confirmed:false,dayOf:true,recentDecks:[],prediction:manual||{...prediction,autoDeckName:null,finalDeckName:null}}]}});
   if(p==='/api/checkin-prediction'){
    const b=route.request().postDataJSON();assert.equal(b.externalKey,'sugatool:test:5');assert.equal(b.dmpId,undefined);
    manual={...prediction,source:'manual',hasManualPrediction:true,manualDeckId:1,manualDeckName:'A'};
    return route.fulfill({json:{success:true,hasManualPrediction:true,manualDeckId:1,manualDeckName:'A'}});
   }
   if(p.startsWith('/api/'))return route.fulfill({json:{success:true,decks,events:[],archives:[]}});
   const file=p==='/'?'index.html':p.slice(1);
   if(/^[\w.-]+$/.test(file)&&fs.existsSync(file))return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'image/png',body:fs.readFileSync(file)});
   return route.fulfill({status:404,body:''});
  });
  await page.goto('https://checkin.test/');
  await page.locator('#event-url').fill('https://www.dmp-ranking.com/event.asp?ShopID=s&EventID=e&Seq=1');
  await page.locator('#get-event').click();await page.waitForFunction(()=>document.querySelector('#participant-load-status').textContent==='参加者を取得しました。');
  await page.locator('#checkin-url').fill('https://sugatool.nojigikucs.com/events/73039efc-e0b5-46ee-9169-2bd4892faeef/entries');
  await page.locator('#get-checkins').click();await page.waitForFunction(()=>document.querySelector('#checkin-load-status').textContent.includes('今回追加：1'));
  assert.equal(await page.locator('#participant-list tr').count(),4);assert.match(await page.locator('#participant-list').textContent(),/当日枠・参加未確定/);
  assert.match(await page.locator('#checkin-counts').textContent(),/母数予想対象：4人/);
  await page.locator('#checkin-confirmed-only').check();assert.match(await page.locator('#checkin-counts').textContent(),/母数予想対象：2人/);
  assert.equal(await page.locator('#participant-list tr').count(),2);
  assert.doesNotMatch(await page.locator('#participant-list').textContent(),/未確認DMP|当日選手/);
  assert.match(await page.locator('#prediction-summary-list').textContent(),/50.0%/);
  await page.locator('#prediction-view-pie').click();
  assert.match(await page.locator('#prediction-summary-pie').textContent(),/2人.*100.0%/);
  await page.locator('#checkin-confirmed-only').uncheck();
  assert.equal(await page.locator('#participant-list tr').count(),4);
  const row=page.locator('#participant-list tr').nth(3);
  await row.locator('.compact-toggle').click();
  await row.locator('select').selectOption('1');await row.getByRole('button',{name:'手動で保存'}).click();await page.waitForFunction(()=>document.querySelectorAll('#participant-list tr')[3].textContent.includes('保存しました'));
  await page.locator('#get-checkins').click();await page.waitForFunction(()=>document.querySelector('#checkin-load-status').textContent.includes('今回追加：0'));
  assert.equal(await page.locator('#participant-list tr').count(),4);assert.match(await row.textContent(),/A（手動）/);
  await page.locator('#checkin-confirmed-only').check();
  await page.locator('#checkin-confirmed-only').uncheck();
  assert.match(await row.textContent(),/A（手動）/);
  failure=true;await page.locator('#get-checkins').click();await page.waitForFunction(()=>document.querySelector('#checkin-load-status').textContent.includes('offline'));assert.equal(await page.locator('#participant-list tr').count(),4);
  for(const width of [320,390,430]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
  await page.locator('#reset').click();assert.match(await page.locator('#checkin-counts').textContent(),/母数予想対象：0人/);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
