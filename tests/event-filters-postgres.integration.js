const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {filteredEventCatalog}=require('../event-catalog');
test('format backfill, save trigger and SQL date filtering preserve unknown events',async()=>{
 const db=new PGlite();try{
 await db.exec(`CREATE TABLE events(id SERIAL PRIMARY KEY,event_name TEXT,event_date DATE,shop_id TEXT,event_id TEXT,seq TEXT);
 CREATE TABLE event_results(event_record_id INT,player_id INT,rank INT);
 CREATE TABLE players(id INT,dmp_id TEXT,handle_name TEXT);
 CREATE TABLE deck_history(id INT,player_id INT,deck_name TEXT,shop_id TEXT,event_id TEXT,seq TEXT,created_at TIMESTAMP);
 CREATE TABLE decks(id INT,name TEXT,image_url TEXT);CREATE TABLE deck_aliases(deck_id INT,alias TEXT);
 INSERT INTO events(event_name,event_date) VALUES ('A【オリジナル】','2026-09-01'),('Bアドバンス','2026-09-30'),('C【２ブロック】','2026-09-30'),('不明','2026-09-02'),('オリジナル・アドバンス','2026-09-03');`);
 const migration=fs.readFileSync('migrations/008_event_formats.sql','utf8');await db.exec(migration);await db.exec(migration);
 const formats=(await db.query('SELECT format FROM events ORDER BY id')).rows.map(r=>r.format);
 assert.deepEqual(formats,['original','advance','2block',null,null]);
 await db.exec("INSERT INTO events(event_name,event_date) VALUES ('追加オリジナル','2026-10-01'),('明示形式','2026-09-10'); UPDATE events SET format='advance' WHERE event_name='明示形式'");
 const list=async query=>{const q=filteredEventCatalog(query);return(await db.query(q.sql,q.params)).rows;};
 assert.equal((await list({format:'original'})).length,2);
 assert.equal((await list({format:'advance'})).length,2);assert.equal((await list({format:'2block'})).length,1);
 assert.equal((await list({format:'original',startDate:'2026-09-01',endDate:'2026-09-30'})).length,1);
 assert.equal((await list({format:'original',startDate:'2026-10-01'})).length,1);
 assert.equal((await list({format:'original',endDate:'2026-09-01'})).length,1);
 assert.equal((await list({format:'2block',endDate:'2026-09-01'})).length,0);
 assert.equal((await list({})).length,7);
 }finally{await db.close();}
});

test('explicit format upsert replaces title inference and null never erases valid format',async()=>{
 const db=new PGlite();try{
 await db.exec('CREATE TABLE events(shop_id TEXT,event_id TEXT,seq TEXT,event_name TEXT,event_date DATE,UNIQUE(shop_id,event_id,seq))');
 await db.exec(fs.readFileSync('migrations/008_event_formats.sql','utf8'));
 await db.exec("INSERT INTO events VALUES ('s','e','1','【オリジナル】',NULL,'original')");
 const migration=fs.readFileSync('migrations/009_explicit_event_format.sql','utf8');await db.exec(migration);await db.exec(migration);
 const sql=`INSERT INTO events(shop_id,event_id,seq,event_name,format) VALUES ('s','e','1','【オリジナル】',$1) ON CONFLICT(shop_id,event_id,seq) DO UPDATE SET format=COALESCE(EXCLUDED.format,events.format)`;
 await db.query(sql,['2block']);await db.query(sql,[null]);
 assert.equal((await db.query('SELECT format FROM events')).rows[0].format,'2block');
 }finally{await db.close();}
});
