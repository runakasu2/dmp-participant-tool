const {test} = require('node:test');
const assert = require('node:assert/strict');
const {PGlite} = require('@electric-sql/pglite');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');

test('player search trims comparison values, preserves names and distinct IDs', async () => {
  // Isolated in-memory PostgreSQL; never connects to the application's database.
  const db = new PGlite();
  const routes = new Map(), app = {use(){}, listen(){}};
  for (const method of ['get', 'post', 'put']) app[method] = (url, handler) => routes.set(method + ' ' + url, handler);
  const express = Object.assign(() => app, {json(){}, static(){}});
  const pool = {query: (sql, args) => db.query(sql, args)};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8'), {
    require(name) {
      if (name === 'express') return express;
      if (name === 'pg') return {Pool: function(){return pool;}};
      return require(name);
    }, __dirname: path.join(__dirname, '..'), process: {env:{}}, URL, TextDecoder,
    console: {log(){}, error(){}}, AbortSignal
  });
  async function search(q) {
    const res = {status(n){this.code=n;return this;}, json(body){this.body=body;}};
    await routes.get('get /api/player-search')({query:{q}}, res);
    assert.equal(res.code, undefined);
    return res.body.players;
  }
  try {
    await db.exec('CREATE TABLE players(id SERIAL PRIMARY KEY,dmp_id TEXT UNIQUE,handle_name TEXT);');
    const names = ['テストプレイヤー', ' テストプレイヤー', '　テストプレイヤー',
      'テストプレイヤー ', 'テストプレイヤー　', ' 　テストプレイヤー　 ',
      'テストプレイヤー', '別テストプレイヤー追加', '内部 空白', '\tテストプレイヤー\n'];
    for (const [i, name] of names.entries()) await db.query('INSERT INTO players(dmp_id,handle_name) VALUES ($1,$2)', [String(i+1).padStart(6,'0'),name]);
    const snapshot = () => db.query('SELECT * FROM players ORDER BY id').then(r=>r.rows);
    const before = await snapshot();
    for (const q of ['テストプレイヤー', ' テストプレイヤー ', '　テストプレイヤー　', '\tテストプレイヤー\n', 'プレイヤ']) {
      const rows = await search(q);
      assert.equal(rows.length, 9, q);
      assert.equal(new Set(rows.map(r=>r.dmp_id)).size, 9);
      for (const row of rows) assert.equal(row.handle_name, names[row.id-1]);
    }
    const exact = await search('テストプレイヤー');
    assert.equal(exact.at(-1).handle_name, '別テストプレイヤー追加', 'normalized exact names rank above partial names');
    assert.deepEqual((await search('　000003 ')).map(r=>r.dmp_id), ['000003']);
    assert.deepEqual((await search('内部 空')).map(r=>r.handle_name), ['内部 空白']);
    assert.equal((await search('内部空')).length, 0, 'internal spaces remain significant');
    assert.deepEqual(await snapshot(), before, 'search does not mutate stored data');
  } finally {await db.close();}
});
