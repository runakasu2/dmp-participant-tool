const {test}=require('node:test'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite');
const {getDeckTrends}=require('../deck-trends');
const {buildEventDeckSummary,loadEventDeckRows}=require('../event-deck-summary');
test('trend PostgreSQL: formats, boundaries, full event keys, aliases, denominator and missing data',async()=>{
 const db=new PGlite();let queries=0;const pool={query:async(...args)=>{queries++;return db.query(...args);}};
 try{
 await db.exec(`CREATE TABLE events(id INT,shop_id TEXT,event_id TEXT,seq TEXT,event_name TEXT,event_date DATE,participant_count INT,format TEXT);
 CREATE TABLE players(id INT,dmp_id TEXT,handle_name TEXT);
 CREATE TABLE decks(id INT,name TEXT,image_url TEXT);
 CREATE TABLE deck_aliases(deck_id INT,alias TEXT);
 CREATE TABLE deck_history(player_id INT,shop_id TEXT,event_id TEXT,seq TEXT,deck_name TEXT);
 INSERT INTO players VALUES(1,'1','P'),(2,'2','Q');
 INSERT INTO decks VALUES(1,'A','https://example.com/a'),(2,'B',NULL);
 INSERT INTO deck_aliases VALUES(1,'aliasA');
 INSERT INTO events VALUES
 (1,'s','e','1','First','2026-09-01',4,'original'),
 (2,'s','e','2','Second','2026-09-01',2,'original'),
 (3,'other','e','1','Other format','2026-09-02',2,'2block'),
 (4,'s','empty','1','Unentered','2026-09-03',8,'original'),
 (5,'s','outside','1','Outside','2026-10-01',2,'original');
 INSERT INTO deck_history VALUES(1,'s','e','1','A'),(2,'s','e','1','aliasA'),(1,'s','e','2','B'),(1,'other','e','1','B'),(1,'s','outside','1','A');`);
 const result=await getDeckTrends(pool,{format:'original',startDate:'2026-09-01',endDate:'2026-09-30'});
 assert.equal(queries,2);assert.deepEqual(result.events.map(e=>e.eventRecordId),[1,2]);
 assert.deepEqual(result.events[0].decks,[{deckId:1,deckName:'A',count:2,percentage:50}]);
 assert.equal(result.events[0].unregisteredCount,2);assert.equal(result.events[1].decks[0].percentage,50);
 assert.equal(result.excludedEvents[0].reason,'unentered');assert.equal(result.excludedEvents[0].eventRecordId,4);
 const summary=buildEventDeckSummary({participant_count:4},await loadEventDeckRows(pool,[1]));
 assert.equal(summary.decks[0].count,result.events[0].decks[0].count);assert.equal(summary.participantCount,result.events[0].participantCount);
 assert.equal(summary.decks[0].players.length,2);assert.equal(summary.decks[0].image_url,'https://example.com/a');
 assert.deepEqual((await getDeckTrends(pool,{format:'2block'})).events.map(e=>e.eventRecordId),[3]);
 assert.deepEqual((await getDeckTrends(pool,{format:'advance'})).events,[]);
 assert.deepEqual((await getDeckTrends(pool,{format:'original',startDate:'2026-10-01'})).events.map(e=>e.eventRecordId),[5]);
 assert.deepEqual((await getDeckTrends(pool,{format:'original',endDate:'2026-09-01'})).events.map(e=>e.eventRecordId),[1,2]);
 await assert.rejects(()=>getDeckTrends(pool,{startDate:'2026-10-01',endDate:'2026-09-01'}));
 // No deck_formats table exists: current membership cannot hide historical usage.
 }finally{await db.close();}
});
