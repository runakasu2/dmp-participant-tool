const {test} = require('node:test');
const assert = require('node:assert/strict');
const {validateRecord, summarizeHands, saveRecord, installRpsRoutes} = require('../rock-paper-scissors');
const base = {playerName: ' 日本語プレイヤー ', dmpId: '000123', hand: 'rock'};
for (const hand of ['rock','scissors','paper']) test(`RPS validates stable hand: ${hand}`, () => {
  assert.deepEqual(validateRecord({...base, hand}), {playerName:'日本語プレイヤー',dmpId:'000123',hand,guestId:undefined,createGuest:false});
});
for (const body of [null, {}, {...base,playerName:''}, {...base,playerName:'　 '}, {...base,playerName:'a'.repeat(101)},
  {...base,hand:''}, {...base,hand:'lizard'}, {...base,hand:'👊'}, {...base,hand:1},
  {...base,dmpId:undefined}, {...base,guestId:1}, {...base,createGuest:true},
  {...base,dmpId:undefined,guestId:0}, {...base,dmpId:undefined,guestId:'1'}, {...base,dmpId:undefined,guestId:2147483648}]) {
  test(`RPS rejects invalid input: ${JSON.stringify(body)}`, () => assert.throws(() => validateRecord(body), {status:400}));
}
test('RPS allows explicitly selected guest or new identity; names never imply identity', () => {
  assert.equal(validateRecord({playerName:'同名',hand:'paper',guestId:1}).guestId,1);
  assert.equal(validateRecord({playerName:'同名',hand:'paper',createGuest:true}).createGuest,true);
});
for (const [counts, expected] of [[[0,0,0],[0,0,0]],[[1,0,0],[100,0,0]],[[5,3,2],[50,30,20]],[[1,1,1],[33.3,33.3,33.3]]]) {
  test(`RPS summary totals and percentages: ${counts}`, () => {
    const result = summarizeHands(['rock','scissors','paper'].map((hand,i) => ({hand,count:String(counts[i])})));
    assert.equal(result.total, counts.reduce((a,b)=>a+b,0));
    assert.deepEqual(result.hands.map(h=>h.percentage),expected);
    assert.deepEqual(summarizeHands([]).hands.map(h=>h.percentage),[0,0,0]);
  });
}
test('API rejects missing/invalid input without acquiring a DB connection', async () => {
  const routes = new Map();
  installRpsRoutes({post:(path,handler)=>routes.set(path,handler),get(){}}, {connect(){throw Error('must not access DB');}});
  for (const body of [null,{}, {...base,hand:'invalid'}]) {
    const res={status(code){this.code=code;return this;},json(data){this.body=data;}};
    await routes.get('/api/rps/records')({body},res);
    assert.equal(res.code,400); assert.equal(res.body.success,false);
  }
});
test('failed guest record insert rolls back the new identity and releases connection', async () => {
  const calls=[];
  await assert.rejects(saveRecord({connect:async()=>({async query(sql){
    calls.push(sql);
    if(sql.startsWith('INSERT INTO rps_guests'))return {rows:[{id:1,handle_name:'新規'}]};
    if(sql.startsWith('INSERT INTO rock_paper'))throw Error('insert failed');
    return {rows:[]};
  },release(){calls.push('release');}})}, {playerName:'新規',createGuest:true,hand:'rock'}), /insert failed/);
  assert.deepEqual(calls.slice(-2),['ROLLBACK','release']);
  assert.ok(!calls.includes('COMMIT'));
});
