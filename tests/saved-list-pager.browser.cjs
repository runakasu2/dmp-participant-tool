const {chromium}=require('playwright'),express=require('express'),assert=require('node:assert/strict'),path=require('node:path');
(async()=>{
 const app=express();app.use(express.static(path.resolve(__dirname,'..')));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));let browser;
 try{browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});const page=await browser.newPage();
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.goto(`http://127.0.0.1:${server.address().port}/`);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const archives=Array.from({length:21},(_,j)=>({id:j+1,event_name:'保存した長い大会名 '+(j+1),event_date:'2026-10-01',updated_at:new Date(2026,0,j+1).toISOString(),provider:'nojigiku',round_count:4,match_count:108,registered_count:20,participant_count:54}));
 await page.route('**/api/matching-archives',r=>r.fulfill({json:{success:true,archives}}));
 await page.route('**/api/deck-memo/archives',r=>r.fulfill({json:{success:true,events:archives}}));
 await page.locator('#menu-deck-memo').click();
 await page.waitForFunction(()=>document.querySelectorAll('#matching-archive-list .saved-list-page').length===3&&document.querySelectorAll('#memo-archives-list .saved-list-page').length===3,null,{timeout:10000}).catch(async e=>{console.error(errors,await page.locator('#memo-archives-status').textContent(),await page.locator('#matching-status').textContent());throw e;});
 for(const width of [375,390,430,768,1440]){await page.setViewportSize({width,height:900});await page.locator('#matching-archive-list .saved-list-controls button').last().click();assert.equal(await page.locator('#memo-archives-list .saved-list-controls span').textContent(),'1 / 3ページ');await page.locator('#matching-archive-list .saved-list-controls button').first().click();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`/tmp/saved-lists-integrated-${width}.png`,fullPage:true});}
 console.log('PASS actual memo page: both 21-record lists render independently across five widths');
 for(const width of [375,390,430,768,1440]){
 await page.setViewportSize({width,height:900});
 await page.evaluate(()=>{
 document.body.replaceChildren();const a=document.createElement('div'),b=document.createElement('div');a.id='a';b.id='b';document.body.append(a,b);
 window.pagers=[new SavedListPager(a,'対戦表'),new SavedListPager(b,'メモ')];window.opened=[];
 window.populate=n=>pagers.forEach((p,i)=>p.update(Array.from({length:n},(_,j)=>({id:j+1,updated_at:new Date(2026,0,j+1).toISOString()})),item=>{const row=document.createElement('div');row.className='saved-memo-row';const button=document.createElement('button');button.textContent='大会 '+item.id+' 長い大会名称の表示確認';button.addEventListener('click',()=>opened.push(item.id));row.append(button);return row;},'保存済みデータはありません。'));
 });
 for(const n of [0,10,11,20,21]){await page.evaluate(n=>populate(n),n);assert.equal(await page.locator('#a .saved-list-page').count(),Math.ceil(n/10));if(n){assert.equal(await page.locator('#a .saved-list-page').first().locator('button').count(),Math.min(n,10));assert.equal(await page.locator('#a .saved-list-page button').first().textContent(),'大会 '+n+' 長い大会名称の表示確認');}else assert.equal(await page.locator('#a .saved-list-controls').isVisible(),false);}
 await page.locator('#a .saved-list-controls button').last().click();assert.equal(await page.locator('#a .saved-list-controls span').textContent(),'2 / 3ページ');assert.equal(await page.locator('#b .saved-list-controls span').textContent(),'1 / 3ページ');
 await page.locator('#a .saved-list-page').nth(1).locator('button').first().click();assert.deepEqual(await page.evaluate(()=>opened),[11]);
 await page.locator('#a .saved-list-track').evaluate(n=>n.scrollTo({left:2*n.clientWidth}));await page.waitForFunction(()=>pagers[0].page===2);assert.equal(await page.locator('#a .saved-list-controls button').last().isDisabled(),true);
 await page.evaluate(()=>populate(11));assert.equal(await page.locator('#a .saved-list-controls span').textContent(),'2 / 2ページ');await page.locator('#a .saved-list-controls button').first().click();assert.equal(await page.locator('#a .saved-list-controls button').first().isDisabled(),true);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`/tmp/saved-list-${width}.png`,fullPage:true});console.log('PASS '+width+'px: boundaries, newest first, buttons, horizontal scroll, independent pages, open, deletion clamp and layout');
 }
 assert.deepEqual(errors,[]);
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
