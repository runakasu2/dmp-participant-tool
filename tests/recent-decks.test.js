const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {spawnSync} = require('node:child_process');

function fixture(query) {
  const routes = new Map();
  const app = {use(){}, listen(){}};
  for (const method of ['get','post','put']) app[method] = (route, handler) => routes.set(method + route, handler);
  const express = Object.assign(() => app, {json(){}, static(){}});
  const context = vm.createContext({require(name) {
    if(name === 'express') return express;
    if(name === 'pg') return {Pool: function(){return {query};}};
    return require(name);
  }, __dirname: process.cwd(), process:{env:{}}, console:{log(){},error(){}}, URL, URLSearchParams, TextDecoder});
  vm.runInContext(fs.readFileSync('server.js','utf8'),context);
  return {context,routes};
}

test('history SQL: deduplicate before ranking; use event dates; exclude current, same-day, future and unknown dates', async () => {
  let calls = 0;
  const f = fixture(async (sql, params) => {
    calls++;
    // Execute the production window query in SQLite with only PostgreSQL syntax adapted.
    sql = sql.replace('= ANY($1::text[])', 'IN (SELECT value FROM json_each($1))')
      .replaceAll('::text','').replaceAll('::date','').replaceAll('BTRIM','TRIM');
    const python = `
import sqlite3,json,sys
payload=json.load(sys.stdin)
c=sqlite3.connect(':memory:')
c.row_factory=sqlite3.Row
c.executescript('''
CREATE TABLE players(id INTEGER,dmp_id TEXT);
CREATE TABLE events(shop_id TEXT,event_id TEXT,seq TEXT,event_date TEXT,event_name TEXT);
CREATE TABLE deck_history(id INTEGER,player_id INTEGER,shop_id TEXT,event_id TEXT,seq TEXT,event_date TEXT,deck_name TEXT,created_at TEXT);
''')
for p in range(1,6): c.execute('INSERT INTO players VALUES (?,?)',(p,str(p)))
def add(i,p,event,date,deck,created='2026-10-01',shop='s',seq='1'):
 c.execute('INSERT INTO deck_history VALUES (?,?,?,?,?,?,?,?)',(i,p,shop,event,seq,date,deck,created))
add(1,1,'a','2026-09-01','old')
add(2,1,'a','2026-09-01','corrected')
add(3,1,'b','2026-09-02','B')
add(4,1,'c','2026-09-03','C')
add(5,1,'d','2026-09-04','D','2020-01-01')
add(6,1,'current','2026-09-01','CURRENT')
add(7,1,'future','2026-10-01','FUTURE')
add(8,1,'same','2026-09-10','SAME')
add(9,1,'unknown',None,'UNKNOWN')
add(10,1,'missing','2026-09-09','MISSING',shop=None)
c.execute('INSERT INTO events VALUES (?,?,?,?,?)',('s','a','1','2026-09-09','event A'))
add(11,2,'a','2026-09-01','single')
add(12,3,'b','2026-09-02','one')
add(13,3,'c','2026-09-03','two')
add(14,4,'a',None,'date from events')
add(15,4,'a',None,'another shop',shop='other')
add(16,4,'a','2026-09-03','another seq',seq='2')
rows=c.execute(payload['sql'],[json.dumps(payload['params'][0])]+payload['params'][1:]).fetchall()
print(json.dumps([dict(r) for r in rows]))
`;
    const run = spawnSync('python3',['-c',python],{input:JSON.stringify({sql,params}),encoding:'utf8'});
    assert.equal(run.status,0,run.stderr);
    return {rows:JSON.parse(run.stdout)};
  });
  const result = await f.context.fetchRecentDecks(['1','2','3','4','5'],{shopId:'s',eventId:'current',seq:'1',eventDate:'2026-09-10'});
  assert.equal(calls,1);
  assert.deepEqual(Array.from(result.get('1'),h=>h.deckName),['corrected','D','C']);
  assert.equal(result.get('1')[0].eventDate,'2026-09-09');
  assert.equal(result.get('1')[0].eventName,'event A');
  assert.equal(result.get('2').length,1);
  assert.equal(result.get('3').length,2);
  assert.equal(result.get('4').length,2);
  assert.equal(result.has('5'),false);
});

test('participants batch-save and batch-read with structured history, independent of player count', async () => {
  const calls=[];
  const f=fixture(async(sql,params)=>{
    calls.push({sql,params});
    if(sql.includes('SELECT event_date::text')) return {rows:[{event_date:'2026-09-10'}]};
    if(sql.includes('WITH latest')) return {rows:[{dmp_id:'1',shop_id:'s',event_id:'old',seq:'1',event_date:'2026-09-01',event_name:'大会',deck_name:'A'}]};
    return {rows:[]};
  });
  f.context.fetch=async()=>({ok:true,json:async()=>({d:[{'会員ID':'1','ハンドルネーム':'A'},{'会員ID':'2','ハンドルネーム':'B'}]})});
  const res={status(n){this.code=n;return this;},json(body){this.body=body;}};
  await f.routes.get('post/api/participants')({body:{shopId:'s',eventId:'current',seq:'1'}},res);
  assert.equal(calls.length,5);
  assert.equal(res.body.participants[0].recentDecks[0].deckName,'A');
  assert.equal(res.body.participants[1].recentDecks.length,0);
  assert.equal(res.body.recentDecksStatus,'ok');
});

test('date lookup failure preserves participants and explicitly marks unavailable history', async()=>{
  const f=fixture(async sql=>{if(sql.includes('SELECT event_date')) throw Error('offline');return {rows:[]};});
  f.context.fetch=async()=>({ok:true,json:async()=>({d:[{'会員ID':'1','ハンドルネーム':'A'}]})});
  const res={status(){return this;},json(body){this.body=body;}};
  await f.routes.get('post/api/participants')({body:{shopId:'s',eventId:'e',seq:'1'}},res);
  assert.equal(res.body.success,true);
  assert.equal(res.body.recentDecksStatus,'unavailable');
  assert.equal(res.body.participants.length,1);
});
