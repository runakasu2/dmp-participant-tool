const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function fixture({ missing = false, failAt, connectFails = false, rollbackFails = false } = {}) {
  const calls = [];
  let released = false;
  let releaseError;
  let connected = false;
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (calls.length === failAt || (rollbackFails && sql === 'ROLLBACK')) throw new Error('simulated failure');
      if (sql.startsWith('SELECT')) return { rows: missing ? [{ id: 1, name: '旧名' }] : [{ id: 1, name: '旧名' }, { id: 4, name: '正式名' }] };
      return { rowCount: sql.startsWith('UPDATE deck_history') ? 3 : 2 };
    },
    release(error) { released = true; releaseError = error; }
  };
  const routes = new Map();
  const app = { use() {}, listen() {} };
  for (const method of ['get', 'post', 'put']) app[method] = (route, handler) => routes.set(method + route, handler);
  const express = Object.assign(() => app, { json() {}, static() {} });
  const pool = { async connect() { connected = true; if (connectFails) throw new Error('offline'); return client; } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8'), {
    require(name) {
      if (name === 'express') return express;
      if (name === 'pg') return { Pool: function () { return pool; } };
      return require(name);
    },
    process: { env: {} }, __dirname: path.join(__dirname, ".."), console: { log() {}, error() {} }, URL, TextDecoder
  });
  return {
    calls,
    get released() { return released; },
    get releaseError() { return releaseError; },
    get connected() { return connected; },
    async request(id = '1', targetDeckId = 4) {
      const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
      await routes.get('post/api/decks/:id/merge')({ params: { id }, body: { targetDeckId } }, res);
      return res;
    }
  };
}

test('success: history and aliases move before source deletion and commit', async () => {
  const f = fixture();
  const res = await f.request();
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.updatedHistoryCount, 3);
  assert.equal(res.body.movedAliasCount, 2);
  assert.equal(res.body.deck.name, '正式名');
  assert.deepEqual(f.calls.map(call => call.sql.split(' ')[0]), ['BEGIN', 'SELECT', 'UPDATE', 'UPDATE', 'UPDATE', 'UPDATE', 'UPDATE', 'UPDATE', 'DELETE', 'COMMIT']);
  assert.deepEqual(Array.from(f.calls[2].params), ['正式名', '旧名']);
  assert.deepEqual(Array.from(f.calls[3].params), [4, 1]);
  assert.deepEqual(Array.from(f.calls[4].params), [4, 1]);
  assert.match(f.calls[4].sql, /UPDATE event_deck_predictions/);
  assert.match(f.calls[5].sql, /UPDATE deck_memos/);
  assert.deepEqual(Array.from(f.calls[5].params), [4, 1]);
  assert.match(f.calls[6].sql, /UPDATE deck_memo_archive_players/);
  assert.deepEqual(Array.from(f.calls[6].params), [4, 1]);
  assert.deepEqual(Array.from(f.calls[8].params), [1]);
  assert.equal(f.released, true);
});

test('invalid IDs and self merge do not connect to DB', async () => {
  for (const [source, target] of [['1', 1], ['0', 4], ['bad', 4], ['1', -1], ['1', 1.5], ['1', true], ['1', [4]], ['1', 2147483648], ['1', null]]) {
    const f = fixture();
    const res = await f.request(source, target);
    assert.equal(res.statusCode, 400);
    assert.equal(f.connected, false);
  }
});

test('missing deck rolls back without mutations', async () => {
  const f = fixture({ missing: true });
  assert.equal((await f.request()).statusCode, 404);
  assert.deepEqual(f.calls.map(call => call.sql.split(' ')[0]), ['BEGIN', 'SELECT', 'ROLLBACK']);
  assert.equal(f.released, true);
});

for (const failAt of [2, 3, 4, 5, 6, 7, 8, 9, 10]) {
  test('failure at transaction step ' + failAt + ' rolls back and releases client', async () => {
    const f = fixture({ failAt });
    assert.equal((await f.request()).statusCode, 500);
    assert.equal(f.calls.at(-1).sql, 'ROLLBACK');
    assert.equal(f.released, true);
  });
}

test('connection failure returns structured error', async () => {
  const f = fixture({ connectFails: true });
  assert.equal((await f.request()).body.success, false);
  assert.equal(f.released, false);
});

test('failed rollback discards connection', async () => {
  const f = fixture({ failAt: 4, rollbackFails: true });
  assert.equal((await f.request()).statusCode, 500);
  assert.equal(f.released, true);
  assert.ok(f.releaseError);
});
