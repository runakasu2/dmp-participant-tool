const {test}=require('node:test'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {EVENT_CATALOG_SQL,installDeckImageRoute}=require('../event-catalog');
const fs=require('node:fs');
test('catalogue batches events, preserves ties, isolates full keys and chooses latest history; images persist',async()=>{
 const db=new PGlite();
 try {
 await db.exec(`CREATE TABLE events(id SERIAL PRIMARY KEY,shop_id TEXT,event_id TEXT,seq TEXT,event_date DATE,updated_at TIMESTAMP);
 CREATE TABLE decks(id SERIAL PRIMARY KEY,name TEXT,updated_at TIMESTAMP);
 CREATE TABLE deck_aliases(deck_id INT,alias TEXT);
 INSERT INTO decks(name) VALUES ('new'),('other seq');
 INSERT INTO deck_aliases VALUES (1,'old alias');
 CREATE TABLE players(id SERIAL PRIMARY KEY,dmp_id TEXT,handle_name TEXT);
 CREATE TABLE event_results(event_record_id INT,player_id INT,rank INT);
 CREATE TABLE deck_history(id SERIAL PRIMARY KEY,player_id INT,shop_id TEXT,event_id TEXT,seq TEXT,deck_name TEXT,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
 INSERT INTO events(shop_id,event_id,seq,event_date) VALUES ('s','e','1','2026-09-30'),('s','e','2','2026-09-29'),('other','e','1','2026-09-28');
 INSERT INTO players(dmp_id,handle_name) VALUES ('11','A'),('22','B'),('33','C'),('44','D');
 INSERT INTO event_results VALUES (1,1,1),(1,2,4),(1,3,4),(1,4,8),(2,1,2);
 INSERT INTO deck_history(player_id,shop_id,event_id,seq,deck_name) VALUES (1,'s','e','1','old'),(1,'s','e','1','new'),(1,'s','e','2','other seq'),(2,'other','e','1','wrong shop');`);
 const migration=fs.readFileSync('migrations/007_deck_images.sql','utf8');await db.exec(migration);await db.exec(migration);
 const rows=(await db.query(EVENT_CATALOG_SQL)).rows;
 assert.equal(rows.length,3);assert.deepEqual(rows[0].best_four.map(p=>p.rank),[1,4,4]);
 assert.equal(rows[0].best_four[0].deckName,'new');assert.equal(rows[0].best_four[0].handleName,'A');
 assert.equal(rows[0].best_four[1].deckName,null);assert.equal(rows[1].best_four[0].deckName,'other seq');
 assert.equal(rows[2].result_count,0);assert.deepEqual(rows[2].best_four,[]);
 let handler;installDeckImageRoute({put(u,h){handler=h;}},db);
 const res={status(n){this.code=n;return this;},json(b){this.body=b;}};
 await handler({params:{id:'1'},body:{imageUrl:'https://example.com/card.png'}},res);assert.equal(res.body.success,true);
 assert.equal((await db.query(EVENT_CATALOG_SQL)).rows[0].best_four[0].deckImageUrl,'https://example.com/card.png');
 await db.exec("UPDATE decks SET name='renamed' WHERE id=1; UPDATE deck_history SET deck_name='old alias' WHERE deck_name='new'");
 assert.equal((await db.query(EVENT_CATALOG_SQL)).rows[0].best_four[0].deckName,'renamed');
 assert.equal((await db.query(EVENT_CATALOG_SQL)).rows[0].best_four[0].deckImageUrl,'https://example.com/card.png');
 await handler({params:{id:'1'},body:{imageUrl:''}},res);assert.equal(res.body.deck.image_url,null);
 }finally{await db.close();}
});
