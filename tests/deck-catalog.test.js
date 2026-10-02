const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const fs=require('node:fs');
const vm=require('node:vm');
const {getDeckCatalog}=require('../deck-catalog');

test('catalog query counts each history once; aliases, zero usage, rename, merge and stable ordering',async()=>{
  let sql,calls=0;
  await getDeckCatalog({query:async query=>{calls++;sql=query;return{rows:[]};}},true);
  assert.equal(calls,1);
  // Execute the production CTE with only cast/JSON aggregate dialect adaptation.
  sql=sql.replace('::integer','').replace('json_agg(a.alias ORDER BY a.alias)','json_group_array(a.alias)').replace('json_agg(f.format ORDER BY f.format)','json_group_array(f.format)');
  const result=spawnSync('python3',['-c',`
import sqlite3,json,sys
sql=json.load(sys.stdin)
c=sqlite3.connect(':memory:');c.row_factory=sqlite3.Row
c.executescript("""
CREATE TABLE decks(id INTEGER PRIMARY KEY,name TEXT,image_url TEXT);
CREATE TABLE deck_formats(deck_id INTEGER,format TEXT);
CREATE TABLE deck_aliases(deck_id INTEGER,alias TEXT UNIQUE);
CREATE TABLE deck_history(deck_name TEXT);
INSERT INTO decks(id,name) VALUES(1,'A'),(2,'B'),(3,'C'),(4,'D');
INSERT INTO deck_aliases VALUES(1,'alias1'),(1,'alias2'),(3,'B');
INSERT INTO deck_history VALUES('A'),('A'),('alias1'),('alias2'),('B'),('B'),('unmapped');
""")
def read(): return [dict(r) for r in c.execute(sql)]
phases=[read()]
c.execute("UPDATE decks SET name='Z' WHERE id=1")
c.execute("UPDATE deck_history SET deck_name='Z' WHERE LOWER(deck_name)=LOWER('A')")
phases.append(read())
c.execute("UPDATE deck_history SET deck_name='B' WHERE deck_name='Z'")
c.execute("UPDATE deck_aliases SET deck_id=2 WHERE deck_id=1")
c.execute("DELETE FROM decks WHERE id=1")
phases.append(read())
c.execute("INSERT INTO decks(id,name) VALUES(5,'E')")
phases.append(read())
print(json.dumps(phases))
`],{input:JSON.stringify(sql),encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const [initial,renamed,merged,added]=JSON.parse(result.stdout);
  assert.deepEqual(initial.map(d=>[d.name,d.usage_count]),[['A',4],['B',2],['C',0],['D',0]]);
  assert.equal(renamed[0].name,'Z');assert.equal(renamed[0].usage_count,4);
  assert.deepEqual(merged.map(d=>[d.name,d.usage_count]),[['B',6],['C',0],['D',0]]);
  assert.equal(added.at(-1).name,'E');assert.equal(added.at(-1).usage_count,0);
  assert.equal(merged.reduce((n,d)=>n+d.usage_count,0),6);
});

test('management retains name ordering; usage mode is explicit',async()=>{
  const queries=[];const db={query:async sql=>{queries.push(sql);return{rows:[]};}};
  await getDeckCatalog(db);await getDeckCatalog(db,true);
  assert.ok(queries[0].endsWith('ORDER BY d.name ASC, d.id ASC'));
  assert.ok(queries[1].endsWith('ORDER BY usage_count DESC, d.name ASC, d.id ASC'));
});

test('shared dropdown preserves usage ordering and selected ID with placeholder first, no aliases/count labels',()=>{
  class Element{constructor(){this.children=[];this.value='';}setAttribute(){}replaceChildren(){this.children=[];}appendChild(child){this.children.push(child);}}
  const c=vm.createContext({document:{createElement:()=>new Element()}});
  vm.runInContext(fs.readFileSync('deck-select.js','utf8'),c);
  const select=c.createDeckSelect([{id:2,name:'B',usage_count:6,aliases:['alias1']},{id:3,name:'C',usage_count:0,aliases:[]}],{deckId:3});
  assert.deepEqual(Array.from(select.children,o=>o.textContent),['未選択','B','C']);
  assert.equal(select.value,'3');
});
