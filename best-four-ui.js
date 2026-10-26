// The event catalogue already resolves aliases and full ShopID + EventID + Seq history.
// Count each recorded event/player result once, without fetching external sites or the DB again.
function buildBestFourSummary(events, filters={}) {
  const decks=new Map();let totalPlacements=0,knownPlacements=0,missingEvents=0;
  for(const event of events){
    if(!Number(event.result_count)){missingEvents++;continue;}
    const seen=new Set();
    for(const player of event.best_four||[]){
      if(!Number.isInteger(player.rank)||player.rank<1||player.rank>4)continue;
      if(player.dmpId!=null){if(seen.has(player.dmpId))continue;seen.add(player.dmpId);}
      totalPlacements++;
      const name=String(player.deckName??'').trim();
      if(!name)continue;
      knownPlacements++;
      const key=player.deckId==null?'name:'+name:'id:'+player.deckId;
      if(!decks.has(key))decks.set(key,{deckId:player.deckId??null,deckName:name,count:0});
      decks.get(key).count++;
    }
  }
  return {...filters,totalEvents:events.length,includedEvents:events.length-missingEvents,missingEvents,
    totalPlacements,knownPlacements,unknownPlacements:totalPlacements-knownPlacements,
    decks:[...decks.values()].map(deck=>({...deck,percentage:knownPlacements?deck.count/knownPlacements*100:0}))
      .sort((a,b)=>b.count-a.count||a.deckName.localeCompare(b.deckName,'ja')||String(a.deckId).localeCompare(String(b.deckId)))};
}
function createBestFourControls(readContext){
  const panel=document.getElementById('best-four-summary'),status=document.getElementById('best-four-status'),body=document.getElementById('best-four-rows');
  let version=0;
  function clear(){version++;panel.hidden=true;body.replaceChildren();status.textContent='';}
  async function load(){
    clear();const request=version;panel.hidden=false;status.textContent='ベスト4使用率を集計中...';
    try{
      const {events,...filters}=readContext();
      // Yield so loading state can paint. Cancellation keeps old filters from overwriting new ones.
      await new Promise(resolve=>setTimeout(resolve,0));
      if(request!==version)return;
      const data=buildBestFourSummary(events,filters);
      status.textContent=`${DECK_FORMAT_LABELS[data.format]} ／ ${data.startDate||'開始指定なし'} ～ ${data.endDate||'終了指定なし'}`+
        (data.eventName?` ／ 大会名：${data.eventName}`:'')+'\n'+
        `対象大会：${data.totalEvents} ／ 結果取得済み：${data.includedEvents} ／ 結果未取得：${data.missingEvents}\n`+
        `ベスト4入賞総数：${data.totalPlacements}件 ／ デッキ判明済み：${data.knownPlacements}件 ／ 未登録：${data.unknownPlacements}件\n`+
        '使用率はデッキ判明済み入賞数を分母に計算。保存済み結果の順位1〜4位のみを集計します。';
      if(!data.totalEvents)status.textContent+='\n条件に一致する大会がありません。';
      else if(!data.includedEvents)status.textContent+='\n結果取得済みの大会がありません。';
      else if(!data.totalPlacements)status.textContent+='\n順位1〜4位として記録された入賞者がいません。';
      else if(!data.knownPlacements)status.textContent+='\n入賞者のデッキはすべて未登録です。';
      data.decks.forEach((deck,index)=>{
        const row=document.createElement('tr');
        for(const value of [index+1,deck.deckName,deck.count+'件',deck.percentage.toFixed(1)+'%']){
          const cell=document.createElement('td');cell.textContent=value;row.appendChild(cell);
        }
        body.appendChild(row);
      });
      if(data.unknownPlacements){const row=document.createElement('tr');for(const value of ['—','未登録',data.unknownPlacements+'件','対象外']){const cell=document.createElement('td');cell.textContent=value;row.appendChild(cell);}body.appendChild(row);}
    }catch(error){if(request===version)status.textContent=error.message;}
  }
  document.getElementById('show-best-four').addEventListener('click',load);
  document.getElementById('close-best-four').addEventListener('click',()=>{clear();document.getElementById('show-best-four').focus();});
  return {clear,load};
}
if(typeof module!=='undefined')module.exports={buildBestFourSummary,createBestFourControls};
