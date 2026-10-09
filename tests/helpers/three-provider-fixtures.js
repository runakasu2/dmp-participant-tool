const fs=require('node:fs'),path=require('node:path');
const tid='2703954',tcgUrl='https://tcg.sfc-jpn.jp/loginnum.asp?tid='+tid;
const eventId='dcb0aac1-ab7f-4261-b997-6614e93cc8d2',id=n=>'48380b24-dc2b-4fee-a063-'+String(n).padStart(12,'0');
const entries=[1,2,3].map(n=>({eventId,entryId:id(n),playerName:'　同名',duemaId:n===2?null:'000'+n,isReception:true,dropped:n===1,entryNo:n}));
const sugaUrl='https://sugatool.nojigikucs.com/events/'+eventId+'/matches';
const match=round=>({matchId:'match-'+round,eventId,round,seatNumber:1,player1Id:id(1),player2Id:id(2),result:'player1',winnerId:id(1)});
function providerFetch(state){return async(url,options)=>{
 if(state.offline)throw Error('offline');const u=new URL(url);
 if(u.hostname==='tcg.sfc-jpn.jp'){
  if(u.pathname==='/loginnum.asp')return new Response(`<form action="login_bin.asp"><input name="tid" value="${tid}"></form>`,{headers:{'Set-Cookie':'anon=1'}});
  if(u.pathname==='/login_bin.asp')return new Response(null,{status:302,headers:{Location:'/tour.asp?tid='+tid}});
  if(u.pathname==='/tour.asp')return new Response(`<form action="tour.asp"><input name="tid" value="${tid}"></form>${[1,2,3,4,9999999].map(k=>`<a href="tourround.asp?tid=${tid}&kno=${k}&znt=${k===9999999?1:0}">round</a>`).join('')}`);
  if(state.badTcg&&u.searchParams.get('kno')==='2')return new Response('failure',{status:503});
  return new Response(state.emptyTcg?'<p>no data</p>':fs.readFileSync(path.join(__dirname,'../fixtures/tcg-meister/2703954',u.searchParams.get('kno')+'-'+u.searchParams.get('Page')+'.html'),'utf8'));
 }
 if(u.hostname==='boi0m28318.execute-api.ap-northeast-1.amazonaws.com'){
  const round=Number(u.searchParams.get('round'));
  if(state.badSuga&&round===2)return new Response('{}',{status:503});
  return new Response(JSON.stringify(u.pathname.endsWith('/entries')?entries:u.pathname.endsWith('/matches')?state.emptySuga||state.emptyRound===round?[]:[{...match(round),result:state.result||'player1',winnerId:state.result==='player2'?id(2):id(1)},...(round===3?[{matchId:'bye-3',eventId,round:3,seatNumber:2,player1Id:id(3),player2Id:null,result:'bye',winnerId:id(3)}]:[])]:{eventId,published:true,currentRound:3,maxRounds:20,gameFormat:['original']}));
 }
 throw Error('Unexpected source '+url);
};}
module.exports={tid,tcgUrl,eventId,id,entries,sugaUrl,providerFetch};
