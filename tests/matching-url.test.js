const {test}=require('node:test');
const assert=require('node:assert/strict');
const {detectProvider,latestMatching}=require('../deck-memo');
for(const admin of ['karatachics','hattics','another_CS-2026'])test('nojigiku admin '+admin+' is not treated as numeric tid',()=>{
  const parsed=detectProvider('https://nojigikucs.com/?admin='+admin+'&tid=not-a-tcg-id');
  assert.equal(parsed.provider,'nojigiku');assert.equal(parsed.adminKey,admin);
  assert.equal(new URL(parsed.sourceUrl).searchParams.get('admin'),admin);
});
for(const tail of ['tid=5482242','tid=8005807&MMP='])test('TCG '+tail+' uses tid without requiring admin',()=>{
  const parsed=detectProvider('https://tcg.sfc-jpn.jp/loginnum.asp?'+tail);
  assert.equal(parsed.provider,'tcg_meister');assert.equal(parsed.tid,new URLSearchParams(tail).get('tid'));
  assert.equal(parsed.adminKey,parsed.tid);
});
test('missing IDs report the correct provider and do not borrow the other provider query',()=>{
  for(const q of ['', '?admin=', '?tid=5482242'])assert.throws(()=>detectProvider('https://nojigikucs.com/'+q),/nojigiku.*adminを取得できません/);
  for(const q of ['', '?tid=', '?admin=hattics'])assert.throws(()=>detectProvider('https://tcg.sfc-jpn.jp/loginnum.asp'+q),/TCGマイスター.*tidを取得できません/);
  assert.throws(()=>detectProvider('https://tcg.sfc-jpn.jp/loginnum.asp?tid=hattics'),/tidは数字/);
});
test('foreign hosts stay rejected',()=>{
  for(const host of ['evil.test','nojigikucs.com.evil.test','tcg.sfc-jpn.jp.evil.test'])assert.throws(()=>detectProvider('https://'+host+'/loginnum.asp?admin=hattics&tid=5482242'));
});
test('upstream participant ID error is distinguishable from URL admin validation',()=>{
  assert.throws(()=>latestMatching([{round:1,table:1,user1id:'invalid-player',user1:'名前'}]),/参加者DMP ID/);
  assert.equal(detectProvider('https://nojigikucs.com/?admin=hattics').adminKey,'hattics');
});
