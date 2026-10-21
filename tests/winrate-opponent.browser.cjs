// Read-only analysis on a local, isolated PostgreSQL fixture.
const {chromium}=require('playwright'),express=require('express'),assert=require('node:assert/strict'),path=require('node:path');
const {fixture}=require('./matching-archives-postgres.integration'),{seed,request}=require('./winrate-postgres.integration');
(async()=>{const f=await fixture();let browser,server;
 try{
 await seed(f);await f.db.exec(`UPDATE deck_memos SET deck_id=3 WHERE memo_event_id=3 AND dmp_id='000123'; INSERT INTO decks(name) VALUES('D'); INSERT INTO deck_aliases(deck_id,alias) VALUES(2,'相手別名');
 INSERT INTO matching_archive_matches(archive_id,round,match_key,table_no,sides,outcome,winner_key) SELECT archive_id,3,'extra',1,sides,outcome,winner_key FROM matching_archive_matches WHERE archive_id=1 AND round=1;`);
 const tables=['events','players','deck_memos','deck_history','matching_archives','matching_archive_matches'];const snapshot=()=>Promise.all(tables.map(t=>f.db.query('SELECT * FROM '+t+' ORDER BY 1').then(r=>r.rows)));const before=await snapshot();
 const summary=await request(f,'/api/winrate/summary',{searchMode:'opponent',deckBId:'2'});assert.equal(summary.code,200);assert.deepEqual(summary.body.decks.map(d=>[d.name,d.physicalMatches,d.wins,d.losses,d.rate]),[['A',5,3,2,60],['C',2,1,1,50]]);
 const combined=await request(f,'/api/winrate/summary',{searchMode:'opponent',deckBId:'2',mode:'single',eventRecordId:'2',format:'advance',startDate:'2026-10-02',endDate:'2026-10-02'});assert.equal(combined.body.search.stats.matches,2);
 const partial=await request(f,'/api/winrate/summary',{searchMode:'matchup',deckBId:'2'});assert.equal(partial.body.search.mode,'opponent');assert.deepEqual(partial.body.decks,summary.body.decks);
 const detail=await request(f,'/api/winrate/matchup',{searchMode:'opponent',deckBId:'2',deckId:'1',opponentDeckId:'2'});assert.equal(detail.body.opponent.name,'B');assert.equal(detail.body.pair.matches,5);
 const app=express();app.use(express.json());for(const [key,h]of f.routes){const [method,...parts]=key.split(' ');app[method.toLowerCase()](parts.join(' '),h);}app.use(express.static(path.resolve(__dirname,'..')));server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});
 browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());await page.goto('http://127.0.0.1:'+server.address().port);
 const ready=()=>page.waitForFunction(()=>!document.querySelector('#wr-results').hidden);const stats=n=>page.waitForFunction(n=>!document.querySelector('#wr-results').hidden&&document.querySelector('#wr-search-stats').textContent.startsWith(n+'試合'),n);
 for(const width of [375,390,430,768,1440]){
 await page.setViewportSize({width,height:900});if(width<=720)await page.locator('#menu-more').click();await page.locator('#menu-winrate').click();await ready();
 await page.locator('#wr-search-mode').selectOption('opponent');await page.locator('#wr-deck-b-query').fill('相手別名');assert.equal(await page.locator('#wr-deck-b option').count(),2);await page.locator('#wr-deck-b').selectOption('2');await stats(7);assert.equal(await page.locator('#wr-deck-a-field').isVisible(),false);
 assert.equal(await page.locator('#wr-search-sort-field').isVisible(),true);assert.equal(await page.locator('#wr-search-sort option').count(),4);assert.equal(await page.locator('#wr-search-breakdown-title').textContent(),'使用デッキ別勝率');assert.ok(!(await page.locator('#page-winrate').textContent()).includes('自分'));
 const names=()=>page.locator('#wr-decks th').allTextContents();assert.deepEqual(await names(),['A','C']);assert.deepEqual(await page.locator('#wr-decks tr').first().locator('td').allTextContents(),['5','3','2','60.0%']);assert.equal(await page.locator('#wr-matrix-body button').count(),2);assert.equal(await page.locator('#wr-matrix-head th').last().textContent(),'B');
 for(const [sort,expected]of [['rate-asc',['C','A']],['rate',['A','C']],['wins',['A','C']],['matches',['A','C']]]){await page.locator('#wr-search-sort').selectOption(sort);assert.equal(await page.locator('#wr-sort').inputValue(),sort);assert.deepEqual(await names(),expected);assert.deepEqual(await page.locator('#wr-search-opponents tr td:first-child').allTextContents(),expected);}
 await page.locator('#wr-search-opponents button').first().click();await page.waitForFunction(()=>document.querySelector('#wr-detail-status').textContent.startsWith('5試合'));assert.equal(await page.locator('#wr-detail-title').textContent(),'A 対 B');await page.locator('#wr-detail-close').click();
 await page.locator('#wr-search-sort').selectOption('rate-asc');
 await page.locator('#wr-search-mode').selectOption('matchup');await stats(7);assert.equal(await page.locator('#wr-deck-a').inputValue(),'');assert.deepEqual(await names(),['C','A']);assert.equal(await page.locator('#wr-search-sort').inputValue(),'rate-asc');
 await page.locator('#wr-search-sort').selectOption('matches');
 await page.locator('#wr-search-details').click();await page.waitForFunction(()=>document.querySelector('#wr-detail-status').textContent.startsWith('7試合'));await page.locator('#wr-detail-close').click();
 await page.screenshot({path:`/tmp/winrate-opponent-${width}.png`,fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.locator('#wr-deck-b-query').fill('');await page.locator('#wr-deck-b').selectOption('4');await page.waitForFunction(()=>document.querySelector('#wr-status').textContent==='該当する対戦データがありません。');assert.equal(await page.locator('#wr-search-details').isEnabled(),false);
 await page.locator('#wr-search-clear').click();await ready();assert.equal(await page.locator('#wr-search-results').isVisible(),false);await page.locator('#menu-deck-memo').click();console.log('PASS '+width+'px: opponent-only alias, own-side rates, four sorts, matrix/detail directions, zero, clear and layout');
 }
 // Controlled read-only response checks ties independently of fixture match totals.
 await page.route('**/api/winrate/summary?**',async route=>{
   const response=await route.fetch(),result=await response.json();
   if(result.search?.mode==='opponent'){
     result.decks=[{deckId:101,name:'Z',physicalMatches:8,matches:8,wins:4,losses:4,rate:50},{deckId:102,name:'A',physicalMatches:8,matches:8,wins:4,losses:4,rate:50},{deckId:103,name:'More',physicalMatches:10,matches:10,wins:5,losses:5,rate:50},{deckId:104,name:'Low',physicalMatches:3,matches:3,wins:0,losses:3,rate:0}];
     result.search.opponents=result.decks.map(d=>({...d,matches:d.physicalMatches,opponentDeckId:2}));
   }
   await route.fulfill({json:result});
 });
 await page.locator('#menu-winrate').click();await ready();await page.locator('#wr-search-mode').selectOption('opponent');await page.locator('#wr-deck-b-query').fill('');await page.locator('#wr-deck-b').selectOption('2');await page.waitForFunction(()=>document.querySelector('#wr-search-opponents').textContent.includes('More'));
 const tieNames=()=>page.locator('#wr-search-opponents tr td:first-child').allTextContents();
 const statsBefore=await page.locator('#wr-search-stats').textContent();
 for(const [sort,expected]of [['matches',['More','A','Z','Low']],['rate',['More','A','Z','Low']],['rate-asc',['Low','More','A','Z']],['wins',['More','A','Z','Low']]]){await page.locator('#wr-search-sort').selectOption(sort);assert.deepEqual(await tieNames(),expected);assert.equal(await page.locator('#wr-search-stats').textContent(),statsBefore);}
 await page.locator('#wr-format').selectOption('advance');await page.waitForFunction(()=>!document.querySelector('#wr-results').hidden);assert.equal(await page.locator('#wr-search-sort').inputValue(),'wins');assert.deepEqual(await tieNames(),['More','A','Z','Low']);
 console.log('PASS rate ties use match count then deck name; sorting preserves statistics and selection survives format change');
 assert.deepEqual(errors,[]);assert.deepEqual(await snapshot(),before);console.log('PASS combined SQL scope and unchanged saved records');
 }finally{await browser?.close();if(server)await new Promise(r=>server.close(r));await f.db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
