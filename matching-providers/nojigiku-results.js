const {latestMatching}=require('../deck-memo');
const fail=message=>Object.assign(new Error(message),{status:502});
function normalizeNojigikuMatches(matches,users=[]) {
  if(!Array.isArray(matches)||matches.length>10000)throw fail('対戦表の件数・形式が不正です。');
  const unique=new Map(),rounds=new Map();
  for(const raw of matches){
    if(!raw||!/^\d+$/.test(String(raw.round))||Number(raw.round)<1||Number(raw.round)>100||!/^\d+$/.test(String(raw.table))||!Number.isSafeInteger(Number(raw.table))||Number(raw.table)<1)throw fail('対戦表の回戦・卓が不正です。');
    const key=Number(raw.round)+':'+Number(raw.table);
    const players=latestMatching([raw],users).participants;
    // A real player can lack a DMP ID. Keep the provider entry number separately;
    // never match such players to a DMP player by name.
    for(const side of [1,2]){
      if(players.some(p=>p.side===side))continue;
      const id=String(raw['user'+side+'id']??''),name=String(raw['user'+side]||'').replace(/\s*[（(]\s*\d+\s*点\s*[）)]\s*$/,'').trim();
      if(!['','0'].includes(id)||!name||/^Bye\s*[（(]不戦勝[）)]$/i.test(name))continue;
      const entry=raw['user'+side+'no'];
      players.push({dmpId:null,name,table:Number(raw.table),side,entryNo:/^\d+$/.test(String(entry))?entry:null});
    }
    players.sort((a,b)=>a.side-b.side);
    if(!players.length)throw fail('選手のいない対戦表は保存できません。');
    const sides=players.map(p=>({...p,participantKey:p.dmpId?'dmp:'+p.dmpId:p.entryNo!=null?'entry:'+p.entryNo:'seat:'+key+':'+p.side,round:Number(raw.round)}));
    const winner=raw.winner==null?null:String(raw.winner);
    let outcome='unresolved',winnerKey=null,reason='winner_unknown';
    if(sides.length===1){const absent=3-sides[0].side;const isBye=/^Bye\s*[（(]不戦勝[）)]$/i.test(String(raw['user'+absent]||'').trim());outcome=isBye?'bye':'unresolved';reason=isBye?'explicit_bye':'missing_opponent';}
    else if(winner!=null&&/^\d+$/.test(winner)&&sides.every(p=>p.entryNo!=null)&&String(sides[0].entryNo)!==String(sides[1].entryNo)){
      const won=sides.find(p=>String(p.entryNo)===winner);
      if(won){outcome='win_loss';winnerKey=won.participantKey;reason=null;}
      else reason='winner_not_in_match';
    } else if(winner!=null)reason='special_or_ambiguous_winner';
    const match={round:Number(raw.round),table:Number(raw.table),matchKey:'table:'+Number(raw.table),sides,outcome,winnerKey,reason,rawResult:{winner:raw.winner??null,user1no:raw.user1no??null,user2no:raw.user2no??null}};
    if(unique.has(key)&&JSON.stringify(unique.get(key))!==JSON.stringify(match))throw fail('同じ回戦・卓の対戦表が競合しています。');
    unique.set(key,match);
  }
  for(const m of unique.values()){if(!rounds.has(m.round))rounds.set(m.round,[]);rounds.get(m.round).push(m);}
  // Validate identity uniqueness across tables in each round, preserving leading-zero DMP IDs.
  for(const rows of rounds.values()){const ids=new Set();for(const m of rows)for(const p of m.sides){if(ids.has(p.participantKey))throw fail('同一回戦に同じ参加者IDが重複しています。');ids.add(p.participantKey);}}
  return [...rounds].sort(([a],[b])=>a-b).map(([round,rows])=>({round,matches:rows.sort((a,b)=>a.table-b.table),participants:rows.flatMap(m=>m.sides.map(p=>({...p,opponentName:m.sides.find(q=>q.participantKey!==p.participantKey)?.name||'相手なし',outcome:m.outcome,winnerKey:m.winnerKey})))}));
}
module.exports={normalizeNojigikuMatches};
