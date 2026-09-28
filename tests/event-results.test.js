const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture(fail = '') {
  const calls = [], routes = new Map();
  let released = false;
  const records = new Map();
  let snapshot;
  const client = {
    async query(sql, args) {
      calls.push({sql, args});
      if (fail && sql.includes(fail)) throw new Error('simulated DB failure');
      if (sql === 'BEGIN') snapshot = new Map(records);
      if (sql === 'ROLLBACK') { records.clear(); for (const [k,v] of snapshot) records.set(k,v); }
      if (sql.includes('INSERT INTO events')) return {rows: [{id: 7}]};
      if (sql.includes('INSERT INTO players')) return {rows: [{id: Number(args[0])}]};
      if (sql.includes('INSERT INTO event_results')) records.set(args[0] + ':' + args[1], args.slice(2));
      return {rows: []};
    },
    release() { released = true; }
  };
  const pool = {connect: async () => client, query: async (sql, args) => {
    calls.push({sql, args}); return {rows: pool.readRows || []};
  }};
  const app = {use() {}, listen() {}};
  for (const method of ['get', 'post', 'put']) app[method] = (route, handler) => routes.set(method + route, handler);
  const express = Object.assign(() => app, {json() {}, static() {}});
  const context = vm.createContext({require(name) {
    if (name === 'express') return express;
    if (name === 'pg') return {Pool: function () {return pool;}};
    return require(name);
  }, process: {env: {}}, __dirname: path.join(__dirname, '..'), console: {log() {}, error() {}}, URL, TextDecoder});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8'), context);
  return {calls, records, pool, context, get released() {return released;},
    save: (rows) => context.saveEventResults({shopId: 's', eventId: 'e', held: '2', eventDate: '2026-09-28', eventName: '大会'}, rows),
    async read(query) {
      const res = {statusCode: 200, status(n) {this.statusCode = n; return this;}, json(body) {this.body = body;}};
      await routes.get('get/api/event-results')({query}, res);
      return res;
    }
  };
}

test('re-fetch updates rank without additional records; omitted players survive', async () => {
  const f = fixture();
  await f.save([{id: '1', name: 'A', rank: '8'}, {id: '2', name: 'B', rank: 8}]);
  await f.save([{id: '1', name: 'A renamed', rank: '1'}]);
  assert.equal(f.records.size, 2);
  assert.equal(f.records.get('7:1')[0], 1);
  assert.equal(f.records.get('7:2')[0], 8);
  assert.ok(f.calls.find(c => c.sql.includes('ON CONFLICT (event_record_id, player_id)')));
  assert.deepEqual(Array.from(f.calls.find(c => c.sql.includes('INSERT INTO events')).args).slice(0,3), ['s','e','2']);
  assert.equal(f.released, true);
});

test('unknown ranks retain original text without becoming a numeric rank', async () => {
  for (const rank of [null, '', '-', '失格', '8位', 0, -1, 1.5, '2147483648']) {
    const f = fixture();
    await f.save([{id: '1', name: 'A', rank}]);
    assert.equal(f.records.get('7:1')[0], null);
    assert.equal(f.records.get('7:1')[1], rank == null ? null : String(rank));
  }
});

test('empty response does not write anything', async () => {
  const f = fixture(); await f.save([]); assert.equal(f.calls.length, 0);
});

test('bad or duplicate player data rejects the entire import before DB writes', async () => {
  for (const rows of [[{id:'', name:'A'}], [{id:'1', name:''}], [{id:'1', name:'A'}, {id:'1', name:'B'}]]) {
    const f = fixture(); await assert.rejects(f.save(rows)); assert.equal(f.calls.length, 0);
  }
});

for (const fail of ['INSERT INTO events', 'INSERT INTO players', 'INSERT INTO event_results', 'COMMIT']) {
  test('failure rolls back and releases connection: ' + fail, async () => {
    const f = fixture(fail);
    await assert.rejects(f.save([{id:'1',name:'A',rank:1}]));
    assert.equal(f.calls.at(-1).sql, 'ROLLBACK');
    assert.equal(f.records.size, 0);
    assert.equal(f.released, true);
  });
}

test('read validates identifiers and distinguishes missing event from no results', async () => {
  const f = fixture();
  assert.equal((await f.read({shopId:'s'})).statusCode, 400);
  const query = {shopId:'s', eventId:'e', seq:'2'};
  assert.equal((await f.read(query)).statusCode, 404);
  f.pool.readRows = [{shop_id:'s',event_id:'e',seq:'2',dmp_id:null}];
  assert.equal((await f.read(query)).body.count, 0);
  f.pool.readRows = [{shop_id:'s',event_id:'e',seq:'2',dmp_id:'1',handle_name:'A',rank:1,rank_raw:'1',deck_name:null}];
  const res = await f.read(query);
  assert.equal(res.body.participants[0].rank, 1);
  assert.equal(res.body.participants[0].deckName, null);
});

test('malformed upstream page is rejected instead of returning partial results', async () => {
  const f = fixture();
  f.context.fetch = async () => ({ok:true, json:async () => ({d: {unexpected:true}})});
  await assert.rejects(f.context.fetchResultParticipants({year:2026,shopId:'s',eventId:'e',held:'2'}));
});


test('existing DMP parser and Shift_JIS detail fetch provide identity, name and date', async () => {
  const f = fixture();
  const url = 'https://www.dmp-ranking.com/event.asp?ShopID=3616&EventID=336&Seq=2';
  const ids = f.context.parseEventDetailUrl(url);
  assert.equal(ids.shopId, '3616'); assert.equal(ids.eventId, '336'); assert.equal(ids.seq, '2');
  assert.throws(() => f.context.parseEventDetailUrl('https://example.com/?ShopID=1&EventID=2&Seq=3'));
  f.context.fetch = async () => ({ok:true, arrayBuffer:async () => Buffer.from('PGh0bWw+PGgxPoNlg1iDZ0NTPC9oMT48cD6KSo3Dk/qBRjIwMjYvMDkvMjg8L3A+PC9odG1sPg==', 'base64')});
  const detail = await f.context.fetchEventDetail(url);
  assert.equal(detail.eventName, 'テストCS');
  assert.equal(detail.eventDate, '2026-09-28');
  assert.equal(detail.held, '2');
});
