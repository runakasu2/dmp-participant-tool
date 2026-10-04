const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {detectProvider}=require('../deck-memo');
const {parseTcgUrl,publicSession,latestRound,parseRound,fetchTcgMatching}=require('../matching-providers/tcg-meister');
const {matchParticipants}=require('../deck-memo-matching');
const fixture=name=>fs.readFileSync(path.join(__dirname,'fixtures/tcg-meister',name+'.html'),'utf8');
const source=parseTcgUrl('https://tcg.sfc-jpn.jp/loginnum.asp?tid=5482242');

test('provider URL validation; tid/MMP are parsed without accepting arbitrary hosts/protocols/paths',()=>{
  assert.equal(detectProvider(source.sourceUrl).provider,'tcg_meister');
  for(const admin of ['karatachics','hattics','other_2026']) assert.equal(detectProvider('https://nojigikucs.com/?admin='+admin).provider,'nojigiku');
  assert.equal(parseTcgUrl(source.sourceUrl+'&x=ignored').tid,'5482242');
  assert.equal(parseTcgUrl(source.sourceUrl.replace('MMP=','MMP=a%26b')).mmp,'a&b');
  for(const url of ['http://tcg.sfc-jpn.jp/loginnum.asp?tid=1','https://tcg.sfc-jpn.jp.evil.test/loginnum.asp?tid=1',
    'https://tcg.sfc-jpn.jp/loginnum.asp','https://tcg.sfc-jpn.jp/loginnum.asp?tid=',
    'https://tcg.sfc-jpn.jp/loginnum.asp?tid=1&tid=2','https://user:password@tcg.sfc-jpn.jp/loginnum.asp?tid=1',
    'https://tcg.sfc-jpn.jp:444/loginnum.asp?tid=1','https://tcg.sfc-jpn.jp/other.asp?tid=1']) assert.throws(()=>detectProvider(url));
});
test('normal rounds exclude standings; rows retain internal/raw IDs without claiming DMP identities',()=>{
  assert.equal(latestRound(fixture('tour'),'5482242'),5);
  assert.equal(latestRound('<a href="tourround.asp?tid=5482242&kno=9999999">成績表</a>','5482242'),null);
  const parsed=parseRound(fixture('round-name-page1'),'5482242',5);
  assert.equal(parsed.participants.length,2);assert.deepEqual(parsed.pages,[2]);
  assert.equal(parsed.participants[0].rawNo,'ガブロジー');assert.equal(parsed.participants[0].internalParticipantId,'42');
  assert.equal(parsed.participants[0].dmpId,null);
  assert.deepEqual(parsed.participants.map(p=>p.tableNumber),[1,1]);
  const numeric=parseRound(fixture('round-number'),'8005807',5).participants[0];
  assert.equal(numeric.rawNo,'45190');assert.equal(numeric.name,'カッツヲ');assert.equal(numeric.dmpId,null);
  assert.equal(numeric.tableNumber,2);
  const bye=parseRound(fixture('round-name-page2'),'5482242',5).participants[0];
  assert.equal(bye.bye,true);assert.equal(bye.table,null);assert.equal(bye.name,'旧HN');
});
test('exact HN match preserves canonical leading zeroes; no fuzzy/partial/symbol matching; ambiguity is not guessed',()=>{
  const participant={participantKey:'id:42',name:'ガブロジー'};
  const candidate={dmp_id:'056075',player_id:123,handle_name:'ガブロジー'};
  const match=matchParticipants([participant],[candidate])[0];
  assert.equal(match.matchStatus,'matched');assert.equal(match.dmpId,'056075');assert.equal(match.playerId,123);
  for(const name of ['旧HN','ガブロジー@','ガブロジ','ガブロジーさん']) {
    const p=matchParticipants([{...participant,name}],[candidate])[0];assert.equal(p.matchStatus,'unmatched');assert.equal(p.dmpId,null);
  }
  assert.equal(matchParticipants([participant],[candidate,{...candidate,dmp_id:'999'}])[0].matchStatus,'ambiguous');
  const duplicate=matchParticipants([participant,{...participant,participantKey:'id:43'}],[candidate]);
  assert.ok(duplicate.every(p=>p.matchStatus==='ambiguous'&&p.dmpId===null));
});
function fakeSource({broken,empty=false}={}) {
  const calls=[];
  return {calls,fetch:async(url,opts)=>{
    const u=new URL(url);calls.push({url,opts});
    if(broken==='http')return new Response('offline',{status:503});
    if(broken==='timeout')throw Object.assign(new Error(),{name:'TimeoutError'});
    if(u.pathname==='/loginnum.asp')return new Response(fixture('login'),{headers:{'Set-Cookie':'session=anonymous; Path=/; HttpOnly'}});
    assert.match(opts.headers.Cookie,/session=anonymous/);
    if(u.pathname==='/login_bin.asp') {
      assert.equal(opts.method,'POST');
      const params=new URLSearchParams(opts.body);
      for(const [key,value] of Object.entries({tid:'5482242',MMP:'',OnlineResult:'2',Dummy:'null',ShikibetsuNo:'',flu:'',SelectShikibetsuNo:'',InputShikibetsuNo:'',pwd:''})) assert.equal(params.get(key),value);
      return new Response(null,{status:302,headers:{Location:broken==='redirect'?'https://evil.test/':'/tour.asp?tid=5482242'}});
    }
    if(u.pathname==='/tour.asp')return new Response(empty?'<form action="tour.asp"><input name="tid" value="5482242"></form>':fixture('tour'));
    if(u.pathname==='/tourround.asp')return new Response(broken==='html'?'<p>error</p>':fixture(u.searchParams.get('Page')==='2'?'round-name-page2':'round-name-page1'));
    throw Error('unexpected request');
  }};
}
test('anonymous login uses request-local cookies, follows safe redirect and loads both pages once',async()=>{
  const f=fakeSource();const result=await fetchTcgMatching(source,f.fetch);
  assert.equal(result.latestRound,5);assert.equal(result.participants.length,4);
  assert.deepEqual(result.participants.map(p=>p.table),[1,1,2,null]);
  assert.equal(f.calls.filter(c=>new URL(c.url).pathname==='/tourround.asp').length,2);
  assert.ok(result.participants.every(p=>p.dmpId===null));
  await fetchTcgMatching(source,f.fetch); // new anonymous session, never reuse the previous request's cookie jar
  assert.equal(f.calls.filter(c=>new URL(c.url).pathname==='/loginnum.asp')[1].opts.headers.Cookie,undefined);
});
test('unpublished empty rounds succeed; external failures/invalid HTML/foreign redirect stop safely',async()=>{
  assert.equal((await fetchTcgMatching(source,fakeSource({empty:true}).fetch)).latestRound,null);
  for(const broken of ['http','timeout','redirect','html']) {
    const f=fakeSource({broken});await assert.rejects(fetchTcgMatching(source,f.fetch));
    assert.ok(f.calls.every(c=>new URL(c.url).hostname==='tcg.sfc-jpn.jp'));
  }
});
test('pagination bounds, unexpected layout and session redirect loops are rejected',async()=>{
  assert.throws(()=>parseRound(fixture('round-name-page1').replace('Page=2','Page=999'),'5482242',5),/上限/);
  assert.throws(()=>parseRound('<html>error</html>','5482242',5),/読み取れません/);
  let count=0;
  await assert.rejects(publicSession(async()=>{count++;return new Response(null,{status:302,headers:{Location:'/tour.asp?tid=1'}});})('/tour.asp?tid=1'),/上限/);
  assert.equal(count,6);
});

test('repeated participants across pages are deduplicated and last-page links include intermediate pages',async()=>{
  const f=fakeSource();
  const fetchImpl=async(url,opts)=>{
    if(new URL(url).pathname==='/tourround.asp') {
      const page=Number(new URL(url).searchParams.get('Page'));
      f.calls.push({url,opts});
      return new Response(page===1?fixture('round-name-page1').replace('Page=2','Page=3'):
        fixture('round-name-page2')+fixture('round-name-page1'));
    }
    return f.fetch(url,opts);
  };
  const data=await fetchTcgMatching(source,fetchImpl);
  assert.equal(data.participants.length,4);
  assert.deepEqual(f.calls.filter(c=>new URL(c.url).pathname==='/tourround.asp').map(c=>new URL(c.url).searchParams.get('Page')),['1','2','3']);
  let calls=0;
  await assert.rejects(publicSession(async()=>{calls++;return new Response(null,{status:302,headers:{Location:'/tour.asp?tid=999'}});},'5482242')('/tour.asp?tid=5482242'),/転送先/);
  assert.equal(calls,1);
});

test('shared DMP participant reader paginates by 32, preserves leading zeroes and rejects malformed data',async()=>{
  const {fetchEventParticipants}=require('../dmp-participants');
  const offsets=[];
  const result=await fetchEventParticipants({shopId:'s',eventId:'e',seq:'2'},async(url,opts)=>{
    const body=JSON.parse(opts.body);offsets.push(body.offset);
    assert.equal(body.shopID,'s');assert.equal(body.eventID,'e');assert.equal(body.heldID,'2');
    const d=body.offset===0?Array.from({length:32},(_,n)=>({'会員ID':String(n+1).padStart(6,'0'),'ハンドルネーム':'HN'+n})):[{'会員ID':'056075','ハンドルネーム':'ガブロジー'}];
    return new Response(JSON.stringify({d:JSON.stringify(d)}));
  });
  assert.equal(result.length,33);assert.equal(result[32].id,'056075');assert.deepEqual(offsets,[0,32]);
  await assert.rejects(fetchEventParticipants({shopId:'s',eventId:'e',seq:'2'},async()=>new Response('{"d":{}}')),/データ形式/);
});

test('BYE placeholders are excluded while the real bye player is retained',()=>{
 const html='<table><tr><td>卓番</td><td>No.</td><td>あなたのお名前</td><td>累計得点</td><td>対戦相手のお名前</td></tr>'+['BYE','不戦勝','Bye (不戦勝)','', '実在プレイヤー'].map((name,i)=>`<tr><td>不戦勝</td><td>${i}</td><td onclick="VisitorLock('${i}','x')">${name}</td><td>0</td><td>不戦勝</td></tr>`).join('')+'</table>';
 const result=parseRound(html,'5482242',5);
 assert.equal(result.participants.length,1);assert.equal(result.participants[0].name,'実在プレイヤー');assert.equal(result.participants[0].bye,true);assert.equal(result.participants[0].dmpId,null);
});

test('public table without optional No. column is recognized and uses internal IDs',()=>{
 const html=`<table><tr><td>卓番</td><td>あなたのお名前</td><td>累計得点</td><td>対戦相手のお名前</td><td>累計得点</td></tr>
 <tr><td>1</td><td onclick="VisitorLock('123','A')">A</td><td>9</td><td>B</td><td>9</td></tr>
 <tr><td>1</td><td onclick="VisitorLock('456','B')">B</td><td>9</td><td>A</td><td>9</td></tr></table>`;
 const result=parseRound(html,'7413902',4);
 assert.equal(result.participants.length,2);
 assert.deepEqual(result.participants.map(p=>p.participantKey),['id:123','id:456']);
 assert.ok(result.participants.every(p=>p.rawNo===''&&p.dmpId===null&&p.table===1));
});

test('table numbers extract normalized digits only from the table cell',()=>{
  for(const [text,expected] of [
    ['12',12],['12〜',12],['12～',12],['12 〜',12],['12 ～',12],
    ['12~',12],['12 ~',12],['１２〜',12],['123〜',123],
    ['',null],['　',null],['〜',null],['BYE',null],['不戦勝',null],
    ['0',null],['9007199254740992',null],
  ]) {
    // Other cells contain entry number 45190, participant ID 8 and score 9.
    const html=fixture('round-number').replace('<td>2</td>',`<td>${text}</td>`);
    const p=parseRound(html,'8005807',5).participants[0];
    assert.equal(p.table,expected,text);assert.equal(p.tableNumber,expected,text);
    assert.equal(p.participantKey,'id:8');assert.equal(p.dmpId,null);
  }
});

test('5856470 three-column wave table retains both sides of each pairing',()=>{
  const participants=parseRound(fixture('round-three-column-wave'),'5856470',1).participants;
  assert.equal(participants.length,4);
  assert.deepEqual(participants.map(p=>p.table),[1,1,2,2]);
  assert.deepEqual(participants.map(p=>p.participantKey),['id:1','id:2','id:3','id:4']);
  assert.ok(participants.every(p=>p.rawNo==='' && p.dmpId===null));
  const bye=parseRound(fixture('round-three-column-wave').replace('1～','不戦勝'),'5856470',1).participants[0];
  assert.equal(bye.table,null);assert.equal(bye.bye,true);
});

test('anonymous fetch sorts wave table numbers numerically and missing tables last',async()=>{
  const f=fakeSource();
  const result=await fetchTcgMatching(source,async(url,opts)=>{
    if(new URL(url).pathname!=='/tourround.asp') return f.fetch(url,opts);
    const tables=['12～','1〜','１１ ~','2 ~','10',''];
    return new Response('<table><tr><td>卓番</td><td>あなたのお名前</td><td>対戦相手のお名前</td></tr>'+tables.map((table,i)=>
      `<tr><td>${table}</td><td onclick="VisitorLock('${i+1}','Player')">Player ${i+1}</td><td>Opponent 999</td></tr>`).join('')+'</table>');
  });
  assert.equal(result.latestRound,5);
  assert.deepEqual(result.participants.map(p=>p.tableNumber),[1,2,10,11,12,null]);
});
