const {test}=require('node:test');
const assert=require('node:assert/strict');
const {buildBestFourSummary}=require('../best-four-ui');
const {PGlite}=require('@electric-sql/pglite');
const {filteredEventCatalog}=require('../event-catalog');
test('best four uses recorded ranks, ties, per-event counts and known decks as denominator',()=>{
 const players=[{rank:1,dmpId:'1',deckId:1,deckName:'A'},{rank:2,dmpId:'2',deckId:2,deckName:'B'},
 {rank:3,dmpId:'3',deckId:1,deckName:'A'},{rank:4,dmpId:'4',deckName:null},
 {rank:4,dmpId:'5',deckName:'   '},{rank:5,dmpId:'6',deckName:'C'},{rank:null,dmpId:'7',deckName:'C'},
 {rank:0,dmpId:'8',deckName:'C'},{rank:'ベスト4',dmpId:'9',deckName:'C'}];
 const data=buildBestFourSummary([{result_count:9,best_four:players},{result_count:1,best_four:[players[0]]},{result_count:0}],{format:'original'});
 assert.equal(data.totalPlacements,6);assert.equal(data.knownPlacements,4);assert.equal(data.unknownPlacements,2);
 assert.equal(data.totalEvents,3);assert.equal(data.missingEvents,1);assert.deepEqual(data.decks.map(d=>[d.deckName,d.count,d.percentage]),[['A',3,75],['B',1,25]]);
 assert.equal(data.decks.reduce((sum,d)=>sum+d.percentage,0),100);
 assert.equal(buildBestFourSummary([]).totalPlacements,0);
 assert.equal(buildBestFourSummary([{result_count:1,best_four:[{rank:1,deckName:null}]}]).knownPlacements,0);
 const ties=buildBestFourSummary([{result_count:2,best_four:[{rank:4,deckName:'B'},{rank:4,deckName:'A'}]}]);assert.deepEqual(ties.decks.map(d=>d.deckName),['A','B']);
});
test('catalogue PostgreSQL normalizes aliases, uses latest full-key history and saved ranks, without new aggregate queries',async()=>{
 const db=new PGlite();
 try{
 await db.exec(`CREATE TABLE events(id INT,shop_id TEXT,event_id TEXT,seq TEXT,event_name TEXT,event_date DATE,format TEXT);
 CREATE TABLE players(id INT,dmp_id TEXT,handle_name TEXT);
 CREATE TABLE event_results(event_record_id INT,player_id INT,rank INT);
 CREATE TABLE decks(id INT,name TEXT,image_url TEXT);
 CREATE TABLE deck_aliases(deck_id INT,alias TEXT);
 CREATE TABLE deck_history(id INT,player_id INT,shop_id TEXT,event_id TEXT,seq TEXT,deck_name TEXT,created_at TIMESTAMP);
 INSERT INTO events VALUES(1,'s','e','1','大会A','2026-10-01','original'),(2,'s','e','2','大会B','2026-10-02','original'),(3,'s','e','3','別形式','2026-10-01','advance'),(4,'s','missing','1','未取得','2026-10-03','original');
 INSERT INTO players VALUES(1,'101','P'),(2,'102','Q'),(3,'103','R'),(4,'104','S');
 INSERT INTO decks VALUES(1,'A',NULL),(2,'B',NULL);INSERT INTO deck_aliases VALUES(1,'Alias A');
 INSERT INTO event_results VALUES(1,1,1),(1,2,4),(1,3,4),(1,4,5),(2,1,2),(3,1,1);
 INSERT INTO deck_history VALUES(1,1,'s','e','1','B','2026-09-01'),(2,1,'s','e','1','Alias A','2026-10-01'),(3,2,'s','e','1','A','2026-10-01'),(4,4,'s','e','1','B','2026-10-01'),(5,1,'s','e','2','B','2026-10-02'),(6,1,'other','e','1','B','2026-10-03');`);
 const q=filteredEventCatalog({format:'original',startDate:'2026-10-01',endDate:'2026-10-03'});const events=(await db.query(q.sql,q.params)).rows;
 const data=buildBestFourSummary(events);
 assert.equal(data.totalPlacements,4);assert.equal(data.knownPlacements,3);assert.equal(data.unknownPlacements,1);assert.equal(data.missingEvents,1);
 assert.deepEqual(data.decks.map(d=>[d.deckName,d.count]),[['A',2],['B',1]]);
 assert.equal(data.decks[0].percentage.toFixed(1),'66.7');
 assert.equal(buildBestFourSummary(events.filter(e=>e.event_name==='大会B')).decks[0].deckName,'B');
 const other=filteredEventCatalog({format:'advance'});assert.equal(buildBestFourSummary((await db.query(other.sql,other.params)).rows).totalEvents,1);
 const end=filteredEventCatalog({format:'original',endDate:'2026-10-01'});assert.equal(buildBestFourSummary((await db.query(end.sql,end.params)).rows).totalEvents,1);
 }finally{await db.close();}
});
